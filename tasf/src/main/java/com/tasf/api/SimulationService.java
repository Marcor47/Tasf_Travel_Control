package com.tasf.api;

import com.tasf.planner.alns.ALNSPlanner;
import com.tasf.planner.core.PlanningContext;
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
    private static final int            BLOCK_HOURS         = 1;
    // Tiempo real por bloque: ALNS tarda ~30s, así que damos 60s y usamos
    // los 30s restantes para animar el bloque en pantalla
    private static final int            BLOCK_REAL_SECONDS  = 30;
    private static final int            ALNS_TIME_BUDGET_SEC = 15;
    private static final int            ALNS_MAX_ITERATIONS  = 0;
    // Intervalo de broadcast en ms durante la animación del bloque
    private static final int            BROADCAST_INTERVAL_MS = 800;

    private final List<SseEmitter> emitters   = new CopyOnWriteArrayList<>();
    private final ExecutorService  executor   = Executors.newSingleThreadExecutor();
    private final ExecutorService  lookahead  = Executors.newSingleThreadExecutor();
    private final AtomicBoolean    running    = new AtomicBoolean(false);
    private final AtomicInteger    generation = new AtomicInteger(0);

    private final ConcurrentLinkedQueue<String> pendingCancellations
        = new ConcurrentLinkedQueue<>();

    // Repositorios compartidos entre getAvailableDates() y runSimulation()
    private final AirportRepository  repoAirports  = new AirportRepository();
    private final FlightRepository   repoFlights   = new FlightRepository();
    private final ShipmentRepository repoShipments = new ShipmentRepository();
    private volatile Map<String, Airport> cachedAirports = null;

    private volatile SimulationState state = SimulationState.initial();

    // ── API pública ──────────────────────────────────────────────────────────

    public synchronized SimulationState start(StartRequest request) {
        StartRequest safeRequest = request == null
                ? new StartRequest("diadia", null, null, null) : request;
        stop();
        int    runId = generation.incrementAndGet();
        String mode  = normalizeMode(safeRequest.mode());
        running.set(true);
        state = SimulationState.initial()
                .withMode(mode).withRunning(true).withMessage("Cargando datos...");
        broadcast(state);
        executor.submit(() -> runSimulation(
                new StartRequest(mode, safeRequest.blockSeconds(),
                                safeRequest.startDate(), safeRequest.numDays()), runId));
        return state;
    }

    public synchronized SimulationState stop() {
        generation.incrementAndGet();
        running.set(false);
        state = state.withRunning(false).withMessage("Detenido");
        broadcast(state);
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

    public SimulationState cancelFlight(String flightId) {
        if (!running.get()) return state;
        pendingCancellations.add(flightId);
        return state;
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

            // 2. Encontrar ventana de días
            int daysToLoad = daysForMode(request.mode(), request.numDaysOrDefault(5));
            List<LocalDate> days;

            if (request.startDate() != null && !request.startDate().isBlank()) {
                try {
                    LocalDate startDate = LocalDate.parse(request.startDate());
                    days = repoShipments.getDaysFrom("data/envios/", airports, startDate, daysToLoad);
                } catch (Exception e) {
                    System.err.println("Fecha inválida '" + request.startDate() + "' — usando primera disponible.");
                    days = repoShipments.findConsecutiveDaysWithK("data/envios/", airports, 10000, daysToLoad);
                }
            } else {
                days = repoShipments.findConsecutiveDaysWithK("data/envios/", airports, 10000, daysToLoad);
            }

            if (days == null || days.isEmpty()) {
                running.set(false);
                state = state.withRunning(false).withMessage("No hay días disponibles para simular");
                broadcast(state);
                return;
            }

            // 4. Calcular offset absoluto de los días encontrados
            //    Los lotes tienen registrationHour en minutos desde BASE_UTC=2026-01-01
            //    El primer día puede ser 2028-08-19 → offset muy grande
            int simulationStart = absoluteMinute(days.get(0).atStartOfDay());
            int simulationEnd   = simulationStart + days.size() * 1440;
            int blockMinutes    = BLOCK_HOURS * 60;

            System.out.printf("Simulación: %s → %s | start=%d end=%d | carga por bloques%n",
                    days.get(0), days.get(days.size() - 1),
                    simulationStart, simulationEnd);

            WorkingSolution solution        = new WorkingSolution(context);
            int             delivered       = 0;
            int             replanifications = 0;
            boolean         collapsed       = false;
            List<SimEvent>  allEvents       = new ArrayList<>();
            List<BaggageLot> allLots         = new ArrayList<>();
            Set<String>      loadedLotIds    = new HashSet<>();
            Map<Integer, List<BaggageLot>> blockLotsCache = new HashMap<>();

            // ── LOOKAHEAD: calcular el primer bloque antes de entrar al loop ──
            // Para cada bloque siguiente, ALNS corre en paralelo mientras
            // se anima el bloque actual, eliminando el tiempo muerto de recálculo
            int firstBlockEnd = Math.min(simulationStart + blockMinutes, simulationEnd);
            final int fbStart = simulationStart;
            final int fbEnd   = firstBlockEnd;
            List<BaggageLot> firstBlockLots =
                    loadBlockLots(airports, fbStart, fbEnd);
            blockLotsCache.put(fbStart, firstBlockLots);
            addKnownLots(allLots, loadedLotIds, firstBlockLots);

            // Future para el resultado del bloque precalculado
            java.util.concurrent.Future<WorkingSolution> nextSolutionFuture =
                    submitALNS(lookahead, context, firstBlockLots, 1, solution);

            for (int blockStart = simulationStart, blockNo = 1;
                 isActive(runId) && blockStart < simulationEnd && !collapsed;
                 blockStart += blockMinutes, blockNo++) {

                int blockEnd = Math.min(blockStart + blockMinutes, simulationEnd);
                final int cbStart = blockStart;
                final int cbEnd   = blockEnd;

                // Lotes de este bloque, cargados por ventana para no retener
                // todo el dataset en heap.
                final boolean collapseMode = "colapso".equals(request.mode());
                List<BaggageLot> rawBlockLots = blockLotsCache.remove(cbStart);
                if (rawBlockLots == null) {
                    rawBlockLots = loadBlockLots(airports, cbStart, cbEnd);
                }
                addKnownLots(allLots, loadedLotIds, rawBlockLots);
                List<BaggageLot> blockLots = applyCollapseMode(rawBlockLots, collapseMode);

                // Notificar inicio de bloque — mantener rutas del bloque anterior visibles
                List<AirportState> staticAirports = airportStaticList(airports, solution, cbStart);
                List<RouteState>   prevRoutes     = state.routes();
                state = new SimulationState(
                true, request.mode(),
                fmtClock(blockStart), blockNo,
                fmtClock(blockStart), fmtClock(blockEnd),
                staticAirports, prevRoutes, List.of(),
                buildKpis(allLots, solution, staticAirports, delivered, replanifications, 0, blockStart),
                false, blockLots.isEmpty()
                    ? "Simulación activa"
                    : "Planificando bloque " + blockNo + " (" + blockLots.size() + " lotes)...",
                blockStart,
                List.of()); // ← nuevo
                broadcast(state);

                // Recoger resultado ALNS del lookahead (esperar solo si aún no terminó)
                try {
                    if (!blockLots.isEmpty()) {
                        solution = nextSolutionFuture.get();
                        allEvents = buildEvents(solution, allLots, blockStart, blockEnd);
                    }
                } catch (Exception e) {
                    System.err.println("Error en ALNS lookahead bloque " + blockNo + ": " + e.getMessage());
                }

                if (!isActive(runId)) return;

                // Preparar el SIGUIENTE bloque en paralelo mientras animamos éste
                int nextBlockStart = blockStart + blockMinutes;
                int nextBlockEnd   = Math.min(nextBlockStart + blockMinutes, simulationEnd);
                final int nbStart  = nextBlockStart;
                final int nbEnd    = nextBlockEnd;
                final WorkingSolution solSnap = solution;
                final int nextBlockNo = blockNo + 1;

                if (nextBlockStart < simulationEnd) {
                    List<BaggageLot> nextLots = loadBlockLots(airports, nbStart, nbEnd);
                    blockLotsCache.put(nbStart, nextLots);
                    nextSolutionFuture = submitALNS(lookahead, context, nextLots, nextBlockNo, solSnap);
                }

                // Animar el bloque actual
                List<SimEvent> events  = allEvents;
                long realStart         = System.currentTimeMillis();
                long realDurationMs    = Math.max(1,
                        request.blockSecondsOrDefault(BLOCK_REAL_SECONDS)) * 1000L;

                final int fBlockStart = blockStart;
                int nextEvent = 0;
                while (nextEvent < events.size()
                    && events.get(nextEvent).minute() < fBlockStart) {
                    nextEvent++;
                }

                while (isActive(runId)) {
                    long elapsedMs    = System.currentTimeMillis() - realStart;
                    int  simulatedNow = blockStart + (int) Math.min(
                            (long)(blockEnd - blockStart),
                            (elapsedMs * (long)(blockEnd - blockStart)) / realDurationMs);

                    // ── Procesar cancelaciones pendientes ────────────────────────────
                    String cancelId = pendingCancellations.poll();
                    if (cancelId != null) {
                        solution = processCancellation(cancelId, context, blockLots, solution);
                        allEvents = buildEvents(solution, allLots, blockStart, blockEnd);
                        events    = allEvents;
                        replanifications++;
                        // Reposicionar nextEvent al minuto simulado actual
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

                    int                activeFlights = countActiveFlights(events, simulatedNow);
                    List<AirportState> airportStates = airportStates(airports, solution, simulatedNow);
                    Kpis               kpis          = buildKpis(allLots, solution, airportStates,
                                                                delivered, replanifications,
                                                                activeFlights, simulatedNow);
                    collapsed = airportStates.stream().anyMatch(a -> a.current() > a.capacity());

                    List<UpcomingFlight> upcoming = "diadia".equals(request.mode())
                            ? buildUpcomingFlights(context, solution, simulatedNow)
                            : List.of();

                    state = new SimulationState(
                            true, request.mode(),
                            fmtClock(simulatedNow), blockNo,
                            fmtClock(blockStart), fmtClock(blockEnd),
                            airportStates,
                            recentRoutes(events, simulatedNow),
                            emitted, kpis, collapsed,
                            collapsed ? "⚠ Capacidad de almacén excedida" : "Simulación activa",
                            simulatedNow,
                            upcoming); // ← nuevo
                    broadcast(state);

                    if (simulatedNow >= blockEnd) break;
                    sleep(BROADCAST_INTERVAL_MS);
                }
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

    private void addKnownLots(
            List<BaggageLot> allLots,
            Set<String> loadedLotIds,
            List<BaggageLot> newLots) {
        for (BaggageLot lot : newLots) {
            if (loadedLotIds.add(lot.getId())) {
                allLots.add(lot);
            }
        }
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
        // minute ya está en minutos absolutos desde BASE_UTC — igual que la timeline
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
            List<BaggageLot> lots,
            WorkingSolution solution,
            List<AirportState> airports,
            int delivered,
            int replanifications,
            int activeFlights,
            int simulatedNow) { // <-- NUEVO PARÁMETRO

        // 1. Filtrar solo las maletas que YA entraron al sistema hasta este minuto
        List<BaggageLot> currentLots = lots.stream()
                .filter(lot -> lot.getRegistrationHour() <= simulatedNow)
                .collect(Collectors.toList());

        // 2. Usar 'currentLots' en vez de 'lots' para los cálculos
        int totalBags = currentLots.stream().mapToInt(BaggageLot::getQuantity).sum();
        int routed    = currentLots.stream()
                .filter(lot -> solution.getPlan(lot.getId()) != null)
                .mapToInt(BaggageLot::getQuantity).sum();
        
        int atRisk        = Math.max(0, totalBags - routed);

        // BUG FIX 2: usar .mapToInt(quantity).sum() en vez de .count().
        // .count() devolvía el número de LOTES con tardiness (ej: 5 lotes),
        // mientras que deliveredOnTime y routedBags son sumas de MALETAS (ej: 5000).
        // La mezcla de unidades hacía que la fórmula del frontend
        // inTransit = routedBags - delivered - overdue fuera incorrecta.
        int outOfDeadline = currentLots.stream()
                .filter(lot -> {
                    RoutePlan p = solution.getPlan(lot.getId());
                    return p != null && p.getTardinessHours() > 0;
                })
                .mapToInt(BaggageLot::getQuantity)
                .sum();

        // Semáforo SLA: solo lotes aún en tránsito (no entregados todavía).
        // Un lote está entregado cuando su arrivalHour ya pasó (arrivalHour <= simulatedNow).
        // elapsed = simulatedNow - registrationHour
        // slaLimit = dueHour - registrationHour  (1440 min mismo / 2880 distinto continente)

        // CRÍTICO: en tránsito, sin tardanza, pero ya superó el 50% del plazo
        int slaCritical = currentLots.stream()
                .filter(lot -> {
                    RoutePlan p = solution.getPlan(lot.getId());
                    if (p == null || p.getTardinessHours() > 0) return false;
                    if (p.arrivalHour() <= simulatedNow) return false; // ya entregado
                    int elapsed  = simulatedNow - lot.getRegistrationHour();
                    int slaLimit = lot.getDueHour() - lot.getRegistrationHour();
                    if (slaLimit <= 0) return false;
                    double pct = (double) elapsed / slaLimit;
                    return pct > 0.5 && pct <= 1.0;
                })
                .mapToInt(BaggageLot::getQuantity)
                .sum();

        // VERDE: en tránsito, sin tardanza, dentro del primer 50% del plazo
        int slaOnTrack = currentLots.stream()
                .filter(lot -> {
                    RoutePlan p = solution.getPlan(lot.getId());
                    if (p == null || p.getTardinessHours() > 0) return false;
                    if (p.arrivalHour() <= simulatedNow) return false; // ya entregado
                    int elapsed  = simulatedNow - lot.getRegistrationHour();
                    int slaLimit = lot.getDueHour() - lot.getRegistrationHour();
                    if (slaLimit <= 0) return false;
                    double pct = (double) elapsed / slaLimit;
                    return pct <= 0.5;
                })
                .mapToInt(BaggageLot::getQuantity)
                .sum();

        int capacity    = airports.stream().mapToInt(AirportState::capacity).sum();
        int current     = airports.stream().mapToInt(AirportState::current).sum();
        int peakPct     = airports.stream()
                .mapToInt(a -> a.capacity() == 0 ? 0
                        : (int) Math.round(a.current() * 100.0 / a.capacity()))
                .max().orElse(0);
        int occupancyPct = capacity == 0 ? 0
                : (int) Math.round(current * 100.0 / capacity);

        double avgDeliveryDays = currentLots.stream()
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
            String flightId,
            PlanningContext context,
            List<BaggageLot> blockLots,
            WorkingSolution solution) {

        // 1. Marcar vuelo como cancelado
        context.getFlights().stream()
                .filter(f -> f.getId().equals(flightId))
                .findFirst()
                .ifPresent(f -> f.setCancelled(true));

        // 2. Lotes afectados en este bloque
        List<BaggageLot> affected = blockLots.stream()
                .filter(lot -> {
                    RoutePlan plan = solution.getPlan(lot.getId());
                    return plan != null && plan.touchesFlight(flightId);
                })
                .collect(Collectors.toList());

        if (affected.isEmpty()) {
            System.out.printf("Vuelo %s cancelado — sin lotes afectados.%n", flightId);
            return solution;
        }

        System.out.printf("Vuelo %s cancelado — replanificando %d lotes.%n",
                flightId, affected.size());

        // 3. Quitar lotes afectados de la solución
        affected.forEach(solution::remove);

        // 4. Re-run ALNS con cancelledFlightId
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
                .sorted(Comparator.comparingInt(FlightInstance::getDepartureHour))
                .limit(15)
                .map(f -> {
                    int depAbs   = dayStart + f.getDepartureHour();
                    int assigned = f.getCapacity() - solution.residualFor(f.getId());
                    return new UpcomingFlight(
                            f.getId(), f.getOrigin(), f.getDestination(),
                            depAbs, fmtClock(depAbs),
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

            // SLA: mismo continente = 24h (1440 min), distinto = 48h (2880 min)
            // El dueHour ya fue calculado en ShipmentRepository con esa misma lógica,
            // así que simplemente derivamos el límite del propio lote.
            int slaLimitMinutes = lot.getDueHour() - lot.getRegistrationHour();

            for (int i = 0; i < segments.size(); i++) {
                RouteSegment seg       = segments.get(i);
                boolean      finalDest = i == segments.size() - 1;

                // FIX Bug 3: incluir eventos aunque estén fuera del bloque actual
                // para que vuelos iniciados en bloques anteriores sigan visibles
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
        // Sin filtro de blockStart/blockEnd — queremos todos los eventos de la solución
        // La key incluye registrationMinute para no fusionar lotes con distinto SLA
        String key = minute + "|" + type + "|" + seg.getFlightId()
                + "|" + finalDestination + "|" + registrationMinute;
        grouped.computeIfAbsent(key, k -> new EventAccumulator(
                minute, type, seg.getOrigin(), seg.getDestination(),
                seg.getFlightId(), finalDestination,
                registrationMinute, slaLimitMinutes))
               .bags += bags;
    }

    private int countActiveFlights(List<SimEvent> events, int minute) {
        Set<String> departed = events.stream()
                .filter(e -> "departed".equals(e.type()) && e.minute() <= minute)
                .map(SimEvent::flightId)
                .collect(Collectors.toSet());
        events.stream()
                .filter(e -> "landed".equals(e.type()) && e.minute() <= minute)
                .map(SimEvent::flightId)
                .forEach(departed::remove);
        return departed.size();
    }

    private List<RouteState> recentRoutes(List<SimEvent> events, int minute) {
        // Vuelos que ya aterrizaron en algún momento hasta ahora
        Set<String> landedIds = events.stream()
                .filter(e -> "landed".equals(e.type()) && e.minute() <= minute)
                .map(SimEvent::flightId)
                .collect(Collectors.toSet());

        // Solo mandamos vuelos ACTIVOS (departed pero no landed aún)
        // Limitamos a las top 60 rutas por cantidad de maletas para no saturar el mapa
        List<RouteState> active = events.stream()
                .filter(e -> "departed".equals(e.type()) && e.minute() <= minute)
                .filter(e -> !landedIds.contains(e.flightId()))
                .map(e -> new RouteState(e.from(), e.to(), e.bags(), "departed"))
                .sorted(Comparator.comparingInt(RouteState::bags).reversed())
                .limit(40)
                .collect(Collectors.toList());

        // "just_landed": vuelos que aterrizaron en los últimos 2 minutos simulados
        // El frontend los convierte a "landed" localmente y los borra con su timer
        List<RouteState> justLanded = events.stream()
                .filter(e -> "landed".equals(e.type()))
                .filter(e -> e.minute() <= minute && e.minute() >= minute - 2)
                .map(e -> new RouteState(e.from(), e.to(), e.bags(), "just_landed"))
                .collect(Collectors.toList());

        List<RouteState> result = new ArrayList<>(active);
        result.addAll(justLanded);
        return result;
    }

    // ── Utilidades ───────────────────────────────────────────────────────────

    private void broadcast(SimulationState s) {
        for (SseEmitter emitter : emitters) send(emitter, s);
    }

    private void send(SseEmitter emitter, SimulationState payload) {
        try {
            emitter.send(SseEmitter.event().name("state").data(payload));
        } catch (IOException e) {
            emitters.remove(emitter);
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

    public record StartRequest(String mode, Integer blockSeconds, String startDate, Integer numDays) {
        int blockSecondsOrDefault(int fallback) {
            return blockSeconds == null || blockSeconds <= 0 ? fallback : blockSeconds;
        }
        int numDaysOrDefault(int fallback) {
            return numDays == null || numDays <= 0 ? fallback : numDays;
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
    public record RouteState(String from, String to, int bags, String status) {}
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

    public record UpcomingFlight(String flightId, String origin, String destination,
                                int departureMinute, String departureClock,
                                int capacity, int assigned) {}
}
