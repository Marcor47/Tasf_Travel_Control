package com.tasf.planner.core;

import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.model.RoutePlan;
import com.tasf.planner.model.RouteSegment;

import java.util.*;

/**
 * Solución de trabajo que rastrea:
 *  - residualCapacity  : espacio restante por vuelo
 *  - warehouseTimeline : ocupación temporal del almacén por aeropuerto
 *
 * Modelo de almacén:
 *  - Una maleta ocupa espacio SOLO en el almacén de su destino FINAL.
 *    En aeropuertos de escala simplemente transita — no se descarga.
 *  - La maleta entra al almacén cuando llega (arrivalHour del último segmento).
 *  - La maleta sale del almacén WAREHOUSE_DWELL_MINUTES después de llegar
 *    (el cliente la recoge / sale hacia entrega final).
 *  - canAssign() verifica que en ningún minuto del intervalo [arrival, arrival+dwell)
 *    se supere la capacidad del almacén destino.
 */
public class WorkingSolution {

    /** Tiempo que una maleta ocupa el almacén tras llegar (minutos). */
    private static final int WAREHOUSE_DWELL_MINUTES = 10;

    private final PlanningContext context;
    private final Map<String, RoutePlan> assignments;
    private final Map<String, Integer>   residualCapacity;

    /**
     * Timeline de almacén: airportCode → TreeMap<minute, deltaLoad>
     * Cada evento es un delta: +quantity al llegar, -quantity al salir.
     * Para consultar la carga en el minuto T se suman todos los deltas ≤ T.
     */
    private final Map<String, TreeMap<Integer, Integer>> warehouseTimeline;

    // ── constructor ──────────────────────────────────────────────────────────

    public WorkingSolution(PlanningContext context) {
        this.context           = context;
        this.assignments       = new HashMap<>();
        this.residualCapacity  = new HashMap<>();
        this.warehouseTimeline = new HashMap<>();

        for (FlightInstance flight : context.getFlights()) {
            residualCapacity.put(flight.getId(), flight.getCapacity());
        }
    }

    // ── copia ────────────────────────────────────────────────────────────────

    public WorkingSolution copy() {
        WorkingSolution clone = new WorkingSolution(context);
        clone.assignments.putAll(assignments);
        clone.residualCapacity.putAll(residualCapacity);
        for (Map.Entry<String, TreeMap<Integer, Integer>> e : warehouseTimeline.entrySet()) {
            clone.warehouseTimeline.put(e.getKey(), new TreeMap<>(e.getValue()));
        }
        return clone;
    }

    // ── consultas ────────────────────────────────────────────────────────────

    public Map<String, RoutePlan> getAssignments()    { return assignments; }
    public Collection<RoutePlan>  plans()             { return assignments.values(); }
    public RoutePlan getPlan(String lotId)            { return assignments.get(lotId); }

    public int residualFor(String flightId) {
        return residualCapacity.getOrDefault(flightId, 0);
    }

    /**
     * Carga del almacén del aeropuerto en el minuto exacto 'atMinute'.
     * Suma todos los deltas registrados hasta ese minuto inclusive.
     */
    public int warehouseLoadAt(String airportCode, int atMinute) {
        TreeMap<Integer, Integer> timeline = warehouseTimeline.get(airportCode);
        if (timeline == null) return 0;
        int load = 0;
        for (Map.Entry<Integer, Integer> e : timeline.headMap(atMinute, true).entrySet()) {
            load += e.getValue();
        }
        return Math.max(0, load);
    }

    /**
     * Carga máxima del almacén en el intervalo [fromMinute, toMinute].
     * Usada por canAssign() para verificar que no se supera la capacidad
     * en ningún momento durante la permanencia de la maleta.
     */
    public int warehousePeakLoad(String airportCode, int fromMinute, int toMinute) {
        TreeMap<Integer, Integer> timeline = warehouseTimeline.get(airportCode);
        if (timeline == null) return 0;
        // reconstruir carga acumulada en cada punto de evento dentro del rango
        int runningLoad = warehouseLoadAt(airportCode, fromMinute - 1);
        int peak = runningLoad;
        for (Map.Entry<Integer, Integer> e :
                timeline.subMap(fromMinute, true, toMinute, true).entrySet()) {
            runningLoad += e.getValue();
            if (runningLoad > peak) peak = runningLoad;
        }
        return Math.max(0, peak);
    }

