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

    private static final int MAX_CONNECTION_MINUTES = 12 * 60; 

    public RouteEvaluator(PlanningContext context) {
        this.context = context;
    }

    private int adjustToNextAvailableDeparture(int flightDeparture, int currentTime) {

        int day = currentTime / 1440;
        int todayDep = day * 1440 + flightDeparture;
        if (todayDep >= currentTime) return todayDep;
        int nextDep = todayDep + 1440;
        return nextDep;
    }

    public List<RoutePlan> enumerateCandidates(BaggageLot lot) {
        List<RoutePlan> candidates = new ArrayList<>();

        dfs(
                lot,
                lot.getOrigin(),
                lot.getRegistrationHour(),
                new ArrayList<>(),
                candidates,
                0
        );

        candidates.sort(Comparator.comparingDouble(RoutePlan::getScore));
        return candidates;
    }

    private void dfs(
            BaggageLot lot,
            String currentAirport,
            int currentTime,
            List<RouteSegment> partial,
            List<RoutePlan> results,
            int depth) {

        if (depth >= context.getConfig().getMaxLegs()) {
            return;
        }

        for (FlightInstance flight : context.flightsFrom(currentAirport)) {

            if (flight.isCancelled()) continue;

            // No usar vuelos que toquen un aeropuerto cerrado.
            if (context.isAirportClosed(flight.getOrigin())
                    || context.isAirportClosed(flight.getDestination())) continue;

            int dep = adjustToNextAvailableDeparture(
                    flight.getDepartureHour(),
                    currentTime
            );
            if (dep == -1) continue;

            // No usar una instancia (día concreto) cancelada por el operador.
            if (context.isInstanceCancelled(flight.getId(), dep)) continue;

            int flightDuration = flight.getArrivalHour() - flight.getDepartureHour();
            if (flightDuration < 0) {
                flightDuration += 1440;
            }

            int arr = dep + flightDuration;

            if (arr > lot.getDueHour()) {
                continue;
            }

           
            if (!partial.isEmpty()) {
                int connection = dep - currentTime;

                if (connection < context.getConfig().getMinConnectionHours()) {
                    continue;
                }

                if (connection > MAX_CONNECTION_MINUTES) {
                    continue;
                }
            }

            int totalSoFar = arr - lot.getRegistrationHour();
            if (totalSoFar > lot.getDueHour() - lot.getRegistrationHour()) {
                continue;
            }

            RouteSegment segment = new RouteSegment(
                    flight.getId(),
                    flight.getOrigin(),
                    flight.getDestination(),
                    dep,
                    arr
            );

            partial.add(segment);

            if (flight.getDestination().equals(lot.getDestination())) {
                results.add(scorePlan(lot, partial));
            } else {
                dfs(
                        lot,
                        flight.getDestination(),
                        arr,
                        partial,
                        results,
                        depth + 1
                );
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

        int totalTravel = Math.max(
                0,
                segments.get(segments.size() - 1).getArrivalHour()
                        - lot.getRegistrationHour()
        );

        int tardiness = Math.max(
                0,
                segments.get(segments.size() - 1).getArrivalHour()
                        - lot.getDueHour()
        );

        double score =
                totalTravel
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
                Math.max(0, score)
        );
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
