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
import com.tasf.planner.model.RouteSegment;
import com.tasf.planner.nsga.NSGA2Planner;
import com.tasf.planner.repository.AirportRepository;
import com.tasf.planner.repository.FlightRepository;
import com.tasf.planner.repository.ShipmentRepository;

import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.IOException;
import java.time.LocalDateTime;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

public class DemoMain {

    // ── Parámetros del experimento ───────────────────────────────────────────

    /**
     * Mínimo de maletas totales sumadas a lo largo de los días seleccionados.
     * 0 = acepta cualquier volumen.
     */
    private static final int K_MIN_TOTAL_BAGS = 300000;

    /**
     * Cantidad de días consecutivos a simular.
     * 0 = correr hasta que el sistema colapse (sin límite de días).
     */
    private static final int DAYS = 10;

    /** Presupuesto de tiempo por solve diario de ALNS (segundos). */
    private static final int TIME_BUDGET_SEC = 30;

    /**
     * Limite de iteraciones ALNS.
     * 0 = desactivado. Si tiempo e iteraciones estan activos, gana el primero
     * que se alcance.
     */
    private static final int ALNS_MAX_ITERATIONS = 0;

    private static final String CSV_PATH = "resultados_experimento.csv";
    private static final String TIMING_CSV_PATH = "timing_experimento.csv";
    private static final String LOG_PATH = "simulacion_diaria.txt";

    private static final DateTimeFormatter FMT = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final LocalDateTime BASE_UTC = LocalDateTime.of(2026, 1, 1, 0, 0);

