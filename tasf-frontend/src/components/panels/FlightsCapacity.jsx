=import { useMemo, useState } from "react";
import { getWarehouseColor } from "../../hooks/useStatusColor";
import { airportName, AIRPORT_META } from "../../data/staticAirports";

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
// ¿`id` (lote) pertenece al foco `focus`? (exacto, o sub-lote de ese paquete)
const lotMatches = (id, focus) => !!id && (id === focus || id.startsWith(focus + "-"));

export default function FlightsCapacity({
  routes = [], upcoming = [], running = false, focusCodes = [],
  focusFlightId = null,   // si está, muestra SOLO ese vuelo
  focusLotId = null,      // paquete (UF-1) o maleta (UF-1-2) seleccionados en Envíos
  sem = "all", onSemChange,   // semáforo controlado por el padre (también filtra el mapa)
  selectedRouteKey = null, pinnedCodes = null, onFlightClick,
  onSearchEnter,          // Enter en la búsqueda → aplicar resultados al mapa
  history = [],           // historial de eventos (sub-pestaña Historial)
}) {
  const [search, setSearch] = useState("");

const [sortBy,        setSortBy]       = useState("ocupacion");
const [sortDir,       setSortDir]      = useState("desc");
const [expandedFlight, setExpandedFlight] = useState(null);

const handleSortFL = (key) => {
  if (sortBy === key) setSortDir(d => d === "desc" ? "asc" : "desc");
  else { setSortBy(key); setSortDir("desc"); }
};


  const [bottomTab, setBottomTab] = useState("planificados"); // planificados | historial

  // Vuelos que transportan un lote según el historial. Permite buscar por ID de
  // paquete/maleta (UF-1 / UF-1-2) y filtrar por la selección de Envíos.
  const flightsByLotQuery = (q) => {
    const ids = new Set();
    for (const e of history) {
      if (e.flightId && e.lotId && e.lotId.toLowerCase().includes(q)) ids.add(e.flightId);
    }
    return ids;
  };
  const lotFlightIds = useMemo(() => {
    if (!focusLotId) return null;
    const ids = new Set();
    for (const e of history) {
      if (e.flightId && lotMatches(e.lotId, focusLotId)) ids.add(e.flightId);
    }
    return ids;
  }, [history, focusLotId]);



// Paquetes por vuelo (del historial): lotId → { bags, status, finalDest }
const flightLots = useMemo(() => {
  const map = new Map();
  for (const e of history) {
    if (!e.flightId || !e.lotId) continue;
    if (!map.has(e.flightId)) map.set(e.flightId, new Map());
    const lots = map.get(e.flightId);
    if (!lots.has(e.lotId) || e.minute > (lots.get(e.lotId).minute ?? 0)) {
      lots.set(e.lotId, {
        bags: e.bags || 0, minute: e.minute,
        status: e.type, finalDest: !!e.finalDestination,
      });
    }
  }
  return map;
}, [history]);


  // Cada ruta activa del backend ya es un vuelo con su capacidad y carga total.
  // Filtros: foco de aeropuerto, búsqueda por código/tramo y semáforo de carga.
  const activeFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    const q = search.trim().toLowerCase();
    const qLotFlights = q ? flightsByLotQuery(q) : null;
    return routes
      .filter(r => r.status === "departed")
      .filter(r => !focusFlightId || r.flightId === focusFlightId)
      .filter(r => !lotFlightIds || lotFlightIds.has(r.flightId))
      .filter(r => focus.size === 0 || focus.has(r.from) || focus.has(r.to))
      .filter(r => sem === "all" || flightSem(r.bags, r.capacity || 0) === sem)
      .filter(r => !q || qLotFlights.has(r.flightId) || (() => {
        const norm = s => (s||"").toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const qn = norm(q);
        const om = AIRPORT_META[r.from] || {};
        const dm = AIRPORT_META[r.to]   || {};
        return [r.flightId, r.from, r.to, om.name, om.country, dm.name, dm.country]
          .some(s => norm(s).includes(qn));
      })())
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
  const dir = sortDir === "desc" ? 1 : -1;
  if (sortBy === "maletas")    return dir * ((b.bags??0) - (a.bags??0));
  if (sortBy === "salida")     return dir * ((a.departureMinute??0) - (b.departureMinute??0));
  if (sortBy === "llegada")    return dir * ((a.arrivalMinute??0) - (b.arrivalMinute??0));
  if (sortBy === "alfabetico") return dir * airportName(a.from||"")
    .localeCompare(airportName(b.from||""), "es", { sensitivity: "base" });
  return dir * ((b.pct??-1) - (a.pct??-1));
});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, focusCodes, focusFlightId, lotFlightIds, history, search, sem, sortBy, sortDir]);


  // Vuelos PLANIFICADOS próximos (aún no despegan) con maletas asignadas —
  // el registro de lo que el sistema planea. Respeta el foco de aeropuertos
  // Y el buscador de la tarjeta (igual que los activos).
  const plannedFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    const q = search.trim().toLowerCase();
    const qLotFlights = q ? flightsByLotQuery(q) : null;
    return upcoming
      .filter(u => (u.assigned || 0) > 0)
      .filter(u =>
  sem === "all" ||
  flightSem(u.assigned, u.capacity || 0) === sem
)
      .filter(u => !focusFlightId || u.flightId === focusFlightId)
      // Selección de Envíos: los tramos FUTUROS del lote aún no tienen eventos,
      // así que los planificados se restringen por aeropuertos del foco (abajo).
      .filter(u => focus.size === 0 || focus.has(u.origin) || focus.has(u.destination))
      .filter(u => !q || qLotFlights.has(u.flightId) || (() => {
        const norm = s => (s||"").toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const qn = norm(q);
        const om = AIRPORT_META[u.origin]      || {};
        const dm = AIRPORT_META[u.destination] || {};
        return [u.flightId, u.origin, u.destination,
                om.name, om.country, dm.name, dm.country]
          .some(s => norm(s).includes(qn));
      })())
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
  const dir = sortDir === "desc" ? 1 : -1;
  if (sortBy === "maletas")    return dir * ((b.bags??0) - (a.bags??0));
  if (sortBy === "salida")     return dir * ((a.departureMinute??0) - (b.departureMinute??0));
  if (sortBy === "llegada")    return dir * ((a.arrivalMinute??0) - (b.arrivalMinute??0));
  if (sortBy === "alfabetico") return dir * airportName(a.from||"")
    .localeCompare(airportName(b.from||""), "es", { sensitivity: "base" });
  return dir * ((b.pct??-1) - (a.pct??-1));
});
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [upcoming, focusCodes, focusFlightId, history, sortBy, sortDir, sem, search]);

  // Historial de eventos integrado (sub-pestaña): respeta foco y buscador.
  const filteredHistory = useMemo(() => {
    const focus = new Set(focusCodes);
    const q = search.trim().toLowerCase();
    return history
      .filter(e => !focusFlightId || e.flightId === focusFlightId)
      .filter(e => !focusLotId || lotMatches(e.lotId, focusLotId))
      .filter(e => focus.size === 0 || focus.has(e.from) || focus.has(e.to))
      .filter(e => !q || (() => {
        const norm = s => (s||"").toLowerCase()
          .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const qn = norm(q);
        const om = AIRPORT_META[e.from] || {};
        const dm = AIRPORT_META[e.to]   || {};
        return [e.flightId, e.lotId, e.from, e.to,
                om.name, om.country, dm.name, dm.country]
          .some(s => norm(s).includes(qn));
      })())
      .slice(0, 40);
  }, [history, focusCodes, focusFlightId, focusLotId, search]);

  return (
    <div className="bg-[#031525] border border-teal/20 rounded p-2 mt-2">
      <div className="flex items-center justify-between mb-2 gap-1">
        <p className="text-teal font-bold uppercase tracking-wide text-[10px] shrink-0">
          Vuelos y Capacidad
          <span className="text-gray-500 normal-case ml-1">({activeFlights.length})</span>
        </p>
        <div className="flex gap-0.5 flex-wrap justify-end">
          {SORT_OPTIONS.map(o => (
  <button key={o.key} onClick={() => handleSortFL(o.key)}
    className={`text-[9px] px-1 py-0.5 rounded transition border
      ${sortBy === o.key
        ? "bg-teal/20 text-teal border-teal/40"
        : "bg-[#021020] text-gray-500 border-white/10 hover:text-white"}`}>
    {o.label}{sortBy === o.key ? (sortDir === "desc" ? " ▼" : " ▲") : ""}
  </button>
))}
        </div>
      </div>

      {/* Búsqueda por código/tramo + filtro por semáforo (incluye vacío).
          ENTER: aplica los resultados como filtro en el MAPA (enfoca los
          aeropuertos de los vuelos coincidentes). */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && search.trim()) {
            const q = search.trim().toLowerCase();
            const all = [...activeFlights, ...plannedFlights];
            // Priorizar coincidencia EXACTA de ID de vuelo: "f104" + Enter debe
            // enfocar solo F104, no F10443 (que sí casa por substring en la lista).
            const exact = all.filter(f =>
              (f.flightId || f.key || "").toLowerCase() === q);
            onSearchEnter?.(exact.length ? exact : all);
          }
        }}
        placeholder="Buscar por ID, origen o destino (Enter → mapa)…"
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
            
