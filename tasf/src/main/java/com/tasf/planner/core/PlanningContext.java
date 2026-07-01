package com.tasf.planner.core;

import com.tasf.planner.model.Airport;
import com.tasf.planner.model.FlightInstance;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Contexto de planificación. Las colecciones son thread-safe y MUTABLES en
 * caliente: el operador puede agregar vuelos/aeropuertos o cerrar aeropuertos
 * mientras la simulación corre. El bucle de simulación aplica esas mutaciones;
 * el planificador (lookahead) las lee de forma segura.
 */
public class PlanningContext {
    private final Map<String, Airport> airports;
    private final List<FlightInstance> flights;
    private final Map<String, List<FlightInstance>> flightsByOrigin;
    private final ScenarioConfig config;

    // Instancias de vuelo canceladas para un día concreto: "flightId@minutoSalida".
    private final Set<String> cancelledInstances = ConcurrentHashMap.newKeySet();
    // Aeropuertos cerrados: no entran/salen vuelos ni se usan para ruteo.
    private final Set<String> closedAirports = ConcurrentHashMap.newKeySet();

    public PlanningContext(
            Map<String, Airport> airports,
            List<FlightInstance> flights,
            ScenarioConfig config) {
        this.airports = new ConcurrentHashMap<>(airports);
        this.flights = new CopyOnWriteArrayList<>(flights);
        this.config = config;
        this.flightsByOrigin = new ConcurrentHashMap<>();
        for (FlightInstance flight : flights) {
            flightsByOrigin
                    .computeIfAbsent(flight.getOrigin(), key -> new CopyOnWriteArrayList<>())
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

    // ── Cancelación por instancia (día concreto) ──────────────────────────────

    /** Cancela la instancia del vuelo que sale en el minuto absoluto dado. */
    public void cancelInstance(String flightId, int departureAbsMinute) {
        cancelledInstances.add(flightId + "@" + departureAbsMinute);
    }

    /** ¿Está cancelada la instancia de este vuelo que sale en ese minuto? */
    public boolean isInstanceCancelled(String flightId, int departureAbsMinute) {
        return cancelledInstances.contains(flightId + "@" + departureAbsMinute);
    }

    // ── Mutación de la red en caliente ────────────────────────────────────────

    /** Agrega un nuevo vuelo disponible para planificación. */
    public void addFlight(FlightInstance flight) {
        flights.add(flight);
        flightsByOrigin
                .computeIfAbsent(flight.getOrigin(), key -> new CopyOnWriteArrayList<>())
                .add(flight);
    }

    /** Reemplaza la capacidad de un vuelo existente por su ID. */
    public boolean updateFlightCapacity(String flightId, int newCapacity) {
        for (int i = 0; i < flights.size(); i++) {
            FlightInstance f = flights.get(i);
            if (f.getId().equals(flightId)) {
                FlightInstance updated = new FlightInstance(
                        f.getId(), f.getOrigin(), f.getDestination(),
                        f.getDepartureHour(), f.getArrivalHour(), newCapacity, f.isCancelled());
                flights.set(i, updated);
                List<FlightInstance> byOrigin = flightsByOrigin.get(f.getOrigin());
                if (byOrigin != null) {
                    byOrigin.replaceAll(x -> x.getId().equals(flightId) ? updated : x);
                }
                return true;
            }
        }
        return false;
    }

    /** Agrega (o reemplaza) un aeropuerto con su almacén. */
    public void addAirport(Airport airport) {
        airports.put(airport.getCode(), airport);
        closedAirports.remove(airport.getCode());
    }

    /** Cierra un aeropuerto: deja de considerarse para ruteo. */
    public void closeAirport(String code) {
        closedAirports.add(code);
    }

    public void reopenAirport(String code) {
        closedAirports.remove(code);
    }

    public boolean isAirportClosed(String code) {
        return closedAirports.contains(code);
    }
}
