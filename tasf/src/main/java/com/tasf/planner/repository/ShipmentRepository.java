package com.tasf.planner.repository;

import com.tasf.planner.model.BaggageLot;

import java.io.*;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;

public class ShipmentRepository {

    private static final LocalDateTime BASE = LocalDateTime.of(2026, 1, 1, 0, 0);

    // Clase interna para el heap con timestamp absoluto
    private static class LotEntry {
        BaggageLot lot;
        long absoluteMinutes;

        LotEntry(BaggageLot lot, long absoluteMinutes) {
            this.lot = lot;
            this.absoluteMinutes = absoluteMinutes;
        }
    }

    public List<BaggageLot> loadShipmentsFromFolder(String folderPath, int maxLots)
            throws IOException {

        // Max-heap por absoluteMinutes descendente — descarta el más tardío
        // cuando supera maxLots, manteniendo siempre los k más tempranos
        PriorityQueue<LotEntry> heap = new PriorityQueue<>(
                (a, b) -> Long.compare(b.absoluteMinutes, a.absoluteMinutes)
        );

        File folder = new File(folderPath);
        File[] files = folder.listFiles();
        if (files == null) return new ArrayList<>();

        for (File file : files) {
            if (!file.getName().contains("_envios_")) continue;

            String origin = extractOrigin(file.getName());

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
                        // ID único por archivo: origen + id local
                        String id = origin + "_" + parts[0];

                        // Fecha completa desde el campo parts[1] (ej. 20260102)
                        String dateStr = parts[1];
                        int year  = Integer.parseInt(dateStr.substring(0, 4));
                        int month = Integer.parseInt(dateStr.substring(4, 6));
                        int day   = Integer.parseInt(dateStr.substring(6, 8));
                        int hour  = Integer.parseInt(parts[2]);
                        int min   = Integer.parseInt(parts[3]);

                        LocalDateTime ts = LocalDateTime.of(year, month, day, hour, min);
                        long absoluteMinutes = Duration.between(BASE, ts).toMinutes();

                        // Minutos dentro del día para compatibilidad con vuelos
                        int registrationTimeInDay = (int) (absoluteMinutes % 1440);
                        int dueTime = registrationTimeInDay + (48 * 60);

                        String destination = cleanCode(parts[4]);
                        int quantity       = Integer.parseInt(parts[5]);

                        BaggageLot lot = new BaggageLot(
                                id,
                                origin,
                                destination,
                                quantity,
                                registrationTimeInDay,
                                dueTime,
                                false
                        );

                        LotEntry entry = new LotEntry(lot, absoluteMinutes);
                        heap.offer(entry);

                        // Si supera el límite, descarta el más tardío (tope del max-heap)
                        if (maxLots > 0 && heap.size() > maxLots) {
                            heap.poll();
                        }

                    } catch (Exception e) {
                        System.out.println("⚠ Error envío: " + line);
                    }
                }
            }
        }

        // Extraer todos los lotes del heap y ordenar por absoluteMinutes ascendente
        List<LotEntry> entries = new ArrayList<>(heap);
        entries.sort(Comparator.comparingLong(e -> e.absoluteMinutes));

        List<BaggageLot> result = new ArrayList<>();
        for (LotEntry entry : entries) {
            result.add(entry.lot);
        }
        return result;
    }

    private String extractOrigin(String filename) {
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