    // ════════════════════════════════════════════════════════════════════════
    public static void main(String[] args) {

        try (PrintWriter csv = new PrintWriter(new FileWriter(CSV_PATH, false));
             PrintWriter timingCsv = new PrintWriter(new FileWriter(TIMING_CSV_PATH, false));
             PrintWriter log = new PrintWriter(new FileWriter(LOG_PATH, false))) {

            csv.println("k,algo,maletas,score,tiempo_ms,"
                    + "total_travel_min,espera_min,transbordos,tardanza_min,"
                    + "sin_ruta");
            timingCsv.println("dia,k,maletas,carga_lotes_ms,overnight_check_ms,"
                    + "candidatos_ms,alns_solve_ms,alns_total_ms,nsga_total_ms,"
                    + "postproceso_ms,dia_total_ms,overhead_no_algoritmo_ms");

            log.println("==========================================================");
            log.println("  SIMULACIÓN DÍA A DÍA — SISTEMA DE ROUTING DE EQUIPAJE  ");
            log.println("==========================================================");
            log.printf("K_MIN=%d  DAYS=%d (0=hasta colapso)  DWELL=%d min%n%n",
                    K_MIN_TOTAL_BAGS, DAYS, WorkingSolution.WAREHOUSE_DWELL_MINUTES);

            // ── Carga de datos ───────────────────────────────────────────────
            System.out.println("Cargando datos...");
            AirportRepository  airportRepo  = new AirportRepository();
            FlightRepository   flightRepo   = new FlightRepository();
            ShipmentRepository shipmentRepo = new ShipmentRepository();

            Map<String, Airport> airports = airportRepo.loadAirports("data/aeropuertos.txt");
            List<FlightInstance> flights  = flightRepo.loadFlights("data/planes_vuelo.txt", airports);

            System.out.printf("Aeropuertos: %d  |  Vuelos: %d%n", airports.size(), flights.size());
            log.printf("Aeropuertos: %d  |  Vuelos: %d%n%n", airports.size(), flights.size());

            PlanningContext context   = new PlanningContext(airports, flights,
                    ScenarioConfig.defaultWeek4());
            RouteEvaluator  evaluator = new RouteEvaluator(context);

            // ── Buscar días con suficientes maletas ──────────────────────────
            System.out.printf("Buscando secuencia de días con >= %d maletas totales...%n",
                    K_MIN_TOTAL_BAGS);
            List<LocalDate> simulationDays = shipmentRepo.findConsecutiveDaysWithK(
                    "data/envios/", airports, K_MIN_TOTAL_BAGS, DAYS);

            if (simulationDays == null || simulationDays.isEmpty()) {
                System.err.println("No se encontró secuencia válida. Abortando.");
                log.println("ERROR: no se encontró secuencia válida.");
                return;
            }

            log.printf("Días seleccionados (%d): %s → %s%n%n",
                    simulationDays.size(),
                    simulationDays.get(0).format(FMT),
                    simulationDays.get(simulationDays.size() - 1).format(FMT));

            // ── Estado overnight que persiste entre días ─────────────────────
            //
            // Lista de OvernightArrival: cada entrada representa UN vuelo que
            // aterrizó más allá de medianoche, con el aeropuerto destino,
            // el minuto absoluto en que entra al almacen del nuevo dia
            // y la cantidad de maletas.
            //
            // NO se agregan por aeropuerto: cada vuelo mantiene su hora
            // individual para que el timeline del almacén los distribuya
            // correctamente y no los acumule todos en el minuto 0.
            List<WorkingSolution.OvernightArrival> pendingOvernight = new ArrayList<>();

            boolean collapsed      = false;
            int     collapseDay    = -1;
            String  collapseReason = "";

            // ── Bucle principal ──────────────────────────────────────────────
            for (int dayIndex = 0; dayIndex < simulationDays.size(); dayIndex++) {

                LocalDate today     = simulationDays.get(dayIndex);
                int       dayNumber = dayIndex + 1;
                int       dayStart  = dayStartMinute(today);
                int       dayEnd    = dayStart + 1440;
                long      dayWallStart = System.currentTimeMillis();

                log.println("══════════════════════════════════════════════════════════");
                log.printf("  DÍA %d — %s%n", dayNumber, today.format(FMT));
                log.println("══════════════════════════════════════════════════════════");
                System.out.printf("%n=== DÍA %d (%s) ===%n", dayNumber, today.format(FMT));

                long loadLotsStart = System.currentTimeMillis();
                List<BaggageLot> lots = shipmentRepo.loadShipmentsForDay(
                        "data/envios/", airports, today, 0);
                int totalBags = lots.stream().mapToInt(BaggageLot::getQuantity).sum();
                long loadLotsMs = System.currentTimeMillis() - loadLotsStart;

                log.printf("Lotes: %d  |  Maletas: %d%n", lots.size(), totalBags);
                System.out.printf("Lotes: %d  |  Maletas: %d%n", lots.size(), totalBags);

                // ── Log overnight entrante y detección de overflow pre-solve ─
                log.println();
                long overnightCheckStart = System.currentTimeMillis();
                if (pendingOvernight.isEmpty()) {
                    log.println("Overnight entrante: ninguno.");
                } else {

                    // Simular pico overnight para detectar overflow antes del solve
                    Map<String, Integer> overnightPeak =
                            simulateOvernightPeak(pendingOvernight, airports);
                    for (Map.Entry<String, Integer> e : overnightPeak.entrySet()) {
                        int cap  = airports.get(e.getKey()).getWarehouseCapacity();
                        int peak = e.getValue();
                        if (peak > cap) {
                            log.printf("  *** OVERFLOW overnight %s: pico=%d cap=%d%n",
                                    e.getKey(), peak, cap);
                            if (!collapsed) {
                                collapsed      = true;
                                collapseDay    = dayNumber;
                                collapseReason = String.format(
                                        "Almacén %s overflow overnight día %d (pico=%d > cap=%d)",
                                        e.getKey(), dayNumber, peak, cap);
                            }
                        }
                    }
                }
                long overnightCheckMs = System.currentTimeMillis() - overnightCheckStart;

                if (collapsed && collapseDay == dayNumber) {
                    log.println();
                    log.println("*** COLAPSO DETECTADO AL INICIO DEL DÍA ***");
                    log.println("Razón: " + collapseReason);
                    System.out.println("*** COLAPSO (overnight): " + collapseReason);
                }

                // ── Precomputar candidatos ───────────────────────────────────
                long startALNS = System.currentTimeMillis();
                System.out.print("Precalculando candidatos... ");
                long tCand = startALNS;
                Map<String, List<RoutePlan>> candidates =
                        new ALNSPlanner(context, 1L).buildCandidateMap(lots);
                long candidateMs = System.currentTimeMillis() - tCand;
                System.out.printf("%.1f s%n", candidateMs / 1000.0);

                // ── ALNS ─────────────────────────────────────────────────────
                // pendingOvernight se inyecta dentro de solveWithCandidates()
                // → seedGreedy() → injectOvernightArrivals(), distribuido por minuto.
                WorkingSolution alnsSol =
                        new ALNSPlanner(context, 1L)
                                .solveWithCandidates(lots, TIME_BUDGET_SEC,
                                        ALNS_MAX_ITERATIONS, null,
                                        candidates, pendingOvernight);
                long alnsSolveMs = System.currentTimeMillis() - startALNS - candidateMs;
                long alnsMs = System.currentTimeMillis() - startALNS;

                // ── NSGA-II ──────────────────────────────────────────────────
                long startNSGA = System.currentTimeMillis();
                NSGA2Planner.Result nsga2Result =
                        new NSGA2Planner(context, 1L).solve(lots, 24, 40, pendingOvernight);
                long nsgaMs = System.currentTimeMillis() - startNSGA;
                WorkingSolution nsgaSol = nsga2Result.getCompromisePlan();

                double        alnsScore = evaluator.solutionScore(lots, alnsSol);
                double        nsgaScore = evaluator.solutionScore(lots, nsgaSol);
                SolutionStats alnsStats = computeStats(lots, alnsSol);
                SolutionStats nsgaStats = computeStats(lots, nsgaSol);

                // ── Log almacenes al cierre del día ──────────────────────────
                log.println();
                log.println("--- Estado del almacén al final del día (ALNS) ---");
                log.printf("%-8s  %6s  %8s  %7s  %12s  %6s%n",
                        "Airport", "Cap", "PeakLoad", "EndLoad", "OvernightOut", "Status");

                // Calcular overnight del día actual → serán pendingOvernight del día siguiente
                List<WorkingSolution.OvernightArrival> nextOvernight =
                        computeOvernightArrivals(lots, alnsSol, dayEnd);

                for (String code : sortedCodes(airports)) {
                    Airport ap       = airports.get(code);
                    int     capacity = ap.getWarehouseCapacity();
                    int     peakLoad = alnsSol.warehousePeakLoad(code, dayStart, dayEnd);
                    int     endLoad  = alnsSol.warehouseLoadAt(code, dayEnd);
                    int     ovOut    = nextOvernight.stream()
                            .filter(oa -> oa.airportCode.equals(code))
                            .mapToInt(oa -> oa.quantity).sum();

                    boolean overflow = peakLoad > capacity;

                    if (peakLoad > 0 || ovOut > 0 || endLoad > 0) {
                        log.printf("%-8s  %6d  %8d  %7d  %12d  %6s%n",
                                code, capacity, peakLoad, endLoad, ovOut,
                                overflow ? "OVERFLOW" : "OK");
                    }

                    if (overflow && !collapsed) {
                        collapsed      = true;
                        collapseDay    = dayNumber;
                        collapseReason = String.format(
                                "Almacén %s overflow día %d (pico=%d > cap=%d)",
                                code, dayNumber, peakLoad, capacity);
                    }
                }

                if (alnsStats.unrouted > 0 && !collapsed) {
                    collapsed      = true;
                    collapseDay    = dayNumber;
                    collapseReason = String.format(
                            "%d lotes sin ruta en día %d", alnsStats.unrouted, dayNumber);
                }
                if (alnsStats.lateLots > 0 && !collapsed) {
                    collapsed      = true;
                    collapseDay    = dayNumber;
                    collapseReason = String.format(
                            "%d lotes con tardanza en día %d", alnsStats.lateLots, dayNumber);
                }

                // ── Resumen del día ──────────────────────────────────────────
                String colFlag = (collapsed && collapseDay == dayNumber) ? "SI" : "no";
                long dayMs = System.currentTimeMillis() - dayWallStart;
                log.println();
                log.println("--- Resumen ---");
                log.printf("ALNS  score=%.1f  sin_ruta=%d  tardios=%d  tiempo=%dms%n",
                        alnsScore, alnsStats.unrouted, alnsStats.lateLots, alnsMs);
                log.printf("NSGA  score=%.1f  sin_ruta=%d  tardios=%d  tiempo=%dms%n",
                        nsgaScore, nsgaStats.unrouted, nsgaStats.lateLots, nsgaMs);
                log.printf("Timing detalle: candidatos=%dms  ALNS_solve=%dms  ALNS_total=%dms  NSGA_total=%dms  dia_total=%dms%n",
                        candidateMs, alnsSolveMs, alnsMs, nsgaMs, dayMs);
                if ("SI".equals(colFlag)) {
                    log.println("*** COLAPSO ***  Razón: " + collapseReason);
                    System.out.println("*** COLAPSO día " + dayNumber + ": " + collapseReason);
                } else {
                    log.println("Sin colapso.");
                }
                log.flush();

                csv.printf("%d,ALNS,%d,%.2f,%d,%.2f,%.2f,%.0f,%.2f,%d%n",
                        lots.size(), totalBags,
                        alnsScore, alnsMs,
                        alnsStats.totalTravel, alnsStats.totalWait,
                        alnsStats.totalTransfers, alnsStats.totalTardiness,
                        alnsStats.unrouted);
                csv.printf("%d,NSGA-II,%d,%.2f,%d,%.2f,%.2f,%.0f,%.2f,%d%n",
                        lots.size(), totalBags,
                        nsgaScore, nsgaMs,
                        nsgaStats.totalTravel, nsgaStats.totalWait,
                        nsgaStats.totalTransfers, nsgaStats.totalTardiness,
                        nsgaStats.unrouted);
                csv.flush();

                long overheadNoAlgMs = Math.max(0, dayMs - alnsMs - nsgaMs);
                long postprocessMs = Math.max(0,
                        overheadNoAlgMs - loadLotsMs - overnightCheckMs);
                timingCsv.printf("%s,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d,%d%n",
                        today.format(FMT), lots.size(), totalBags,
                        loadLotsMs, overnightCheckMs, candidateMs, alnsSolveMs,
                        alnsMs, nsgaMs, postprocessMs, dayMs, overheadNoAlgMs);
                timingCsv.flush();

                System.out.printf("ALNS=%.1f  NSGA=%.1f  sin_ruta=%d/%d  colapso=%s%n",
                        alnsScore, nsgaScore,
                        alnsStats.unrouted, nsgaStats.unrouted, colFlag);
                System.out.printf("Timing: candidatos=%dms  ALNS_solve=%dms  ALNS_total=%dms  NSGA_total=%dms  dia_total=%dms%n",
                        candidateMs, alnsSolveMs, alnsMs, nsgaMs, dayMs);

                pendingOvernight = nextOvernight;
                if (collapsed) break;
            }

            // ── Resumen final ────────────────────────────────────────────────
            log.println();
            log.println("==========================================================");
            log.println("  RESUMEN FINAL");
            log.println("==========================================================");
            if (collapsed)
                log.printf("Colapso en día %d — %s%n", collapseDay, collapseReason);
            else
                log.printf("Sin colapso en %d días simulados.%n", simulationDays.size());
            log.flush();

            System.out.println("\nLog : " + LOG_PATH);
            System.out.println("CSV : " + CSV_PATH);
            System.out.println("Timing CSV : " + TIMING_CSV_PATH);
            if (collapsed)
                System.out.printf("Colapso día %d: %s%n", collapseDay, collapseReason);
            else
                System.out.println("Sin colapso.");

        } catch (IOException e) {
            System.err.println("Error: " + e.getMessage());
            e.printStackTrace();
        }
    }

