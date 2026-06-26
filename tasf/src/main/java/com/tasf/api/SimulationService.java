package com.tasf.api;

import com.tasf.planner.alns.ALNSPlanner;
import com.tasf.planner.core.PlanningContext;
import com.tasf.planner.core.RouteEvaluator;
import com.tasf.planner.core.ScenarioConfig;
import com.tasf.planner.core.WorkingSolution;
import com.tasf.planner.model.Airport;
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.model.RoutePlan;
import com.tasf.planner.model.RouteSegment;
import com.tasf.planner.repository.AirportRepository;
import com.tasf.planner.repository.FlightRepository;
import com.tasf.planner.repository.ShipmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

@Service
public class SimulationService {

    // BASE_UTC del ShipmentRepository — ambos deben coincidir
    private static final LocalDateTime BASE_UTC            = LocalDateTime.of(2026, 1, 1, 0, 0);
    // Tamaño de bloque en horas GMT. Bloques más grandes ⇒ menos llamadas al
    // ALNS ⇒ el período de 5 días entra en ≤30 min sin que el planificador se
    // convierta en el cuello de botella. 3 h = 40 bloques para 5 días.
    private static final int            BLOCK_HOURS         = 3;
    // ⏱ ÚNICO punto para ajustar la velocidad de Período/Colapso: segundos
    // reales que dura la animación de UN bloque. Período (5 días) = 40 bloques,
    // 40 × 45 s = 30 min. Cambiar SOLO este número para acortar/alargar.
    // (Día a Día va en tiempo real y NO usa este valor.)
    private static final int            BLOCK_REAL_SECONDS  = 45;
    // ⏱ ÚNICO punto para la velocidad de Día a Día (modo de pruebas de
    // registro/cancelación). 24 h / 3 h = 8 bloques; 8 × 113 s ≈ 15 min por día.
    private static final int            DIADIA_BLOCK_SECONDS = 113;
    private static final int            ALNS_TIME_BUDGET_SEC = 25;
    private static final int            ALNS_MAX_ITERATIONS  = 0;
    private static final int            BROADCAST_INTERVAL_MS = 800;

    private final List<SseEmitter> emitters   = new CopyOnWriteArrayList<>();
    private final ExecutorService  executor   = Executors.newSingleThreadExecutor();
    private final ExecutorService  lookahead  = Executors.newSingleThreadExecutor();
    private final AtomicBoolean    running    = new AtomicBoolean(false);
    private final AtomicBoolean    paused     = new AtomicBoolean(false);
    private final AtomicInteger    generation = new AtomicInteger(0);

    private final ConcurrentLinkedQueue<String> pendingCancellations
        = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<BaggageLot> pendingAdditions
        = new ConcurrentLinkedQueue<>();
    // Edición de la red en caliente (mid-run): nuevos vuelos/aeropuertos y cierres.
    private final ConcurrentLinkedQueue<FlightInstance> pendingFlightAdds
        = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<Airport> pendingAirportAdds
        = new ConcurrentLinkedQueue<>();
    private final ConcurrentLinkedQueue<String> pendingAirportCloses
        = new ConcurrentLinkedQueue<>();
    private final AtomicInteger userFlightSeq = new AtomicInteger(0);

    private final AirportRepository  repoAirports  = new AirportRepository();
    private final FlightRepository   repoFlights   = new FlightRepository();
    private final ShipmentRepository repoShipments = new ShipmentRepository();
    private volatile Map<String, Airport> cachedAirports = null;
    private volatile List<FlightInfo>     cachedFlights  = null;
    private volatile Map<String, Integer> flightCapacityById = Map.of();
    private volatile List<FlightInstance> scheduledFlights   = List.of();
    private volatile PlanningContext      activeContext      = null;

    private volatile SimulationState state = SimulationState.initial();

    // ── API pública ──────────────────────────────────────────────────────────

    public synchronized SimulationState start(StartRequest request) {
        StartRequest safeRequest = request == null
                ? new StartRequest("diadia", null, null, null, null) : request;
        stop();
        int    runId = generation.incrementAndGet();
        String mode  = normalizeMode(safeRequest.mode());
        running.set(true);
        paused.set(false);
        state = SimulationState.initial()
                .withMode(mode).withRunning(true).withMessage("Cargando datos...");
        broadcast(state);
        executor.submit(() -> runSimulation(
                new StartRequest(mode, safeRequest.blockSeconds(),
                                safeRequest.startDate(), safeRequest.numDays(),
                                safeRequest.startMinuteOfDay()), runId));
        return state;
    }

    public synchronized SimulationState stop() {
        generation.incrementAndGet();
        running.set(false);
        paused.set(false);
        state = state.withRunning(false).withMessage("Detenido");
        broadcast(state);
        return state;
    }

    /** Pausa la simulación en curso: congela el reloj sin terminar el run. */
    public synchronized SimulationState pause() {
        if (running.get() && !paused.get()) {
            paused.set(true);
            state = state.withMessage("Pausado");
            broadcast(state);
        }
        return state;
    }

    /** Reanuda una simulación pausada desde el punto exacto en que se pausó. */
    public synchronized SimulationState resume() {
        paused.set(false);
        if (running.get() && "Pausado".equals(state.message())) {
            state = state.withMessage("Simulación activa");
            broadcast(state);
        }
        return state;
    }

