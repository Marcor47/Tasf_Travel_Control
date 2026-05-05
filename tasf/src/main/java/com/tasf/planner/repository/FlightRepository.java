package com.tasf.planner.repository;

import com.tasf.planner.model.Airport;
import com.tasf.planner.model.FlightInstance;

import java.io.*;
import java.util.*;

/**
 * Carga instancias de vuelo y convierte departure/arrival a UTC.
 *
 * Conversión:
 *   departure_UTC = departure_local_origen   - gmtOffset_origen
 *   arrival_UTC   = arrival_local_destino    - gmtOffset_destino
 *
 * El cruce de medianoche se evalúa DESPUÉS de la conversión a UTC,
 * porque un vuelo puede quedar en UTC con arrival 
 */
public class FlightRepository {

    /**
     * @param path     ruta al archivo de vuelos
     * @param airports mapa ICAO → Airport (necesario para leer gmtOffset)
     */
    public List<FlightInstance> loadFlights(String path, Map<String, Airport> airports)
            throws IOException {

        List<FlightInstance> flights = new ArrayList<>();

        try (BufferedReader br = new BufferedReader(new FileReader(path))) {
            String line;
            int idCounter = 1;

            while ((line = br.readLine()) != null) {
                line = clean(line);
                if (line.isEmpty()) continue;
                if (line.startsWith("//")) continue;

                String[] parts = line.split("-");
                if (parts.length < 5) {
                    System.out.println("⚠ Línea vuelo inválida: " + line);
                    continue;
                }

                try {
                    String origin      = cleanCode(parts[0]);
                    String destination = cleanCode(parts[1]);

                    String[] dep = parts[2].split(":");
                    String[] arr = parts[3].split(":");

                    int depHour = Integer.parseInt(dep[0]);
                    int depMin  = Integer.parseInt(dep[1]);
                    int arrHour = Integer.parseInt(arr[0]);
                    int arrMin  = Integer.parseInt(arr[1]);

                    // horas locales en minutos desde medianoche
                    int departureLocal = depHour * 60 + depMin;
                    int arrivalLocal   = arrHour * 60 + arrMin;

                    // obtener offsets GMT (en minutos)
                    int gmtOrigin = getGmt(airports, origin);
                    int gmtDest   = getGmt(airports, destination);

                    // convertir a UTC
                    // UTC = local - gmtOffset  (GMT-5 → sumar 300 min para llegar a UTC)
                    int departureUtc = departureLocal - gmtOrigin;
                    int arrivalUtc   = arrivalLocal   - gmtDest;

                    // normalizar a rango [0, 1440) dentro del día UTC
                    departureUtc = ((departureUtc % 1440) + 1440) % 1440;
                    arrivalUtc   = ((arrivalUtc   % 1440) + 1440) % 1440;

                    // si tras la conversión UTC el vuelo cruza medianoche, sumar un día
                    if (arrivalUtc < departureUtc) {
                        arrivalUtc += 1440;
                    }

                    int capacity = Integer.parseInt(parts[4].trim());

                    flights.add(new FlightInstance(
                            "F" + idCounter++,
                            origin,
                            destination,
                            departureUtc,
                            arrivalUtc,
                            capacity,
                            false
                    ));

                } catch (Exception e) {
                    System.out.println("⚠ Error parseando vuelo: " + line);
                }
            }
        }

        System.out.println("Vuelos cargados: " + flights.size());
        return flights;
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private int getGmt(Map<String, Airport> airports, String code) {
        Airport ap = airports.get(code);
        if (ap == null) {
            System.out.println("⚠ Aeropuerto no encontrado para GMT: " + code + " — usando UTC");
            return 0;
        }
        return ap.getGmtOffset();
    }

    private String clean(String s) {
        return s
                .replace("\uFEFF", "")
                .replace("\u200B", "")
                .replace("\u00A0", "")
                .trim();
    }

    private String cleanCode(String s) {
        return clean(s).toUpperCase().replaceAll("[^A-Z0-9]", "");
    }
}