return (() => {
  const isExp  = expandedFlight === f.key;
  const lots   = flightLots.get(f.flightId) ?? new Map();
  const lotList = [...lots.entries()]
    .sort((a, b) => b[1].minute - a[1].minute);
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
        {/* Expandir paquetes del vuelo */}
        {lotList.length > 0 && (
          <button onClick={() => setExpandedFlight(isExp ? null : f.key)}
            title={isExp ? "Ocultar paquetes" : `Ver ${lotList.length} paquetes`}
            className="text-[10px] px-1 py-1 text-gray-500 hover:text-teal transition shrink-0">
            {isExp ? "▴" : "▾"}
          </button>
        )}
      </div>

      {/* Lista de paquetes del vuelo */}
      {isExp && (
        <div className="mt-1 px-1 pb-1 border-t border-white/10 pt-1">
          <p className="text-gray-500 text-[9px] uppercase mb-1">
            Paquetes · <span className="text-teal font-bold">{lotList.length}</span>
          </p>
          <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto">
            {lotList.map(([lotId, info]) => {
              const statusIcon = info.finalDest    ? ["✓", "text-green-400"]
                               : info.status === "departed" ? ["✈", "text-yellow-400"]
                               :                              ["⇄", "text-blue-400"];
              return (
                <div key={lotId}
                  className="grid grid-cols-[1fr_auto_auto] gap-1 items-center
                             bg-[#021020] rounded px-1 py-0.5 text-[9px]">
                  <span className="text-teal font-mono truncate">{lotId}</span>
                  <span className="text-gray-300 font-bold tabular-nums">
                    {(info.bags||0).toLocaleString()} maletas
                  </span>
                  <span className={statusIcon[1]}>{statusIcon[0]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
})();


          })}
        </div>
      )}

      {/* ── Sección inferior: Planificados | Historial (integrado, req. #11).
             Ambas sub-pestañas responden al buscador de la tarjeta. ─────────── */}
      <div className="mt-3 pt-2 border-t border-white/10">
        <div className="flex gap-1 mb-1.5">
          {[["planificados", `Planificados (${plannedFlights.length})`],
            ["historial",    `Historial (${filteredHistory.length})`]].map(([k, l]) => (
            <button key={k} onClick={() => setBottomTab(k)}
              className={`text-[10px] px-2 py-0.5 rounded transition border
                ${bottomTab === k
                  ? "bg-teal/20 text-teal border-teal/40"
                  : "bg-[#021020] text-gray-500 border-white/10 hover:text-white"}`}>
              {l}
            </button>
          ))}
        </div>

        {bottomTab === "planificados" && (
          plannedFlights.length === 0 ? (
            <p className="text-gray-600 text-[10px] text-center py-2">Sin vuelos planificados</p>
          ) : (
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
          )
        )}

        {bottomTab === "historial" && (
          filteredHistory.length === 0 ? (
            <p className="text-gray-600 text-[10px] text-center py-2">
              {search.trim() ? "Sin eventos para esa búsqueda" : "Aún no hay eventos"}
            </p>
          ) : (
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {filteredHistory.map((e, i) => {
              const tag = e.type === "departed" ? ["Salida", "text-yellow-400"]
                        : e.finalDestination    ? ["Entregado", "text-green-400"]
                        : ["Transbordo", "text-blue-400"];
              return (
                <div key={`h-${e.minute}-${e.flightId}-${i}`}
                     className="flex items-center justify-between text-[10px] px-1 py-0.5">
                  <span className="flex items-center gap-1 min-w-0">
                    <span className="text-gray-400 font-mono">{e.flightId || "—"}</span>
                    <span className="text-teal truncate">{airportName(e.from)}</span>
                    <span className="text-gray-600">→</span>
                    <span className="text-gray-200 truncate">{airportName(e.to)}</span>
                  </span>
                  <span className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-gray-500 tabular-nums">{e.bags ?? 0}</span>
                    <span className="text-gray-600 font-mono">
                      {(e.clock || "").split("  ")[1] || ""}
                    </span>
                    <span className={tag[1]}>{tag[0]}</span>
                  </span>
                </div>
              );
            })}
          </div>
          )
        )}
      </div>
    </div>
  );
}
