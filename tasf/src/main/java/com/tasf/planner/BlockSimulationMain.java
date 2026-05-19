package com.tasf.planner;

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

import java.io.IOException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.Scanner;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

public class BlockSimulationMain {

    private static final int DAYS_TO_LOAD = 5;
    private static final int BLOCK_HOURS = 3;
    private static final int BLOCK_REAL_SECONDS = 120;
    private static final int ALNS_TIME_BUDGET_SEC = 30;
    private static final int ALNS_MAX_ITERATIONS = 0;
    private static final int K_MIN_TOTAL_BAGS = 0;
    private static final long SEED = 1L;

    private static final LocalDateTime BASE_UTC = LocalDateTime.of(2026, 1, 1, 0, 0);
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.BASIC_ISO_DATE;

    public static void main(String[] args) {
        if (24 % BLOCK_HOURS != 0) {
            throw new IllegalArgumentException("BLOCK_HOURS must divide 24.");
        }

        Queue<Command> commands = new ConcurrentLinkedQueue<>();
        AtomicBoolean running = new AtomicBoolean(true);
        startCommandReader(commands, running);

        try {
            AirportRepository airportRepo = new AirportRepository();
            FlightRepository flightRepo = new FlightRepository();
            ShipmentRepository shipmentRepo = new ShipmentRepository();

            Map<String, Airport> airports = airportRepo.loadAirports("data/aeropuertos.txt");
            List<FlightInstance> flights = flightRepo.loadFlights("data/planes_vuelo.txt", airports);
            PlanningContext context = new PlanningContext(
                    airports, flights, ScenarioConfig.defaultWeek4());

            List<LocalDate> days = shipmentRepo.findConsecutiveDaysWithK(
                    "data/envios/", airports, K_MIN_TOTAL_BAGS, DAYS_TO_LOAD);
            if (days == null || days.isEmpty()) {
                System.err.println("No valid simulation days found.");
                return;
            }

            List<BaggageLot> loadedLots = shipmentRepo.loadShipmentsForDays(
                    "data/envios/", airports, days);
            Map<String, BaggageLot> lotsById = loadedLots.stream()
                    .collect(Collectors.toMap(BaggageLot::getId, lot -> lot, (a, b) -> a));
            Set<String> cancelled = new HashSet<>();

            int blockMinutes = BLOCK_HOURS * 60;
            int simulationStart = absoluteMinute(days.get(0).atStartOfDay());
            int simulationEnd = simulationStart + DAYS_TO_LOAD * 1440;

            WorkingSolution solution = new WorkingSolution(context);

            System.out.printf("Loaded %d days (%s -> %s), %d lots.%n",
                    days.size(), days.get(0), days.get(days.size() - 1), loadedLots.size());
            System.out.printf("Block size=%dh, playback=%ds, ALNS time=%ds, ALNS iterations=%d%n",
                    BLOCK_HOURS, BLOCK_REAL_SECONDS, ALNS_TIME_BUDGET_SEC, ALNS_MAX_ITERATIONS);
            System.out.println("Commands: cancel package <id> | add package | quit");

            for (int blockStart = simulationStart, blockNo = 1;
                 blockStart < simulationEnd && running.get();
                 blockStart += blockMinutes, blockNo++) {

                int blockEnd = Math.min(blockStart + blockMinutes, simulationEnd);
                applyCommands(commands, cancelled, lotsById, solution, airports, blockStart);

                final int currentBlockStart = blockStart;
                final int currentBlockEnd = blockEnd;
                List<BaggageLot> blockLots = lotsById.values().stream()
                        .filter(lot -> !cancelled.contains(lot.getId()))
                        .filter(lot -> lot.getRegistrationHour() >= currentBlockStart)
                        .filter(lot -> lot.getRegistrationHour() < currentBlockEnd)
                        .sorted(Comparator.comparingInt(BaggageLot::getRegistrationHour))
                        .collect(Collectors.toList());

                System.out.printf("%n=== BLOCK %d %s -> %s | lots=%d bags=%d ===%n",
                        blockNo, fmtTime(blockStart), fmtTime(blockEnd),
                        blockLots.size(), blockLots.stream().mapToInt(BaggageLot::getQuantity).sum());

                if (!blockLots.isEmpty()) {
                    long candidateStart = System.currentTimeMillis();
                    Map<String, List<RoutePlan>> candidates =
                            new ALNSPlanner(context, SEED + blockNo).buildCandidateMap(blockLots);
                    long candidateMs = System.currentTimeMillis() - candidateStart;

                    long solveStart = System.currentTimeMillis();
                    solution = new ALNSPlanner(context, SEED + blockNo)
                            .solveWithCandidates(blockLots, ALNS_TIME_BUDGET_SEC,
                                    ALNS_MAX_ITERATIONS, null, candidates,
                                    List.of(), solution);
                    long solveMs = System.currentTimeMillis() - solveStart;
                    System.out.printf("ALNS block done: candidates=%dms solve=%dms total=%dms%n",
                            candidateMs, solveMs, candidateMs + solveMs);
                }

                List<BaggageLot> eventLots = lotsById.values().stream()
                        .filter(lot -> !cancelled.contains(lot.getId()))
                        .collect(Collectors.toList());
                playbackBlock(blockStart, blockEnd, solution, eventLots, BLOCK_REAL_SECONDS);
            }
        } catch (IOException e) {
            System.err.println("Simulation error: " + e.getMessage());
            e.printStackTrace();
        } finally {
            running.set(false);
        }
    }

