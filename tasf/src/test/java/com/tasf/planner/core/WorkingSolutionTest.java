package com.tasf.planner.core;

import com.tasf.planner.model.Airport;
import com.tasf.planner.model.BaggageLot;
import com.tasf.planner.model.FlightInstance;
import com.tasf.planner.model.RoutePlan;
import com.tasf.planner.model.RouteSegment;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkingSolutionTest {

    @Test
    void assignCountsBagAtConnectionUntilNextFlightDeparts() {
        WorkingSolution solution = new WorkingSolution(contextWithConnectionCapacity(10));
        BaggageLot lot = lot("lot-1", 4);
        RoutePlan plan = twoLegPlan("lot-1");

        assertTrue(solution.canAssign(lot, plan));
        solution.assign(lot, plan);

        assertEquals(4, solution.warehouseLoadAt("BBB", 120));
        assertEquals(4, solution.warehouseLoadAt("BBB", 179));
        assertEquals(0, solution.warehouseLoadAt("BBB", 180));
        assertEquals(4, solution.warehouseLoadAt("CCC", 240));
        assertEquals(4, solution.warehouseLoadAt(
                "CCC", 240 + WorkingSolution.WAREHOUSE_DWELL_MINUTES - 1));
        assertEquals(0, solution.warehouseLoadAt(
                "CCC", 240 + WorkingSolution.WAREHOUSE_DWELL_MINUTES));
    }

    @Test
    void assignedBagStaysInOriginWarehouseUntilFirstFlightDeparts() {
        WorkingSolution solution = new WorkingSolution(contextWithConnectionCapacity(10));
        BaggageLot lot = lot("lot-1", 4);   // registrada en minuto 0; F1 despega en 60

        solution.assign(lot, twoLegPlan("lot-1"));

        // Asignada pero el vuelo NO ha despegado → sigue en el almacén de origen
        assertEquals(4, solution.warehouseLoadAt("AAA", 0));
        assertEquals(4, solution.warehouseLoadAt("AAA", 59));
        // En el minuto del despegue sale del almacén y pasa al vuelo
        assertEquals(0, solution.warehouseLoadAt("AAA", 60));
    }

    @Test
    void canAssignRejectsRouteWhenOriginWarehouseWouldOverflow() {
        // Origen AAA con capacidad 10: un lote de 8 esperando su vuelo deja
        // sitio solo para 2 → un segundo lote de 4 no cabe mientras ambos
        // esperan el despegue.
        WorkingSolution solution = new WorkingSolution(contextWithConnectionCapacity(10));
        solution.assign(lot("lot-1", 8), twoLegPlan("lot-1"));

        assertFalse(solution.canAssign(lot("lot-2", 4), twoLegPlan("lot-2")));
    }

    @Test
    void removeClearsOriginWarehouseLoad() {
        WorkingSolution solution = new WorkingSolution(contextWithConnectionCapacity(10));
        BaggageLot lot = lot("lot-1", 4);

        solution.assign(lot, twoLegPlan("lot-1"));
        solution.remove(lot);

        assertEquals(0, solution.warehouseLoadAt("AAA", 30));
    }

    @Test
    void canAssignRejectsRouteWhenConnectionWarehouseWouldOverflow() {
        WorkingSolution solution = new WorkingSolution(contextWithConnectionCapacity(5));
        BaggageLot firstLot = lot("lot-1", 4);
        BaggageLot secondLot = lot("lot-2", 2);

        solution.assign(firstLot, twoLegPlan("lot-1"));

        assertFalse(solution.canAssign(secondLot, twoLegPlan("lot-2")));
    }

    @Test
    void removeClearsConnectionWarehouseLoad() {
        WorkingSolution solution = new WorkingSolution(contextWithConnectionCapacity(10));
        BaggageLot lot = lot("lot-1", 4);

        solution.assign(lot, twoLegPlan("lot-1"));
        solution.remove(lot);

        assertEquals(0, solution.warehouseLoadAt("BBB", 120));
        assertEquals(0, solution.warehouseLoadAt("CCC", 240));
    }

    private PlanningContext contextWithConnectionCapacity(int connectionCapacity) {
        Map<String, Airport> airports = Map.of(
                "AAA", new Airport("AAA", "R1", 10, 0),
                "BBB", new Airport("BBB", "R1", connectionCapacity, 0),
                "CCC", new Airport("CCC", "R1", 10, 0));
        List<FlightInstance> flights = List.of(
                new FlightInstance("F1", "AAA", "BBB", 60, 120, 10, false),
                new FlightInstance("F2", "BBB", "CCC", 180, 240, 10, false));
        return new PlanningContext(airports, flights, ScenarioConfig.defaultWeek4());
    }

    private BaggageLot lot(String id, int quantity) {
        return new BaggageLot(id, "AAA", "CCC", quantity, 0, 300, false);
    }

    private RoutePlan twoLegPlan(String lotId) {
        List<RouteSegment> segments = List.of(
                new RouteSegment("F1", "AAA", "BBB", 60, 120),
                new RouteSegment("F2", "BBB", "CCC", 180, 240));
        return new RoutePlan(lotId, segments, true, "OK", 240, 60, 0, 240);
    }
}
