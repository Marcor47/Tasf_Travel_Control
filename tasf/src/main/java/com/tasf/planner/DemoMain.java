package com.tasf.planner;

import com.tasf.planner.alns.ALNSPlanner;
import com.tasf.planner.core.PlanningContext;
import com.tasf.planner.core.RouteEvaluator;
import com.tasf.planner.core.ScenarioConfig;
import com.tasf.planner.core.WorkingSolution;
import com.tasf.planner.model.Airport;
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.nsga.NSGA2Planner;
import com.tasf.planner.repository.AirportRepository;
import com.tasf.planner.repository.FlightRepository;
import com.tasf.planner.repository.ShipmentRepository;

import java.io.IOException;
import java.util.List;
import java.util.Map;

public class DemoMain {

    //CONFIGURACIÓN DE PRUEBA
    private static final int MAX_LOTS = 10; // ⚠️ cambia a -1 para usar TODOS

    public static void main(String[] args) {

        
        Map<String, Airport> airports;
        List<FlightInstance> flights;
        List<BaggageLot> lots;

        try {
            System.out.println("Cargando datos...");

            AirportRepository airportRepo = new AirportRepository();
            FlightRepository flightRepo = new FlightRepository();
            ShipmentRepository shipmentRepo = new ShipmentRepository();

            airports = airportRepo.loadAirports("data/aeropuertos.txt");
            flights = flightRepo.loadFlights("data/planes_vuelo.txt");
            lots = shipmentRepo.loadShipmentsFromFolder("data/envios/");

            System.out.println("Aeropuertos: " + airports.size());
            System.out.println("Vuelos: " + flights.size());
            System.out.println("Lotes (original): " + lots.size());

            // 🔥 LIMITAR DATASET PARA PRUEBAS
            if (MAX_LOTS > 0 && lots.size() > MAX_LOTS) {
                lots = lots.subList(0, MAX_LOTS);
                System.out.println("Lotes (recortado): " + lots.size());
            }

        } catch (IOException e) {
            System.err.println("Error leyendo archivos: " + e.getMessage());
            e.printStackTrace();
            return;
        }
        


        /*
        Map<String, Airport> airports = Map.of(
                "LIM", new Airport("LIM", "America", 650),
                "MAD", new Airport("MAD", "Europa", 700),
                "JFK", new Airport("JFK", "America", 800),
                "NRT", new Airport("NRT", "Asia", 750)
        );
 
        List<FlightInstance> flights = List.of(
                new FlightInstance("F01", "LIM", "JFK", 2, 8, 220, false),
                new FlightInstance("F02", "JFK", "MAD", 12, 24, 300, false),
                new FlightInstance("F03", "LIM", "MAD", 4, 28, 260, false),
                new FlightInstance("F04", "MAD", "NRT", 30, 46, 320, false),
                new FlightInstance("F05", "JFK", "NRT", 16, 40, 280, false),
                new FlightInstance("F06", "LIM", "JFK", 10, 16, 180, true)
        );
 
        List<BaggageLot> lots = List.of(
                new BaggageLot("L001", "LIM", "MAD", 60, 0, 48, false),
                new BaggageLot("L002", "LIM", "NRT", 40, 0, 72, false),
                new BaggageLot("L003", "LIM", "MAD", 80, 6, 54, true),
                new BaggageLot("L004", "JFK", "NRT", 35, 8, 56, false)
        );
        */



        // 🔹 CONTEXTO
        PlanningContext context = new PlanningContext(
                airports,
                flights,
                ScenarioConfig.defaultWeek4()
        );

        RouteEvaluator evaluator = new RouteEvaluator(context);




        // =========================
        // 🔥 ALNS
        // =========================
        System.out.println("\n Iniciando ALNS...");
        long startALNS = System.currentTimeMillis();

        ALNSPlanner alns = new ALNSPlanner(context, 2026L);
        WorkingSolution alnsSolution = alns.solve(lots, 120, null);

        long endALNS = System.currentTimeMillis();
        System.out.println(" ALNS terminado en " + (endALNS - startALNS) + " ms");




        // =========================
        // 🔥 NSGA-II
        // =========================
        System.out.println("\n Iniciando NSGA-II...");
        long startNSGA = System.currentTimeMillis();

        NSGA2Planner nsga2 = new NSGA2Planner(context, 2026L);
        NSGA2Planner.Result nsga2Result = nsga2.solve(lots, 24, 40);

        long endNSGA = System.currentTimeMillis();
        System.out.println(" NSGA-II terminado en " + (endNSGA - startNSGA) + " ms");



        // =========================
        // 🔹 RESULTADOS (solo muestra parcial)
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



        System.out.println("\n Ejecución completada correctamente.");
    }
}