    // ── lógica principal ─────────────────────────────────────────────────────

    public boolean canAssign(BaggageLot lot, RoutePlan plan) {
        if (!plan.isFeasible()) return false;

        // 1. Verificar capacidad de cada vuelo en la ruta
        for (RouteSegment segment : plan.getSegments()) {
            if (residualFor(segment.getFlightId()) < lot.getQuantity()) {
                return false;
            }
        }

        // 2. Verificar almacén SOLO en el destino final
        //    La maleta ocupa almacén desde arrival hasta arrival + DWELL
        RouteSegment lastSeg = lastSegment(plan);
        if (lastSeg != null) {
            String finalDest = lastSeg.getDestination();
            var airport = context.getAirports().get(finalDest);
            if (airport == null) {
                throw new IllegalStateException("Airport not found: " + finalDest);
            }
            int arrivalMinute = lastSeg.getArrivalHour();
            int departureMinute = arrivalMinute + WAREHOUSE_DWELL_MINUTES;
            int peakLoad = warehousePeakLoad(finalDest, arrivalMinute, departureMinute);
            if (peakLoad + lot.getQuantity() > airport.getWarehouseCapacity()) {
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

        // Reducir capacidad de cada vuelo usado
        for (RouteSegment segment : plan.getSegments()) {
            residualCapacity.computeIfPresent(
                    segment.getFlightId(), (k, v) -> v - lot.getQuantity());
        }

        // Registrar ocupación temporal en almacén del destino FINAL únicamente
        RouteSegment lastSeg = lastSegment(plan);
        if (lastSeg != null) {
            int arrivalMinute   = lastSeg.getArrivalHour();
            int departureMinute = arrivalMinute + WAREHOUSE_DWELL_MINUTES;
            addWarehouseDelta(lastSeg.getDestination(), arrivalMinute,   +lot.getQuantity());
            addWarehouseDelta(lastSeg.getDestination(), departureMinute, -lot.getQuantity());
        }
    }

    public void remove(BaggageLot lot) {
        RoutePlan existing = assignments.remove(lot.getId());
        if (existing == null) return;

        // Restaurar capacidad de vuelos
        for (RouteSegment segment : existing.getSegments()) {
            residualCapacity.computeIfPresent(
                    segment.getFlightId(), (k, v) -> v + lot.getQuantity());
        }

        // Revertir ocupación de almacén del destino final
        RouteSegment lastSeg = lastSegment(existing);
        if (lastSeg != null) {
            int arrivalMinute   = lastSeg.getArrivalHour();
            int departureMinute = arrivalMinute + WAREHOUSE_DWELL_MINUTES;
            addWarehouseDelta(lastSeg.getDestination(), arrivalMinute,   -lot.getQuantity());
            addWarehouseDelta(lastSeg.getDestination(), departureMinute, +lot.getQuantity());
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private RouteSegment lastSegment(RoutePlan plan) {
        List<RouteSegment> segs = plan.getSegments();
        return segs.isEmpty() ? null : segs.get(segs.size() - 1);
    }

    private void addWarehouseDelta(String airportCode, int minute, int delta) {
        warehouseTimeline
                .computeIfAbsent(airportCode, k -> new TreeMap<>())
                .merge(minute, delta, Integer::sum);
    }

    // ── compatibilidad con código existente ──────────────────────────────────

    /** @deprecated Usar warehouseLoadAt(code, minute) para consultas temporales. */
    @Deprecated
    public int warehouseLoad(String airportCode) {
        // devuelve carga actual en t=0 — útil solo para debug de estado inicial
        return warehouseLoadAt(airportCode, Integer.MAX_VALUE);
    }
}