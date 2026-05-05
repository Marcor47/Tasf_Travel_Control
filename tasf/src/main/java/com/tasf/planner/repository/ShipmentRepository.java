package com.tasf.planner.repository;

import com.tasf.planner.model.Airport;
import com.tasf.planner.model.BaggageLot;

import java.io.*;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

/**
 * Carga lotes de equipaje con registro en UTC.
 *
 * Flujo:
 *  1. loadAllUtc()          — lee todos los archivos, convierte cada timestamp a UTC
 *  2. findDayWithK()        — busca el primer día con al menos targetK lotes (±10%)
 *  3. loadShipmentsForDay() — devuelve los primeros maxLots lotes de ese día en UTC
 *
 * Conversión a UTC:
 *   registrationTime_UTC = registrationTime_local - gmtOffset_origen
 *   dueTime = registrationTime_UTC + 48h (siempre en UTC)
 */
public class ShipmentRepository {

    // Fecha base del sistema: todo tiempo se mide en minutos desde este instante UTC
    private static final LocalDateTime BASE_UTC = LocalDateTime.of(2026, 1, 1, 0, 0);

    // ── clase interna ────────────────────────────────────────────────────────

    private static class LotEntry {
        final BaggageLot lot;
        final long utcMinutes;   // minutos desde BASE_UTC — ya en UTC
        final LocalDate utcDate;

        LotEntry(BaggageLot lot, long utcMinutes) {
            this.lot        = lot;
            this.utcMinutes = utcMinutes;
            this.utcDate    = BASE_UTC.plusMinutes(utcMinutes).toLocalDate();
        }
    }

    // ── API pública ──────────────────────────────────────────────────────────

    /**
     * Busca el primer día (en UTC) que tenga al menos targetK lotes.
     * Tolerancia: acepta días con lotes en [targetK * 0.9, ∞).
     *
     * @param folderPath ruta a la carpeta de envíos
     * @param airports   mapa ICAO → Airport para leer gmtOffset
     * @param targetK    cantidad mínima de lotes requerida
     * @return fecha UTC del día encontrado, o null si ninguno cumple
     */
    public LocalDate findDayWithK(String folderPath,
                                  Map<String, Airport> airports,
                                  int targetK) throws IOException {

        // contar lotes por día UTC
        Map<LocalDate, Integer> countByDay = new TreeMap<>();
        for (LotEntry entry : loadAllUtc(folderPath, airports)) {
            countByDay.merge(entry.utcDate, 1, Integer::sum);
        }

        int lowerBound = (int) (targetK * 0.9);

        System.out.println("Distribución de lotes por día UTC:");
        for (Map.Entry<LocalDate, Integer> e : countByDay.entrySet()) {
            System.out.printf("  %s : %d lotes%n", e.getKey(), e.getValue());
        }

        // primer día (orden cronológico) con suficientes lotes
        for (Map.Entry<LocalDate, Integer> e : countByDay.entrySet()) {
            if (e.getValue() >= lowerBound) {
                System.out.printf("Día seleccionado: %s (%d lotes, target=%d)%n",
                        e.getKey(), e.getValue(), targetK);
                return e.getKey();
            }
        }

        System.out.println("⚠ Ningún día tiene " + lowerBound + "+ lotes.");
        return null;
    }

    /**
     * Devuelve los primeros maxLots lotes del día targetDay, ordenados por
     * hora de registro UTC.
     *
     * @param maxLots número máximo de lotes a devolver (≤0 = todos los del día)
     */
    public List<BaggageLot> loadShipmentsForDay(String folderPath,
                                                 Map<String, Airport> airports,
                                                 LocalDate targetDay,
                                                 int maxLots) throws IOException {

        List<LotEntry> dayEntries = new ArrayList<>();
        for (LotEntry entry : loadAllUtc(folderPath, airports)) {
            if (entry.utcDate.equals(targetDay)) {
                dayEntries.add(entry);
            }
        }

        // ordenar por hora UTC dentro del día
        dayEntries.sort(Comparator.comparingLong(e -> e.utcMinutes));

        int limit = (maxLots <= 0) ? dayEntries.size()
                                   : Math.min(maxLots, dayEntries.size());

        List<BaggageLot> result = new ArrayList<>(limit);
        for (int i = 0; i < limit; i++) {
            result.add(dayEntries.get(i).lot);
        }

        System.out.printf("Lotes cargados del día %s: %d (solicitados=%d)%n",
                targetDay, result.size(), maxLots);
        return result;
    }

