package com.tasf.planner.core;
 
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.model.RoutePlan;
import com.tasf.planner.model.RouteSegment;
 
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
 
public class WorkingSolution {
    private final PlanningContext context;
    private final Map<String, RoutePlan> assignments;
    private final Map<String, Integer> residualCapacity;
    private final Map<String, Integer> projectedWarehouseLoad;
 
    public WorkingSolution(PlanningContext context) {
        this.context = context;
        this.assignments = new HashMap<>();
        this.residualCapacity = new HashMap<>();
        this.projectedWarehouseLoad = new HashMap<>();
        for (FlightInstance flight : context.getFlights()) {
            residualCapacity.put(flight.getId(), flight.getCapacity());
        }
    }
 
    public WorkingSolution copy() {
        WorkingSolution clone = new WorkingSolution(context);
        clone.assignments.putAll(assignments);
        clone.residualCapacity.putAll(residualCapacity);
        clone.projectedWarehouseLoad.putAll(projectedWarehouseLoad);
        return clone;
    }
 
    public Map<String, RoutePlan> getAssignments() {
        return assignments;
    }
 
    public Collection<RoutePlan> plans() {
        return assignments.values();
    }
 
    public RoutePlan getPlan(String lotId) {
        return assignments.get(lotId);
    }
 
    public int residualFor(String flightId) {
        return residualCapacity.getOrDefault(flightId, 0);
    }
 
    public int warehouseLoad(String airportCode) {
        return projectedWarehouseLoad.getOrDefault(airportCode, 0);
    }
 
    public boolean canAssign(BaggageLot lot, RoutePlan plan) {
        if (!plan.isFeasible()) {
            return false;
        }
        for (RouteSegment segment : plan.getSegments()) {
            if (residualFor(segment.getFlightId()) < lot.getQuantity()) {
                return false;
            }
        }
        for (RouteSegment segment : plan.getSegments()) {
            String dest = segment.getDestination();

            var airport = context.getAirports().get(dest);

            if (airport == null) {
                throw new IllegalStateException("Airport not found in context: " + dest);
            }

            int projected = warehouseLoad(dest);
            int capacity = airport.getWarehouseCapacity();
            if (projected + lot.getQuantity() > capacity) {
                return false;
            }
        }
        return true;
    }
 
    public void assign(BaggageLot lot, RoutePlan plan) {
        if (assignments.containsKey(lot.getId())) {
            remove(lot);
        }
        assignments.put(lot.getId(), plan);
        for (RouteSegment segment : plan.getSegments()) {
            residualCapacity.computeIfPresent(
                    segment.getFlightId(), (k, v) -> v - lot.getQuantity());
            projectedWarehouseLoad.merge(
                    segment.getDestination(), lot.getQuantity(), Integer::sum);
        }
    }
 
    public void remove(BaggageLot lot) {
        RoutePlan existing = assignments.remove(lot.getId());
        if (existing == null) {
            return;
        }
        for (RouteSegment segment : existing.getSegments()) {
            residualCapacity.computeIfPresent(
                    segment.getFlightId(), (k, v) -> v + lot.getQuantity());
            projectedWarehouseLoad.computeIfPresent(
                    segment.getDestination(),
                    (k, v) -> Math.max(0, v - lot.getQuantity()));
        }
    }
}
