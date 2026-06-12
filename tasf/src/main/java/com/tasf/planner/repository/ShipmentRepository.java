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
 * ESTRATEGIA DE MEMORIA (servidor 3 GB / 2 vCPU):
 * ─────────────────────────────────────────────────
 * El caché anterior almacenaba ~9 millones de LotEntry en heap (~2 GB),
 * lo que combinado con allLots + lookahead + Spring/Tomcat superaba los
 * 4 GB disponibles → OutOfMemoryError: Java heap space desde el bloque 1.
 *
 * Solución: índice ligero (FileIndex) + lectura por rango bajo demanda.
 *
 *  • FileIndex: por cada archivo de envíos, guarda SOLO la lista de fechas
 *    UTC presentes (un Set<LocalDate> de ints compactos). ~30 archivos,
 *    negligible en RAM.
 *
 *  • loadShipmentsForMinuteRange() / loadShipmentsForDays() leen solo los
 *    archivos que contienen datos del rango pedido, línea a línea, y
 *    descartan las demás sin crear objetos.
 *
 *  • scanAllUtc() se elimina. Toda lógica de escaneo usa el índice primero
 *    para descartar archivos enteros antes de abrirlos.
 *
 *  • findConsecutiveDaysWithK() construye el mapa de conteos leyendo una
 *    sola vez, sin conservar ningún LotEntry en memoria.
 */
public class ShipmentRepository {

    private static final LocalDateTime BASE_UTC = LocalDateTime.of(2026, 1, 1, 0, 0);

    // ── Índice ligero ─────────────────────────────────────────────────────────
    // Se construye una sola vez al primer uso; almacena solo qué fechas UTC
    // están en cada archivo. Sin objetos BaggageLot, sin LotEntry.

    /** Datos de un archivo de envíos: origen ICAO + conjunto de fechas UTC presentes. */
    private static class FileIndex {
        final File          file;
        final String        origin;
        final int           gmtOffset;
        final Set<LocalDate> dates;   // fechas UTC presentes en el archivo

        FileIndex(File file, String origin, int gmtOffset, Set<LocalDate> dates) {
            this.file      = file;
            this.origin    = origin;
            this.gmtOffset = gmtOffset;
            this.dates     = dates;
        }
    }

    // Solo el índice sobrevive entre llamadas (~30 FileIndex, cada uno con
    // un Set<LocalDate> de pocos elementos — <1 MB total).
    private List<FileIndex>  index         = null;
    private String           indexedFolder = null;
    private Map<String,Airport> indexedAirports = null;

    // ── API pública ───────────────────────────────────────────────────────────

    /**
     * Busca el primer día UTC con al menos targetK maletas.
     */
    public LocalDate findDayWithK(String folderPath,
                                  Map<String, Airport> airports,
                                  int targetK) throws IOException {

        Map<LocalDate, Integer> bagsByDay = new TreeMap<>();
        Map<LocalDate, Integer> lotsByDay = new TreeMap<>();
        streamAllLots(folderPath, airports, null, entry -> {
            bagsByDay.merge(entry.utcDate, entry.quantity, Integer::sum);
            lotsByDay.merge(entry.utcDate, 1,              Integer::sum);
        });

        int lowerBound = (int)(targetK * 0.9);
        System.out.println("Distribución por día UTC (maletas / lotes):");
        for (LocalDate d : bagsByDay.keySet()) {
            System.out.printf("  %s : %d maletas en %d lotes%n",
                    d, bagsByDay.get(d), lotsByDay.getOrDefault(d, 0));
        }
        for (Map.Entry<LocalDate, Integer> e : bagsByDay.entrySet()) {
            if (e.getValue() >= lowerBound) {
                System.out.printf("Día seleccionado: %s (%d maletas, target=%d)%n",
                        e.getKey(), e.getValue(), targetK);
                return e.getKey();
            }
        }
        System.out.println("⚠ Ningún día tiene " + lowerBound + "+ maletas.");
        return null;
    }

