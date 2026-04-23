package com.tasf.planner.repository;

import com.tasf.planner.model.Airport;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class AirportRepository {

    public Map<String, Airport> loadAirports(String path) throws IOException {

        Map<String, Airport> airports = new HashMap<>();
        String currentContinent = "UNKNOWN";

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(path), StandardCharsets.UTF_8))) {

            String line;

            while ((line = br.readLine()) != null) {

                line = line.trim();

                // 🚫 Saltar vacías
                if (line.isEmpty()) continue;

                // 🌍 Detectar continente
                if (line.contains("America del Sur")) {
                    currentContinent = "America";
                    continue;
                }
                if (line.contains("Europa")) {
                    currentContinent = "Europa";
                    continue;
                }
                if (line.contains("Asia")) {
                    currentContinent = "Asia";
                    continue;
                }

                // 🚫 Ignorar encabezados u otras líneas
                if (!line.matches("^\\d+.*")) continue;

                try {
                    // ✅ 1. Código ICAO (posición fija)
                    String code = line.substring(3, 7).trim();

                    // ✅ 2. Buscar capacidad (último número antes de "Latitude")
                    int latIndex = line.indexOf("Latitude");
                    if (latIndex == -1) continue;

                    String beforeLat = line.substring(0, latIndex).trim();

                    String[] parts = beforeLat.split("\\s+");

                    // último número = capacidad
                    int capacity = Integer.parseInt(parts[parts.length - 1]);

                    // ✅ Guardar aeropuerto
                    airports.put(code, new Airport(code, currentContinent, capacity));

                } catch (Exception e) {
                    System.out.println("⚠ Error parseando:");
                    System.out.println(line);
                }
            }
        }

        return airports;
    }
}