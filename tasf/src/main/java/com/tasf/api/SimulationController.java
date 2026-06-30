package com.tasf.api;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;

@RestController
@RequestMapping("/api/simulation")
@CrossOrigin(origins = {"http://localhost:5173", "http://127.0.0.1:5173"})
public class SimulationController {

    private final SimulationService simulationService;

    public SimulationController(SimulationService simulationService) {
        this.simulationService = simulationService;
    }

    @PostMapping("/start")
    public SimulationService.SimulationState start(
            @RequestBody SimulationService.StartRequest request) {
        return simulationService.start(request);
    }

    @PostMapping("/stop")
    public SimulationService.SimulationState stop() {
        return simulationService.stop();
    }

    @PostMapping("/pause")
    public SimulationService.SimulationState pause() {
        return simulationService.pause();
    }




@PostMapping("/editAirport")
public SimulationService.SimulationState editAirport(@RequestBody SimulationService.EditAirportRequest req) {
    return simulationService.editAirport(req.code(), req.capacity());
}

@PostMapping("/editFlight")
public SimulationService.SimulationState editFlight(@RequestBody SimulationService.EditFlightRequest req) {
    return simulationService.editFlight(req.flightId(), req.capacity(), req.departureLocal(), req.arrivalLocal());
}



    @PostMapping("/resume")
    public SimulationService.SimulationState resume() {
        return simulationService.resume();
    }

    @GetMapping("/state")
    public SimulationService.SimulationState state() {
        return simulationService.currentState();
    }

    @GetMapping(value = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events() {
        return simulationService.subscribe();
    }

    @GetMapping("/availableDates")
    public List<String> availableDates() {
        return simulationService.getAvailableDates();
    }

    @GetMapping("/flights")
    public List<SimulationService.FlightInfo> flights() {
        return simulationService.getFlights();
    }

    @PostMapping("/cancelFlight")
    public SimulationService.SimulationState cancelFlight(
            @RequestBody SimulationService.CancelRequest request) {
        return simulationService.cancelFlight(request.flightId());
    }

    @PostMapping("/evaluateLot")
    public SimulationService.FeasibilityReport evaluateLot(
            @RequestBody SimulationService.LotRequest request) {
        return simulationService.evaluateLot(
                request.origin(), request.destination(), request.qty());
    }

    @PostMapping("/addLot")
    public SimulationService.SimulationState addLot(
            @RequestBody SimulationService.LotRequest request) {
        return simulationService.addLot(
                request.origin(), request.destination(), request.qty(),
                request.who(), request.clientEpochMs());
    }

    @PostMapping("/addFlight")
    public SimulationService.SimulationState addFlight(
            @RequestBody SimulationService.FlightRequest r) {
        return simulationService.addFlight(
                r.origin(), r.destination(), r.departureLocal(), r.arrivalLocal(), r.cap());
    }

    @PostMapping("/addAirport")
    public SimulationService.SimulationState addAirport(
            @RequestBody SimulationService.AirportRequest r) {
        return simulationService.addAirport(
                r.code(), r.region(),
                r.lat()      == null ? 0 : r.lat(),
                r.lng()      == null ? 0 : r.lng(),
                r.gmtHours() == null ? 0 : r.gmtHours(),
                r.capacity() == null ? 0 : r.capacity());
    }

    @PostMapping("/closeAirport")
    public SimulationService.SimulationState closeAirport(
            @RequestBody SimulationService.CloseRequest r) {
        return simulationService.closeAirport(r.code());
    }

    @PostMapping("/uploadData")
    public SimulationService.SimulationState uploadData(
            @RequestBody SimulationService.UploadRequest r) {
        return simulationService.uploadData(r.type(), r.content(), r.origin());
    }

    /** Recorrido completo (todos los tramos) de un envío seleccionado. */
    @GetMapping("/shipmentPath")
    public SimulationService.ShipmentPath shipmentPath(@RequestParam String lotId) {
        return simulationService.shipmentPath(lotId);
    }

    /** Estado de preparación de Día a Día (aeropuertos/vuelos/paquetes cargados). */
    @GetMapping("/prepStatus")
    public SimulationService.PrepStatus prepStatus() {
        return simulationService.prepStatus();
    }

    /** Vacía la preparación de Día a Día. */
    @PostMapping("/resetPrep")
    public SimulationService.SimulationState resetPrep() {
        return simulationService.resetPrep();
    }
}