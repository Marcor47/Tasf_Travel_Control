package com.tasf.planner.repository;

import com.tasf.planner.model.Airport;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

public class AirportRepository {

    public Map<String, Airport> loadAirports(String path) throws IOException {

        Map<String, Airport> airports = new HashMap<>();
        String currentContinent = "UNKNOWN";

        try (BufferedReader br = new BufferedReader(
                new InputStreamReader(new FileInputStream(path), StandardCharsets.UTF_16))) {

            String line;

            while ((line = br.readLine()) != null) {

                line = clean(line);
                if (line.isEmpty()) continue;

                String upper = line.toUpperCase();

                // =========================
                // CONTINENTES
                // =========================
                if (upper.contains("AMERICA DEL SUR")) {
                    currentContinent = "America";
                    continue;
                }
                if (upper.contains("EUROPA")) {
                    currentContinent = "Europa";
                    continue;
                }
                if (upper.contains("ASIA")) {
                    currentContinent = "Asia";
                    continue;
                }

                // solo líneas de aeropuertos
                if (!line.matches("^\\d+.*")) continue;

                try {

                    // ======================================================
                    // 🔥 FIX REAL: NO substring fijo (3,7) — eso está mal
                    // ======================================================

                    String[] parts = line.trim().split("\\s+");

                    // Formato esperado:
                    // 0 = índice
                    // 1 = ICAO
                    // 2 = ciudad
                    // ...

                    if (parts.length < 5) continue;

                    String codeRaw = parts[1];
                    String code = cleanCode(codeRaw);

                    // encontrar capacidad (último número antes de LATITUDE)
                    int latIndex = upper.indexOf("LATITUDE");
                    if (latIndex == -1) continue;

                    String beforeLat = line.substring(0, latIndex).trim();
                    String[] beforeParts = beforeLat.split("\\s+");

                    int capacity = Integer.parseInt(beforeParts[beforeParts.length - 1]);

                    airports.put(code, new Airport(code, currentContinent, capacity));

                } catch (Exception e) {
                    System.out.println("⚠ Error aeropuerto: " + line);
                }
            }
        }

        return airports;
    }

    // =========================
    // CLEAN GENERAL
    // =========================
    private String clean(String s) {
        return s
                .replace("\uFEFF", "")
                .replace("\uFFFE", "")
                .replace("\u200B", "")
                .replace("\u00A0", "")
                .replace("\u0000", "")
                .trim();
    }

    // =========================
    // ICAO CLEAN
    // =========================
    private String cleanCode(String s) {
        return clean(s)
                .toUpperCase()
                .replaceAll("[^A-Z0-9]", "");
    }
}