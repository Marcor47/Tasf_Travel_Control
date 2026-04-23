package com.tasf.planner.repository;

import com.tasf.planner.model.FlightInstance;

import java.io.*;
import java.util.*;

public class FlightRepository {

    public List<FlightInstance> loadFlights(String path) throws IOException {

        List<FlightInstance> flights = new ArrayList<>();

        try (BufferedReader br = new BufferedReader(new FileReader(path))) {

            String line;
            int idCounter = 1;

            while ((line = br.readLine()) != null) {

                line = clean(line);

                if (line.isEmpty()) continue;

                String[] parts = line.split("-");

                if (parts.length < 5) {
                    System.out.println("⚠ Línea vuelo inválida: " + line);
                    continue;
                }

                try {
                    String origin = cleanCode(parts[0]);
                    String destination = cleanCode(parts[1]);

                    String[] dep = parts[2].split(":");
                    String[] arr = parts[3].split(":");

                    int depHour = Integer.parseInt(dep[0]);
                    int depMin = Integer.parseInt(dep[1]);

                    int arrHour = Integer.parseInt(arr[0]);
                    int arrMin = Integer.parseInt(arr[1]);

                    int departure = depHour * 60 + depMin;
                    int arrival = arrHour * 60 + arrMin;

                    // ✅ FIX: si el vuelo cruza medianoche, sumar 1440 a la llegada
                    if (arrival < departure) {
                        arrival += 1440;
                    }

                    int capacity = Integer.parseInt(parts[4]);

                    flights.add(new FlightInstance(
                            "F" + idCounter++,
                            origin,
                            destination,
                            departure,
                            arrival,
                            capacity,
                            false
                    ));

                } catch (Exception e) {
                    System.out.println("⚠ Error parseando vuelo: " + line);
                }
            }
        }

        return flights;
    }

    private String clean(String s) {
        return s
                .replace("\uFEFF", "")
                .replace("\u200B", "")
                .replace("\u00A0", "")
                .trim();
    }

    // 🔥 SOLO PARA ICAO
    private String cleanCode(String s) {
        return clean(s).toUpperCase().replaceAll("[^A-Z0-9]", "");
    }
}