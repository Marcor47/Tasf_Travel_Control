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

    @PostMapping("/cancelFlight")
    public SimulationService.SimulationState cancelFlight(
            @RequestBody SimulationService.CancelRequest request) {
        return simulationService.cancelFlight(request.flightId());
    }
}