package com.tasf.planner.model;

public class FlightInstance {
    private final String id;
    private final String origin;
    private final String destination;
    private int departureHour;
    private int arrivalHour;
    private int capacity;
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

    public void setDepartureHour(int departureHour) {
        this.departureHour = departureHour;
    }

    public int getArrivalHour() {
        return arrivalHour;
    }

    public void setArrivalHour(int arrivalHour) {
        this.arrivalHour = arrivalHour;
    }

    public int getCapacity() {
        return capacity;
    }

    public void setCapacity(int capacity) {
        this.capacity = capacity;
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