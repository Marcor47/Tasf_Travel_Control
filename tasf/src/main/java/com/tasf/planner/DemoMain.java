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

import java.io.IOException;
import java.util.List;
import java.util.Map;

public class DemoMain {

    // Cambia a -1 para usar TODOS los lotes
    private static final int MAX_LOTS = 10;

    public static void main(String[] args) {

        Map<String, Airport> airports;
        List<FlightInstance> flights;
        List<BaggageLot> lots;

        try {
            System.out.println("Cargando datos...");

            AirportRepository airportRepo   = new AirportRepository();
            FlightRepository  flightRepo    = new FlightRepository();
            ShipmentRepository shipmentRepo = new ShipmentRepository();

            airports = airportRepo.loadAirports("data/aeropuertos.txt");
            flights  = flightRepo.loadFlights("data/planes_vuelo.txt");
            lots     = shipmentRepo.loadShipmentsFromFolder("data/envios/", MAX_LOTS);

            System.out.println("Aeropuertos cargados             : " + airports.size());
            System.out.println("Vuelos cargados                  : " + flights.size());
            System.out.println("Lotes cargados (k más tempranos) : " + lots.size());

        } catch (IOException e) {
            System.err.println("Error leyendo archivos: " + e.getMessage());
            e.printStackTrace();
            return;
        }

        // ── Contexto ──────────────────────────────────────────────────────
        PlanningContext context = new PlanningContext(
                airports,
                flights,
                ScenarioConfig.defaultWeek4()
        );

        RouteEvaluator evaluator = new RouteEvaluator(context);

        // =========================
        //  ALNS
        // =========================
        System.out.println("\n Iniciando ALNS...");
        long startALNS = System.currentTimeMillis();

        ALNSPlanner alns = new ALNSPlanner(context, 2026L);
        WorkingSolution alnsSolution = alns.solve(lots, 120, null);

        long endALNS = System.currentTimeMillis();
        System.out.println(" ALNS terminado en " + (endALNS - startALNS) + " ms");

        // =========================
        //  NSGA-II
        // =========================
        System.out.println("\n Iniciando NSGA-II...");
        long startNSGA = System.currentTimeMillis();

        NSGA2Planner nsga2 = new NSGA2Planner(context, 2026L);
        NSGA2Planner.Result nsga2Result = nsga2.solve(lots, 24, 40);

        long endNSGA = System.currentTimeMillis();
        System.out.println(" NSGA-II terminado en " + (endNSGA - startNSGA) + " ms");

        // =========================
        //  RESULTADOS
        // =========================
        int preview = Math.min(10, lots.size());

        System.out.println("\n===== ALNS (preview) =====");
        for (int i = 0; i < preview; i++) {
            BaggageLot lot = lots.get(i);
            var plan = alnsSolution.getPlan(lot.getId());
            System.out.println(lot.getId() + " -> "
                    + (plan == null ? "SIN-RUTA" : plan.compactPath()));
        }
        System.out.println("Score ALNS = "
                + evaluator.solutionScore(lots, alnsSolution));

        System.out.println("\n===== NSGA-II (preview) =====");
        for (int i = 0; i < preview; i++) {
            BaggageLot lot = lots.get(i);
            var plan = nsga2Result.getCompromisePlan().getPlan(lot.getId());
            System.out.println(lot.getId() + " -> "
                    + (plan == null ? "SIN-RUTA" : plan.compactPath()));
        }
        System.out.println("Frente de Pareto = "
                + nsga2Result.getFirstFront().size() + " soluciones");
        System.out.println("Score NSGA-II (compromiso) = "
                + evaluator.solutionScore(lots, nsga2Result.getCompromisePlan()));

        // =========================
        //  ANÁLISIS COMPARATIVO
        // =========================
        System.out.println("\n===== ANÁLISIS COMPARATIVO =====");

        int    alnsPlanned = 0, alnsUnplanned = 0;
        double alnsTotalTravel = 0, alnsTardiness = 0,
               alnsWaiting = 0,    alnsTransfers = 0;

        int    nsgaPlanned = 0, nsgaUnplanned = 0;
        double nsgaTotalTravel = 0, nsgaTardiness = 0,
               nsgaWaiting = 0,    nsgaTransfers = 0;

        WorkingSolution nsgaSolution = nsga2Result.getCompromisePlan();

        for (BaggageLot lot : lots) {
            RoutePlan alnsP = alnsSolution.getPlan(lot.getId());
            RoutePlan nsgaP = nsgaSolution.getPlan(lot.getId());

            if (alnsP == null) {
                alnsUnplanned++;
            } else {
                alnsPlanned++;
                alnsTotalTravel += alnsP.getTotalTravelHours();
                alnsTardiness   += alnsP.getTardinessHours();
                alnsWaiting     += alnsP.getTotalWaitingHours();
                alnsTransfers   += alnsP.transfers();
            }

            if (nsgaP == null) {
                nsgaUnplanned++;
            } else {
                nsgaPlanned++;
                nsgaTotalTravel += nsgaP.getTotalTravelHours();
                nsgaTardiness   += nsgaP.getTardinessHours();
                nsgaWaiting     += nsgaP.getTotalWaitingHours();
                nsgaTransfers   += nsgaP.transfers();
            }
        }

        double alnsScore = evaluator.solutionScore(lots, alnsSolution);
        double nsgaScore = evaluator.solutionScore(lots, nsgaSolution);

        // Ponderaciones de ScenarioConfig.defaultWeek4()
        double wTravel    = 1.0;
        double wWaiting   = 0.8;
        double wTransfers = 4.0;
        double wTardiness = 30.0;

        double alnsScoreFromParts = wTravel    * alnsTotalTravel
                                  + wWaiting   * alnsWaiting
                                  + wTransfers * alnsTransfers
                                  + wTardiness * alnsTardiness;
        double nsgaScoreFromParts = wTravel    * nsgaTotalTravel
                                  + wWaiting   * nsgaWaiting
                                  + wTransfers * nsgaTransfers
                                  + wTardiness * nsgaTardiness;

        System.out.printf("%-35s %10s %10s%n", "Métrica", "ALNS", "NSGA-II");
        System.out.println("-".repeat(57));
        System.out.printf("%-35s %10.1f %10.1f%n", "Score total (min)",
                alnsScore, nsgaScore);
        System.out.printf("%-35s %10.1f %10.1f%n", "Score total (hrs equiv)",
                alnsScore / 60.0, nsgaScore / 60.0);
        System.out.println("-".repeat(57));
        System.out.printf("%-35s %10.1f %10.1f%n", "  TotalTravel x1.0 (min)",
                wTravel * alnsTotalTravel, wTravel * nsgaTotalTravel);
        System.out.printf("%-35s %10.1f %10.1f%n", "  Espera x0.8 (min)",
                wWaiting * alnsWaiting, wWaiting * nsgaWaiting);
        System.out.printf("%-35s %10.1f %10.1f%n", "  Transbordos x4.0",
                wTransfers * alnsTransfers, wTransfers * nsgaTransfers);
        System.out.printf("%-35s %10.1f %10.1f%n", "  Tardanza x30.0 (min)",
                wTardiness * alnsTardiness, wTardiness * nsgaTardiness);
        System.out.printf("%-35s %10.1f %10.1f%n", "  Score reconstruido",
                alnsScoreFromParts, nsgaScoreFromParts);
        System.out.println("-".repeat(57));
        System.out.printf("%-35s %10.1f %10.1f%n", "TotalTravel bruto (min)",
                alnsTotalTravel, nsgaTotalTravel);
        System.out.printf("%-35s %10.1f %10.1f%n", "Espera bruta (min)",
                alnsWaiting, nsgaWaiting);
        System.out.printf("%-35s %10.1f %10.1f%n", "Transbordos totales",
                alnsTransfers, nsgaTransfers);
        System.out.printf("%-35s %10.1f %10.1f%n", "Tardanza total (min)",
                alnsTardiness, nsgaTardiness);
        System.out.printf("%-35s %10d %10d%n", "Lotes planificados",
                alnsPlanned, nsgaPlanned);
        System.out.printf("%-35s %10d %10d%n", "Lotes SIN ruta",
                alnsUnplanned, nsgaUnplanned);
        System.out.printf("%-35s %10.1f %10.1f%n", "TotalTravel promedio (min)",
                alnsPlanned > 0 ? alnsTotalTravel / alnsPlanned : 0,
                nsgaPlanned > 0 ? nsgaTotalTravel / nsgaPlanned : 0);
        System.out.printf("%-35s %10.1f %10.1f%n", "Espera promedio (min)",
                alnsPlanned > 0 ? alnsWaiting / alnsPlanned : 0,
                nsgaPlanned > 0 ? nsgaWaiting / nsgaPlanned : 0);
        System.out.printf("%-35s %10.1f %10.1f%n", "Tardanza promedio (min)",
                alnsPlanned > 0 ? alnsTardiness / alnsPlanned : 0,
                nsgaPlanned > 0 ? nsgaTardiness / nsgaPlanned : 0);
        System.out.printf("%-35s %10d %10d%n", "Tiempo ejecucion (ms)",
                (endALNS - startALNS), (endNSGA - startNSGA));

        System.out.println("\n¿Cuándo usar cada uno?");
        if (alnsScore < nsgaScore) {
            System.out.println(" ALNS tiene menor score agregado"
                    + " (mejor si priorizas minimizar costo total)");
        } else {
            System.out.println(" NSGA-II tiene menor score agregado"
                    + " en la solucion compromiso");
        }
        if (alnsTotalTravel <= nsgaTotalTravel) {
            System.out.println(" ALNS logra menor tiempo total de viaje"
                    + " (componente de mayor peso en el score)");
        } else {
            System.out.println(" NSGA-II logra menor tiempo total de viaje");
        }
        if (alnsWaiting > nsgaWaiting) {
            System.out.println(" NSGA-II reduce esperas en escalas"
                    + " (mejor experiencia operativa en conexiones)");
        } else {
            System.out.println(" ALNS igual o menor espera en escalas");
        }
        if (alnsTransfers > nsgaTransfers) {
            System.out.println(" NSGA-II reduce transbordos"
                    + " (menor complejidad operativa)");
        } else {
            System.out.println(" ALNS igual o menor numero de transbordos");
        }
        System.out.println(" NSGA-II ademas ofrece "
                + nsga2Result.getFirstFront().size()
                + " soluciones alternativas en el frente de Pareto"
                + " para elegir manualmente");

        System.out.println("\n Ejecucion completada correctamente.");
    }
}