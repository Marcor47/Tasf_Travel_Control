package com.tasf.planner.model;
 
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
 
public class RoutePlan {
    private final String lotId;
    private final List<RouteSegment> segments;
    private final boolean feasible;
    private final String reason;
    private final int totalTravelHours;
    private final int totalWaitingHours;
    private final int tardinessHours;
    private final double score;
 
    public RoutePlan(
            String lotId,
            List<RouteSegment> segments,
            boolean feasible,
            String reason,
            int totalTravelHours,
            int totalWaitingHours,
            int tardinessHours,
            double score) {
        this.lotId = lotId;
        this.segments = new ArrayList<>(segments);
        this.feasible = feasible;
        this.reason = reason;
        this.totalTravelHours = totalTravelHours;
        this.totalWaitingHours = totalWaitingHours;
        this.tardinessHours = tardinessHours;
        this.score = score;
    }
 
    public static RoutePlan infeasible(String lotId, String reason, double score) {
        return new RoutePlan(lotId, List.of(), false, reason, 0, 0, 999, score);
    }
 
    public String getLotId() {
        return lotId;
    }
 
    public List<RouteSegment> getSegments() {
        return Collections.unmodifiableList(segments);
    }
 
    public boolean isFeasible() {
        return feasible;
    }
 
    public String getReason() {
        return reason;
    }
 
    public int getTotalTravelHours() {
        return totalTravelHours;
    }
 
    public int getTotalWaitingHours() {
        return totalWaitingHours;
    }
 
    public int getTardinessHours() {
        return tardinessHours;
    }
 
    public double getScore() {
        return score;
    }
 
    public int transfers() {
        return Math.max(0, segments.size() - 1);
    }
 
    public int arrivalHour() {
        if (segments.isEmpty()) {
            return Integer.MAX_VALUE;
        }
        return segments.get(segments.size() - 1).getArrivalHour();
    }
 
    public boolean touchesFlight(String flightId) {
        return segments.stream().anyMatch(s -> s.getFlightId().equals(flightId));
    }
 
    public String compactPath() {
        if (segments.isEmpty()) {
            return "SIN-RUTA";
        }
        StringBuilder sb = new StringBuilder();
        sb.append(segments.get(0).getOrigin());
        for (RouteSegment segment : segments) {
            sb.append(" -> ").append(segment.getDestination());
        }
        return sb.toString();
    }
}
