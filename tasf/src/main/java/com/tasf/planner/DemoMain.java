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
import java.io.PrintWriter;
import java.io.IOException;
import java.util.List;
import java.util.Map;
public class DemoMain {

    // Cambia a -1 para usar TODOS los lotes
    private static final int[]  K_VALUES  = {10, 50, 100, 500};
    private static final int    REPLICAS  = 30;
    private static final String CSV_PATH  = "resultados_experimento.csv";

    public static void main(String[] args) {

        Map<String, Airport> airports;
        List<FlightInstance> flights;
        List<BaggageLot> lots;
        try (PrintWriter csv = new PrintWriter(new FileWriter(CSV_PATH, false))) {
            // -- Inicializacion CSV
            csv.println("k,algoritmo,replica,score,tiempo_ms,"
                      + "total_travel_min,espera_min,transbordos,"
                      + "tardanza_min,sin_ruta");

            // -- Contexto -------------------------------------
            System.out.println("Cargando datos...");

            AirportRepository airportRepo   = new AirportRepository();
            FlightRepository  flightRepo    = new FlightRepository();
            ShipmentRepository shipmentRepo = new ShipmentRepository();
            
            airports = airportRepo.loadAirports("data/aeropuertos.txt");
            flights  = flightRepo.loadFlights("data/planes_vuelo.txt");
            System.out.println("Aeropuertos cargados             : " + airports.size());
            System.out.println("Vuelos cargados                  : " + flights.size());
            
            PlanningContext context = new PlanningContext(
                    airports,
                    flights,
                    ScenarioConfig.defaultWeek4()
            );
            RouteEvaluator evaluator = new RouteEvaluator(context);
            // Verificacion inicial del evaluador 
            System.out.println("=== Verificación de consistencia del evaluador ===");
            List<BaggageLot> testLots = shipmentRepo.loadShipmentsFromFolder("data/envios/", 10);
            ALNSPlanner testAlns = new ALNSPlanner(context, 1L);
            WorkingSolution testSol = testAlns.solve(testLots, 120, null);
            double scoreA = evaluator.solutionScore(testLots, testSol);
            double scoreB = 0;
            for (BaggageLot lot : testLots) {
                RoutePlan p = testSol.getPlan(lot.getId());
                if (p != null) scoreB += p.getTotalTravelHours()
                                       + 0.8 * p.getTotalWaitingHours()      
                                       + 4.0 * p.transfers()
                                       + 30.0 * p.getTardinessHours();  
            }
            System.out.printf("Score A (evaluador): %.2f%n", scoreA);
            System.out.printf("Score B (manual):    %.2f%n", scoreB);
            System.out.printf("Diferencia:          %.4f%n", Math.abs(scoreA - scoreB));
            if (Math.abs(scoreA - scoreB) > 1.0)
                System.out.println("ADVERTENCIA: scores inconsistentes — revisar unidades");
            else
                System.out.println("OK: evaluador consistente. Iniciando experimento.");
            
             for (int k : K_VALUES) {
                lots = shipmentRepo.loadShipmentsFromFolder("data/envios/", k);
                System.out.printf("%n--- k = %d ---%n", k);
                for (int seed = 1; seed <= REPLICAS; seed++) {
                    // =========================
                    //  ALNS
                    // =========================
                    System.out.println("\n Iniciando ALNS...");
                    long startALNS = System.currentTimeMillis();

                    ALNSPlanner alns = new ALNSPlanner(context, (long)seed);
                    WorkingSolution alnsSolution = alns.solve(lots, 120, null);

                    long endALNS = System.currentTimeMillis();
                    System.out.println(" ALNS terminado en " + (endALNS - startALNS) + " ms");

                    // =========================
                    //  NSGA-II
                    // =========================
                    System.out.println("\n Iniciando NSGA-II...");
                    long startNSGA = System.currentTimeMillis();

                    NSGA2Planner nsga2 = new NSGA2Planner(context, (long)seed);
                    NSGA2Planner.Result nsga2Result = nsga2.solve(lots, 24, 40);

                    long endNSGA = System.currentTimeMillis();
                    System.out.println(" NSGA-II terminado en " + (endNSGA - startNSGA) + " ms");
                    
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
                    
                    csv.printf("%d,ALNS,%d,%.2f,%d,%.2f,%.2f,%.0f,%.2f,%d%n",
                        k, seed, alnsScore, endALNS-startALNS,
                        alnsTotalTravel, alnsWaiting, alnsTransfers, alnsTardiness, alnsUnplanned);
                    csv.printf("%d,NSGA-II,%d,%.2f,%d,%.2f,%.2f,%.0f,%.2f,%d%n",
                        k, seed, nsgaScore, endNSGA-startNSGA,
                        nsgaTotalTravel, nsgaWaiting, nsgaTransfers, nsgaTardiness, nsgaUnplanned);
                    csv.flush();
                    
                    System.out.printf("k=%4d | rep=%2d | ALNS=%8.1f | NSGA=%8.1f | %dms / %dms%n",
                    k, seed, alnsScore, nsgaScore,(endALNS-startALNS), (endNSGA-startNSGA));
                }
            }
        } catch (IOException e) {
            System.err.println("Error: " + e.getMessage());
            e.printStackTrace();
        }
        
        System.out.println("\nCSV generado: " + CSV_PATH);
        System.out.println("Filas escritas: " + (K_VALUES.length * REPLICAS * 2));
        System.out.println("\n Ejecucion completada correctamente.");
    }
}