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
 * En cada aeropuerto origen se llena un archivo
    id_envío-aaaammdd-hh-mm-dest-###-IdClien
    00000001-20250102-01-38-EBCI-006-0007729

    Dónde 
    id_pedido. Identificador de pedido para el destino solicitado.
    aaaammdd: 
    mm: 01, ..., 12
    dd: 01, 04, 12, 24
    hh: horas dos posiciones 01,14..23 (máximo de 23)
    mm: minutos dos posiciones  01, 08, 25..59 (máximo de 59)
    dest: codigo del aeropuerto destino considerado: SVMI, SBBR, etc 
    ###: cantidad como cadena de 3 posiciones   001, 002, 089, 999 
 * 
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

        System.out.printf("Lotes cargados del día %s: %d lotes / %d maletas (objetivo=%d maletas)%n",
                targetDay, result.size(), bagsAccumulated, maxLots);
        return result;
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

        // contar MALETAS por día UTC (no lotes — cada lote tiene N maletas)
        Map<LocalDate, Integer> bagsByDay  = new TreeMap<>();
        Map<LocalDate, Integer> lotsByDay  = new TreeMap<>();
        for (LotEntry entry : loadAllUtc(folderPath, airports)) {
            bagsByDay.merge(entry.utcDate, entry.lot.getQuantity(), Integer::sum);
            lotsByDay.merge(entry.utcDate, 1, Integer::sum);
        }

        int lowerBound = (int) (targetK * 0.9);

        System.out.println("Distribución por día UTC (maletas / lotes):");
        for (LocalDate d : bagsByDay.keySet()) {
            System.out.printf("  %s : %d maletas en %d lotes%n",
                    d, bagsByDay.get(d), lotsByDay.getOrDefault(d, 0));
        }

        // primer día (orden cronológico) con suficientes MALETAS
        for (Map.Entry<LocalDate, Integer> e : bagsByDay.entrySet()) {
            if (e.getValue() >= lowerBound) {
                System.out.printf("Día seleccionado: %s (%d maletas en %d lotes, target=%d)%n",
                        e.getKey(), e.getValue(),
                        lotsByDay.getOrDefault(e.getKey(), 0), targetK);
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

        // acumular lotes hasta completar maxBags maletas
        // (maxBags <= 0 = todos los lotes del día)
        List<BaggageLot> result = new ArrayList<>();
        int bagsAccumulated = 0;
        for (LotEntry entry : dayEntries) {
            if (maxLots > 0 && bagsAccumulated >= maxLots) break;
            result.add(entry.lot);
            bagsAccumulated += entry.lot.getQuantity();
        }

        System.out.printf("Lotes cargados del día %s: %d lotes / %d maletas (objetivo=%d maletas)%n",
                targetDay, result.size(), bagsAccumulated, maxLots);
        return result;
    }

    public List<BaggageLot> loadShipmentsForDays(String folderPath,
                                                 Map<String, Airport> airports,
                                                 List<LocalDate> targetDays) throws IOException {
        Set<LocalDate> selectedDays = new HashSet<>(targetDays);
        List<LotEntry> selectedEntries = new ArrayList<>();
        for (LotEntry entry : loadAllUtc(folderPath, airports)) {
            if (selectedDays.contains(entry.utcDate)) {
                selectedEntries.add(entry);
            }
        }

        selectedEntries.sort(Comparator.comparingLong(e -> e.utcMinutes));

        List<BaggageLot> result = new ArrayList<>();
        for (LotEntry entry : selectedEntries) {
            result.add(entry.lot);
        }
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
                        

                        // Formato: id-aaaammdd-hh-mm-dest-###-IdClien
                        String destination = cleanCode(parts[4]);           // parts[4] = ICAO destino
                        int quantity       = Integer.parseInt(            // parts[5] = cantidad maletas
                                clean(parts[5]).replaceAll("[^0-9]", "")); // clean() antes de parseInt
                        // parts[6] = IdCliente — no se usa en la planificación

                        // Ventana de entrega según continente
                        // Mismo continente: 24h  |  Distinto continente: 48h
                        Airport originAirport = airports.get(origin);
                        Airport destAirport   = airports.get(destination);
                        boolean sameContinent = originAirport != null
                                && destAirport != null
                                && originAirport.getRegion().equals(destAirport.getRegion());
                        int dueTimeUtc = registrationTimeUtc + (sameContinent ? 24 * 60 : 48 * 60);

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
    
    public List<LocalDate> findConsecutiveDaysWithK(
        String folderPath,
        Map<String, Airport> airports,
        int targetTotalBags,
        int targetDays) throws IOException {
 
            // Build per-day bag counts (sorted chronologically)
            Map<LocalDate, Integer> bagsByDay  = new TreeMap<>();
            Map<LocalDate, Integer> lotsByDay  = new TreeMap<>();

            for (LotEntry entry : loadAllUtc(folderPath, airports)) {
                bagsByDay.merge(entry.utcDate, entry.lot.getQuantity(), Integer::sum);
                lotsByDay.merge(entry.utcDate, 1, Integer::sum);
            }

            if (bagsByDay.isEmpty()) return null;

            List<LocalDate> allDays   = new ArrayList<>(bagsByDay.keySet()); // already sorted
            int             totalDays = allDays.size();

            System.out.println("Distribución por día UTC:");
            for (LocalDate d : allDays) {
                System.out.printf("  %s : %d maletas en %d lotes%n",
                        d, bagsByDay.get(d), lotsByDay.getOrDefault(d, 0));
            }

            int lowerBound = Math.max(0, targetTotalBags);

            // ── Case 1: fixed window length ──────────────────────────────────────
            if (targetDays > 0) {
                for (int start = 0; start + targetDays <= totalDays; start++) {
                    // Check days are actually consecutive (no gaps)
                    boolean consecutive = true;
                    for (int i = start; i < start + targetDays - 1; i++) {
                        if (!allDays.get(i).plusDays(1).equals(allDays.get(i + 1))) {
                            consecutive = false;
                            break;
                        }
                    }
                    if (!consecutive) continue;

                    int windowBags = 0;
                    for (int i = start; i < start + targetDays; i++) {
                        windowBags += bagsByDay.get(allDays.get(i));
                    }
                    if (windowBags >= lowerBound) {
                        List<LocalDate> window = new ArrayList<>(
                                allDays.subList(start, start + targetDays));
                        System.out.printf(
                                "Ventana encontrada: %s → %s (%d días, %d maletas totales)%n",
                                window.get(0), window.get(window.size() - 1),
                                targetDays, windowBags);
                        return window;
                    }
                }
                System.out.printf(
                        "No se encontró ventana de %d días consecutivos con %d+ maletas.%n",
                        targetDays, lowerBound);
                return null;
            }

            // ── Case 2: run until collapse (targetDays == 0) ─────────────────────
            // Find the first start date where a consecutive run from that point
            // accumulates >= targetTotalBags, then return everything from there onward.
            for (int start = 0; start < totalDays; start++) {
                int runBags = 0;
                int runEnd  = start;

                // Accumulate as long as days are consecutive
                for (int i = start; i < totalDays; i++) {
                    if (i > start && !allDays.get(i - 1).plusDays(1).equals(allDays.get(i))) {
                        break; // gap in calendar — stop the run
                    }
                    runBags += bagsByDay.get(allDays.get(i));
                    runEnd   = i;
                    if (runBags >= lowerBound) {
                        // Found enough bags — return from this start to end of data
                        List<LocalDate> window = new ArrayList<>(
                                allDays.subList(start, totalDays));
                        System.out.printf(
                                "Ventana encontrada (modo colapso): inicio=%s  días_disponibles=%d  "
                                + "maletas_acumuladas=%d (umbral alcanzado en día %s)%n",
                                window.get(0), window.size(), runBags, allDays.get(runEnd));
                        return window;
                    }
                }
            }

            System.out.printf(
                    "No se encontró secuencia consecutiva con %d+ maletas totales.%n",
                    lowerBound);
            return null;
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