    private static void playbackBlock(
            int blockStart,
            int blockEnd,
            WorkingSolution solution,
            List<BaggageLot> blockLots,
            int realSeconds) {

        List<Event> events = buildEvents(solution, blockLots, blockStart, blockEnd);
        long realStart = System.currentTimeMillis();
        long realDurationMs = Math.max(1, realSeconds) * 1000L;
        int blockDuration = Math.max(1, blockEnd - blockStart);
        int nextEvent = 0;

        while (nextEvent < events.size()) {
            long elapsedMs = System.currentTimeMillis() - realStart;
            int simulatedNow = blockStart + (int) Math.min(
                    blockDuration,
                    (elapsedMs * blockDuration) / realDurationMs);

            while (nextEvent < events.size() && events.get(nextEvent).minute <= simulatedNow) {
                Event event = events.get(nextEvent++);
                System.out.println(event.render(solution));
            }

            if (simulatedNow >= blockEnd) break;
            sleep(100);
        }
    }

    private static List<Event> buildEvents(
            WorkingSolution solution,
            List<BaggageLot> lots,
            int blockStart,
            int blockEnd) {

        Map<String, EventAccumulator> departures = new HashMap<>();
        Map<String, EventAccumulator> arrivals = new HashMap<>();

        for (BaggageLot lot : lots) {
            RoutePlan plan = solution.getPlan(lot.getId());
            if (plan == null) continue;
            List<RouteSegment> segments = plan.getSegments();
            for (int i = 0; i < segments.size(); i++) {
                RouteSegment segment = segments.get(i);
                String flightKey = segment.getFlightId() + "|" + segment.getOrigin()
                        + "|" + segment.getDestination();

                if (segment.getDepartureHour() >= blockStart
                        && segment.getDepartureHour() < blockEnd) {
                    departures.computeIfAbsent(
                            segment.getDepartureHour() + "|D|" + flightKey,
                            k -> new EventAccumulator(segment, segment.getDepartureHour(), false))
                            .quantity += lot.getQuantity();
                }

                if (segment.getArrivalHour() >= blockStart
                        && segment.getArrivalHour() < blockEnd) {
                    boolean finalDestination = i == segments.size() - 1;
                    arrivals.computeIfAbsent(
                            segment.getArrivalHour() + "|A|" + flightKey + "|" + finalDestination,
                            k -> new EventAccumulator(segment, segment.getArrivalHour(), finalDestination))
                            .quantity += lot.getQuantity();
                }
            }
        }

        List<Event> events = new ArrayList<>();
        departures.values().forEach(a -> events.add(a.departureEvent()));
        arrivals.values().forEach(a -> events.add(a.arrivalEvent()));
        events.sort(Comparator.comparingInt((Event e) -> e.minute)
                .thenComparing(e -> e.type));
        return events;
    }

    private static void applyCommands(
            Queue<Command> commands,
            Set<String> cancelled,
            Map<String, BaggageLot> lotsById,
            WorkingSolution solution,
            Map<String, Airport> airports,
            int nextBlockStart) {

        Command command;
        while ((command = commands.poll()) != null) {
            if ("quit".equals(command.type)) {
                System.out.println("Quit requested. Finish with Ctrl+C if playback is running.");
                continue;
            }
            if ("cancel".equals(command.type)) {
                BaggageLot lot = findLot(command.value, lotsById);
                if (lot == null) {
                    System.out.println("Cancel ignored, package not found: " + command.value);
                    continue;
                }
                cancelled.add(lot.getId());
                solution.remove(lot);
                System.out.println("Canceled package " + lot.getId());
            } else if ("add".equals(command.type)) {
                BaggageLot lot = parseAddedLot(command.origin, command.value, airports, nextBlockStart);
                if (lot == null) continue;
                lotsById.put(lot.getId(), lot);
                System.out.printf("Added package %s to next block at %s%n",
                        lot.getId(), fmtTime(lot.getRegistrationHour()));
            }
        }
    }

