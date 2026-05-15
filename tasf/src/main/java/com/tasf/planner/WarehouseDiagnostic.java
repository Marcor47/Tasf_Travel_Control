package com.tasf.planner;

import com.tasf.planner.core.PlanningContext;
import com.tasf.planner.core.WorkingSolution;
import com.tasf.planner.model.Airport;
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.model.RoutePlan;
import com.tasf.planner.model.RouteSegment;

import java.util.*;

/**
 * Snippet de diagnóstico para pegar en DemoMain después de cada solve().
 *
 * Uso:
 *   WarehouseDiagnostic.printFlightLoad(lots, alnsSolution, context, "ALNS");
 *   WarehouseDiagnostic.printWarehouseTimeline(alnsSolution, context, "ALNS", 60);
 *
 * printFlightLoad      — muestra cuántas maletas despegan en cada vuelo
 *                        y qué % de capacidad ocupan.
 * printWarehouseTimeline — muestra la ocupación de cada almacén en
 *                          ventanas de 'intervalMinutes' minutos.
 */
public class WarehouseDiagnostic {

    // ── carga por vuelo ──────────────────────────────────────────────────────

    public static void printFlightLoad(
            List<BaggageLot> lots,
            WorkingSolution solution,
            PlanningContext context,
            String label) {

        // flightId → cantidad total embarcada
        Map<String, Integer> flightLoad     = new TreeMap<>();
        Map<String, Integer> flightCapacity = new TreeMap<>();

        for (FlightInstance f : context.getFlights()) {
            flightLoad.put(f.getId(), 0);
            flightCapacity.put(f.getId(), f.getCapacity());
        }

        for (BaggageLot lot : lots) {
            RoutePlan plan = solution.getPlan(lot.getId());
            if (plan == null || !plan.isFeasible()) continue;
            for (RouteSegment seg : plan.getSegments()) {
                flightLoad.merge(seg.getFlightId(), lot.getQuantity(), Integer::sum);
            }
        }

        System.out.println("\n=== [" + label + "] CARGA POR VUELO ===");
        System.out.printf("%-8s %-6s %-6s %-6s %-8s %-8s%n",
                "Vuelo", "Orig", "Dest", "Dep", "Embarcado", "Capacidad");
        System.out.println("-".repeat(50));

        // índice de vuelos por id para acceder a origen/destino/dep
        Map<String, FlightInstance> flightById = new HashMap<>();
        for (FlightInstance f : context.getFlights()) flightById.put(f.getId(), f);

        int usedFlights = 0;
        for (Map.Entry<String, Integer> e : flightLoad.entrySet()) {
            int load = e.getValue();
            if (load == 0) continue;  // omitir vuelos vacíos
            usedFlights++;
            FlightInstance f = flightById.get(e.getKey());
            int cap  = flightCapacity.getOrDefault(e.getKey(), 1);
            int pct  = (int)(100.0 * load / cap);
            String bar = "#".repeat(Math.min(20, pct / 5))
                       + ".".repeat(Math.max(0, 20 - pct / 5));
            System.out.printf("%-8s %-6s %-6s %4d  %6d/%6d  %3d%%  |%s|%n",
                    e.getKey(),
                    f != null ? f.getOrigin()      : "?",
                    f != null ? f.getDestination() : "?",
                    f != null ? f.getDepartureHour(): 0,
                    load, cap, pct, bar);
        }
        System.out.printf("Vuelos con carga: %d / %d%n", usedFlights, flightLoad.size());
    }

    // ── timeline de almacén ──────────────────────────────────────────────────

    /**
     * Imprime la ocupación de cada almacén en intervalos de 'intervalMinutes'.
     * Solo muestra aeropuertos que tienen al menos una maleta asignada como destino.
     *
     * @param intervalMinutes resolución temporal (ej. 60 = cada hora, 30 = cada media hora)
     */
    public static void printWarehouseTimeline(
            List<BaggageLot> lots,
            WorkingSolution solution,
            PlanningContext context,
            String label,
            int intervalMinutes) {

        // encontrar rango temporal de la solución
        int minTime = Integer.MAX_VALUE;
        int maxTime = 0;
        Set<String> activeAirports = new TreeSet<>();

        for (BaggageLot lot : lots) {
            RoutePlan plan = solution.getPlan(lot.getId());
            if (plan == null || !plan.isFeasible()) continue;
            List<RouteSegment> segs = plan.getSegments();
            if (segs.isEmpty()) continue;

            RouteSegment last = segs.get(segs.size() - 1);
            int arrival = last.getArrivalHour();
            if (arrival < minTime) minTime = arrival;
            if (arrival > maxTime) maxTime = arrival;
            activeAirports.add(last.getDestination());
        }

        if (activeAirports.isEmpty()) {
            System.out.println("\n[" + label + "] No hay lotes asignados — sin timeline de almacén.");
            return;
        }

        // redondear al intervalo más cercano
        minTime = (minTime / intervalMinutes) * intervalMinutes;
        maxTime = ((maxTime / intervalMinutes) + 2) * intervalMinutes;

        System.out.println("\n=== [" + label + "] OCUPACIÓN DE ALMACENES "
                + "(intervalo=" + intervalMinutes + " min) ===");

        // cabecera de tiempo
        System.out.printf("%-8s %-6s", "Aerop.", "Cap.");
        for (int t = minTime; t <= maxTime; t += intervalMinutes) {
            System.out.printf(" %4d", t);
        }
        System.out.println();
        System.out.println("-".repeat(14 + 5 * ((maxTime - minTime) / intervalMinutes + 1)));

        for (String code : activeAirports) {
            Airport ap = context.getAirports().get(code);
            int cap = (ap != null) ? ap.getWarehouseCapacity() : 9999;

            System.out.printf("%-8s %6d", code, cap);

            for (int t = minTime; t <= maxTime; t += intervalMinutes) {
                int load = solution.warehouseLoadAt(code, t);
                // mostrar con alerta si supera el 80% de capacidad
                String marker = (load > cap * 0.8) ? "!" : " ";
                System.out.printf(" %3d%s", load, marker);
            }
            System.out.println();
        }

        System.out.println("  Nota: '!' indica almacén al >80% de capacidad en ese minuto.");
    }

    // ── resumen rápido ───────────────────────────────────────────────────────

    public static void printSummary(
            List<BaggageLot> lots,
            WorkingSolution solution,
            PlanningContext context,
            String label) {

        int planned = 0, unplanned = 0;
        int warehouseViolations = 0;

        for (BaggageLot lot : lots) {
            RoutePlan plan = solution.getPlan(lot.getId());
            if (plan == null || !plan.isFeasible()) {
                unplanned++;
                continue;
            }
            planned++;

            // verificar si el almacén final estaba al límite
            List<RouteSegment> segs = plan.getSegments();
            if (!segs.isEmpty()) {
                RouteSegment last = segs.get(segs.size() - 1);
                Airport ap = context.getAirports().get(last.getDestination());
                if (ap != null) {
                    int load = solution.warehouseLoadAt(
                            last.getDestination(), last.getArrivalHour());
                    if (load >= ap.getWarehouseCapacity()) warehouseViolations++;
                }
            }
        }

        System.out.printf("%n[%s] Resumen: planificados=%d | sin_ruta=%d | " +
                          "almacén_al_límite=%d lotes%n",
                label, planned, unplanned, warehouseViolations);
    }
}
