package com.tasf.planner.model;

public class RouteSegment {
    private final String flightId;
    private final String origin;
    private final String destination;
    private final int departureHour;
    private final int arrivalHour;

    public RouteSegment(String flightId, String origin, String destination,
                        int departureHour, int arrivalHour) {
        this.flightId = flightId;
        this.origin = origin;
        this.destination = destination;
        this.departureHour = departureHour;
        this.arrivalHour = arrivalHour;
    }

    public String getFlightId() {
        return flightId;
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
}