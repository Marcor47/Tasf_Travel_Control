import { useMemo, useEffect, useRef } from "react";
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
export default function FlightsCapacity({
  routes = [], upcoming = [], running = false, focusCodes = [],
  selectedFlightKey = null, // clave de vuelo resaltado externamente (desde el mapa)
  onFlightClick,            // (flightKey) => void — usuario clicó un vuelo en el panel
}) {
  const selectedRowRef = useRef(null);
  // Cada ruta activa del backend ya es un vuelo con su capacidad y carga total.
  // Si hay un aeropuerto en foco, mostrar solo los vuelos que entran o salen.
  const activeFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    return routes
      .filter(r => r.status === "departed")
      .filter(r => focus.size === 0 || focus.has(r.from) || focus.has(r.to))
      .map(r => {
        const cap = r.capacity || 0;
        return {
          key: r.flightId || `${r.from}-${r.to}-${r.departureMinute}`,
          from: r.from, to: r.to, departure: hhmm(r.departureMinute),
          bags: r.bags || 0, capacity: cap || null,
          pct: cap > 0 ? Math.round(((r.bags || 0) / cap) * 100) : null,
        };
      })
      .sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1));
  }, [routes, focusCodes]);

  // Desplazar automáticamente hacia el vuelo seleccionado externamente
  useEffect(() => {
    if (selectedFlightKey && selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectedFlightKey]);

  // Vuelos PLANIFICADOS próximos (aún no despegan) con maletas asignadas —
  // el registro de lo que el sistema planea. Respeta el foco de aeropuertos.
  const plannedFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    return upcoming
      .filter(u => (u.assigned || 0) > 0)
      .filter(u => focus.size === 0 || focus.has(u.origin) || focus.has(u.destination))
      .map(u => ({
        key: u.flightId,
        from: u.origin, to: u.destination,
        departure: (u.departureClock || "").split("  ")[1] || u.departureClock,
        bags: u.assigned || 0, capacity: u.capacity || 0,
        pct: u.capacity ? Math.round(((u.assigned || 0) / u.capacity) * 100) : null,
      }))
      .slice(0, 10);
  }, [upcoming, focusCodes]);

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
            const empty    = (f.bags || 0) === 0;
            const clamp    = pct == null ? 0 : Math.min(100, pct);
            const color    = empty || pct == null ? null : getWarehouseColor(pct);
            const barColor = color === "green" ? "bg-green-500"
                           : color === "amber" ? "bg-yellow-500"
                           : color === "red"   ? "bg-red-500"
                           : "bg-gray-600";
            const txtColor = color === "green" ? "text-green-400"
                           : color === "amber" ? "text-yellow-400"
                           : color === "red"   ? "text-red-400"
                           : "text-gray-400";
            const isSelected = selectedFlightKey === f.key;
            return (
              <div key={f.key}
                ref={isSelected ? selectedRowRef : null}
                onClick={() => onFlightClick?.(isSelected ? null : f.key)}
                title="Clic para resaltar en el mapa"
                className={`rounded px-1 py-0.5 cursor-pointer transition
                  ${isSelected
                    ? "bg-teal/15 border border-teal/40"
                    : "hover:bg-white/5 border border-transparent"}`}>
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-gray-300 truncate">
                    {isSelected && <span className="text-teal mr-1">▶</span>}
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

      {/* ── Vuelos planificados (próximos, aún sin despegar) ──────────────── */}
      {plannedFlights.length > 0 && (
        <div className="mt-3 pt-2 border-t border-white/10">
          <p className="text-gray-500 text-[10px] font-bold uppercase mb-1">
            Planificados (próximos)
          </p>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {plannedFlights.map(f => (
              <div key={f.key} className="flex items-center justify-between text-[10px]">
                <span className="flex items-center gap-1 min-w-0">
                  <span className="text-blue-400">⌛</span>
                  <span className="text-teal">{f.from}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-gray-200">{f.to}</span>
                  <span className="text-gray-600 font-mono ml-1">{f.departure}</span>
                </span>
                <span className="text-gray-400 tabular-nums flex-shrink-0">
                  {f.bags.toLocaleString()}/{f.capacity.toLocaleString()}
                  {f.pct != null && <span className="text-gray-600 ml-1">({f.pct}%)</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
