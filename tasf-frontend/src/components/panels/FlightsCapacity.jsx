import { useMemo } from "react";
import { getWarehouseColor } from "../../hooks/useStatusColor";

// Minuto absoluto → "HH:MM" del día (igual que el backend para casar capacidades)
function hhmm(minute) {
  const m = (((minute ?? 0) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Vuelos activos (en el aire) y qué tan llenos están respecto a su capacidad.
 * Semáforo igual que el resto de la página: verde casi vacío, ámbar a media
 * carga, rojo casi lleno.
 *
 * Los RouteState del backend traen origen/destino/maletas/minuto de salida pero
 * no la capacidad, así que la cruzamos con la lista estática de vuelos por
 * origen-destino-hora de salida. Las maletas se suman por vuelo (un mismo vuelo
 * puede llevar varios grupos de lotes).
 */
export default function FlightsCapacity({ flights = [], routes = [], running = false, focusCodes = [] }) {
  // Capacidad por vuelo: clave origen-destino-horaSalida
  const capByKey = useMemo(() => {
    const m = {};
    for (const f of flights) {
      m[`${f.origin}-${f.destination}-${f.departureClock}`] = f.capacity;
    }
    return m;
  }, [flights]);

  // Agrupar las rutas activas por vuelo y sumar maletas. Si hay un aeropuerto
  // en foco, mostrar solo los vuelos que entran o salen de él.
  const activeFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    const groups = {};
    for (const r of routes) {
      if (r.status !== "departed") continue;
      if (focus.size > 0 && !focus.has(r.from) && !focus.has(r.to)) continue;
      const dep = hhmm(r.departureMinute);
      const key = `${r.from}-${r.to}-${dep}`;
      if (!groups[key]) {
        groups[key] = {
          key, from: r.from, to: r.to, departure: dep,
          bags: 0, capacity: capByKey[key] ?? null,
        };
      }
      groups[key].bags += r.bags || 0;
    }
    return Object.values(groups)
      .map(g => ({
        ...g,
        pct: g.capacity ? Math.round((g.bags / g.capacity) * 100) : null,
      }))
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  }, [routes, capByKey, focusCodes]);

  return (
    <div className="bg-[#031525] border border-teal/20 rounded p-2 mt-2">
      <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
        Vuelos Activos y Capacidad
        {activeFlights.length > 0 && (
          <span className="text-gray-500 normal-case ml-1">
            ({activeFlights.length})
          </span>
        )}
      </p>

      {activeFlights.length === 0 ? (
        <p className="text-gray-600 text-center py-4 text-[10px]">
          {running ? "Sin vuelos activos en este momento" : "Inicia la simulación"}
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
          {activeFlights.map(f => {
            const pct      = f.pct;
            const clamp    = pct == null ? 0 : Math.min(100, pct);
            const color    = pct == null ? null : getWarehouseColor(pct);
            const barColor = color === "green" ? "bg-green-500"
                           : color === "amber" ? "bg-yellow-500"
                           : color === "red"   ? "bg-red-500"
                           : "bg-gray-600";
            const txtColor = color === "green" ? "text-green-400"
                           : color === "amber" ? "text-yellow-400"
                           : color === "red"   ? "text-red-400"
                           : "text-gray-400";
            return (
              <div key={f.key}>
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-gray-300 truncate">
                    <span className="text-teal">{f.from}</span>
                    <span className="text-gray-600 mx-1">→</span>
                    <span className="text-gray-200">{f.to}</span>
                    <span className="text-gray-600 font-mono text-[10px] ml-1">
                      {f.departure}
                    </span>
                  </span>
                  <span className={`font-bold flex-shrink-0 ${txtColor}`}>
                    {pct == null ? `${f.bags}` : `${pct}%`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-white/10 rounded-full h-1.5">
                    <div className={`${barColor} h-1.5 rounded-full transition-all duration-500`}
                         style={{ width: `${clamp}%` }}/>
                  </div>
                  <span className="text-gray-500 text-[10px] tabular-nums flex-shrink-0">
                    {(f.bags || 0).toLocaleString()}
                    {f.capacity != null && ` / ${f.capacity.toLocaleString()}`}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
