import { useEffect, useMemo, useState } from "react";
import { Hourglass } from "lucide-react";
import { getWarehouseColor } from "../../hooks/useStatusColor";
import { airportName, AIRPORT_META, airportGmtHours } from "../../data/staticAirports";
import { hhmm } from "../../utils/simClock";

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
// "HH:MM UTC±g (HH:MM UTC-0)": hora LOCAL del aeropuerto con su huso explícito
// y la referencia UTC-0 entre paréntesis (mismo formato que el registro de
// vuelos). Los minutos del backend son UTC (GMT-0 interno); el offset local
// sale de la columna GMT(h) del dataset (staticAirports.js). Si el aeropuerto
// no está en el dataset (agregado por el usuario), se muestra solo UTC-0.
function tzTime(utcMinute, airportCode) {
  const utc = `${hhmm(utcMinute)} UTC-0`;
  const g = airportGmtHours(airportCode);
  if (g == null) return utc;
  return `${hhmm(utcMinute + Math.round(g * 60))} UTC${g >= 0 ? "+" : ""}${g} (${utc})`;
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
  cargoLots = null,       // paquetes del vuelo ENFOCADO — los carga el Dashboard
                          // AL CLIC (backend /flightLots); null = cargando
  fetchFlightLots = null, // (flightId) => paquetes — para el desplegable inline
}) {
  const [search, setSearch] = useState("");

const [sortBy,        setSortBy]       = useState("ocupacion");
const [sortDir,       setSortDir]      = useState("desc");

const handleSortFL = (key) => {
  if (sortBy === key) setSortDir(d => d === "desc" ? "asc" : "desc");
  else { setSortBy(key); setSortDir("desc"); }
};


  const [bottomTab, setBottomTab] = useState("planificados"); // planificados | historial | carga

  // ── Desplegable de PAQUETES por vuelo planificado (▾) ─────────────────────
  // Al expandir una fila se piden sus paquetes al backend (/flightLots) y se
  // cachean; se muestran igual que en Envíos. `expandedPlanned` = flightId abierto.
  const [expandedPlanned, setExpandedPlanned] = useState(null);
  const [plannedLotsCache, setPlannedLotsCache] = useState({}); // flightId -> lots|null
  const togglePlanned = (flightId) => {
    if (expandedPlanned === flightId) { setExpandedPlanned(null); return; }
    setExpandedPlanned(flightId);
    if (!fetchFlightLots || plannedLotsCache[flightId] !== undefined) return;
    setPlannedLotsCache(c => ({ ...c, [flightId]: null }));   // cargando
    fetchFlightLots(flightId).then(l =>
      setPlannedLotsCache(c => ({ ...c, [flightId]: l ?? [] })));
  };

  // Al clicar un vuelo, la sub-pestaña "Carga" se abre sola (los datos ya los
  // trae el Dashboard, que los pide al backend en el mismo clic).
  useEffect(() => {
    if (focusFlightId) setBottomTab("carga");
  }, [focusFlightId]);

  // Vuelos que transportan un lote según el historial. Permite buscar por ID de
  // paquete/maleta (UF-1 / UF-1-2) y filtrar por la selección de Envíos.
  const flightsByLotQuery = (q) => {
    const ids = new Set();
    for (const e of history) {
      if (e.flightId && e.lotId && e.lotId.toLowerCase().includes(q)) ids.add(String(e.flightId));
    }
    return ids;
  };
  const lotFlightIds = useMemo(() => {
    if (!focusLotId) return null;
    const ids = new Set();
    for (const e of history) {
      if (e.flightId && lotMatches(e.lotId, focusLotId)) ids.add(String(e.flightId));
    }
    return ids;
  }, [history, focusLotId]);



  // Cada ruta activa del backend ya es un vuelo con su capacidad y carga total.
  // Filtros: foco de aeropuerto, búsqueda por código/tramo y semáforo de carga.
  const activeFlights = useMemo(() => {
    const focus = new Set(focusCodes);
    const q = search.trim().toLowerCase();
    const qLotFlights = q ? flightsByLotQuery(q) : null;
    return routes
      .filter(r => r.status === "departed")
      .filter(r => !focusFlightId || r.flightId === focusFlightId)
      .filter(r => !lotFlightIds || lotFlightIds.has(String(r.flightId)))
      .filter(r => focus.size === 0 || focus.has(r.from) || focus.has(r.to))
      .filter(r => sem === "all" || flightSem(r.bags, r.capacity || 0) === sem)
      .filter(r => !q || qLotFlights.has(String(r.flightId)) || (() => {
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
      .filter(u => !q || qLotFlights.has(String(u.flightId)) || (() => {
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

    departure: hhmm(u.departureMinute),
    departureMinute: u.departureMinute ?? 0,   // <-- AGREGAR

    bags: u.assigned || 0,
    capacity: u.capacity || 0,
    pct: u.capacity
      ? Math.round(((u.assigned || 0) / u.capacity) * 100)
      : null,

    flightId: u.flightId,

    arrival: hhmm(u.arrivalMinute),
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
          {/* Tope de filas: con el dataset completo pueden ser cientos de
              vuelos; renderizarlos todos en cada broadcast degrada el cliente.
              El buscador/filtros siguen operando sobre TODOS. */}
          {activeFlights.length > 80 && (
            <p className="text-gray-600 text-[9px] text-center">
              Mostrando 80 de {activeFlights.length} — usa el buscador o los filtros
            </p>
          )}
          {activeFlights.slice(0, 80).map(f => {
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
            
            {/* La CARGA del vuelo (paquetes a bordo/planeados) vive en la
                sub-pestaña "Carga" de abajo — el desplegable por fila se quitó
                porque desaparecía al re-renderizar y era difícil de leer. */}
            return (
              <div key={f.key} className={`rounded transition ${isSel ? "bg-teal/15 ring-1 ring-teal/40" : ""}`}>
                <button type="button" onClick={() => onFlightClick?.(f)}
                  title={`ID: ${f.key} · ${f.from} → ${f.to} · clic: enfocar y ver su carga abajo`}
                  className="w-full text-left rounded px-1 py-0.5 hover:bg-white/5 transition">
                  <div className="flex justify-between items-center mb-0.5">
                    <span className="text-gray-300 truncate">
                      <span className="text-teal">{airportName(f.from)}</span>
                      <span className="text-gray-600 mx-1">→</span>
                      <span className="text-gray-200">{airportName(f.to)}</span>
                    </span>
                    <span className={`font-bold flex-shrink-0 ${txtColor}`}>
                      {pct == null ? `${f.bags}` : `${pct}%`}
                    </span>
                  </div>
                  {/* Salida y llegada explícitas: hora local del aeropuerto
                      correspondiente + referencia UTC-0 (mismo formato que el
                      formulario de registro de vuelos). */}
                  <p className="text-gray-500 text-[9px] font-mono mb-0.5">
                    Salida: {tzTime(f.departureMinute, f.from)}
                    <span className="text-gray-600 mx-1">·</span>
                    Llegada: {tzTime(f.arrivalMinute, f.to)}
                  </p>
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
              </div>
            );
          })}
        </div>
      )}

      {/* ── Sección inferior: Planificados | Historial (integrado, req. #11).
             Ambas sub-pestañas responden al buscador de la tarjeta. ─────────── */}
      <div className="mt-3 pt-2 border-t border-white/10">
        <div className="flex gap-1 mb-1.5">
          {[["planificados", `Planificados (${plannedFlights.length})`],
            ["historial",    `Historial (${filteredHistory.length})`],
            ["carga",        focusFlightId ? `Carga · ${focusFlightId}` : "Carga"]].map(([k, l]) => (
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
            {plannedFlights.length > 60 && (
              <p className="text-gray-600 text-[9px] text-center">
                Mostrando 60 de {plannedFlights.length} — usa el buscador
              </p>
            )}
            {plannedFlights.slice(0, 60).map(f => {
              const isSel = pinnedCodes
                && pinnedCodes[0] === f.from && pinnedCodes[1] === f.to;
              const isExp = expandedPlanned === f.flightId;
              const lots  = plannedLotsCache[f.flightId];   // undefined=cerrado, null=cargando
              return (
              <div key={f.key}>
                <div className={`flex items-stretch gap-0.5 rounded transition
                  ${isSel ? "bg-teal/15 ring-1 ring-teal/40" : "hover:bg-white/5"}`}>
                  <button type="button"
                    onClick={() => onFlightClick?.(f)}
                    title={`ID: ${f.key} · ${f.from} → ${f.to} · clic para enfocar en el mapa`}
                    className="flex-1 text-[10px] px-1 py-0.5 text-left min-w-0">
                    <span className="flex items-center justify-between">
                      <span className="flex items-center gap-1 min-w-0">
                        <Hourglass size={9} className="text-blue-400 shrink-0"/>
                        <span className="text-gray-500 font-mono mr-0.5">{f.flightId}</span>
                        <span className="text-teal truncate">{airportName(f.from)}</span>
                        <span className="text-gray-600">→</span>
                        <span className="text-gray-200 truncate">{airportName(f.to)}</span>
                      </span>
                      <span className="text-gray-400 tabular-nums flex-shrink-0">
                        {f.bags.toLocaleString()}
{f.capacity != null && `/${f.capacity.toLocaleString()}`}
                        {f.pct != null && <span className="text-gray-600 ml-1">({f.pct}%)</span>}
                      </span>
                    </span>
                    <span className="block text-left text-gray-500 text-[9px] font-mono">
                      Salida: {tzTime(f.departureMinute, f.from)}
                      <span className="text-gray-600 mx-1">·</span>
                      Llegada: {tzTime(f.arrivalMinute, f.to)}
                    </span>
                  </button>
                  {/* Desplegar los paquetes que lleva este vuelo (▾) */}
                  {f.flightId && (
                    <button onClick={() => togglePlanned(f.flightId)}
                      title={isExp ? "Ocultar paquetes" : "Ver paquetes del vuelo"}
                      className="px-1 text-gray-500 hover:text-teal transition text-[10px] shrink-0">
                      {lots === null ? "…" : isExp ? "▴" : "▾"}
                    </button>
                  )}
                </div>

                {/* Paquetes del vuelo (inline, igual que Envíos) */}
                {isExp && Array.isArray(lots) && (
                  lots.length === 0 ? (
                    <p className="text-gray-600 text-[9px] pl-4 py-0.5">Sin paquetes asignados</p>
                  ) : (
                    <div className="flex flex-col gap-0.5 pl-4 py-0.5">
                      {lots.map((l, i) => {
                        const st = l.status === "current"  ? ["✈", "text-yellow-400"]
                                 : l.status === "done"     ? ["✓", "text-green-400"]
                                 :                           ["⌛", "text-blue-400"];
                        return (
                          <div key={`${l.lotId}-${i}`}
                               className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-center
                                          bg-[#021020] rounded px-1 py-0.5 text-[9px]">
                            <span className="text-teal font-mono truncate" title={`${l.from} → ${l.to}`}>
                              {l.lotId}
                            </span>
                            <span className="text-gray-300 tabular-nums">{l.bags || 0} mal.</span>
                            <span className={st[1]}>{st[0]}</span>
                          </div>
                        );
                      })}
                    </div>
                  )
                )}
              </div>
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

        {/* ── Carga del vuelo enfocado (paquetes a bordo / por salir / volados).
               Fuente: backend (plan vigente) — se ve EN EL AIRE, no solo al
               aterrizar, e incluye lo planeado aún sin despegar. ───────────── */}
        {bottomTab === "carga" && (
          !focusFlightId ? (
            <p className="text-gray-600 text-[10px] text-center py-2">
              Selecciona un vuelo (clic en la lista o en el avión del mapa)
              para ver su carga
            </p>
          ) : cargoLots == null ? (
            <p className="text-gray-600 text-[10px] text-center py-2">Cargando carga…</p>
          ) : cargoLots.length === 0 ? (
            <p className="text-gray-600 text-[10px] text-center py-2">
              El vuelo {focusFlightId} no tiene paquetes asignados (vacío)
            </p>
          ) : (() => {
            const TAG = {
              current:  ["A bordo",   "text-yellow-400"],
              upcoming: ["Por salir", "text-blue-400"],
              done:     ["Voló",      "text-green-400"],
            };
            const order = { current: 0, upcoming: 1, done: 2 };
            const rows = [...cargoLots].sort((a, b) =>
              (order[a.status] ?? 3) - (order[b.status] ?? 3)
              || (a.departureMinute ?? 0) - (b.departureMinute ?? 0));
            const aboard = cargoLots.filter(l => l.status === "current")
                                    .reduce((s, l) => s + (l.bags || 0), 0);
            const total  = cargoLots.reduce((s, l) => s + (l.bags || 0), 0);
            return (
              <>
                <p className="text-gray-500 text-[10px] mb-1">
                  <span className="text-yellow-400 font-bold">{aboard.toLocaleString()}</span> a bordo
                  {" · "}{total.toLocaleString()} en total ({cargoLots.length} paquete{cargoLots.length === 1 ? "" : "s"})
                </p>
                <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                  {rows.map((l, i) => {
                    const tag = TAG[l.status] || TAG.upcoming;
                    return (
                      <div key={`${l.lotId}-${l.departureMinute}-${i}`}
                           title={`${l.from} → ${l.to}`}
                           className="grid grid-cols-[1fr_auto_auto_auto] gap-1.5 items-center
                                      bg-[#021020] rounded px-1.5 py-0.5 text-[10px]">
                        <span className="text-teal font-mono truncate">{l.lotId}</span>
                        <span className="text-gray-500 font-mono">{hhmm(l.departureMinute)}</span>
                        <span className="text-gray-300 font-bold tabular-nums">
                          {(l.bags || 0).toLocaleString()}
                        </span>
                        <span className={tag[1]}>{tag[0]}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}