    /**
     * Devuelve los lotes del día targetDay (hasta maxLots maletas acumuladas).
     */
    public List<BaggageLot> loadShipmentsForDay(String folderPath,
                                                 Map<String, Airport> airports,
                                                 LocalDate targetDay,
                                                 int maxLots) throws IOException {
        List<BaggageLot> result = new ArrayList<>();
        int[] bagsAcc = {0};
        Set<LocalDate> filter = Collections.singleton(targetDay);

        streamAllLots(folderPath, airports, filter, entry -> {
            if (maxLots > 0 && bagsAcc[0] >= maxLots) return;
            result.add(entry.toLot());
            bagsAcc[0] += entry.quantity;
        });

        result.sort(Comparator.comparingInt(BaggageLot::getRegistrationHour));
        System.out.printf("Lotes cargados del día %s: %d lotes / %d maletas (objetivo=%d)%n",
                targetDay, result.size(), bagsAcc[0], maxLots);
        return result;
    }

    /**
     * Devuelve todos los lotes de los días indicados, ordenados por hora UTC.
     * Lee solo los archivos que contienen esos días (filtrado por índice).
     */
    public List<BaggageLot> loadShipmentsForDays(String folderPath,
                                                  Map<String, Airport> airports,
                                                  List<LocalDate> targetDays) throws IOException {
        Set<LocalDate> filter = new HashSet<>(targetDays);
        List<BaggageLot> result = new ArrayList<>();

        streamAllLots(folderPath, airports, filter, entry -> result.add(entry.toLot()));
        result.sort(Comparator.comparingInt(BaggageLot::getRegistrationHour));
        System.out.printf("loadShipmentsForDays: %d lotes para %d días%n",
                result.size(), targetDays.size());
        return result;
    }

    /**
     * Devuelve los lotes cuya hora UTC de registro cae en [fromMinute, toMinute).
     * Es el método clave para la carga bloque a bloque: solo materializa
     * los objetos del rango pedido, sin tocar el resto del dataset.
     */
    public List<BaggageLot> loadShipmentsForMinuteRange(String folderPath,
                                                         Map<String, Airport> airports,
                                                         int fromMinute,
                                                         int toMinute) throws IOException {

        // Convertir el rango de minutos a fechas UTC para filtrar archivos
        LocalDate dateFrom = BASE_UTC.plusMinutes(fromMinute).toLocalDate();
        LocalDate dateTo   = BASE_UTC.plusMinutes(toMinute - 1).toLocalDate();

        Set<LocalDate> dateFilter = new HashSet<>();
        LocalDate cur = dateFrom;
        while (!cur.isAfter(dateTo)) { dateFilter.add(cur); cur = cur.plusDays(1); }

        List<BaggageLot> result = new ArrayList<>();
        streamAllLots(folderPath, airports, dateFilter, entry -> {
            if (entry.utcMinutes >= fromMinute && entry.utcMinutes < toMinute) {
                result.add(entry.toLot());
            }
        });
        result.sort(Comparator.comparingInt(BaggageLot::getRegistrationHour));
        System.out.printf("Rango cargado [%d, %d): %d lotes%n",
                fromMinute, toMinute, result.size());
        return result;
    }

