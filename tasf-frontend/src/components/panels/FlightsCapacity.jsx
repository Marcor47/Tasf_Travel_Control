import { useMemo, useState } from "react";
import { getWarehouseColor } from "../../hooks/useStatusColor";
import { airportName } from "../../data/staticAirports";

// Categoría de semáforo de un vuelo (incluye "vacío").
function flightSem(bags, capacity) {
  if ((bags || 0) === 0) return "empty";
  return getWarehouseColor(capacity > 0 ? Math.round((bags / capacity) * 100) : 0);
}

const SEM_CHIPS = [
  { key: "all",   label: "Todos", dot: "bg-gray-400" },
  { key: "green", label: "",      dot: "bg-green-500" },
  { key: "amber", label: "",      dot: "bg-yellow-500" },
  { key: "red",   label: "",      dot: "bg-red-500" },
  { key: "empty", label: "Vacío", dot: "bg-gray-500" },
];

const SORT_OPTIONS = [
  { key: "ocupacion",  label: "% Ocup."  },
  { key: "maletas",    label: "Maletas"  },
  { key: "salida",     label: "Salida"   },
  { key: "llegada",    label: "Llegada"  },
  { key: "alfabetico", label: "A-Z"      },
];

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
  focusFlightId = null,   // si está, muestra SOLO ese vuelo
  sem = "all", onSemChange,   // semáforo controlado por el padre (también filtra el mapa)
  selectedRouteKey = null, pinnedCodes = null, onFlightClick,
  onEditFlight,
}) {
  const [search, setSearch] = useState("");
  const [sortBy,   setSortBy]   = useState("ocupacion");
  const [editKey,  setEditKey]  = useState(null);
  const [editForm, setEditForm] = useState({ capacity: "", dep: "", arr: "" });

  const startEdit = (f) => {
    setEditKey(f.key);
    setEditForm({ capacity: String(f.capacity ?? ""), dep: f.departure || "", arr: f.arrival || "" });
  };
  const saveEdit = (f) => {
    const cap = parseInt(editForm.capacity, 10);
    onEditFlight?.(f.flightId || f.key, {
      capacity: isNaN(cap) ? undefined : cap,
      departureLocal: editForm.dep || undefined,
      arrivalLocal:   editForm.arr || undefined,
    });
    setEditKey(null);
  };

  // Cada ruta activa del backend ya es un vuelo con su capacidad y carga total.
  // Filtros: foco de aeropuerto, búsqueda por código/tramo y semáforo de carga.
  const activeFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    const q = search.trim().toLowerCase();
    return routes
      .filter(r => r.status === "departed")
      .filter(r => !focusFlightId || r.flightId === focusFlightId)
      .filter(r => focus.size === 0 || focus.has(r.from) || focus.has(r.to))
      .filter(r => sem === "all" || flightSem(r.bags, r.capacity || 0) === sem)
      .filter(r => !q
        || (r.flightId || "").toLowerCase().includes(q)
        || `${r.from}-${r.to}`.toLowerCase().includes(q)
        || (r.from || "").toLowerCase().includes(q)
        || (r.to   || "").toLowerCase().includes(q))
.map(r => {
  const cap = r.capacity || 0;
  return {
    key: r.flightId || `${r.from}-${r.to}-${r.departureMinute}`,
    active: true,
    from: r.from,
    to: r.to,

    departure: hhmm(r.departureMinute),
    departureMinute: r.departureMinute ?? 0,   // <-- AGREGAR ESTA LÍNEA

    bags: r.bags || 0,
    capacity: cap || null,
    pct: cap > 0 ? Math.round(((r.bags || 0) / cap) * 100) : null,

    flightId: r.flightId,

    arrival: hhmm(r.arrivalMinute),
    arrivalMinute: r.arrivalMinute ?? 0,
  };
})
.sort((a, b) => {
  if (sortBy === "maletas") 
    return (b.bags ?? 0) - (a.bags ?? 0);

  if (sortBy === "salida") 
    return (a.departureMinute ?? 0) - (b.departureMinute ?? 0);

  if (sortBy === "llegada") 
    return (a.arrivalMinute ?? 0) - (b.arrivalMinute ?? 0);

  if (sortBy === "alfabetico") {
    const fromCompare = airportName(a.from || "")
      .localeCompare(
        airportName(b.from || ""),
        "es",
        { sensitivity: "base" }
      );

    if (fromCompare !== 0) return fromCompare;

    return airportName(a.to || "")
      .localeCompare(
        airportName(b.to || ""),
        "es",
        { sensitivity: "base" }
      );
  }

  return (b.pct ?? -1) - (a.pct ?? -1);
});
  }, [routes, focusCodes, focusFlightId, search, sem, sortBy]);

  // Vuelos PLANIFICADOS próximos (aún no despegan) con maletas asignadas —
  // el registro de lo que el sistema planea. Respeta el foco de aeropuertos.
  const plannedFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    return upcoming
      .filter(u => (u.assigned || 0) > 0)
      .filter(u =>
  sem === "all" ||
  flightSem(u.assigned, u.capacity || 0) === sem
)
      .filter(u => !focusFlightId || u.flightId === focusFlightId)
      .filter(u => focus.size === 0 || focus.has(u.origin) || focus.has(u.destination))
      .map(u => ({
    key: u.flightId,
    active: false,
    from: u.origin,
    to: u.destination,

    departure: (u.departureClock || "").split("  ")[1] || u.departureClock,
    departureMinute: u.departureMinute ?? 0,   // <-- AGREGAR

    bags: u.assigned || 0,
    capacity: u.capacity || 0,
    pct: u.capacity
      ? Math.round(((u.assigned || 0) / u.capacity) * 100)
      : null,

    flightId: u.flightId,

    arrival: (u.arrivalClock || "").split("  ")[1] || u.arrivalClock || "",
    arrivalMinute: u.arrivalMinute ?? 0,
}))
.sort((a, b) => {
  if (sortBy === "maletas") 
    return (b.bags ?? 0) - (a.bags ?? 0);

  if (sortBy === "salida") 
    return (a.departureMinute ?? 0) - (b.departureMinute ?? 0);

  if (sortBy === "llegada") 
    return (a.arrivalMinute ?? 0) - (b.arrivalMinute ?? 0);

  if (sortBy === "alfabetico") {
    const fromCompare = airportName(a.from || "")
      .localeCompare(
        airportName(b.from || ""),
        "es",
        { sensitivity: "base" }
      );

    if (fromCompare !== 0) return fromCompare;

    return airportName(a.to || "")
      .localeCompare(
        airportName(b.to || ""),
        "es",
        { sensitivity: "base" }
      );
  }

  return (b.pct ?? -1) - (a.pct ?? -1);
});
}, [upcoming, focusCodes, focusFlightId, sortBy, sem]);

  return (
    <div className="bg-[#031525] border border-teal/20 rounded p-2 mt-2">
      <div className="flex items-center justify-between mb-2 gap-1">
        <p className="text-teal font-bold uppercase tracking-wide text-[10px] shrink-0">
          Vuelos y Capacidad
          <span className="text-gray-500 normal-case ml-1">({activeFlights.length})</span>
        </p>
        <div className="flex gap-0.5 flex-wrap justify-end">
          {SORT_OPTIONS.map(o => (
            <button key={o.key} onClick={() => setSortBy(o.key)}
              className={`text-[9px] px-1 py-0.5 rounded transition border
                ${sortBy === o.key
                  ? "bg-teal/20 text-teal border-teal/40"
                  : "bg-[#021020] text-gray-500 border-white/10 hover:text-white"}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Búsqueda por código/tramo + filtro por semáforo (incluye vacío) */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Buscar por ID, origen o destino (LIM-MAD)…"
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1
                   text-[11px] text-gray-300 mb-1.5 focus:outline-none focus:border-teal"
      />
      <div className="flex gap-1 mb-2">
        {SEM_CHIPS.map(c => (
          <button key={c.key} onClick={() => onSemChange?.(c.key)}
            title={c.key}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition border
              ${sem === c.key ? "border-teal/60 bg-teal/10 text-gray-200"
                              : "border-white/10 text-gray-400 hover:text-white"}`}>
            <span className={`w-2 h-2 rounded-full ${c.dot}`}/>{c.label}
          </button>
        ))}
      </div>

      {activeFlights.length === 0 ? (
        <p className="text-gray-600 text-center py-4 text-[10px]">
          {running ? "Sin vuelos para el filtro" : "Inicia la simulación"}
        </p>
      ) : (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
          {activeFlights.map(f => {
            const pct      = f.pct;
            const empty    = (f.bags || 0) === 0;        // vuelo programado sin maletas
            const clamp    = pct == null ? 0 : Math.min(100, pct);
            const color    = empty || pct == null ? null : getWarehouseColor(pct);
            const barColor = color === "green" ? "bg-green-500"
                           : color === "amber" ? "bg-yellow-500"
                           : color === "red"   ? "bg-red-500"
                           : "bg-gray-600";       // gris = vacío
            const txtColor = color === "green" ? "text-green-400"
                           : color === "amber" ? "text-yellow-400"
                           : color === "red"   ? "text-red-400"
                           : "text-gray-400";
            const isSel = selectedRouteKey === f.key;
            const isEd = editKey === f.key;
            return (
              <div key={f.key} className={`rounded transition ${isSel ? "bg-teal/15 ring-1 ring-teal/40" : ""}`}>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => onFlightClick?.(f)}
                    title={`ID: ${f.key} · ${f.from} → ${f.to}`}
                    className="flex-1 text-left rounded px-1 py-0.5 hover:bg-white/5 transition">
                    







<div className="flex justify-between items-center mb-0.5">
<span className="text-gray-300 truncate">
<span className="text-teal">{airportName(f.from)}</span>
<span className="text-gray-600 mx-1">→</span>
<span className="text-gray-200">{airportName(f.to)}</span>
<span className="text-gray-600 font-mono text-[10px] ml-1">{f.departure}</span>
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
{(f.bags||0).toLocaleString()}
{f.capacity != null && ` / ${f.capacity.toLocaleString()}`}
</span>
</div>




                  </button>
                  <button onClick={() => isEd ? setEditKey(null) : startEdit(f)}
                    title="Editar vuelo"
                    className={`text-[11px] px-1 py-1 transition shrink-0 ${isEd ? "text-teal" : "text-gray-500 hover:text-teal"}`}>
                    ✎
                  </button>
                </div>
                {isEd && (
                  <div className="mt-1 px-1 pb-1 border-t border-white/10 pt-1">
                    <div className="grid grid-cols-3 gap-1 mb-1">
                      <div>
                        <label className="text-gray-600 text-[8px] block">Capacidad</label>
                        <input type="number" min="1" value={editForm.capacity}
                          onChange={e => setEditForm(p => ({ ...p, capacity: e.target.value }))}
                          className="w-full bg-[#021020] border border-white/10 rounded px-1 py-0.5
                                     text-[10px] text-gray-300 focus:outline-none focus:border-teal"/>
                      </div>
                      <div>
                        <label className="text-gray-600 text-[8px] block">Salida</label>
                        <input type="time" value={editForm.dep}
                          onChange={e => setEditForm(p => ({ ...p, dep: e.target.value }))}
                          className="w-full bg-[#021020] border border-white/10 rounded px-1 py-0.5
                                     text-[10px] text-gray-300 focus:outline-none focus:border-teal [color-scheme:dark]"/>
                      </div>
                      <div>
                        <label className="text-gray-600 text-[8px] block">Llegada</label>
                        <input type="time" value={editForm.arr}
                          onChange={e => setEditForm(p => ({ ...p, arr: e.target.value }))}
                          className="w-full bg-[#021020] border border-white/10 rounded px-1 py-0.5
                                     text-[10px] text-gray-300 focus:outline-none focus:border-teal [color-scheme:dark]"/>
                      </div>
                    </div>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => saveEdit(f)}
                        className="bg-teal hover:bg-teal/80 text-white text-[9px] px-2 py-0.5 rounded transition">
                        Guardar
                      </button>
                      <button onClick={() => setEditKey(null)}
                        className="text-gray-500 hover:text-white text-[9px] px-1 py-0.5 rounded transition">
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
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
            {plannedFlights.map(f => {
              const isSel = pinnedCodes
                && pinnedCodes[0] === f.from && pinnedCodes[1] === f.to;
              return (
              <button key={f.key} type="button"
                onClick={() => onFlightClick?.(f)}
                title={`ID: ${f.key} · ${f.from} → ${f.to} · clic para enfocar en el mapa`}
                className={`w-full flex items-center justify-between text-[10px] rounded
                  px-1 py-0.5 -mx-1 transition
                  ${isSel ? "bg-teal/15 ring-1 ring-teal/40" : "hover:bg-white/5"}`}>
                <span className="flex items-center gap-1 min-w-0">
                  <span className="text-blue-400">⌛</span>
                  <span className="text-teal truncate">{airportName(f.from)}</span>
                  <span className="text-gray-600">→</span>
                  <span className="text-gray-200 truncate">{airportName(f.to)}</span>
                  <span className="text-gray-600 font-mono ml-1">{f.departure}</span>
                </span>
                <span className="text-gray-400 tabular-nums flex-shrink-0">
                  {f.bags.toLocaleString()}
{f.capacity != null && `/${f.capacity.toLocaleString()}`}
                  {f.pct != null && <span className="text-gray-600 ml-1">({f.pct}%)</span>}
                </span>
              </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
