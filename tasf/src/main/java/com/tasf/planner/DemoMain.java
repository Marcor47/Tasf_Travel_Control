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
 
import java.util.List;
import java.util.Map;
 
public class DemoMain {
    public static void main(String[] args) {
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
 
        PlanningContext context = new PlanningContext(
                airports,
                flights,
                ScenarioConfig.defaultWeek4()
        );
 
        RouteEvaluator evaluator = new RouteEvaluator(context);
        ALNSPlanner alns = new ALNSPlanner(context, 2026L);
        WorkingSolution alnsSolution = alns.solve(lots, 120, "F06");
 
        NSGA2Planner nsga2 = new NSGA2Planner(context, 2026L);
        NSGA2Planner.Result nsga2Result = nsga2.solve(lots, 24, 40);
 
        System.out.println("===== ALNS =====");
        for (BaggageLot lot : lots) {
            var plan = alnsSolution.getPlan(lot.getId());
            System.out.println(lot.getId() + " -> "
                    + (plan == null ? "SIN-RUTA" : plan.compactPath()));
        }
        System.out.println("Score ALNS = "
                + evaluator.solutionScore(lots, alnsSolution));
 
        System.out.println("===== NSGA-II =====");
        for (BaggageLot lot : lots) {
            var plan = nsga2Result.getCompromisePlan().getPlan(lot.getId());
            System.out.println(lot.getId() + " -> "
                    + (plan == null ? "SIN-RUTA" : plan.compactPath()));
        }
        System.out.println("Frente de Pareto = "
                + nsga2Result.getFirstFront().size() + " soluciones");
    }
}