    /**
     * Encuentra una ventana de targetDays días consecutivos con al menos
     * targetTotalBags maletas. Lee todos los archivos UNA sola vez para
     * construir el mapa de conteos; no guarda ningún LotEntry en memoria.
     */
    public List<LocalDate> findConsecutiveDaysWithK(String folderPath,
                                                     Map<String, Airport> airports,
                                                     int targetTotalBags,
                                                     int targetDays) throws IOException {

        Map<LocalDate, Integer> bagsByDay = new TreeMap<>();
        Map<LocalDate, Integer> lotsByDay = new TreeMap<>();

        streamAllLots(folderPath, airports, null, entry -> {
            bagsByDay.merge(entry.utcDate, entry.quantity, Integer::sum);
            lotsByDay.merge(entry.utcDate, 1,              Integer::sum);
        });

        if (bagsByDay.isEmpty()) return null;

        List<LocalDate> allDays   = new ArrayList<>(bagsByDay.keySet());
        int             totalDays = allDays.size();

        System.out.println("Distribución por día UTC:");
        for (LocalDate d : allDays) {
            System.out.printf("  %s : %d maletas en %d lotes%n",
                    d, bagsByDay.get(d), lotsByDay.getOrDefault(d, 0));
        }

        int lowerBound = Math.max(0, targetTotalBags);

        // ── Ventana de longitud fija ──────────────────────────────────────────
        if (targetDays > 0) {
            for (int start = 0; start + targetDays <= totalDays; start++) {
                boolean consecutive = true;
                for (int i = start; i < start + targetDays - 1; i++) {
                    if (!allDays.get(i).plusDays(1).equals(allDays.get(i + 1))) {
                        consecutive = false; break;
                    }
                }
                if (!consecutive) continue;

                int windowBags = 0;
                for (int i = start; i < start + targetDays; i++) {
                    windowBags += bagsByDay.get(allDays.get(i));
                }
                if (windowBags >= lowerBound) {
                    List<LocalDate> window = new ArrayList<>(allDays.subList(start, start + targetDays));
                    System.out.printf("Ventana encontrada: %s → %s (%d días, %d maletas)%n",
                            window.get(0), window.get(window.size()-1), targetDays, windowBags);
                    return window;
                }
            }
            System.out.printf("No se encontró ventana de %d días con %d+ maletas.%n",
                    targetDays, lowerBound);
            return null;
        }

        // ── Modo colapso (targetDays == 0) ────────────────────────────────────
        for (int start = 0; start < totalDays; start++) {
            int runBags = 0, runEnd = start;
            for (int i = start; i < totalDays; i++) {
                if (i > start && !allDays.get(i-1).plusDays(1).equals(allDays.get(i))) break;
                runBags += bagsByDay.get(allDays.get(i));
                runEnd = i;
                if (runBags >= lowerBound) {
                    List<LocalDate> window = new ArrayList<>(allDays.subList(start, totalDays));
                    System.out.printf("Ventana colapso: inicio=%s días=%d maletas=%d (umbral en %s)%n",
                            window.get(0), window.size(), runBags, allDays.get(runEnd));
                    return window;
                }
            }
        }
        System.out.printf("No se encontró secuencia con %d+ maletas totales.%n", lowerBound);
        return null;
    }

    public List<LocalDate> getAvailableDates(String folderPath,
                                             Map<String, Airport> airports) throws IOException {
        Set<LocalDate> dates = new TreeSet<>();
        streamAllLots(folderPath, airports, null, entry -> dates.add(entry.utcDate));
        return new ArrayList<>(dates);
    }

    public List<LocalDate> getDaysFrom(String folderPath,
                                       Map<String, Airport> airports,
                                       LocalDate startDate,
                                       int numDays) throws IOException {
        List<LocalDate> all = getAvailableDatesLightweight(folderPath);
        if (all.isEmpty()) return List.of();

        int startIdx = all.size();
        for (int i = 0; i < all.size(); i++) {
            if (!all.get(i).isBefore(startDate)) { startIdx = i; break; }
        }
        if (startIdx == all.size()) {
            System.out.println("⚠ Fecha " + startDate + " posterior al dataset — usando primera disponible.");
            startIdx = 0;
        }

        List<LocalDate> result = new ArrayList<>();
        for (int i = startIdx; i < all.size(); i++) {
            if (i > startIdx && !all.get(i-1).plusDays(1).equals(all.get(i))) break;
            result.add(all.get(i));
            if (numDays > 0 && result.size() >= numDays) break;
        }

        System.out.printf("getDaysFrom(%s, numDays=%d): %d días (%s → %s)%n",
                startDate, numDays, result.size(),
                result.isEmpty() ? "—" : result.get(0),
                result.isEmpty() ? "—" : result.get(result.size()-1));
        return result;
    }

    /**
     * Obtiene fechas disponibles leyendo solo nombres y primeras líneas de archivo.
     * No construye ningún LotEntry. Muy rápido.
     */
    public List<LocalDate> getAvailableDatesLightweight(String folderPath) {
        Set<LocalDate> dates = new TreeSet<>();
        File folder = new File(folderPath);
        File[] files = folder.listFiles();
        if (files == null) return List.of();

        for (File file : files) {
            if (!file.getName().contains("_envios_")) continue;
            try (BufferedReader br = new BufferedReader(new FileReader(file))) {
                String line;
                while ((line = br.readLine()) != null) {
                    line = clean(line);
                    if (line.isEmpty()) continue;
                    String[] parts = line.split("-");
                    if (parts.length < 2) continue;
                    try {
                        String dateStr = parts[1];
                        if (dateStr.length() != 8) continue;
                        dates.add(LocalDate.of(
                                Integer.parseInt(dateStr.substring(0, 4)),
                                Integer.parseInt(dateStr.substring(4, 6)),
                                Integer.parseInt(dateStr.substring(6, 8))));
                    } catch (Exception ignored) {}
                }
            } catch (Exception e) {
                System.out.println("⚠ Error leyendo fechas de: " + file.getName());
            }
        }

        List<LocalDate> result = new ArrayList<>(dates);
        System.out.println("Fechas disponibles (lightweight): " + result.size());
        return result;
    }

