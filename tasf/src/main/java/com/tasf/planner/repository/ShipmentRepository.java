package com.tasf.planner.repository;

import com.tasf.planner.model.BaggageLot;

import java.io.*;
import java.util.*;

public class ShipmentRepository {

    public List<BaggageLot> loadShipmentsFromFolder(String folderPath) throws IOException {

        List<BaggageLot> lots = new ArrayList<>();

        File folder = new File(folderPath);
        File[] files = folder.listFiles();

        if (files == null) return lots;

        for (File file : files) {

            if (!file.getName().contains("_envios_")) continue;

            String origin = extractOrigin(file.getName());

            try (BufferedReader br = new BufferedReader(new FileReader(file))) {

                String line;

                while ((line = br.readLine()) != null) {

                    line = clean(line);
                    if (line.isEmpty()) continue;

                    String[] parts = line.split("-");

                    if (parts.length < 6) {
                        System.out.println("⚠ Línea envío inválida: " + line);
                        continue;
                    }

                    try {
                        String id = parts[0];

                        int hour = Integer.parseInt(parts[2]);
                        int minute = Integer.parseInt(parts[3]);

                        String destination = cleanCode(parts[4]);
                        int quantity = Integer.parseInt(parts[5]);

                        int registrationTime = hour * 60 + minute;
                        int dueTime = registrationTime + (48 * 60);

                        lots.add(new BaggageLot(
                                id,
                                origin,
                                destination,
                                quantity,
                                registrationTime,
                                dueTime,
                                false
                        ));

                    } catch (Exception e) {
                        System.out.println("⚠ Error envío: " + line);
                    }
                }
            }
        }

        return lots;
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