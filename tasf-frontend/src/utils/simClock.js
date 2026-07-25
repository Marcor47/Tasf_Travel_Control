// Relojes del simulador derivados del MINUTO ABSOLUTO (GMT-0).
//
// El backend enviaba `departureClock`/`arrivalClock` ya formateados dentro de
// cada vuelo del broadcast: ~600 cadenas por tick (cada 800 ms) que además el
// frontend partía con `.split("  ")` para quedarse solo con la hora. Ahora el
// broadcast lleva únicamente el minuto absoluto y el formato se hace AQUÍ, solo
// para las filas que realmente se pintan.

// Época del simulador. DEBE COINCIDIR con BASE_UTC de SimulationService.java
// (`LocalDateTime.of(2026, 1, 1, 0, 0)`) y con la del ShipmentRepository.
export const BASE_UTC_MS = Date.UTC(2026, 0, 1);

const p2 = n => String(n).padStart(2, "0");

/** "10:23" — hora del día en GMT-0. Aritmética pura, sin crear Date. */
export function hhmm(absoluteMinute) {
  const m = (((absoluteMinute ?? 0) % 1440) + 1440) % 1440;
  return `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}

/**
 * "Dia 2026-01-05  10:23" — mismo formato que `fmtClock` del backend.
 * Solo donde la fecha importa (p. ej. el Historial, que mezcla estas filas con
 * eventos reales que sí traen la cadena completa y deben verse igual).
 */
export function fullClock(absoluteMinute) {
  const d = new Date(BASE_UTC_MS + (absoluteMinute ?? 0) * 60000);
  return `Dia ${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
       + `  ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
