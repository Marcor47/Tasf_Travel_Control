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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

@Service
public class SimulationService {

    private static final LocalDateTime BASE_UTC = LocalDateTime.of(2026, 1, 1, 0, 0);
    private static final int BLOCK_HOURS = 3;
    private static final int BLOCK_REAL_SECONDS = 120;
    private static final int ALNS_TIME_BUDGET_SEC = 30;
    private static final int ALNS_MAX_ITERATIONS = 0;

    private final List<SseEmitter> emitters = new CopyOnWriteArrayList<>();
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private final AtomicInteger generation = new AtomicInteger(0);

    private volatile SimulationState state = SimulationState.initial();

    public synchronized SimulationState start(StartRequest request) {
        StartRequest safeRequest = request == null ? new StartRequest("diadia", null) : request;
        stop();
        int runId = generation.incrementAndGet();
        String mode = normalizeMode(safeRequest.mode());
        running.set(true);
        state = SimulationState.initial().withMode(mode).withRunning(true);
        StartRequest normalized = new StartRequest(mode, safeRequest.blockSeconds());
        executor.submit(() -> runSimulation(normalized, runId));
        return state;
    }

    public synchronized SimulationState stop() {
        generation.incrementAndGet();
        running.set(false);
        state = state.withRunning(false);
        broadcast(state);
        return state;
    }

    public SimulationState currentState() {
        return state;
    }

    public SseEmitter subscribe() {
        SseEmitter emitter = new SseEmitter(0L);
        emitters.add(emitter);
        emitter.onCompletion(() -> emitters.remove(emitter));
        emitter.onTimeout(() -> emitters.remove(emitter));
        emitter.onError(e -> emitters.remove(emitter));
        send(emitter, state);
        return emitter;
    }

    private void runSimulation(StartRequest request, int runId) {
        try {
            AirportRepository airportRepo = new AirportRepository();
            FlightRepository flightRepo = new FlightRepository();
            ShipmentRepository shipmentRepo = new ShipmentRepository();

            Map<String, Airport> airports = airportRepo.loadAirports("data/aeropuertos.txt");
            List<FlightInstance> flights = flightRepo.loadFlights("data/planes_vuelo.txt", airports);
            PlanningContext context = new PlanningContext(airports, flights, ScenarioConfig.defaultWeek4());

            int daysToLoad = daysForMode(request.mode());
            List<LocalDate> days = shipmentRepo.findConsecutiveDaysWithK(
                    "data/envios/", airports, 0, daysToLoad);
            if (days == null || days.isEmpty()) {
                running.set(false);
                state = state.withMessage("No hay dias disponibles para simular.");
                broadcast(state);
                return;
            }

            List<BaggageLot> allLots = shipmentRepo.loadShipmentsForDays(
                    "data/envios/", airports, days);
            int simulationStart = absoluteMinute(days.get(0).atStartOfDay());
            int simulationEnd = simulationStart + days.size() * 1440;
            int blockMinutes = BLOCK_HOURS * 60;
            WorkingSolution solution = new WorkingSolution(context);
            int delivered = 0;
            int replanifications = 0;
            boolean collapsed = false;

            for (int blockStart = simulationStart, blockNo = 1;
                 isActive(runId) && blockStart < simulationEnd && !collapsed;
                 blockStart += blockMinutes, blockNo++) {

                int blockEnd = Math.min(blockStart + blockMinutes, simulationEnd);
                final int currentBlockStart = blockStart;
                final int currentBlockEnd = blockEnd;
                List<BaggageLot> blockLots = allLots.stream()
                        .filter(lot -> lot.getRegistrationHour() >= currentBlockStart)
                        .filter(lot -> lot.getRegistrationHour() < currentBlockEnd)
                        .sorted(Comparator.comparingInt(BaggageLot::getRegistrationHour))
                        .collect(Collectors.toList());

                if (!blockLots.isEmpty()) {
                    Map<String, List<RoutePlan>> candidates =
                            new ALNSPlanner(context, blockNo).buildCandidateMap(blockLots);
                    solution = new ALNSPlanner(context, blockNo)
                            .solveWithCandidates(blockLots, ALNS_TIME_BUDGET_SEC,
                                    ALNS_MAX_ITERATIONS, null, candidates, List.of(), solution);
                }

                List<SimEvent> events = buildEvents(solution, allLots, blockStart, blockEnd);
                long realStart = System.currentTimeMillis();
                long realDurationMs = Math.max(1, request.blockSecondsOrDefault(BLOCK_REAL_SECONDS)) * 1000L;
                int nextEvent = 0;

                while (isActive(runId)) {
                    long elapsedMs = System.currentTimeMillis() - realStart;
                    int simulatedNow = blockStart + (int) Math.min(
                            blockEnd - blockStart,
                            (elapsedMs * (blockEnd - blockStart)) / realDurationMs);

                    List<SimEvent> emitted = new ArrayList<>();
                    while (nextEvent < events.size() && events.get(nextEvent).minute() <= simulatedNow) {
                        SimEvent event = events.get(nextEvent++);
                        emitted.add(event);
                        if ("landed".equals(event.type()) && event.finalDestination()) {
                            delivered += event.bags();
                        }
                    }

                    int activeFlights = countActiveFlights(events, simulatedNow);
                    List<AirportState> airportStates = airportStates(airports, solution, simulatedNow);
                    Kpis kpis = buildKpis(allLots, solution, airportStates, delivered,
                            replanifications, activeFlights);
                    collapsed = airportStates.stream().anyMatch(a -> a.current() > a.capacity());

                    state = new SimulationState(
                            true,
                            request.mode(),
                            fmtClock(simulatedNow),
                            blockNo,
                            fmtClock(blockStart),
                            fmtClock(blockEnd),
                            airportStates,
                            recentRoutes(events, simulatedNow),
                            emitted,
                            kpis,
                            collapsed,
                            collapsed ? "Capacidad de almacen excedida" : "Simulacion activa");
                    broadcast(state);

                    if (simulatedNow >= blockEnd) break;
                    sleep(1000);
                }
            }

            if (!isActive(runId)) {
                return;
            }
            running.set(false);
            state = state.withRunning(false).withMessage(
                    state.collapsed() ? state.message() : "Simulacion finalizada");
            broadcast(state);
        } catch (Exception e) {
            if (!isActive(runId)) {
                return;
            }
            running.set(false);
            state = state.withRunning(false).withMessage("Error: " + e.getMessage());
            broadcast(state);
        }
    }