    public SimulationState currentState() { return state; }

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(   () -> emitters.remove(emitter));
        emitter.onError(   e -> emitters.remove(emitter));
        send(emitter, state);
        return emitter;
    }

    /**
     * Cancela un vuelo. Reglas del caso (por instancia de día):
     *  · Solo se puede cancelar la salida de HOY si faltan ≥ 60 min para ella;
     *    si la cancelación llega dentro de la última hora (o tras la salida),
     *    se cancela la instancia del DÍA SIGUIENTE.
     *  · Las maletas asignadas a la instancia cancelada se replanifican.
     */
    public SimulationState cancelFlight(String flightId) {
        if (!running.get()) return state;
        PlanningContext ctx = activeContext;
        FlightInstance  f   = scheduledFlights.stream()
                .filter(x -> x.getId().equals(flightId)).findFirst().orElse(null);
        if (ctx == null || f == null) return state;

        int now      = state.simulatedMinute();
        int depToday = (now / 1440) * 1440 + f.getDepartureHour();
        // ≥ 60 min antes de la salida de hoy → cancela hoy; si no, mañana.
        int targetDep = (now <= depToday - 60) ? depToday : depToday + 1440;

        ctx.cancelInstance(flightId, targetDep);
        pendingCancellations.add(flightId + "@" + targetDep);
        return state;
    }

    // ── Registro de lotes (solo día a día) ─────────────────────────────────────

    /**
     * Evalúa la viabilidad de un nuevo lote SIN agregarlo: ¿existe ruta dentro
     * del plazo (1 día mismo continente / 2 días si no), con capacidad de vuelo,
     * y cómo está la ocupación de los almacenes de origen y destino?
     */
    public FeasibilityReport evaluateLot(String origin, String destination, int quantity) {
        try {
            Map<String, Airport> airports = loadAirports();
            Airport o = airports.get(origin), d = airports.get(destination);
            if (o == null || d == null)
                return FeasibilityReport.infeasible("Aeropuerto de origen o destino no válido");
            if (origin.equals(destination))
                return FeasibilityReport.infeasible("Origen y destino no pueden ser el mismo");
            if (quantity <= 0)
                return FeasibilityReport.infeasible("La cantidad debe ser mayor que 0");

            List<FlightInstance> flights = repoFlights.loadFlights("data/planes_vuelo.txt", airports);
            PlanningContext context = new PlanningContext(airports, flights, ScenarioConfig.defaultWeek4());

            int     regMin        = Math.max(0, state.simulatedMinute());
            boolean sameContinent = o.getRegion().equals(d.getRegion());
            int     slaMin        = sameContinent ? 24 * 60 : 48 * 60;

            BaggageLot lot = new BaggageLot("USER-EVAL", origin, destination,
                    quantity, regMin, regMin + slaMin, false);
            List<RoutePlan> candidates = new RouteEvaluator(context).enumerateCandidates(lot);

            int origPct = warehousePctFromState(origin);
            int destPct = warehousePctFromState(destination);

            if (candidates.isEmpty()) {
                return new FeasibilityReport(false,
                        "Sin ruta viable dentro del plazo (" + (sameContinent ? "1 día" : "2 días") + ")",
                        sameContinent, slaMin / 60, 0, 0.0, List.of(), origPct, destPct);
            }

            RoutePlan best = candidates.get(0);
            List<String> path = new ArrayList<>();
            path.add(best.getSegments().get(0).getOrigin());
            for (RouteSegment s : best.getSegments()) path.add(s.getDestination());

            boolean capacityOk = best.getSegments().stream()
                    .allMatch(s -> flightCapacity(flights, s.getFlightId()) >= quantity);
            double etaHours = best.getTotalTravelHours() / 60.0;

            return new FeasibilityReport(capacityOk,
                    capacityOk ? "Ruta viable encontrada"
                               : "Ruta encontrada pero algún vuelo no tiene capacidad para "
                                 + quantity + " maletas",
                    sameContinent, slaMin / 60, best.transfers(),
                    Math.round(etaHours * 10) / 10.0, path, origPct, destPct);
        } catch (Exception e) {
            return FeasibilityReport.infeasible("Error evaluando: " + e.getMessage());
        }
    }

    /** Encola un nuevo lote para inyectarlo en la simulación día a día en curso. */
    public synchronized SimulationState addLot(String origin, String destination, int quantity) {
        if (!running.get() || !"diadia".equals(state.mode())) return state;
        try {
            Map<String, Airport> airports = loadAirports();
            Airport o = airports.get(origin), d = airports.get(destination);
            if (o == null || d == null || origin.equals(destination) || quantity <= 0) return state;
            int     regMin        = Math.max(0, state.simulatedMinute());
            boolean sameContinent = o.getRegion().equals(d.getRegion());
            int     dueMin        = regMin + (sameContinent ? 24 * 60 : 48 * 60);
            pendingAdditions.add(new BaggageLot(
                    "USER-" + System.currentTimeMillis(),
                    origin, destination, quantity, regMin, dueMin, false));
        } catch (IOException e) {
            System.err.println("Error agregando lote: " + e.getMessage());
        }
        return state;
    }

    private int flightCapacity(List<FlightInstance> flights, String flightId) {
        return flights.stream()
                .filter(f -> f.getId().equals(flightId))
                .mapToInt(FlightInstance::getCapacity)
                .findFirst().orElse(0);
    }

    private int warehousePctFromState(String code) {
        return state.airports().stream()
                .filter(a -> a.code().equals(code))
                .mapToInt(a -> a.capacity() == 0 ? 0
                        : (int) Math.round(a.current() * 100.0 / a.capacity()))
                .findFirst().orElse(0);
    }

    // ── Edición de la red en caliente (solo con simulación en curso) ───────────

    /** Agrega un vuelo (horas LOCALES de origen/destino → se convierten a UTC). */
    public synchronized SimulationState addFlight(String origin, String destination,
            String departureLocal, String arrivalLocal, int capacity) {
        PlanningContext ctx = activeContext;
        if (!running.get() || ctx == null) return state;
        try {
            Airport o = ctx.getAirports().get(origin);
            Airport d = ctx.getAirports().get(destination);
            if (o == null || d == null || origin.equals(destination) || capacity <= 0) return state;
            int depUtc = toUtcMinuteOfDay(departureLocal, o.getGmtOffset());
            int arrUtc = toUtcMinuteOfDay(arrivalLocal,   d.getGmtOffset());
            if (arrUtc < depUtc) arrUtc += 1440;
            pendingFlightAdds.add(new FlightInstance(
                    "U" + userFlightSeq.incrementAndGet(),
                    origin, destination, depUtc, arrUtc, capacity, false));
        } catch (Exception e) {
            System.err.println("Error agregando vuelo: " + e.getMessage());
        }
        return state;
    }

    /** Agrega un aeropuerto con su almacén (gmtHours en horas, p.ej. -5, +2). */
    public synchronized SimulationState addAirport(String code, String region,
            double lat, double lng, int gmtHours, int capacity) {
        if (!running.get() || activeContext == null
                || code == null || code.isBlank() || capacity <= 0) return state;
        pendingAirportAdds.add(new Airport(
                code.trim().toUpperCase(),
                (region == null || region.isBlank()) ? "UNKNOWN" : region,
                capacity, gmtHours * 60, lat, lng));
        return state;
    }

    /** Cierra un aeropuerto: deja de usarse para ruteo de nuevas rutas. */
    public synchronized SimulationState closeAirport(String code) {
        if (!running.get() || activeContext == null || code == null) return state;
        pendingAirportCloses.add(code.trim().toUpperCase());
        return state;
    }

    /**
     * Carga masiva desde un archivo arrastrado (mismo formato que el dataset).
     * type = "planes" | "airports" | "lots". Para lots, `origin` es el código
     * del aeropuerto de origen (en el dataset va en el nombre del archivo).
     */
    public synchronized SimulationState uploadData(String type, String content, String origin) {
        PlanningContext ctx = activeContext;
        if (!running.get() || ctx == null || content == null || content.isBlank()) return state;
        try {
            if ("planes".equals(type)) {
                java.io.File tmp = java.io.File.createTempFile("up_planes", ".txt");
                java.nio.file.Files.writeString(tmp.toPath(), content);
                for (FlightInstance f : repoFlights.loadFlights(tmp.getAbsolutePath(), ctx.getAirports())) {
                    pendingFlightAdds.add(new FlightInstance(
                            "U" + userFlightSeq.incrementAndGet(),
                            f.getOrigin(), f.getDestination(),
                            f.getDepartureHour(), f.getArrivalHour(), f.getCapacity(), false));
                }
                tmp.delete();
            } else if ("airports".equals(type)) {
                java.io.File tmp = java.io.File.createTempFile("up_airports", ".txt");
                java.nio.file.Files.write(tmp.toPath(),
                        content.getBytes(java.nio.charset.StandardCharsets.UTF_16));
                repoAirports.loadAirports(tmp.getAbsolutePath()).values()
                        .forEach(pendingAirportAdds::add);
                tmp.delete();
            } else if ("lots".equals(type) && origin != null) {
                Airport o = ctx.getAirports().get(origin.trim().toUpperCase());
                if (o == null) return state;
                for (String raw : content.split("\\r?\\n")) {
                    String line = raw.trim();
                    if (line.isEmpty()) continue;
                    String[] p = line.split("-");
                    if (p.length < 6) continue;
                    try {
                        String ds = p[1];
                        int y = Integer.parseInt(ds.substring(0, 4));
                        int mo = Integer.parseInt(ds.substring(4, 6));
                        int da = Integer.parseInt(ds.substring(6, 8));
                        int hh = Integer.parseInt(p[2].trim());
                        int mm = Integer.parseInt(p[3].trim());
                        String dest = p[4].trim().toUpperCase();
                        int qty = Integer.parseInt(p[5].replaceAll("[^0-9]", ""));
                        Airport d = ctx.getAirports().get(dest);
                        if (d == null || qty <= 0) continue;
                        int regUtc = (int) (Duration.between(BASE_UTC,
                                LocalDateTime.of(y, mo, da, hh, mm)).toMinutes() - o.getGmtOffset());
                        boolean same = o.getRegion().equals(d.getRegion());
                        pendingAdditions.add(new BaggageLot("UF-" + userFlightSeq.incrementAndGet(),
                                origin.trim().toUpperCase(), dest, qty,
                                regUtc, regUtc + (same ? 1440 : 2880), false));
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception e) {
            System.err.println("Error cargando archivo (" + type + "): " + e.getMessage());
        }
        return state;
    }

    private int toUtcMinuteOfDay(String hhmm, int gmtOffsetMin) {
        String[] p = hhmm.split(":");
        int local = Integer.parseInt(p[0].trim()) * 60 + Integer.parseInt(p[1].trim());
        return (((local - gmtOffsetMin) % 1440) + 1440) % 1440;
    }

    private Map<String, Airport> loadAirports() throws IOException {
        if (cachedAirports == null) {
            synchronized (this) {
                if (cachedAirports == null) {
                    cachedAirports = repoAirports.loadAirports("data/aeropuertos.txt");
                }
            }
        }
        return cachedAirports;
    }

    /** Lista estática de todos los vuelos disponibles con su capacidad. */
    public List<FlightInfo> getFlights() {
        if (cachedFlights == null) {
            synchronized (this) {
                if (cachedFlights == null) {
                    try {
                        Map<String, Airport> airports = loadAirports();
                        List<FlightInstance> flights =
                                repoFlights.loadFlights("data/planes_vuelo.txt", airports);
                        cachedFlights = flights.stream()
                                .sorted(Comparator.comparing(FlightInstance::getOrigin)
                                        .thenComparingInt(FlightInstance::getDepartureHour))
                                .map(f -> new FlightInfo(
                                        f.getId(), f.getOrigin(), f.getDestination(),
                                        fmtHHMM(f.getDepartureHour()),
                                        fmtHHMM(f.getArrivalHour()),
                                        f.getCapacity()))
                                .collect(Collectors.toList());
                    } catch (Exception e) {
                        System.err.println("Error cargando vuelos: " + e.getMessage());
                        return List.of();
                    }
                }
            }
        }
        return cachedFlights;
    }

    public List<String> getAvailableDates() {
        try {
            return repoShipments.getAvailableDatesLightweight("data/envios/")
                    .stream().map(LocalDate::toString).collect(Collectors.toList());
        } catch (Exception e) {
            System.err.println("Error cargando fechas disponibles: " + e.getMessage());
            return List.of();
        }
    }

    // ── Simulación ───────────────────────────────────────────────────────────

    private void runSimulation(StartRequest request, int runId) {
        try {
            // 1. Cargar datos
            Map<String, Airport> airports = loadAirports();
            List<FlightInstance> flights  = repoFlights.loadFlights("data/planes_vuelo.txt", airports);
            PlanningContext      context  = new PlanningContext(airports, flights,
                                                                ScenarioConfig.defaultWeek4());
            flightCapacityById = flights.stream().collect(Collectors.toMap(
                    FlightInstance::getId, FlightInstance::getCapacity, (a, b) -> a));
            scheduledFlights = context.getFlights();   // lista viva (incluye altas)
            activeContext    = context;                // cancelaciones + edición de red

            // 2. Encontrar ventana de días: desde la fecha elegida (o la primera
            //    disponible si no hay/ es inválida), tomando daysToLoad días
            //    consecutivos (0 = hasta el final del dataset, modo colapso).
            int daysToLoad = daysForMode(request.mode(), request.numDaysOrDefault(5));
            LocalDate startDate = null;
            if (request.startDate() != null && !request.startDate().isBlank()) {
                try { startDate = LocalDate.parse(request.startDate()); }
                catch (Exception e) {
                    System.err.println("Fecha inválida '" + request.startDate() + "' — usando primera disponible.");
                }
            }
            if (startDate == null) {
                List<LocalDate> avail = repoShipments.getAvailableDatesLightweight("data/envios/");
                startDate = avail.isEmpty() ? null : avail.get(0);
            }
            List<LocalDate> days = startDate == null ? List.of()
                    : repoShipments.getDaysFrom("data/envios/", airports, startDate, daysToLoad);

            if (days == null || days.isEmpty()) {
                running.set(false);
                state = state.withRunning(false).withMessage("No hay días disponibles para simular");
                broadcast(state);
                return;
            }

            // 4. Calcular offset absoluto de los días encontrados.
            //    El usuario puede elegir hora y minuto de inicio dentro del primer
            //    día: la simulación arranca en ese minuto (se omiten los lotes
            //    anteriores de ese día) y termina al final del último día cargado.
            int dayStartAbs     = absoluteMinute(days.get(0).atStartOfDay());
            int simulationStart = dayStartAbs + request.startMinuteOrDefault();
            int simulationEnd   = dayStartAbs + days.size() * 1440;
            int blockMinutes    = BLOCK_HOURS * 60;

            System.out.printf("Simulación: %s → %s | start=%d end=%d | carga por bloques%n",
                    days.get(0), days.get(days.size() - 1),
                    simulationStart, simulationEnd);

            WorkingSolution solution         = new WorkingSolution(context);
            int             delivered        = 0;
            int             replanifications = 0;
            boolean         collapsed        = false;
            List<SimEvent>  allEvents        = new ArrayList<>();
            List<SimEvent>  carryoverEvents  = new ArrayList<>();

            // Acumuladores globales — se actualizan AL TERMINAR cada bloque,
            // no al inicio, para que los contadores empiecen en 0 y crezcan
            // gradualmente conforme el tiempo simulado avanza.
            int accumTotalBags     = 0;
            int accumRoutedBags    = 0;
            int accumOutOfDeadline = 0;

            // Precalcular bloque 1 completamente en background (carga + ALNS)
            Future<BlockResult> nextFuture = submitBlockWork(
                    lookahead, context, airports,
                    simulationStart, Math.min(simulationStart + blockMinutes, simulationEnd),
                    1, solution);

            for (int blockStart = simulationStart, blockNo = 1;
                isActive(runId) && blockStart < simulationEnd && !collapsed;
                blockStart += blockMinutes, blockNo++) {

                int blockEnd = Math.min(blockStart + blockMinutes, simulationEnd);

                // Recoger resultado del bloque actual (carga + ALNS paralelo)
                BlockResult blockResult;
                try {
                    blockResult = nextFuture.get();
                } catch (Exception e) {
                    System.err.println("Error en lookahead bloque " + blockNo + ": " + e.getMessage());
                    blockResult = new BlockResult(solution, List.of());
                }

                solution = blockResult.solution();
                List<BaggageLot> rawBlockLots = blockResult.lots();

                final boolean collapseMode = "colapso".equals(request.mode());
                List<BaggageLot> blockLots = applyCollapseMode(rawBlockLots, collapseMode);

                // ── SNAPSHOT de acumuladores ANTES de este bloque ─────────────
                // Los contadores del panel arrancan desde el estado real al inicio
                // del bloque (lotes de bloques anteriores ya contabilizados).
                // Los lotes del bloque actual se irán sumando dinámicamente dentro
                // del loop de animación conforme su registrationHour sea alcanzado.
                final int prevBlockTotal   = accumTotalBags;
                final int prevBlockRouted  = accumRoutedBags;
                final int prevBlockOverdue = accumOutOfDeadline;

                if (!blockLots.isEmpty()) {
                    List<SimEvent> blockEvents = buildEvents(solution, blockLots, blockStart, blockEnd);
                    List<SimEvent> merged = new ArrayList<>(carryoverEvents.size() + blockEvents.size());
                    merged.addAll(carryoverEvents);
                    merged.addAll(blockEvents);
                    merged.sort(Comparator.comparingInt(SimEvent::minute)
                                          .thenComparing(SimEvent::type));
                    allEvents = merged;
                } else if (!carryoverEvents.isEmpty()) {
                    allEvents = new ArrayList<>(carryoverEvents);
                }

                // Lanzar INMEDIATAMENTE el siguiente bloque en background
                int nextBlockStart = blockStart + blockMinutes;
                int nextBlockEnd   = Math.min(nextBlockStart + blockMinutes, simulationEnd);
                final int nextBlockNo = blockNo + 1;
                final WorkingSolution solSnap = solution;

                if (nextBlockStart < simulationEnd && isActive(runId)) {
                    nextFuture = submitBlockWork(
                            lookahead, context, airports,
                            nextBlockStart, nextBlockEnd,
                            nextBlockNo, solSnap);
                }

                // Notificar inicio de bloque — contadores aún en estado previo,
                // sin sumar nada del bloque actual (los lotes no son visibles aún).
                List<AirportState> staticAirports = airportStaticList(airports, solution, blockStart);
                List<RouteState>   prevRoutes     = state.routes();
                state = new SimulationState(
                        true, request.mode(),
                        fmtClock(blockStart), blockNo,
                        fmtClock(blockStart), fmtClock(blockEnd),
                        staticAirports, prevRoutes, List.of(),
                        buildKpis(prevBlockTotal, prevBlockRouted, prevBlockOverdue,
                                solution, staticAirports, List.of(),
                                delivered, replanifications, 0, blockStart),
                        false, blockLots.isEmpty()
                            ? "Simulación activa"
                            : "Bloque " + blockNo + " (" + blockLots.size() + " lotes)",
                        blockStart,
                        List.of());
                broadcast(state);

                if (!isActive(runId)) return;

                // Animar bloque actual
                List<SimEvent> events  = allEvents;
                long realStart         = System.currentTimeMillis();
                // Duración real de la animación de este bloque (paso fijo por modo):
                //  · diadia → DIADIA_BLOCK_SECONDS (≈15 min/día, modo de pruebas)
                //  · periodo / colapso → BLOCK_REAL_SECONDS
                long realDurationMs = "diadia".equals(request.mode())
                        ? DIADIA_BLOCK_SECONDS * 1000L
                        : BLOCK_REAL_SECONDS * 1000L;

                final int fBlockStart = blockStart;
                int nextEvent = 0;
                while (nextEvent < events.size()
                    && events.get(nextEvent).minute() < fBlockStart) {
                    nextEvent++;
                }

                while (isActive(runId)) {
                    // ── Pausa: congelar el tiempo simulado ────────────────────
                    // Mientras paused esté activo no se avanza el reloj. Al salir
                    // se desplaza realStart por la duración de la pausa para que
                    // simulatedNow continúe exactamente donde estaba (sin saltos).
                    if (paused.get()) {
                        long pauseStart = System.currentTimeMillis();
                        state = state.withMessage("Pausado");
                        broadcast(state);
                        while (paused.get() && isActive(runId)) sleep(150);
                        if (!isActive(runId)) return;
                        realStart += System.currentTimeMillis() - pauseStart;
                    }

                    long elapsedMs    = System.currentTimeMillis() - realStart;
                    int  simulatedNow = blockStart + (int) Math.min(
                            (long)(blockEnd - blockStart),
                            (elapsedMs * (long)(blockEnd - blockStart)) / realDurationMs);

                    // Cancelaciones pendientes
                    String cancelId = pendingCancellations.poll();
                    if (cancelId != null) {
                        solution = processCancellation(cancelId, context, blockLots, solution);
                        List<SimEvent> rebuildBlock = buildEvents(solution, blockLots, blockStart, blockEnd);
                        List<SimEvent> rebuildMerged = new ArrayList<>(carryoverEvents.size() + rebuildBlock.size());
                        rebuildMerged.addAll(carryoverEvents);
                        rebuildMerged.addAll(rebuildBlock);
                        rebuildMerged.sort(Comparator.comparingInt(SimEvent::minute)
                                                     .thenComparing(SimEvent::type));
                        allEvents = rebuildMerged;
                        events    = allEvents;
                        replanifications++;
                        nextEvent = 0;
                        while (nextEvent < events.size()
                            && events.get(nextEvent).minute() <= simulatedNow) {
                            nextEvent++;
                        }
                    }

                    // ── Adiciones y edición de la red (registro / carga de txt) ──
                    // Drena TODOS los lotes encolados (registro o archivo de lotes),
                    // los planea greedy, y aplica altas de vuelos/aeropuertos y
                    // cierres. Todo en el hilo del bucle ⇒ sin condiciones de
                    // carrera con el planificador.
                    boolean networkChanged = false;
                    List<BaggageLot> newLots = new ArrayList<>();
                    BaggageLot added;
                    while ((added = pendingAdditions.poll()) != null && newLots.size() < 2000) {
                        newLots.add(added);
                    }
                    if (!newLots.isEmpty()) {
                        List<BaggageLot> mergedLots = new ArrayList<>(blockLots);
                        mergedLots.addAll(newLots);
                        blockLots = mergedLots;
                        WorkingSolution next = solution.copy();
                        RouteEvaluator ev = new RouteEvaluator(context);
                        for (BaggageLot lot : newLots) {
                            try {
                                for (RoutePlan p : ev.enumerateCandidates(lot)) {
                                    if (next.canAssign(lot, p)) { next.assign(lot, p); break; }
                                }
                            } catch (Exception e) {
                                System.err.println("Error planificando lote: " + e.getMessage());
                            }
                        }
                        solution = next;
                        networkChanged = true;
                    }

                    FlightInstance newFlight;
                    while ((newFlight = pendingFlightAdds.poll()) != null) {
                        context.addFlight(newFlight);
                        flightCapacityById.put(newFlight.getId(), newFlight.getCapacity());
                        networkChanged = true;
                    }
                    Airport newAirport;
                    while ((newAirport = pendingAirportAdds.poll()) != null) {
                        context.addAirport(newAirport);
                        networkChanged = true;
                    }
                    String closeCode;
                    while ((closeCode = pendingAirportCloses.poll()) != null) {
                        context.closeAirport(closeCode);
                        networkChanged = true;
                    }

                    if (networkChanged) {
                        List<SimEvent> addBlock  = buildEvents(solution, blockLots, blockStart, blockEnd);
                        List<SimEvent> addMerged = new ArrayList<>(carryoverEvents.size() + addBlock.size());
                        addMerged.addAll(carryoverEvents);
                        addMerged.addAll(addBlock);
                        addMerged.sort(Comparator.comparingInt(SimEvent::minute)
                                                 .thenComparing(SimEvent::type));
                        allEvents = addMerged;
                        events    = allEvents;
                        nextEvent = 0;
                        while (nextEvent < events.size()
                            && events.get(nextEvent).minute() <= simulatedNow) {
                            nextEvent++;
                        }
                    }

                    List<SimEvent> emitted = new ArrayList<>();
                    while (nextEvent < events.size()
                        && events.get(nextEvent).minute() <= simulatedNow) {
                        SimEvent ev = events.get(nextEvent++);
                        emitted.add(ev);
                        if ("landed".equals(ev.type()) && ev.finalDestination()) {
                            delivered += ev.bags();
                        }
                    }

                    // ── Lotes visibles en este instante ───────────────────────
                    // Solo los lotes cuya hora de registro ya fue alcanzada por
                    // el tiempo simulado contribuyen a los contadores del panel.
                    // Esto hace que los números arranquen en 0 y crezcan gradualmente.
                    final WorkingSolution solForCalc = solution;
                    List<BaggageLot> visibleLots = blockLots.stream()
                            .filter(lot -> lot.getRegistrationHour() <= simulatedNow)
                            .collect(Collectors.toList());

                    int dynTotal   = visibleLots.stream()
                            .mapToInt(BaggageLot::getQuantity).sum();
                    int dynRouted  = visibleLots.stream()
                            .filter(l -> solForCalc.getPlan(l.getId()) != null)
                            .mapToInt(BaggageLot::getQuantity).sum();
                    int dynOverdue = visibleLots.stream()
                            .filter(l -> {
                                RoutePlan p = solForCalc.getPlan(l.getId());
                                return p != null && p.getTardinessHours() > 0;
                            })
                            .mapToInt(BaggageLot::getQuantity).sum();

                    int                activeFlights = countActiveFlights(simulatedNow);
                    List<AirportState> airportStates = airportStates(airports, solution, simulatedNow);
                    Kpis               kpis          = buildKpis(
                            prevBlockTotal   + dynTotal,
                            prevBlockRouted  + dynRouted,
                            prevBlockOverdue + dynOverdue,
                            solution, airportStates, visibleLots,
                            delivered, replanifications, activeFlights, simulatedNow);
                    // ── Detección de colapso ──────────────────────────────────
                    // 1. Almacén lleno: alguna bodega supera su capacidad.
                    // 2. Ruteo inviable (solo en el escenario "colapso"): alguna
                    //    maleta ya visible que el planificador NO pudo enrutar a
                    //    tiempo — sin ruta dentro de su plazo (1 día mismo
                    //    continente / 2 días si no) o con retraso. Esto implementa
                    //    el fin del escenario "hasta el colapso".
                    boolean storageCollapse = airportStates.stream()
                            .anyMatch(a -> a.current() > a.capacity());
                    boolean routingCollapse = "colapso".equals(request.mode())
                            && visibleLots.stream().anyMatch(lot -> {
                                RoutePlan p = solForCalc.getPlan(lot.getId());
                                return p == null || p.getTardinessHours() > 0;
                            });
                    collapsed = storageCollapse || routingCollapse;
                    String collapseReason = !collapsed ? "Simulación activa"
                            : storageCollapse ? "⚠ Capacidad de almacén excedida"
                            : "⚠ Maletas sin ruta viable dentro del plazo";

                    // Vuelos planificados próximos (con sus maletas asignadas) —
                    // el "registro de lo que el sistema planea". Se calcula en
                    // todos los modos para alimentar las tarjetas de planificados.
                    List<UpcomingFlight> upcoming =
                            buildUpcomingFlights(context, solution, simulatedNow);

                    state = new SimulationState(
                            true, request.mode(),
                            fmtClock(simulatedNow), blockNo,
                            fmtClock(blockStart), fmtClock(blockEnd),
                            airportStates,
                            recentRoutes(events, simulatedNow),
                            emitted, kpis, collapsed,
                            collapseReason,
                            simulatedNow,
                            upcoming);
                    broadcast(state);

                    if (simulatedNow >= blockEnd) break;
                    sleep(BROADCAST_INTERVAL_MS);
                }

                // ── Actualizar acumuladores AL TERMINAR el bloque ─────────────
                // Ahora sí contabilizamos todos los lotes del bloque para que
                // el siguiente bloque parta desde el total correcto acumulado.
                for (BaggageLot lot : blockLots) {
                    accumTotalBags += lot.getQuantity();
                    RoutePlan p = solution.getPlan(lot.getId());
                    if (p != null) {
                        accumRoutedBags += lot.getQuantity();
                        if (p.getTardinessHours() > 0) {
                            accumOutOfDeadline += lot.getQuantity();
                        }
                    }
                }

                // ── Carryover para el siguiente bloque ────────────────────────
                // Se conservan DOS grupos de eventos para mantener coherencia
                // entre bloques:
                //   1. Aviones aún en el aire al cerrar el bloque (departed cuyo
                //      landed todavía no ha ocurrido) → para seguir dibujándolos.
                //   2. TODOS los eventos aún en el futuro (minute > blockEnd):
                //      incluyen los aterrizajes finales (ENTREGAS) y los tramos
                //      posteriores de lotes ya planificados. Sin esto, cualquier
                //      entrega que ocurra más de 1 h después del registro se perdía
                //      y el contador de entregadas se quedaba clavado en 0.
                Set<String> landedByBlockEnd = allEvents.stream()
                        .filter(e -> "landed".equals(e.type()) && e.minute() <= blockEnd)
                        .map(SimEvent::flightId)
                        .collect(Collectors.toSet());
                List<SimEvent> inAir = allEvents.stream()
                        .filter(e -> "departed".equals(e.type())
                                && e.minute() <= blockEnd
                                && !landedByBlockEnd.contains(e.flightId()))
                        .collect(Collectors.toList());
                List<SimEvent> futurePending = allEvents.stream()
                        .filter(e -> e.minute() > blockEnd)
                        .collect(Collectors.toList());
                carryoverEvents = new ArrayList<>(inAir.size() + futurePending.size());
                carryoverEvents.addAll(inAir);
                carryoverEvents.addAll(futurePending);
            }

            if (!isActive(runId)) return;
            running.set(false);
            state = state.withRunning(false).withMessage(
                    state.collapsed() ? state.message() : "Simulación finalizada");
            broadcast(state);
        } catch (Exception e) {
            e.printStackTrace();
            if (!isActive(runId)) return;
            running.set(false);
            state = state.withRunning(false).withMessage("Error: " + e.getMessage());
            broadcast(state);
        }
    }

    // ── Lookahead ALNS helper ────────────────────────────────────────────────

    private List<BaggageLot> loadBlockLots(
            Map<String, Airport> airports,
            int blockStart,
            int blockEnd) throws IOException {
        return repoShipments.loadShipmentsForMinuteRange(
                "data/envios/", airports, blockStart, blockEnd);
    }

    private List<BaggageLot> applyCollapseMode(
            List<BaggageLot> lots,
            boolean collapseMode) {
        if (!collapseMode) return lots;
        return lots.stream()
                .map(lot -> new BaggageLot(lot.getId(), lot.getOrigin(),
                        lot.getDestination(),
                        lot.getQuantity() * 3,
                        lot.getRegistrationHour(),
                        lot.getDueHour(),
                        lot.isReplanningPriority()))
                .sorted(Comparator.comparingInt(BaggageLot::getRegistrationHour))
                .collect(Collectors.toList());
    }

    private java.util.concurrent.Future<WorkingSolution> submitALNS(
            ExecutorService pool,
            PlanningContext context,
            List<BaggageLot> blockLots,
            int blockNo,
            WorkingSolution currentSolution) {

        final WorkingSolution snap = currentSolution;
        return pool.submit(() -> {
            if (blockLots.isEmpty()) return snap;
            try {
                Map<String, List<RoutePlan>> candidates =
                        new ALNSPlanner(context, blockNo).buildCandidateMap(blockLots);
                return new ALNSPlanner(context, blockNo)
                        .solveWithCandidates(blockLots, ALNS_TIME_BUDGET_SEC,
                                ALNS_MAX_ITERATIONS, null, candidates, List.of(), snap);
            } catch (Exception e) {
                System.err.println("ALNS error bloque " + blockNo + ": " + e.getMessage());
                return snap;
            }
        });
    }

    private Future<BlockResult> submitBlockWork(
            ExecutorService pool,
            PlanningContext context,
            Map<String, Airport> airports,
            int blockStart,
            int blockEnd,
            int blockNo,
            WorkingSolution currentSolution) {

        final WorkingSolution snap = currentSolution;
        return pool.submit(() -> {
            List<BaggageLot> lots;
            try {
                lots = loadBlockLots(airports, blockStart, blockEnd);
            } catch (Exception e) {
                System.err.println("Error cargando lotes bloque " + blockNo + ": " + e.getMessage());
                return new BlockResult(snap, List.of());
            }
            if (lots.isEmpty()) return new BlockResult(snap, lots);
            try {
                Map<String, List<RoutePlan>> candidates =
                        new ALNSPlanner(context, blockNo).buildCandidateMap(lots);
                WorkingSolution result = new ALNSPlanner(context, blockNo)
                        .solveWithCandidates(lots, ALNS_TIME_BUDGET_SEC,
                                ALNS_MAX_ITERATIONS, null, candidates, List.of(), snap);
                return new BlockResult(result, lots);
            } catch (Exception e) {
                System.err.println("ALNS error bloque " + blockNo + ": " + e.getMessage());
                return new BlockResult(snap, lots);
            }
        });
    }

    // ── Helpers de estado ────────────────────────────────────────────────────

    private List<AirportState> airportStaticList(
            Map<String, Airport> airports,
            WorkingSolution solution,
            int minute) {
        return airports.values().stream()
                .sorted(Comparator.comparing(Airport::getCode))
                .map(a -> new AirportState(
                        a.getCode(), a.getCode(),
                        a.getLatitude(), a.getLongitude(),
                        a.getWarehouseCapacity(),
                        solution.warehouseLoadAt(a.getCode(), minute)))
                .collect(Collectors.toList());
    }

    private List<AirportState> airportStates(
            Map<String, Airport> airports,
            WorkingSolution solution,
            int minute) {
        return airports.values().stream()
                .sorted(Comparator.comparing(Airport::getCode))
                .map(a -> new AirportState(
                        a.getCode(), a.getCode(),
                        a.getLatitude(), a.getLongitude(),
                        a.getWarehouseCapacity(),
                        solution.warehouseLoadAt(a.getCode(), minute)))
                .collect(Collectors.toList());
    }

    private Kpis buildKpis(
            int accumTotalBags,
            int accumRoutedBags,
            int accumOutOfDeadline,
            WorkingSolution solution,
            List<AirportState> airports,
            List<BaggageLot> blockLots,   // solo lotes visibles del bloque actual
            int delivered,
            int replanifications,
            int activeFlights,
            int simulatedNow) {

        int totalBags     = accumTotalBags;
        int routed        = accumRoutedBags;
        int outOfDeadline = accumOutOfDeadline;
        int atRisk        = Math.max(0, totalBags - routed);

        // Semáforo SLA: sobre los lotes visibles del bloque actual en tránsito.
        int slaCritical = blockLots.stream()
                .filter(lot -> {
                    RoutePlan p = solution.getPlan(lot.getId());
                    if (p == null || p.getTardinessHours() > 0) return false;
                    if (p.arrivalHour() <= simulatedNow) return false;
                    int elapsed  = simulatedNow - lot.getRegistrationHour();
                    int slaLimit = lot.getDueHour() - lot.getRegistrationHour();
                    if (slaLimit <= 0) return false;
                    double pct = (double) elapsed / slaLimit;
                    return pct > 0.5 && pct <= 1.0;
                })
                .mapToInt(BaggageLot::getQuantity)
                .sum();

        int slaOnTrack = blockLots.stream()
                .filter(lot -> {
                    RoutePlan p = solution.getPlan(lot.getId());
                    if (p == null || p.getTardinessHours() > 0) return false;
                    if (p.arrivalHour() <= simulatedNow) return false;
                    int elapsed  = simulatedNow - lot.getRegistrationHour();
                    int slaLimit = lot.getDueHour() - lot.getRegistrationHour();
                    if (slaLimit <= 0) return false;
                    double pct = (double) elapsed / slaLimit;
                    return pct <= 0.5;
                })
                .mapToInt(BaggageLot::getQuantity)
                .sum();

        int capacity     = airports.stream().mapToInt(AirportState::capacity).sum();
        int current      = airports.stream().mapToInt(AirportState::current).sum();
        int peakPct      = airports.stream()
                .mapToInt(a -> a.capacity() == 0 ? 0
                        : (int) Math.round(a.current() * 100.0 / a.capacity()))
                .max().orElse(0);
        int occupancyPct = capacity == 0 ? 0
                : (int) Math.round(current * 100.0 / capacity);

        double avgDeliveryDays = blockLots.stream()
                .filter(lot -> {
                    RoutePlan p = solution.getPlan(lot.getId());
                    return p != null && p.arrivalHour() <= simulatedNow;
                })
                .map(lot -> solution.getPlan(lot.getId()))
                .mapToDouble(p -> p.getTotalTravelHours() / 1440.0)
                .average().orElse(0.0);

        return new Kpis(activeFlights, peakPct, occupancyPct, avgDeliveryDays,
                replanifications, delivered, atRisk, outOfDeadline, totalBags, routed,
                slaOnTrack, slaCritical);
    }

    private WorkingSolution processCancellation(
            String cancelKey,
            PlanningContext context,
            List<BaggageLot> blockLots,
            WorkingSolution solution) {

        // cancelKey = "flightId@minutoAbsolutoDeSalida". La instancia ya quedó
        // marcada como cancelada en el context por cancelFlight(), así que el
        // replanificador no volverá a usarla.
        String[] parts    = cancelKey.split("@");
        String   flightId = parts[0];
        int      targetDep = parts.length > 1 ? Integer.parseInt(parts[1]) : -1;

        List<BaggageLot> affected = blockLots.stream()
                .filter(lot -> {
                    RoutePlan plan = solution.getPlan(lot.getId());
                    return plan != null && (targetDep < 0
                            ? plan.touchesFlight(flightId)
                            : plan.touchesFlightInstance(flightId, targetDep));
                })
                .collect(Collectors.toList());

        if (affected.isEmpty()) {
            System.out.printf("Vuelo %s cancelado — sin lotes afectados.%n", cancelKey);
            return solution;
        }

        System.out.printf("Vuelo %s cancelado — replanificando %d lotes.%n",
                cancelKey, affected.size());

        affected.forEach(solution::remove);

        ALNSPlanner planner = new ALNSPlanner(context, System.currentTimeMillis());
        Map<String, List<RoutePlan>> candidates = planner.buildCandidateMap(affected);
        return planner.solveWithCandidates(
                affected, ALNS_TIME_BUDGET_SEC, 0,
                flightId, candidates, List.of(), solution);
    }

    private List<UpcomingFlight> buildUpcomingFlights(
            PlanningContext context, WorkingSolution solution, int simulatedNow) {
        int minuteOfDay = simulatedNow % 1440;
        int dayStart    = (simulatedNow / 1440) * 1440;

        return context.getFlights().stream()
                .filter(f -> !f.isCancelled() && f.getDepartureHour() > minuteOfDay)
                .filter(f -> !context.isInstanceCancelled(
                        f.getId(), dayStart + f.getDepartureHour()))
                .sorted(Comparator.comparingInt(FlightInstance::getDepartureHour))
                .limit(30)
                .map(f -> {
                    int depAbs   = dayStart + f.getDepartureHour();
                    int dur      = f.getArrivalHour() - f.getDepartureHour();
                    if (dur < 0) dur += 1440;
                    int arrAbs   = depAbs + dur;
                    int assigned = f.getCapacity() - solution.residualFor(f.getId());
                    return new UpcomingFlight(
                            f.getId(), f.getOrigin(), f.getDestination(),
                            depAbs, fmtClock(depAbs),
                            arrAbs, fmtClock(arrAbs),
                            f.getCapacity(), Math.max(0, assigned));
                })
                .collect(Collectors.toList());
    }

    // ── Eventos ──────────────────────────────────────────────────────────────

    private List<SimEvent> buildEvents(
            WorkingSolution solution,
            List<BaggageLot> lots,
            int blockStart,
            int blockEnd) {

        Map<String, EventAccumulator> grouped = new HashMap<>();
        for (BaggageLot lot : lots) {
            RoutePlan plan = solution.getPlan(lot.getId());
            if (plan == null) continue;
            List<RouteSegment> segments = plan.getSegments();

            int slaLimitMinutes = lot.getDueHour() - lot.getRegistrationHour();

            for (int i = 0; i < segments.size(); i++) {
                RouteSegment seg       = segments.get(i);
                boolean      finalDest = i == segments.size() - 1;

                addEvent(grouped, seg, seg.getDepartureHour(), "departed",
                         false, lot.getQuantity(),
                         lot.getRegistrationHour(), slaLimitMinutes);
                addEvent(grouped, seg, seg.getArrivalHour(), "landed",
                         finalDest, lot.getQuantity(),
                         lot.getRegistrationHour(), slaLimitMinutes);
            }
        }
        return grouped.values().stream()
                .map(acc -> acc.toEvent(fmtClock(acc.minute)))
                .sorted(Comparator.comparingInt(SimEvent::minute)
                                  .thenComparing(SimEvent::type))
                .collect(Collectors.toList());
    }

    private void addEvent(
            Map<String, EventAccumulator> grouped,
            RouteSegment seg,
            int minute,
            String type,
            boolean finalDestination,
            int bags,
            int registrationMinute,
            int slaLimitMinutes) {
        String key = minute + "|" + type + "|" + seg.getFlightId()
                + "|" + finalDestination + "|" + registrationMinute;
        grouped.computeIfAbsent(key, k -> new EventAccumulator(
                minute, type, seg.getOrigin(), seg.getDestination(),
                seg.getFlightId(), finalDestination,
                registrationMinute, slaLimitMinutes))
               .bags += bags;
    }

    /** Vuelos en el aire ahora mismo según el horario (con o sin maletas). */
    private int countActiveFlights(int minute) {
        int dayStart = (minute / 1440) * 1440;
        int count = 0;
        for (FlightInstance f : scheduledFlights) {
            if (f.isCancelled()) continue;
            int dep = dayStart + f.getDepartureHour();
            if (dep > minute) dep -= 1440;
            if (activeContext != null && activeContext.isInstanceCancelled(f.getId(), dep)) continue;
            int dur = f.getArrivalHour() - f.getDepartureHour();
            if (dur < 0) dur += 1440;
            if (dep <= minute && minute < dep + dur) count++;
        }
        return count;
    }

    private List<RouteState> recentRoutes(List<SimEvent> events, int minute) {
        Set<String> landedIds = events.stream()
                .filter(e -> "landed".equals(e.type()) && e.minute() <= minute)
                .map(SimEvent::flightId)
                .collect(Collectors.toSet());

        // Carga (maletas) por vuelo en el aire: un vuelo puede llevar varios
        // grupos de lotes (eventos), así que sumamos todas sus maletas.
        Map<String, Integer> bagsByFlight = new HashMap<>();
        events.stream()
            .filter(e -> "departed".equals(e.type()) && e.minute() <= minute)
            .filter(e -> !landedIds.contains(e.flightId()))
            .forEach(e -> bagsByFlight.merge(e.flightId(), e.bags(), Integer::sum));

        // Vuelos EN EL AIRE según el HORARIO, no solo los que llevan maletas: un
        // vuelo está volando si la instancia diaria de su horario ya despegó y
        // aún no aterriza. Los que no tienen maletas asignadas se incluyen igual
        // (bags = 0) → el frontend los pinta en gris.
        int dayStart = (minute / 1440) * 1440;
        List<RouteState> active = new ArrayList<>();
        for (FlightInstance f : scheduledFlights) {
            if (f.isCancelled()) continue;
            int dep = dayStart + f.getDepartureHour();
            if (dep > minute) dep -= 1440;            // usar la instancia ya despegada
            if (activeContext != null && activeContext.isInstanceCancelled(f.getId(), dep)) continue;
            int dur = f.getArrivalHour() - f.getDepartureHour();
            if (dur < 0) dur += 1440;
            int arr = dep + dur;
            if (!(dep <= minute && minute < arr)) continue;   // no está en el aire
            active.add(new RouteState(
                    f.getId(), f.getOrigin(), f.getDestination(),
                    bagsByFlight.getOrDefault(f.getId(), 0),
                    f.getCapacity(), "departed", dep, arr));
        }
        active.sort(Comparator.comparingInt(RouteState::bags).reversed());

        List<RouteState> justLanded = events.stream()
                .filter(e -> "landed".equals(e.type()))
                .filter(e -> e.minute() <= minute && e.minute() >= minute - 2)
                .map(e -> new RouteState(
                        e.flightId(), e.from(), e.to(), e.bags(),
                        flightCapacityById.getOrDefault(e.flightId(), 0),
                        "just_landed", e.minute(), e.minute()))
                .collect(Collectors.toList());

        List<RouteState> result = new ArrayList<>(active);
        result.addAll(justLanded);
        return result;
    }

    // ── Utilidades ───────────────────────────────────────────────────────────

    private void broadcast(SimulationState s) {
        // emitters es CopyOnWriteArrayList ⇒ es seguro retirar elementos durante
        // la iteración (lo hace send() cuando un cliente se desconecta).
        for (SseEmitter emitter : emitters) send(emitter, s);
    }

    private void send(SseEmitter emitter, SimulationState payload) {
        try {
            emitter.send(SseEmitter.event().name("state").data(payload));
        } catch (Exception e) {
            // Un cliente desconectado provoca "Broken pipe", que Spring envuelve en
            // IllegalStateException (NO en IOException). Si no se captura aquí, el
            // fallo sube hasta runSimulation y MATA la simulación para todos.
            // Capturamos cualquier excepción, retiramos el emisor muerto y seguimos.
            emitters.remove(emitter);
            try { emitter.complete(); } catch (Exception ignored) { /* ya cerrado */ }
        }
    }

    private int daysForMode(String mode, int numDays) {
        if ("periodo".equals(mode)) return numDays;
        if ("colapso".equals(mode)) return 0;
        return 1;
    }

    private String normalizeMode(String mode) {
        if ("periodo".equals(mode) || "colapso".equals(mode)) return mode;
        return "diadia";
    }

    private boolean isActive(int runId) {
        return running.get() && generation.get() == runId;
    }

    private int absoluteMinute(LocalDateTime timestamp) {
        return (int) Duration.between(BASE_UTC, timestamp).toMinutes();
    }

    private String fmtClock(int absoluteMinute) {
        LocalDateTime t = BASE_UTC.plusMinutes(absoluteMinute);
        return "Dia " + t.toLocalDate() + "  "
                + String.format("%02d:%02d", t.getHour(), t.getMinute());
    }

    /** Formatea un minuto del día (0–1439) como HH:MM. */
    private String fmtHHMM(int minuteOfDay) {
        int m = ((minuteOfDay % 1440) + 1440) % 1440;
        return String.format("%02d:%02d", m / 60, m % 60);
    }

    private void sleep(long ms) {
        try { Thread.sleep(ms); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    // ── Clases internas ──────────────────────────────────────────────────────

    private static class EventAccumulator {
        final int minute; final String type, from, to, flightId;
        final boolean finalDestination;
        final int registrationMinute;
        final int slaLimitMinutes;
        int bags;

        EventAccumulator(int minute, String type, String from, String to,
                         String flightId, boolean finalDestination,
                         int registrationMinute, int slaLimitMinutes) {
            this.minute = minute; this.type = type;
            this.from   = from;   this.to   = to;
            this.flightId = flightId;
            this.finalDestination = finalDestination;
            this.registrationMinute = registrationMinute;
            this.slaLimitMinutes    = slaLimitMinutes;
        }
        SimEvent toEvent(String clock) {
            return new SimEvent(minute, type, from, to, flightId, bags,
                    finalDestination, clock, registrationMinute, slaLimitMinutes);
        }
    }

    public record StartRequest(String mode, Integer blockSeconds, String startDate,
                               Integer numDays, Integer startMinuteOfDay) {
        int blockSecondsOrDefault(int fallback) {
            return blockSeconds == null || blockSeconds <= 0 ? fallback : blockSeconds;
        }
        int numDaysOrDefault(int fallback) {
            return numDays == null || numDays <= 0 ? fallback : numDays;
        }
        /** Minuto de inicio dentro del día seleccionado (0–1439). 0 = inicio del día. */
        int startMinuteOrDefault() {
            if (startMinuteOfDay == null) return 0;
            return Math.max(0, Math.min(1439, startMinuteOfDay));
        }
    }

    public record SimulationState(
            boolean running, String mode, String clock, int block,
            String blockStart, String blockEnd,
            List<AirportState> airports, List<RouteState> routes,
            List<SimEvent> events, Kpis kpis,
            boolean collapsed, String message, int simulatedMinute,
            List<UpcomingFlight> upcomingFlights) {

        static SimulationState initial() {
            return new SimulationState(false, "diadia", "Dia --  00:00", 0,
                    "", "", List.of(), List.of(), List.of(), Kpis.empty(),
                    false, "Listo", 0, List.of());
        }
        SimulationState withRunning(boolean v) {
            return new SimulationState(v, mode, clock, block, blockStart, blockEnd,
                    airports, routes, events, kpis, collapsed, message,
                    simulatedMinute, upcomingFlights);
        }
        SimulationState withMode(String v) {
            return new SimulationState(running, v, clock, block, blockStart, blockEnd,
                    airports, routes, events, kpis, collapsed, message,
                    simulatedMinute, upcomingFlights);
        }
        SimulationState withMessage(String v) {
            return new SimulationState(running, mode, clock, block, blockStart, blockEnd,
                    airports, routes, events, kpis, collapsed, v,
                    simulatedMinute, upcomingFlights);
        }
    }

    public record AirportState(String code, String name,
                                double lat, double lng,
                                int capacity, int current) {}
    public record RouteState(String flightId, String from, String to,
                          int bags, int capacity, String status,
                          int departureMinute, int arrivalMinute) {}
    public record SimEvent(int minute, String type, String from, String to,
                           String flightId, int bags, boolean finalDestination,
                           String clock,
                           int registrationMinute, int slaLimitMinutes) {}
    public record Kpis(int activeFlights, int saturationPercent,
                       int occupancyPercent, double avgDeliveryDays,
                       int replanifications, int deliveredOnTime,
                       int atRisk, int outOfDeadline,
                       int totalBags, int routedBags,
                       int slaOnTrack, int slaCritical) {
        static Kpis empty() { return new Kpis(0,0,0,0,0,0,0,0,0,0,0,0); }
    }

    public record CancelRequest(String flightId) {}

    public record FlightInfo(String id, String origin, String destination,
                             String departureClock, String arrivalClock, int capacity) {}

    public record FeasibilityReport(boolean feasible, String reason, boolean sameContinent,
                                    int slaHours, int transfers, double etaHours,
                                    List<String> path, int originStoragePct, int destStoragePct) {
        static FeasibilityReport infeasible(String reason) {
            return new FeasibilityReport(false, reason, false, 0, 0, 0.0, List.of(), 0, 0);
        }
    }

    public record LotRequest(String origin, String destination, Integer quantity) {
        int qty() { return quantity == null ? 0 : quantity; }
    }

    public record FlightRequest(String origin, String destination,
                                String departureLocal, String arrivalLocal, Integer capacity) {
        int cap() { return capacity == null ? 0 : capacity; }
    }

    public record AirportRequest(String code, String region, Double lat, Double lng,
                                 Integer gmtHours, Integer capacity) {}

    public record CloseRequest(String code) {}

    public record UploadRequest(String type, String content, String origin) {}

    public record UpcomingFlight(String flightId, String origin, String destination,
                                int departureMinute, String departureClock,
                                int arrivalMinute, String arrivalClock,
                                int capacity, int assigned) {}

    private record BlockResult(WorkingSolution solution, List<BaggageLot> lots) {}
}