    // ── Índice ligero ─────────────────────────────────────────────────────────

    /**
     * Construye el índice la primera vez (o si cambia la carpeta/aeropuertos).
     * El índice almacena SOLO: File + origin + gmtOffset + Set<LocalDate>.
     * Sin BaggageLot, sin LotEntry — usa <1 MB para 30 archivos.
     */
    private synchronized List<FileIndex> getOrBuildIndex(
            String folderPath, Map<String, Airport> airports) throws IOException {

        if (index != null
                && folderPath.equals(indexedFolder)
                && airports == indexedAirports) {
            return index;
        }

        File folder = new File(folderPath);
        File[] files = folder.listFiles();
        if (files == null) { index = List.of(); return index; }

        Arrays.sort(files, Comparator.comparing(File::getName));

        List<FileIndex> built = new ArrayList<>();
        int maxFiles = 0;
        for (File f : files) if (f.getName().contains("_envios_")) maxFiles++;
        maxFiles = Math.min(maxFiles, 30);

        int processed = 0;
        for (File file : files) {
            if (!file.getName().contains("_envios_")) continue;
            if (processed >= maxFiles) break;
            processed++;

            String        origin    = extractOrigin(file.getName());
            int           gmt       = getGmt(airports, origin);
            Set<LocalDate> fileDates = new HashSet<>();

            try (BufferedReader br = new BufferedReader(
                    new FileReader(file), 64 * 1024)) {
                String line;
                while ((line = br.readLine()) != null) {
                    line = clean(line);
                    if (line.isEmpty()) continue;
                    String[] parts = line.split("-");
                    if (parts.length < 7) continue;
                    try {
                        String dateStr = parts[1];
                        if (dateStr.length() != 8) continue;
                        int year  = Integer.parseInt(dateStr.substring(0, 4));
                        int month = Integer.parseInt(dateStr.substring(4, 6));
                        int day   = Integer.parseInt(dateStr.substring(6, 8));
                        int hour  = Integer.parseInt(parts[2]);
                        int min   = Integer.parseInt(parts[3]);
                        LocalDateTime localTs    = LocalDateTime.of(year, month, day, hour, min);
                        long          utcMinutes = Duration.between(BASE_UTC, localTs).toMinutes() - gmt;
                        fileDates.add(BASE_UTC.plusMinutes(utcMinutes).toLocalDate());
                    } catch (Exception ignored) {}
                }
            }
            built.add(new FileIndex(file, origin, gmt, fileDates));
        }

        index          = built;
        indexedFolder  = folderPath;
        indexedAirports = airports;
        System.out.printf("Índice construido: %d archivos indexados%n", built.size());
        return index;
    }

    // ── Motor de streaming ────────────────────────────────────────────────────

    /**
     * Interfaz interna: entrada mínima para filtrar antes de crear BaggageLot.
     */
    @FunctionalInterface
    private interface RawLotConsumer {
        void accept(RawLot lot) throws IOException;
    }

    /** Datos mínimos de un lote antes de decidir si construir el objeto completo. */
    private static class RawLot {
        final String    id, origin, destination;
        final int       quantity, utcMinutes, dueUtc;
        final LocalDate utcDate;

        RawLot(String id, String origin, String destination,
               int quantity, int utcMinutes, int dueUtc) {
            this.id          = id;
            this.origin      = origin;
            this.destination = destination;
            this.quantity    = quantity;
            this.utcMinutes  = utcMinutes;
            this.dueUtc      = dueUtc;
            this.utcDate     = BASE_UTC.plusMinutes(utcMinutes).toLocalDate();
        }