    // ── Overnight arrivals ───────────────────────────────────────────────────

    /**
     * Construye la lista de OvernightArrival desde la solución del día actual.
     *
     * Un intervalo de almacen es overnight cuando su salida ocurre despues de
     * la medianoche absoluta del dia actual. Se guarda desde esa medianoche
     * hasta la salida real del almacen, usando minutos absolutos.
     *
     * Se genera UNA entrada por lote (no se fusionan), así cada vuelo mantiene
     * su propia hora de llegada y el timeline las distribuye correctamente.
     */
    private static List<WorkingSolution.OvernightArrival> computeOvernightArrivals(
            List<BaggageLot> lots, WorkingSolution sol, int dayEnd) {

        List<WorkingSolution.OvernightArrival> result = new ArrayList<>();
        for (BaggageLot lot : lots) {
            RoutePlan plan = sol.getPlan(lot.getId());
            if (plan == null) continue;
            List<RouteSegment> segs = plan.getSegments();
            if (segs.isEmpty()) continue;
            for (int i = 0; i < segs.size(); i++) {
                RouteSegment segment = segs.get(i);
                int arrivalMinute = segment.getArrivalHour();
                int releaseMinute = (i == segs.size() - 1)
                        ? arrivalMinute + WorkingSolution.WAREHOUSE_DWELL_MINUTES
                        : segs.get(i + 1).getDepartureHour();

                if (releaseMinute > dayEnd) {
                    int carryStart = Math.max(arrivalMinute, dayEnd);
                    result.add(new WorkingSolution.OvernightArrival(
                            segment.getDestination(),
                            carryStart,
                            releaseMinute,
                            lot.getQuantity()));
                }
            }
        }
        return result;
    }

