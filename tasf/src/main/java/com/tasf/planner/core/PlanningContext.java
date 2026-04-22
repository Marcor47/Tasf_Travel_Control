package com.tasf.planner.core;
 
import com.tasf.planner.model.Airport;
import com.tasf.planner.model.FlightInstance;
 
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
 
public class PlanningContext {
    private final Map<String, Airport> airports;
    private final List<FlightInstance> flights;
    private final Map<String, List<FlightInstance>> flightsByOrigin;
    private final ScenarioConfig config;
 
    public PlanningContext(
            Map<String, Airport> airports,
            List<FlightInstance> flights,
            ScenarioConfig config) {
        this.airports = airports;
        this.flights = flights;
        this.config = config;
        this.flightsByOrigin = new HashMap<>();
        for (FlightInstance flight : flights) {
            flightsByOrigin
                    .computeIfAbsent(flight.getOrigin(), key -> new ArrayList<>())
                    .add(flight);
        }
    }
 
    public Map<String, Airport> getAirports() {
        return airports;
    }
 
    public List<FlightInstance> getFlights() {
        return flights;
    }
 
    public List<FlightInstance> flightsFrom(String origin) {
        return flightsByOrigin.getOrDefault(origin, List.of());
    }
 
    public ScenarioConfig getConfig() {
        return config;
    }
}
