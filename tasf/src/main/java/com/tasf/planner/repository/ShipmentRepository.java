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
 * El caché anterior almacenaba ~9 millones de LotEntry en heap (~2 GB),
 * combinado con allLots + lookahead + Spring/Tomcat superaba los
 * 4 GB disponibles → OutOfMemoryError: Java heap space desde el bloque 1.
 * 
 *  • FileIndex: por cada archivo de envíos, guarda solo la lista de fechas
 *    UTC presentes (un Set<LocalDate> de ints compactos). ~30 archivos
 *
 *  • loadShipmentsForMinuteRange() lee solo los archivos que contienen datos
 *    del rango pedido, línea a línea, y descarta las demás sin crear objetos.
 *
 *  • getDaysFrom() / getAvailableDatesLightweight() resuelven la ventana de
 *    días leyendo solo lo imprescindible, sin conservar ningún LotEntry.
 */
public class ShipmentRepository {

    private static final LocalDateTime BASE_UTC = LocalDateTime.of(2026, 1, 1, 0, 0);

    // ── Índice ─────────────────────────────────────────────────────────
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
    // un Set<LocalDate> de pocos elementos).
    private List<FileIndex>  index         = null;
    private String           indexedFolder = null;
    private Map<String,Airport> indexedAirports = null;

    // ── API pública ───────────────────────────────────────────────────────────

    /**
     * Devuelve los lotes cuya hora UTC de registro cae en [fromMinute, toMinute).
     * Carga bloque a bloque: solo materializa los objetos del rango pedido, sin 
     * tocar el resto del dataset.
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
     * Obtiene fechas disponibles, lee solo nombres y primeras líneas de archivo.
     * No construye ningún LotEntry.
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

    // ── Construcción Índice ─────────────────────────────────────────────────────────

    /**
     * Construye el índice la primera vez (o si cambia la carpeta/aeropuertos).
     * El índice almacena SOLO: File + origin + gmtOffset + Set<LocalDate>.
     * Sin BaggageLot, sin LotEntry.
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
     *
     * @param dateFilter si es null, lee todos los días; si no, filtra por fechas.
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
                        // línea malformada — ignorar
                    }
                }
            }
        }
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
