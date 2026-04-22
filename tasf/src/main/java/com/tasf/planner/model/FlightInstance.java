package com.tasf.planner.model;
 
public class FlightInstance {
    private final String id;
    private final String origin;
    private final String destination;
    private final int departureHour;
    private final int arrivalHour;
    private final int capacity;
    private boolean cancelled;
 
    public FlightInstance(
            String id,
            String origin,
            String destination,
            int departureHour,
            int arrivalHour,
            int capacity,
            boolean cancelled) {
        this.id = id;
        this.origin = origin;
        this.destination = destination;
        this.departureHour = departureHour;
        this.arrivalHour = arrivalHour;
        this.capacity = capacity;
        this.cancelled = cancelled;
    }
 
    public String getId() {
        return id;
    }
 
    public String getOrigin() {
        return origin;
    }
 
    public String getDestination() {
        return destination;
    }
 
    public int getDepartureHour() {
        return departureHour;
    }
 
    public int getArrivalHour() {
        return arrivalHour;
    }
 
    public int getCapacity() {
        return capacity;
    }
 
    public boolean isCancelled() {
        return cancelled;
    }
 
    public void setCancelled(boolean cancelled) {
        this.cancelled = cancelled;
    }
 
    public int durationHours() {
        return arrivalHour - departureHour;
    }
}
