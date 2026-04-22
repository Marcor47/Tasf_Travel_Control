package com.tasf.planner.core;
 
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.model.RoutePlan;
import com.tasf.planner.model.RouteSegment;
 
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
 
public class RouteEvaluator {
    private final PlanningContext context;
 
    public RouteEvaluator(PlanningContext context) {
        this.context = context;
    }
 
    public List<RoutePlan> enumerateCandidates(BaggageLot lot) {
        List<RoutePlan> candidates = new ArrayList<>();
        dfs(
                lot,
                lot.getOrigin(),
                lot.getRegistrationHour(),
                new ArrayList<>(),
                candidates,
                0);
        candidates.sort(Comparator.comparingDouble(RoutePlan::getScore));
        return candidates;
    }
 
    private void dfs(
            BaggageLot lot,
            String currentAirport,
            int currentHour,
            List<RouteSegment> partial,
            List<RoutePlan> results,
            int depth) {
        if (depth >= context.getConfig().getMaxLegs()) {
            return;
        }
        for (FlightInstance flight : context.flightsFrom(currentAirport)) {
            if (flight.isCancelled()) {
                continue;
            }
            if (flight.getDepartureHour() < currentHour) {
                continue;
            }
            if (!partial.isEmpty()) {
                int connection = flight.getDepartureHour() - currentHour;
                if (connection < context.getConfig().getMinConnectionHours()) {
                    continue;
                }
            }
            RouteSegment segment = new RouteSegment(
                    flight.getId(),
                    flight.getOrigin(),
                    flight.getDestination(),
                    flight.getDepartureHour(),
                    flight.getArrivalHour());
            partial.add(segment);
            if (flight.getDestination().equals(lot.getDestination())) {
                results.add(scorePlan(lot, partial));
            } else {
                dfs(
                        lot,
                        flight.getDestination(),
                        flight.getArrivalHour(),
                        partial,
                        results,
                        depth + 1);
            }
            partial.remove(partial.size() - 1);
        }
    }
 
    public RoutePlan scorePlan(BaggageLot lot, List<RouteSegment> segments) {
        if (segments.isEmpty()) {
            return RoutePlan.infeasible(lot.getId(), "Sin ruta", 9999);
        }
        int waiting = 0;
        for (int i = 1; i < segments.size(); i++) {
            waiting += segments.get(i).getDepartureHour()
                    - segments.get(i - 1).getArrivalHour();
        }
        int totalTravel = segments.get(segments.size() - 1).getArrivalHour()
                - lot.getRegistrationHour();
        int tardiness = Math.max(0, segments.get(segments.size() - 1).getArrivalHour()
                - lot.getDueHour());
        double score = totalTravel
                + context.getConfig().getWaitingPenalty() * waiting
                + context.getConfig().getTransferPenalty() * Math.max(0, segments.size() - 1)
                + context.getConfig().getTardinessPenalty() * tardiness;
        return new RoutePlan(
                lot.getId(),
                segments,
                true,
                "OK",
                totalTravel,
                waiting,
                tardiness,
                score);
    }
 
    public double solutionScore(
            List<BaggageLot> lots,
            WorkingSolution solution) {
        double total = 0.0;
        for (BaggageLot lot : lots) {
            RoutePlan plan = solution.getPlan(lot.getId());
            if (plan == null) {
                total += context.getConfig().getUnplannedPenalty();
            } else {
                total += plan.getScore();
            }
        }
        return total;
    }
}