    private static void startCommandReader(Queue<Command> commands, AtomicBoolean running) {
        Thread thread = new Thread(() -> {
            Scanner scanner = new Scanner(System.in);
            while (running.get()) {
                if (!scanner.hasNextLine()) break;
                String line = scanner.nextLine().trim();
                if (line.equalsIgnoreCase("quit")) {
                    commands.add(Command.quit());
                    running.set(false);
                    break;
                }
                if (line.toLowerCase(Locale.ROOT).startsWith("cancel package ")) {
                    commands.add(Command.cancel(line.substring("cancel package ".length()).trim()));
                    continue;
                }
                if (line.equalsIgnoreCase("add package")) {
                    System.out.print("Origin airport code: ");
                    String origin = scanner.nextLine().trim().toUpperCase(Locale.ROOT);
                    System.out.print("Package line (id-yyyymmdd-hh-mm-dest-qty-client): ");
                    String packageLine = scanner.nextLine().trim();
                    commands.add(Command.add(origin, packageLine));
                    continue;
                }
                System.out.println("Unknown command. Use: cancel package <id> | add package | quit");
            }
        }, "block-simulation-console");
        thread.setDaemon(true);
        thread.start();
    }

    private static BaggageLot parseAddedLot(
            String origin,
            String line,
            Map<String, Airport> airports,
            int nextBlockStart) {
        String[] parts = line.split("-");
        if (parts.length < 7) {
            System.out.println("Add ignored, invalid package format.");
            return null;
        }
        if (!airports.containsKey(origin)) {
            System.out.println("Add ignored, unknown origin: " + origin);
            return null;
        }
        String destination = cleanCode(parts[4]);
        if (!airports.containsKey(destination)) {
            System.out.println("Add ignored, unknown destination: " + destination);
            return null;
        }
        int quantity;
        try {
            quantity = Integer.parseInt(parts[5].replaceAll("[^0-9]", ""));
        } catch (NumberFormatException e) {
            System.out.println("Add ignored, invalid quantity.");
            return null;
        }

        int registration = nextBlockStart;
        Airport originAirport = airports.get(origin);
        Airport destAirport = airports.get(destination);
        boolean sameContinent = originAirport.getRegion().equals(destAirport.getRegion());
        int due = registration + (sameContinent ? 24 * 60 : 48 * 60);
        String id = origin + "_ADDED_" + parts[0] + "_" + nextBlockStart;
        return new BaggageLot(id, origin, destination, quantity, registration, due, true);
    }

    private static BaggageLot findLot(String id, Map<String, BaggageLot> lotsById) {
        BaggageLot exact = lotsById.get(id);
        if (exact != null) return exact;
        for (BaggageLot lot : lotsById.values()) {
            if (lot.getId().endsWith("_" + id) || lot.getId().equalsIgnoreCase(id)) {
                return lot;
            }
        }
        return null;
    }

    private static int absoluteMinute(LocalDateTime timestamp) {
        return (int) Duration.between(BASE_UTC, timestamp).toMinutes();
    }

    private static String fmtTime(int absoluteMinute) {
        LocalDateTime time = BASE_UTC.plusMinutes(absoluteMinute);
        return time.toLocalDate() + " " + String.format("%02d:%02d", time.getHour(), time.getMinute());
    }

    private static String fmtClock(int absoluteMinute) {
        LocalDateTime time = BASE_UTC.plusMinutes(absoluteMinute);
        return String.format("%02d:%02d", time.getHour(), time.getMinute());
    }

    private static String cleanCode(String s) {
        return s.trim().toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]", "");
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static class EventAccumulator {
        final RouteSegment segment;
        final int minute;
        final boolean finalDestination;
        int quantity;

        EventAccumulator(RouteSegment segment, int minute, boolean finalDestination) {
            this.segment = segment;
            this.minute = minute;
            this.finalDestination = finalDestination;
        }

        Event departureEvent() {
            return new Event(minute, "departed", segment, quantity, finalDestination);
        }

        Event arrivalEvent() {
            return new Event(minute, "landed", segment, quantity, finalDestination);
        }
    }

    private static class Event {
        final int minute;
        final String type;
        final RouteSegment segment;
        final int quantity;
        final boolean finalDestination;

        Event(int minute, String type, RouteSegment segment, int quantity, boolean finalDestination) {
            this.minute = minute;
            this.type = type;
            this.segment = segment;
            this.quantity = quantity;
            this.finalDestination = finalDestination;
        }

        String render(WorkingSolution solution) {
            if ("departed".equals(type)) {
                return String.format("(%s) Plane %s - %s with %d bags departed",
                        fmtClock(minute), segment.getOrigin(), segment.getDestination(), quantity);
            }
            return String.format("(%s) Plane %s - %s with %d bags landed (%s) - Current %s Storage (%d bags)",
                    fmtClock(minute), segment.getOrigin(), segment.getDestination(), quantity,
                    finalDestination ? "final" : "connection",
                    segment.getDestination(),
                    solution.warehouseLoadAt(segment.getDestination(), minute));
        }
    }

    private static class Command {
        final String type;
        final String origin;
        final String value;

        private Command(String type, String origin, String value) {
            this.type = type;
            this.origin = origin;
            this.value = value;
        }

        static Command cancel(String id) {
            return new Command("cancel", null, id);
        }

        static Command add(String origin, String line) {
            return new Command("add", origin, line);
        }

        static Command quit() {
            return new Command("quit", null, null);
        }
    }
}
