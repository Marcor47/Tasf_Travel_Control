package com.tasf.planner.repository;
 
import com.tasf.planner.model.Airport;
 
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
 
/**
 * Carga aeropuertos desde el archivo PDDS.
 *
 * Formato de línea de aeropuerto:
 *   01   SKBO   Bogota   Colombia   bogo   -5   430   Latitude: ...
 *
 * Columnas relevantes (separadas por espacios):
 *   parts[0] = índice
 *   parts[1] = código ICAO
 *   ...antes de "Latitude:" está:
 */
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
 
                // ── detectar continente ──────────────────────────────────
                if (upper.contains("AMERICA DEL SUR")) { currentContinent = "America del Sur"; continue; }
                if (upper.contains("AMERICA DEL NORTE")) { currentContinent = "America del Norte"; continue; }
                if (upper.contains("EUROPA"))            { currentContinent = "Europa";    continue; }
                if (upper.contains("ASIA"))              { currentContinent = "Asia";      continue; }
                if (upper.contains("AFRICA"))            { currentContinent = "Africa";    continue; }
                if (upper.contains("OCEANIA"))           { currentContinent = "Oceania";   continue; }
 
                // solo líneas que empiezan con número (filas de aeropuerto)
                if (!line.matches("^\\d+.*")) continue;
 
                try {
                    // ── encontrar índice de "Latitude:" ─────────────────
                    int latIndex = upper.indexOf("LATITUDE");
                    if (latIndex == -1) continue;
 
                    // todo lo que está antes de "Latitude:"
                    String beforeLat = line.substring(0, latIndex).trim();
                    String[] parts   = beforeLat.split("\\s+");
 
                    // Necesitamos al menos: idx ICAO ciudad país abrev GMT capacidad
                    if (parts.length < 5) continue;
 
                    String code     = cleanCode(parts[1]);           // ICAO
                    // capacidad = último token antes de Latitude
                    int capacity    = Integer.parseInt(parts[parts.length - 1]);
                    // GMT      = penúltimo token (ej. "-5", "+1", "0")
                    String gmtToken = parts[parts.length - 2];
                    int gmtHours    = parseGmt(gmtToken);
                    int gmtOffset   = gmtHours * 60;                 // convertir a minutos
 
                    double latitude = parseCoordinate(line, "LATITUDE");
                    double longitude = parseCoordinate(line, "LONGITUDE");

                    airports.put(code, new Airport(
                            code, currentContinent, capacity, gmtOffset,
                            latitude, longitude));
 
                } catch (Exception e) {
                    System.out.println("⚠ Error aeropuerto: " + line);
                }
            }
        }
 
        System.out.println("Aeropuertos cargados: " + airports.size());
        return airports;
    }
 
    // ── helpers ─────────────────────────────────────────────────────────────
 
    /**
     * Parsea tokens de GMT como "-5", "+1", "0", "5".
     * Si el token no es un entero reconocible devuelve 0 (UTC).
     */
    private int parseGmt(String token) {
        try {
            // quitar el signo '+' explícito si lo tiene
            return Integer.parseInt(token.replace("+", ""));
        } catch (NumberFormatException e) {
            System.out.println("⚠ GMT no reconocido '" + token + "' — usando 0");
            return 0;
        }
    }
 
    private String clean(String s) {
        return s
                .replace("\uFEFF", "")
                .replace("\uFFFE", "")
                .replace("\u200B", "")
                .replace("\u00A0", "")
                .replace("\u0000", "")
                .trim();
    }
 
    private String cleanCode(String s) {
        return clean(s).toUpperCase().replaceAll("[^A-Z0-9]", "");
    }

    private double parseCoordinate(String line, String label) {
        String upper = line.toUpperCase();
        int labelIndex = upper.indexOf(label);
        if (labelIndex < 0) return 0.0;

        int nextLabel = "LATITUDE".equals(label)
                ? upper.indexOf("LONGITUDE", labelIndex)
                : line.length();
        if (nextLabel < 0) nextLabel = line.length();

        String chunk = line.substring(labelIndex, nextLabel)
                .replace(label + ":", "")
                .replace("Latitude:", "")
                .replace("Longitude:", "")
                .replace("°", " ")
                .replace("'", " ")
                .replace("\"", " ")
                .trim();
        String[] parts = chunk.split("\\s+");
        if (parts.length < 4) return 0.0;

        try {
            double deg = Double.parseDouble(parts[0]);
            double min = Double.parseDouble(parts[1]);
            double sec = Double.parseDouble(parts[2]);
            String hemisphere = parts[3].toUpperCase();
            double value = deg + min / 60.0 + sec / 3600.0;
            if ("S".equals(hemisphere) || "W".equals(hemisphere)) {
                value *= -1.0;
            }
            return value;
        } catch (NumberFormatException e) {
            return 0.0;
        }
    }
}
