package com.tasf.planner;

import com.tasf.planner.alns.ALNSPlanner;
import com.tasf.planner.core.PlanningContext;
import com.tasf.planner.core.RouteEvaluator;
import com.tasf.planner.core.ScenarioConfig;
import com.tasf.planner.core.WorkingSolution;
import com.tasf.planner.model.Airport;
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.model.RoutePlan;
import com.tasf.planner.nsga.NSGA2Planner;
import com.tasf.planner.repository.AirportRepository;
import com.tasf.planner.repository.FlightRepository;
import com.tasf.planner.repository.ShipmentRepository;

import java.io.FileWriter;
import java.io.IOException;
import java.io.PrintWriter;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.List;
import java.util.Map;

public class AnovaExperimentMain {

    private static final int[] K_LEVELS = {15000, 20000, 25000, 30000};
    private static final int RUNS_PER_K = 30;
    private static final int ALNS_TIME_BUDGET_SEC = 30;
    private static final int ALNS_MAX_ITERATIONS = 0;
    private static final int NSGA_POPULATION_SIZE = 24;
    private static final int NSGA_GENERATIONS = 40;

    private static final String OUTPUT_PATH = "anova_experimento.csv";
    private static final String TIMING_OUTPUT_PATH = "anova_timing_experimento.csv";
    private static final DateTimeFormatter FMT = DateTimeFormatter.ISO_LOCAL_DATE;

    public static void main(String[] args) {
        try (PrintWriter csv = new PrintWriter(new FileWriter(OUTPUT_PATH, false));
             PrintWriter timingCsv = new PrintWriter(new FileWriter(TIMING_OUTPUT_PATH, false))) {
            csv.println("run,k,algo,maletas,score,tiempo_ms,"
                    + "total_travel_min,espera_min,transbordos,tardanza_min,"
                    + "sin_ruta");
            timingCsv.println("run,k,algo,maletas,candidatos_ms,solve_ms,total_ms");

            System.out.println("Cargando datos para experimento ANOVA...");
            AirportRepository airportRepo = new AirportRepository();
            FlightRepository flightRepo = new FlightRepository();
            ShipmentRepository shipmentRepo = new ShipmentRepository();

            Map<String, Airport> airports = airportRepo.loadAirports("data/aeropuertos.txt");
            List<FlightInstance> flights = flightRepo.loadFlights("data/planes_vuelo.txt", airports);
            PlanningContext context = new PlanningContext(
                    airports, flights, ScenarioConfig.defaultWeek4());
            RouteEvaluator evaluator = new RouteEvaluator(context);

            int maxK = maxK();
            List<LocalDate> days = shipmentRepo.findConsecutiveDaysWithK(
                    "data/envios/", airports, maxK, 1);
            if (days == null || days.isEmpty()) {
                throw new IllegalStateException("No day found with at least " + maxK + " bags.");
            }
            LocalDate experimentDay = days.get(0);

            System.out.printf("Dia base ANOVA: %s%n", experimentDay.format(FMT));
            System.out.printf("K levels: %s | runs per K: %d%n",
                    java.util.Arrays.toString(K_LEVELS), RUNS_PER_K);

            for (int k : K_LEVELS) {
                List<BaggageLot> lots = shipmentRepo.loadShipmentsForDay(
                        "data/envios/", airports, experimentDay, k);
                int totalBags = lots.stream().mapToInt(BaggageLot::getQuantity).sum();
                System.out.printf("%nK=%d -> lotes=%d, maletas=%d%n",
                        k, lots.size(), totalBags);

                for (int run = 1; run <= RUNS_PER_K; run++) {
                    long seed = seedFor(k, run);
                    System.out.printf("  Run %02d/%02d seed=%d%n", run, RUNS_PER_K, seed);

                    long candStart = System.currentTimeMillis();
                    Map<String, List<RoutePlan>> candidates =
                            new ALNSPlanner(context, seed).buildCandidateMap(lots);
                    long candidateMs = System.currentTimeMillis() - candStart;

                    long alnsStart = System.currentTimeMillis();
                    WorkingSolution alnsSol = new ALNSPlanner(context, seed)
                            .solveWithCandidates(lots, ALNS_TIME_BUDGET_SEC,
                                    ALNS_MAX_ITERATIONS, null,
                                    candidates, Collections.emptyList());
                    long alnsSolveMs = System.currentTimeMillis() - alnsStart;
                    long alnsTotalMs = candidateMs + alnsSolveMs;

                    writeRow(csv, run, k, "ALNS", totalBags,
                            evaluator.solutionScore(lots, alnsSol), alnsTotalMs,
                            computeStats(lots, alnsSol));
                    timingCsv.printf("%d,%d,ALNS,%d,%d,%d,%d%n",
                            run, k, totalBags, candidateMs, alnsSolveMs, alnsTotalMs);

                    long nsgaStart = System.currentTimeMillis();
                    NSGA2Planner.Result nsgaResult = new NSGA2Planner(context, seed)
                            .solve(lots, NSGA_POPULATION_SIZE, NSGA_GENERATIONS,
                                    Collections.emptyList());
                    long nsgaMs = System.currentTimeMillis() - nsgaStart;
                    WorkingSolution nsgaSol = nsgaResult.getCompromisePlan();

                    writeRow(csv, run, k, "NSGA-II", totalBags,
                            evaluator.solutionScore(lots, nsgaSol), nsgaMs,
                            computeStats(lots, nsgaSol));
                    timingCsv.printf("%d,%d,NSGA-II,%d,%d,%d,%d%n",
                            run, k, totalBags, 0, nsgaMs, nsgaMs);
                    csv.flush();
                    timingCsv.flush();
                }
            }

            System.out.println("\nANOVA CSV: " + OUTPUT_PATH);
            System.out.println("ANOVA timing CSV: " + TIMING_OUTPUT_PATH);

        } catch (IOException e) {
            System.err.println("Error ANOVA: " + e.getMessage());
            e.printStackTrace();
        }
    }

    private static void writeRow(
            PrintWriter csv,
            int run,
            int k,
            String algo,
            int totalBags,
            double score,
            long totalMs,
            SolutionStats stats) {

        csv.printf("%d,%d,%s,%d,%.2f,%d,%.2f,%.2f,%.0f,%.2f,%d%n",
                run, k, algo, totalBags, score, totalMs,
                stats.totalTravel, stats.totalWait, stats.totalTransfers,
                stats.totalTardiness, stats.unrouted);
    }

    private static SolutionStats computeStats(List<BaggageLot> lots, WorkingSolution sol) {
        SolutionStats s = new SolutionStats();
        for (BaggageLot lot : lots) {
            RoutePlan p = sol.getPlan(lot.getId());
            if (p == null) {
                s.unrouted++;
            } else {
                s.totalTravel += p.getTotalTravelHours();
                s.totalWait += p.getTotalWaitingHours();
                s.totalTransfers += p.transfers();
                s.totalTardiness += p.getTardinessHours();
                if (p.getTardinessHours() > 0) s.lateLots++;
            }
        }
        return s;
    }

    private static long seedFor(int k, int run) {
        return 10_000L * k + run;
    }

    private static int maxK() {
        int max = 0;
        for (int k : K_LEVELS) {
            max = Math.max(max, k);
        }
        return max;
    }

    private static class SolutionStats {
        int unrouted, lateLots;
        double totalTravel, totalWait, totalTransfers, totalTardiness;
    }
}