    // ── método original — se conserva para compatibilidad ───────────────────

    /**
     * @deprecated Usar loadShipmentsForDay() para garantizar que todos los
     *             lotes pertenecen al mismo día UTC.
     */
    @Deprecated
    public List<BaggageLot> loadShipmentsFromFolder(String folderPath, int maxLots)
            throws IOException {
        // sin mapa de aeropuertos → no puede convertir a UTC; aviso explícito
        System.out.println("⚠ loadShipmentsFromFolder() no convierte a UTC. " +
                           "Usar loadShipmentsForDay() con mapa de aeropuertos.");
        List<LotEntry> all = loadAllUtc(folderPath, Collections.emptyMap());
        all.sort(Comparator.comparingLong(e -> e.utcMinutes));
        int limit = (maxLots <= 0) ? all.size() : Math.min(maxLots, all.size());
        List<BaggageLot> result = new ArrayList<>(limit);
        for (int i = 0; i < limit; i++) result.add(all.get(i).lot);
        return result;
    }

    // ── implementación interna ───────────────────────────────────────────────

    /**
     * Lee todos los archivos de la carpeta y devuelve todos los lotes
     * con su timestamp ya convertido a UTC.
     */
    private List<LotEntry> loadAllUtc(String folderPath,
                                       Map<String, Airport> airports)
            throws IOException {

        List<LotEntry> all = new ArrayList<>();

        File folder = new File(folderPath);
        File[] files = folder.listFiles();
        if (files == null) return all;

        // ordenar archivos para procesado determinista
        Arrays.sort(files, Comparator.comparing(File::getName));

        for (File file : files) {
            if (!file.getName().contains("_envios_")) continue;

            String origin = extractOrigin(file.getName());
            int gmtOrigin = getGmt(airports, origin);  // en minutos

            try (BufferedReader br = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = br.readLine()) != null) {

                    line = clean(line);
                    if (line.isEmpty()) continue;

                    String[] parts = line.split("-");
                    if (parts.length < 7) {
                        System.out.println("⚠ Línea envío inválida: " + line);
                        continue;
                    }

                    try {
                        String id = origin + "_" + parts[0];

                        String dateStr = parts[1];
                        int year  = Integer.parseInt(dateStr.substring(0, 4));
                        int month = Integer.parseInt(dateStr.substring(4, 6));
                        int day   = Integer.parseInt(dateStr.substring(6, 8));
                        int hour  = Integer.parseInt(parts[2]);
                        int min   = Integer.parseInt(parts[3]);

                        // timestamp local del aeropuerto origen
                        LocalDateTime localTs = LocalDateTime.of(year, month, day, hour, min);
                        long localMinutes = Duration.between(BASE_UTC, localTs).toMinutes();

                        // convertir a UTC: UTC = local - gmtOffset
                        long utcMinutes = localMinutes - gmtOrigin;

                        int registrationTimeUtc = (int) utcMinutes;
                        int dueTimeUtc          = registrationTimeUtc + (48 * 60);

                        String destination = cleanCode(parts[4]);
                        int quantity       = Integer.parseInt(parts[5].trim());

                        BaggageLot lot = new BaggageLot(
                                id,
                                origin,
                                destination,
                                quantity,
                                registrationTimeUtc,
                                dueTimeUtc,
                                false
                        );

                        all.add(new LotEntry(lot, utcMinutes));

                    } catch (Exception e) {
                        System.out.println("⚠ Error envío: " + line);
                    }
                }
            }
        }

        return all;
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private int getGmt(Map<String, Airport> airports, String code) {
        if (airports == null || airports.isEmpty()) return 0;
        Airport ap = airports.get(code);
        if (ap == null) {
            System.out.println("⚠ GMT no encontrado para origen: " + code + " — usando UTC");
            return 0;
        }
        return ap.getGmtOffset();
    }

    private String extractOrigin(String filename) {
        // formato esperado: algo_envios_ICAO.txt
        String[] parts = filename.split("_");
        return parts.length > 2 ? cleanCode(parts[2]) : "UNK";
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