        BaggageLot toLot() {
            return new BaggageLot(id, origin, destination, quantity,
                                  utcMinutes, dueUtc, false);
        }
    }

    /**
     * Lee línea a línea solo los archivos relevantes (filtrados por índice),
     * parsea cada línea y pasa el RawLot al consumer.
     * No acumula ninguna lista interna → O(1) memoria adicional por lote.
     *
     * @param dateFilter si null, lee todos los días; si no, filtra por fechas.
     */
    private void streamAllLots(String folderPath,
                                Map<String, Airport> airports,
                                Set<LocalDate> dateFilter,
                                RawLotConsumer consumer) throws IOException {

        List<FileIndex> idx = getOrBuildIndex(folderPath, airports);

        for (FileIndex fi : idx) {
            // Saltar el archivo completo si ninguna de sus fechas intersecta el filtro
            if (dateFilter != null) {
                boolean hasOverlap = false;
                for (LocalDate d : fi.dates) {
                    if (dateFilter.contains(d)) { hasOverlap = true; break; }
                }
                if (!hasOverlap) continue;
            }

            try (BufferedReader br = new BufferedReader(
                    new FileReader(fi.file), 64 * 1024)) {
                String line;
                while ((line = br.readLine()) != null) {
                    line = clean(line);
                    if (line.isEmpty()) continue;
                    String[] parts = line.split("-");
                    if (parts.length < 7) continue;
                    try {
                        String dateStr = parts[1];
                        if (dateStr.length() != 8) continue;
                        int year  = Integer.parseInt(dateStr.substring(0, 4));
                        int month = Integer.parseInt(dateStr.substring(4, 6));
                        int day   = Integer.parseInt(dateStr.substring(6, 8));
                        int hour  = Integer.parseInt(parts[2]);
                        int minp  = Integer.parseInt(parts[3]);

                        LocalDateTime localTs    = LocalDateTime.of(year, month, day, hour, minp);
                        int           utcMinutes = (int)(Duration.between(BASE_UTC, localTs).toMinutes()
                                                         - fi.gmtOffset);
                        LocalDate     utcDate    = BASE_UTC.plusMinutes(utcMinutes).toLocalDate();

                        // Filtro de fecha rápido antes de parsear el resto
                        if (dateFilter != null && !dateFilter.contains(utcDate)) continue;

                        String destination = cleanCode(parts[4]);
                        int    quantity    = Integer.parseInt(
                                clean(parts[5]).replaceAll("[^0-9]", ""));
                        String id = fi.origin + "_" + parts[0];

                        Airport originAirport = airports.get(fi.origin);
                        Airport destAirport   = airports.get(destination);
                        boolean sameContinent = originAirport != null && destAirport != null
                                && originAirport.getRegion().equals(destAirport.getRegion());
                        int dueUtc = utcMinutes + (sameContinent ? 24 * 60 : 48 * 60);

                        consumer.accept(new RawLot(id, fi.origin, destination,
                                                   quantity, utcMinutes, dueUtc));
                    } catch (Exception e) {
                        // línea malformada — ignorar silenciosamente
                    }
                }
            }
        }
    }

    // ── Método deprecado — solo para compatibilidad ───────────────────────────

    /** @deprecated Usar loadShipmentsForDay() */
    @Deprecated
    public List<BaggageLot> loadShipmentsFromFolder(String folderPath, int maxLots)
            throws IOException {
        System.out.println("⚠ loadShipmentsFromFolder() no convierte a UTC. " +
                           "Usar loadShipmentsForDay().");
        List<BaggageLot> all = new ArrayList<>();
        streamAllLots(folderPath, Collections.emptyMap(), null, e -> all.add(e.toLot()));
        all.sort(Comparator.comparingInt(BaggageLot::getRegistrationHour));
        int limit = (maxLots <= 0) ? all.size() : Math.min(maxLots, all.size());
        return new ArrayList<>(all.subList(0, limit));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
        String[] parts = filename.split("_");
        return parts.length > 2 ? cleanCode(parts[2]) : "UNK";
    }

    private String clean(String s) {
        return s.replace("\uFEFF", "")
                .replace("\u200B", "")
                .replace("\u00A0", "")
                .trim();
    }

    private String cleanCode(String s) {
        return s.trim().toUpperCase();
    }
}