    private List<AirportState> airportStates(
            Map<String, Airport> airports,
            WorkingSolution solution,
            int minute) {
        return airports.values().stream()
                .sorted(Comparator.comparing(Airport::getCode))
                .map(a -> new AirportState(
                        a.getCode(),
                        a.getCode(),
                        a.getLatitude(),
                        a.getLongitude(),
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
            int activeFlights) {
        int totalBags = lots.stream().mapToInt(BaggageLot::getQuantity).sum();
        int routed = lots.stream()
                .filter(lot -> solution.getPlan(lot.getId()) != null)
                .mapToInt(BaggageLot::getQuantity)
                .sum();
        int atRisk = Math.max(0, totalBags - routed);
        int outOfDeadline = (int) lots.stream()
                .filter(lot -> {
                    RoutePlan plan = solution.getPlan(lot.getId());
                    return plan != null && plan.getTardinessHours() > 0;
                })
                .count();
        int capacity = airports.stream().mapToInt(AirportState::capacity).sum();
        int current = airports.stream().mapToInt(AirportState::current).sum();
        int peakPct = airports.stream()
                .mapToInt(a -> a.capacity() == 0 ? 0 : (int) Math.round(a.current() * 100.0 / a.capacity()))
                .max()
                .orElse(0);
        int occupancyPct = capacity == 0 ? 0 : (int) Math.round(current * 100.0 / capacity);
        double avgDeliveryDays = routed == 0 ? 0.0 : lots.stream()
                .map(lot -> solution.getPlan(lot.getId()))
                .filter(p -> p != null)
                .mapToDouble(p -> p.getTotalTravelHours() / 1440.0)
                .average()
                .orElse(0.0);
        return new Kpis(activeFlights, peakPct, occupancyPct, avgDeliveryDays,
                replanifications, delivered, atRisk, outOfDeadline, totalBags, routed);
    }

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
            for (int i = 0; i < segments.size(); i++) {
                RouteSegment segment = segments.get(i);
                boolean finalDest = i == segments.size() - 1;
                addEvent(grouped, segment, segment.getDepartureHour(), "departed", false,
                        lot.getQuantity(), blockStart, blockEnd);
                addEvent(grouped, segment, segment.getArrivalHour(), "landed", finalDest,
                        lot.getQuantity(), blockStart, blockEnd);
            }
        }
        return grouped.values().stream()
                .map(EventAccumulator::toEvent)
                .sorted(Comparator.comparingInt(SimEvent::minute).thenComparing(SimEvent::type))
                .collect(Collectors.toList());
    }

