import { useMemo } from "react";
import { AIRPORT_META, airportName } from "../../data/staticAirports";

// Cuántos almacenes mostrar cuando no hay filtro (para no saturar la vista)
const MAX_STORAGES_NO_FILTER = 6;
// Cuántos movimientos mostrar por almacén
const MAX_ROWS_PER_STORAGE   = 8;

/**
 * Movimientos de paquetes por almacén: lista, para cada almacén, los paquetes
 * que entran (llegadas) y salen (salidas) con su código, hora y tipo
 * (Final / Transbordo). Derivado del historial de eventos del backend.
 *
 * Respeta el mismo foco de aeropuertos que el mapa y las demás tarjetas: si hay
 * uno o varios aeropuertos enfocados (por clic o filtro), solo muestra esos.
 * Mismo estilo de tarjeta; vive dentro de un panel lateral colapsable.
 */
export default function StorageMovements({ history = [], upcoming = [], focusCodes = [], airports = [] }) {
  const nameByCode = useMemo(() => {
    const m = {};
    airports.forEach(a => { if (a.code) m[a.code] = a.name; });
    return m;
  }, [airports]);

  // Agrupar por almacén:
  //  · historial: 'landed' = entrada al destino, 'departed' = salida del origen.
  //  · planificado (upcoming, aún sin despegar): salida planeada desde el origen
  //    y entrada planeada en el destino — el registro de lo que el sistema planea.
  const byAirport = useMemo(() => {
    const acc = {};
    for (const e of history) {
      if (e.type === "departed" && e.from) {
        (acc[e.from] ??= []).push({ ...e, dir: "out" });
      } else if (e.type === "landed" && e.to) {
        (acc[e.to] ??= []).push({ ...e, dir: "in" });
      }
    }
    for (const u of upcoming) {
      if (!u.assigned) continue;          // solo vuelos planeados con maletas
      if (u.origin)
        (acc[u.origin] ??= []).push({
          dir: "out", planned: true, flightId: u.flightId, to: u.destination,
          bags: u.assigned, minute: u.departureMinute, clock: u.departureClock });
      if (u.destination)
        (acc[u.destination] ??= []).push({
          dir: "in", planned: true, finalDestination: false, flightId: u.flightId,
          from: u.origin, bags: u.assigned, minute: u.arrivalMinute, clock: u.arrivalClock });
    }
    // Ordenar por minuto descendente: lo planeado (futuro) queda arriba.
    for (const code of Object.keys(acc)) {
      acc[code].sort((a, b) => (b.minute || 0) - (a.minute || 0));
    }
    return acc;
  }, [history, upcoming]);

  const focus     = useMemo(() => new Set(focusCodes), [focusCodes]);
  const hasFilter = focus.size > 0;

  const codes = useMemo(() => {
    let list = Object.keys(byAirport);
    if (hasFilter) list = list.filter(c => focus.has(c));
    list.sort();
    return hasFilter ? list : list.slice(0, MAX_STORAGES_NO_FILTER);
  }, [byAirport, hasFilter, focus]);

  return (
    <div className="bg-[#031525] border border-teal/20 rounded p-2 mt-2">
      <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
        Movimientos por Almacén
        {hasFilter && (
          <span className="text-gray-500 normal-case ml-1">
            ({codes.length})
          </span>
        )}
      </p>

      {history.length === 0 && upcoming.length === 0 ? (
        <p className="text-gray-600 text-center py-4 text-[10px]">
          Inicia la simulación para ver movimientos
        </p>
      ) : codes.length === 0 ? (
        <p className="text-gray-600 text-center py-4 text-[10px]">
          {hasFilter ? "Sin coincidencias" : "Sin movimientos"}
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-80 overflow-y-auto">
          {codes.map(code => {
            const rows = byAirport[code].slice(0, MAX_ROWS_PER_STORAGE);
            const total = byAirport[code].length;
            return (
              <div key={code} className="bg-[#021020] rounded p-1.5">
                <p className="text-[10px] font-bold text-teal mb-1">
                  {code}
                  {(nameByCode[code] || AIRPORT_META[code]?.name) && (
                    <span className="text-gray-500 font-normal ml-1">
                      {nameByCode[code] || AIRPORT_META[code]?.name}
                    </span>
                  )}
                  {total > rows.length && (
                    <span className="text-gray-600 font-normal ml-1">
                      (+{total - rows.length})
                    </span>
                  )}
                </p>
                <div className="flex flex-col gap-0.5">
                  {rows.map((e, i) => (
                    <MovementRow key={`${code}-${e.minute}-${e.flightId}-${e.dir}-${i}`}
                                 e={e} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MovementRow({ e }) {
  const isIn    = e.dir === "in";
  const planned = !!e.planned;
  const time    = (e.clock && e.clock.split("  ")[1]) || e.clock || "--:--";
  const tag     = planned
    ? "Planificado"
    : isIn ? (e.finalDestination ? "Final" : "Transbordo") : "Salida";
  const tagColor = planned
    ? "text-blue-300"
    : !isIn ? "text-yellow-400"
    : e.finalDestination ? "text-green-400" : "text-blue-400";

  return (
    <div className={`flex items-center justify-between text-[10px] ${planned ? "opacity-70" : ""}`}>
      <span className="flex items-center gap-1 min-w-0">
        <span className={isIn ? "text-green-400" : "text-yellow-400"}>
          {planned ? "⌛" : isIn ? "↓" : "↑"}
        </span>
        <span className="text-gray-300 font-mono truncate">
          {e.flightId || "—"}
        </span>
        <span className="text-gray-600 truncate"
              title={isIn ? `← ${e.from}` : `→ ${e.to}`}>
          {isIn ? `← ${airportName(e.from)}` : `→ ${airportName(e.to)}`}
        </span>
        {e.bags != null && (
          <span className="text-gray-500">· {e.bags}</span>
        )}
      </span>
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-gray-500 font-mono">{time}</span>
        <span className={tagColor}>{tag}</span>
      </span>
    </div>
  );
}
