import { useMemo } from "react";
import { AIRPORT_META } from "../../data/staticAirports";

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
export default function StorageMovements({ history = [], focusCodes = [], airports = [] }) {
  const nameByCode = useMemo(() => {
    const m = {};
    airports.forEach(a => { if (a.code) m[a.code] = a.name; });
    return m;
  }, [airports]);

  // Agrupar eventos por almacén: 'landed' = entrada al destino,
  // 'departed' = salida desde el origen.
  const byAirport = useMemo(() => {
    const acc = {};
    for (const e of history) {
      if (e.type === "departed" && e.from) {
        (acc[e.from] ??= []).push({ ...e, dir: "out" });
      } else if (e.type === "landed" && e.to) {
        (acc[e.to] ??= []).push({ ...e, dir: "in" });
      }
    }
    // Ordenar cada almacén por minuto descendente (lo más reciente primero)
    for (const code of Object.keys(acc)) {
      acc[code].sort((a, b) => (b.minute || 0) - (a.minute || 0));
    }
    return acc;
  }, [history]);

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

      {history.length === 0 ? (
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
  const isIn   = e.dir === "in";
  const time   = (e.clock && e.clock.split("  ")[1]) || e.clock || "--:--";
  const tag    = isIn
    ? (e.finalDestination ? "Final" : "Transbordo")
    : "Salida";
  const tagColor = !isIn
    ? "text-yellow-400"
    : e.finalDestination ? "text-green-400" : "text-blue-400";

  return (
    <div className="flex items-center justify-between text-[10px]">
      <span className="flex items-center gap-1 min-w-0">
        <span className={isIn ? "text-green-400" : "text-yellow-400"}>
          {isIn ? "↓" : "↑"}
        </span>
        <span className="text-gray-300 font-mono truncate">
          {e.flightId || "—"}
        </span>
        <span className="text-gray-600">
          {isIn ? `← ${e.from}` : `→ ${e.to}`}
        </span>
      </span>
      <span className="flex items-center gap-1.5 flex-shrink-0">
        <span className="text-gray-500 font-mono">{time}</span>
        <span className={tagColor}>{tag}</span>
      </span>
    </div>
  );
}