    /**
     * Simula el pico de carga de almacén considerando solo los overnight,
     * para detectar overflow antes del solve del nuevo día.
     */
    private static Map<String, Integer> simulateOvernightPeak(
            List<WorkingSolution.OvernightArrival> arrivals,
            Map<String, Airport> airports) {

        Map<String, TreeMap<Integer, Integer>> timelines = new HashMap<>();
        for (WorkingSolution.OvernightArrival oa : arrivals) {
            int arrMin = oa.arrivalMinuteRebased;
            int depMin = oa.releaseMinuteRebased;
            if (depMin <= arrMin) continue;
            timelines.computeIfAbsent(oa.airportCode, k -> new TreeMap<>())
                     .merge(arrMin, +oa.quantity, Integer::sum);
            timelines.computeIfAbsent(oa.airportCode, k -> new TreeMap<>())
                     .merge(depMin, -oa.quantity, Integer::sum);
        }

        Map<String, Integer> peaks = new TreeMap<>();
        for (Map.Entry<String, TreeMap<Integer, Integer>> e : timelines.entrySet()) {
            int running = 0, peak = 0;
            for (int delta : e.getValue().values()) {
                running += delta;
                if (running > peak) peak = running;
            }
            peaks.put(e.getKey(), Math.max(0, peak));
        }
        return peaks;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private static SolutionStats computeStats(List<BaggageLot> lots, WorkingSolution sol) {
        SolutionStats s = new SolutionStats();
        for (BaggageLot lot : lots) {
            RoutePlan p = sol.getPlan(lot.getId());
            if (p == null) { s.unrouted++; }
            else {
                s.totalTravel    += p.getTotalTravelHours();
                s.totalWait      += p.getTotalWaitingHours();
                s.totalTransfers += p.transfers();
                s.totalTardiness += p.getTardinessHours();
                if (p.getTardinessHours() > 0) s.lateLots++;
            }
        }
        return s;
    }

    private static int dayStartMinute(LocalDate day) {
        return (int) ChronoUnit.MINUTES.between(BASE_UTC, day.atStartOfDay());
    }

    private static List<String> sortedCodes(Map<String, Airport> airports) {
        return airports.keySet().stream().sorted().collect(Collectors.toList());
    }

    private static List<WorkingSolution.OvernightArrival> sortedArrivals(
            List<WorkingSolution.OvernightArrival> arrivals) {
        return arrivals.stream()
                .sorted(Comparator
                        .comparing((WorkingSolution.OvernightArrival a) -> a.airportCode)
                        .thenComparingInt(a -> a.arrivalMinuteRebased))
                .collect(Collectors.toList());
    }

    private static class SolutionStats {
        int    unrouted, lateLots;
        double totalTravel, totalWait, totalTransfers, totalTardiness;
    }
}