    private void addEvent(
            Map<String, EventAccumulator> grouped,
            RouteSegment segment,
            int minute,
            String type,
            boolean finalDestination,
            int bags,
            int blockStart,
            int blockEnd) {
        if (minute < blockStart || minute >= blockEnd) return;
        String key = minute + "|" + type + "|" + segment.getFlightId() + "|" + finalDestination;
        grouped.computeIfAbsent(key, k -> new EventAccumulator(
                minute, type, segment.getOrigin(), segment.getDestination(),
                segment.getFlightId(), finalDestination))
                .bags += bags;
    }

    private int countActiveFlights(List<SimEvent> events, int minute) {
        Set<String> departed = events.stream()
                .filter(e -> "departed".equals(e.type()))
                .filter(e -> e.minute() <= minute)
                .map(SimEvent::flightId)
                .collect(Collectors.toSet());
        events.stream()
                .filter(e -> "landed".equals(e.type()))
                .filter(e -> e.minute() <= minute)
                .map(SimEvent::flightId)
                .forEach(departed::remove);
        return departed.size();
    }

    private List<RouteState> recentRoutes(List<SimEvent> events, int minute) {
        return events.stream()
                .filter(e -> e.minute() <= minute)
                .sorted(Comparator.comparingInt(SimEvent::minute).reversed())
                .limit(20)
                .map(e -> new RouteState(e.from(), e.to(), e.bags(), e.type()))
                .collect(Collectors.toList());
    }

    private void broadcast(SimulationState newState) {
        for (SseEmitter emitter : emitters) {
            send(emitter, newState);
        }
    }

    private void send(SseEmitter emitter, SimulationState payload) {
        try {
            emitter.send(SseEmitter.event().name("state").data(payload));
        } catch (IOException e) {
            emitters.remove(emitter);
        }
    }

    private int daysForMode(String mode) {
        if ("periodo".equals(mode)) return 5;
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
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static class EventAccumulator {
        final int minute;
        final String type;
        final String from;
        final String to;
        final String flightId;
        final boolean finalDestination;
        int bags;

        EventAccumulator(int minute, String type, String from, String to,
                         String flightId, boolean finalDestination) {
            this.minute = minute;
            this.type = type;
            this.from = from;
            this.to = to;
            this.flightId = flightId;
            this.finalDestination = finalDestination;
        }

        SimEvent toEvent() {
            return new SimEvent(minute, type, from, to, flightId, bags, finalDestination);
        }
    }

    public record StartRequest(String mode, Integer blockSeconds) {
        int blockSecondsOrDefault(int fallback) {
            return blockSeconds == null || blockSeconds <= 0 ? fallback : blockSeconds;
        }
    }

    public record SimulationState(
            boolean running,
            String mode,
            String clock,
            int block,
            String blockStart,
            String blockEnd,
            List<AirportState> airports,
            List<RouteState> routes,
            List<SimEvent> events,
            Kpis kpis,
            boolean collapsed,
            String message) {

        static SimulationState initial() {
            return new SimulationState(false, "diadia", "Dia --  00:00", 0, "", "",
                    List.of(), List.of(), List.of(), Kpis.empty(), false, "Listo");
        }

        SimulationState withRunning(boolean value) {
            return new SimulationState(value, mode, clock, block, blockStart, blockEnd,
                    airports, routes, events, kpis, collapsed, message);
        }

        SimulationState withMode(String value) {
            return new SimulationState(running, value, clock, block, blockStart, blockEnd,
                    airports, routes, events, kpis, collapsed, message);
        }

        SimulationState withMessage(String value) {
            return new SimulationState(running, mode, clock, block, blockStart, blockEnd,
                    airports, routes, events, kpis, collapsed, value);
        }
    }

    public record AirportState(
            String code,
            String name,
            double lat,
            double lng,
            int capacity,
            int current) {}

    public record RouteState(String from, String to, int bags, String status) {}

    public record SimEvent(
            int minute,
            String type,
            String from,
            String to,
            String flightId,
            int bags,
            boolean finalDestination) {}

    public record Kpis(
            int activeFlights,
            int saturationPercent,
            int occupancyPercent,
            double avgDeliveryDays,
            int replanifications,
            int deliveredOnTime,
            int atRisk,
            int outOfDeadline,
            int totalBags,
            int routedBags) {
        static Kpis empty() {
            return new Kpis(0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
    }
}
