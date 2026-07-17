import { Fragment, useMemo, useState } from "react";
import { Pin } from "lucide-react";
import { airportName, AIRPORT_META } from "../../data/staticAirports";

// ── Constantes SLA ────────────────────────────────────────────────────────────
// El backend envía registrationMinute y slaLimitMinutes por evento.
// slaLimitMinutes = 1440 (mismo continente / 24 h) ó 2880 (distinto / 48 h).

/**
 * Calcula el estado SLA de un evento a partir de los campos que ahora
 * provee el backend.
 *
 * @returns {{ status: "green"|"yellow"|"red", pct: number, label: string }}
 */
function computeSLA(event, simulatedMinute) {
  const { registrationMinute, slaLimitMinutes, type, finalDestination } = event;

  // Fallback: si el backend antiguo no envía los campos nuevos, degradar a
  // la lógica original para no romper el monitor durante la transición.
  if (registrationMinute == null || slaLimitMinutes == null) {
    if (event.overDeadline) return { status: "red",    pct: 110, label: "Fuera de plazo" };
    if (type === "landed" && finalDestination) return { status: "green", pct: 0, label: "Entregado" };
    return { status: "yellow", pct: 50, label: type === "landed" ? "Transbordo" : "En tránsito" };
  }

  // Tiempo transcurrido desde el registro del lote hasta el minuto
  // representado por este evento (salida o llegada del vuelo).
  const elapsed = event.minute - registrationMinute;
  const pct     = slaLimitMinutes > 0 ? (elapsed / slaLimitMinutes) * 100 : 0;

  // ── Reglas de negocio ─────────────────────────────────────────────────────
  // REGULAR  (Verde)  : elapsed ≤ 50 % del SLA
  // CRÍTICO  (Amarillo): elapsed > 50 % y ≤ 100 % del SLA
  // VENCIDO  (Rojo)   : elapsed > 100 % del SLA
  //
  // Caso especial: si el lote llegó a su destino final Y está dentro del SLA,
  // siempre mostramos Verde ("Entregado") independientemente de la ventana.
  if (type === "landed" && finalDestination && pct <= 100) {
    return { status: "green", pct, label: "Entregado" };
  }
  if (pct > 100) {
    return { status: "red",    pct, label: "Fuera de plazo" };
  }
  if (pct > 50) {
    return { status: "yellow", pct, label: type === "landed" ? "Transbordo" : "En tránsito" };
  }
  return { status: "green", pct, label: type === "landed" ? "Transbordo" : "En tránsito" };
}

// ── Configuración visual del semáforo ─────────────────────────────────────────
const STATUS_CONFIG = {
  green:  { bg: "#16a34a", dot: "#bbf7d0", bar: "#22c55e" },
  yellow: { bg: "#ca8a04", dot: "#fef08a", bar: "#eab308" },
  red:    { bg: "#dc2626", dot: "#fecaca", bar: "#ef4444" },
};

function SLAStatusBadge({ event, simulatedMinute }) {
  const { status, pct, label } = computeSLA(event, simulatedMinute);
  const cfg = STATUS_CONFIG[status];
  const slaHours = event.slaLimitMinutes != null
    ? event.slaLimitMinutes / 60
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {/* Badge de estado */}
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 10, padding: "2px 6px", borderRadius: 4,
        background: cfg.bg, color: "#fff", whiteSpace: "nowrap",
      }}>
        <span style={{
          width: 6, height: 6, borderRadius: "50%",
          background: cfg.dot, flexShrink: 0,
        }}/>
        {label}
      </span>

      {/* Barra de progreso del SLA */}
      {event.slaLimitMinutes != null && (
        <div style={{
          position: "relative", height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.1)", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${Math.min(100, Math.max(0, pct))}%`,
            background: cfg.bar,
            borderRadius: 2,
            transition: "width 0.4s ease",
          }}/>
          {/* Marca del 50 % */}
          <div style={{
            position: "absolute", left: "50%", top: 0, bottom: 0,
            width: 1, background: "rgba(255,255,255,0.3)",
          }}/>
        </div>
      )}

      {/* Texto de tiempo SLA */}
      {slaHours != null && (
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)" }}>
          SLA {slaHours}h · {Math.round(pct)}% usado
        </span>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const EMPTY_KPIS = {
  activeFlights: 0, saturationPercent: 0, occupancyPercent: 0,
  avgDeliveryDays: 0, replanifications: 0, deliveredOnTime: 0,
  atRisk: 0, outOfDeadline: 0, totalBags: 0, routedBags: 0,
};

function getPackageId(event) {
  if (event.packageId) return event.packageId;
  const from = event.from || "XX";
  const to = event.to || "XX";
  return `PKG-${from}${to}-${event.minute || "00"}`;
}

// Paquete base de un sub-lote: un sub-lote SIEMPRE es «base-k» donde base
// termina a su vez en número (UF-1-2 → UF-1; SPIM_204-3 → SPIM_204). Así
// «UF-1» (lote sin dividir) NO se confunde con un sub-lote de «UF».
const packageBase = (lotId) => {
  const m = /^(.+\d)-(\d+)$/.exec(lotId || "");
  return m ? m[1] : (lotId || "—");
};

// ¿`id` pertenece al foco `focus`? (exacto, o sub-lote de ese paquete)
const matchesLot = (id, focus) => !!id && (id === focus || id.startsWith(focus + "-"));

/** Etiqueta legible del SLA (mismo / distinto continente) */
function slaTypeLabel(slaLimitMinutes) {
  if (slaLimitMinutes == null) return "";
  return slaLimitMinutes <= 1440 ? "mismo continente (24 h)" : "distinto continente (48 h)";
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function SLAMonitor({
  kpis = {},
  events = [],
  running = false,
  message = "",
  simulatedMinute = 0,
  focusCodes = [],
  focusFlightId = null,
  focusLotId = null,   // paquete (UF-1) o maleta (UF-1-2) seleccionados en Envíos
  focusRoute = null,   // ruta (vuelo) enfocada en el mapa: {flightId,from,to,bags,capacity}
  focusFlightLots = null, // paquetes del vuelo enfocado (backend /flightLots, al clic)
  view = "all",
  selectedShipment = null, onShipmentClick,
  searchText, onSearchChange,
  fleetFill = null,
  fetchShipmentPaths = null,
}) {
  const [internalFilter, setInternalFilter] = useState("");
  const [slaSearch, setSlaSearch] = useState("");
  // Paquete desplegado en la tarjeta de Envíos (muestra sus sub-lotes debajo).
  const [expandedPkg, setExpandedPkg] = useState(null);

const [expandedSubLot,  setExpandedSubLot]  = useState(null);
const [subLotPaths,     setSubLotPaths]     = useState({});
const [loadingSubLot,   setLoadingSubLot]   = useState(null);

const expandSubLot = async (subLotId) => {
  if (expandedSubLot === subLotId) { setExpandedSubLot(null); return; }
  setExpandedSubLot(subLotId);
  if (subLotPaths[subLotId] || !fetchShipmentPaths) return;
  setLoadingSubLot(subLotId);
  try {
    const paths = await fetchShipmentPaths(subLotId);
    // fetchShipmentPaths devuelve array de paths; tomamos el que coincide con subLotId
    const match = (paths ?? []).find(p => p.lotId === subLotId) ?? paths?.[0];
    setSubLotPaths(p => ({ ...p, [subLotId]: match?.legs ?? [] }));
  } catch { setSubLotPaths(p => ({ ...p, [subLotId]: [] })); }
  finally { setLoadingSubLot(null); }
};


const [envioSort,      setEnvioSort]      = useState("reciente");
const [envioSortDir,   setEnvioSortDir]   = useState("desc");
const [envioStatusFilter, setEnvioStatusFilter] = useState("all");

const handleEnvioSort = (key) => {
  if (envioSort === key) setEnvioSortDir(d => d === "desc" ? "asc" : "desc");
  else { setEnvioSort(key); setEnvioSortDir("desc"); }
};

  // Búsqueda controlada (la eleva el Dashboard para reflejarla en el mapa y los
  // demás paneles) o interna si no se controla.
  const filterText    = searchText !== undefined ? searchText : internalFilter;
  const setFilterText = onSearchChange || setInternalFilter;
  const showSla     = view === "all" || view === "sla";
  const showEnvios  = view === "all" || view === "envios";
  const showResumen = view === "all" || view === "resumen";

  const safeKpis = { ...EMPTY_KPIS, ...Object.fromEntries(
    Object.entries(kpis).filter(([, v]) => v !== undefined && v !== null)
  )};

  const isPlanning = message.startsWith("Planificando");

  // Foco. Prioridad: si hay un vuelo enfocado (se seleccionó una unidad de
  // transporte), mostrar SOLO las maletas de ese vuelo. Si no, restringir a los
  // aeropuertos en foco (entradas/salidas), coherente con el mapa y las tarjetas.
  const focusedEvents = useMemo(() => {
    const byCodes = () => {
      if (!focusCodes.length) return events;
      const focus = new Set(focusCodes);
      return events.filter(e => focus.has(e.from) || focus.has(e.to));
    };
    if (focusFlightId) {
      const byFlight = events.filter(e => e.flightId === focusFlightId);
      // Si el vuelo ya tiene eventos (despegó/aterrizó con carga), mostrar SOLO
      // esos. Si aún NO generó eventos (en el aire o vacío), degradar al foco de
      // aeropuertos (origen/destino, que el clic también fija) en vez de quedar
      // en blanco — antes esto era el "se queda cargando" al abrir varios paneles.
      if (byFlight.length) return byFlight;
      return byCodes();
    }
    return byCodes();
  }, [events, focusCodes, focusFlightId]);

  // ¿El vuelo enfocado no tiene eventos propios y estamos mostrando el contexto
  // de sus aeropuertos? Sirve para matizar el estado vacío/encabezado.
  const flightFallback = focusFlightId
    && !events.some(e => e.flightId === focusFlightId)
    && focusCodes.length > 0;
  // Carga real del vuelo enfocado según el mapa (RouteState). Un avión puede ir
  // EN EL AIRE con maletas cuyo evento aún no llegó al historial del cliente
  // (tope/dedup): en ese caso NO es "vacío" — hay que decir que lleva N maletas.
  const focusFlightBags = (focusRoute && focusRoute.flightId === focusFlightId)
    ? (focusRoute.bags || 0) : 0;
  // Paquetes del vuelo enfocado, directos del backend (disponibles AL CLIC,
  // también con el avión en el aire). Si el historial no tiene sus eventos
  // (tope 300 con el dataset completo), estos alimentan la tabla igualmente.
  const flightLotRows = (flightFallback && Array.isArray(focusFlightLots))
    ? focusFlightLots : null;



const lotEndpoints = useMemo(() => {
  const map = new Map();
  for (const e of events) {
    const id = e.lotId;
    if (!id) continue;
    if (!map.has(id)) map.set(id, { from: e.from, to: e.to });
    if (e.type === "landed" && e.finalDestination) {
      map.get(id).to = e.to;
    }
  }
  return map;
}, [events]);



  // ── Últimos 5 eventos para el monitor de plazos general ───────────────────
  const recentEvents = useMemo(() => {
    if (!focusedEvents.length) return [];
    let list = [...focusedEvents].reverse();
    // Selección de Envíos: restringir al paquete (incluye sub-lotes) o maleta.
    if (focusLotId) list = list.filter(e => matchesLot(e.lotId, focusLotId));
    if (slaSearch.trim()) {
      const norm = s => (s||"").toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const q = norm(slaSearch.trim());
      list = list.filter(e => {
        const om = AIRPORT_META[e.from] || {};
        const dm = AIRPORT_META[e.to]   || {};
        return [e.lotId, e.flightId, e.from, e.to,
                om.name, om.country, dm.name, dm.country]
          .some(s => norm(s).includes(q));
      });
    }
    return list.slice(0, slaSearch.trim() || focusLotId ? 20 : 5);
  }, [focusedEvents, slaSearch, focusLotId]);

  // ── Tarjeta de Envíos: una fila por PAQUETE (lote base) ──────────────────
  //  · Clic en el paquete → TODAS sus rutas (una por sub-lote) en el mapa.
  //  · Desplegar (▾) → sub-lotes/maletas debajo; clic en uno → SOLO su ruta.
const packageRows = useMemo(() => {
  if (!focusedEvents.length) return [];

  // Estado más reciente de cada sub-lote/lote.
  const byLot = new Map();
  for (const e of focusedEvents) {
    const lotId = e.lotId || getPackageId(e);
    if (!byLot.has(lotId) || e.minute > byLot.get(lotId).minute) {
      byLot.set(lotId, { ...e, pkgId: lotId });
    }
  }

  // Agrupar sub-lotes por su paquete base: fila nivel 1 = PAQUETE (UF-1),
  // filas nivel 2 (desplegables) = sub-lotes/maletas (UF-1-1, UF-1-2\u2026).
  const groups = new Map();
  for (const row of byLot.values()) {
    const base = packageBase(row.pkgId);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(row);
  }

  let result = [...groups.entries()].map(([base, subs]) => {
    subs.sort((a, b) =>
      a.pkgId.localeCompare(b.pkgId, undefined, { numeric: true }));
    const latest = subs.reduce((x, y) => (y.minute > x.minute ? y : x));
    // Extremos del paquete (origen y destino FINAL, com\u00fan a los sub-lotes).
    const ep     = lotEndpoints.get(latest.pkgId);
    const origin = ep?.from || latest.from;
    const dest   = ep?.to   || latest.to;
    return {
      base, subs, latest, origin, dest,
      bags: subs.reduce((s, x) => s + (x.bags || 0), 0),
      delivered: subs.every(s => s.type === "landed" && s.finalDestination),
      inAir:     subs.some(s => s.type === "departed"),
    };
  }).sort((a, b) => b.latest.minute - a.latest.minute);

  if (filterText.trim()) {
    const norm = s => (s||"").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = norm(filterText.trim());
    // Coincide por paquete (UF-1), maleta/sub-lote (UF-1-2), vuelo o ruta.
    result = result.filter(p => {
      const om = AIRPORT_META[p.origin] || {};
      const dm = AIRPORT_META[p.dest]   || {};
      return [p.base, p.origin, p.dest, om.name, om.country, dm.name, dm.country,
              ...p.subs.flatMap(s => [s.pkgId, s.flightId])]
        .some(s => norm(s).includes(q));
    });
  }

  // El paquete SELECCIONADO se FIJA al inicio de la lista: los eventos nuevos
  // no deben enterrarlo (hay que poder ver sus datos y des-seleccionarlo con
  // otro clic). Se fija antes del tope de 30 para que nunca quede fuera.
  if (selectedShipment?.bagId) {
    const selBase = packageBase(selectedShipment.bagId);
    const idx = result.findIndex(p => p.base === selBase);
    if (idx > 0) result.unshift(result.splice(idx, 1)[0]);
  }

  return result.slice(0, 30);
}, [focusedEvents, filterText, lotEndpoints, selectedShipment]);




const ENVIO_SORT_OPTIONS = [
  { key: "reciente",  label: "Reciente" },
  { key: "maletas",   label: "Maletas"  },
  { key: "sla",       label: "SLA %"    },
  { key: "nombre",    label: "A-Z"      },
];

const ENVIO_STATUS_CHIPS = [
  { key: "all",       label: "Todos",      dot: "bg-gray-400"  },
  { key: "delivered", label: "Entregado",  dot: "bg-green-500" },
  { key: "inAir",     label: "En vuelo",   dot: "bg-yellow-500"},
  { key: "escala",    label: "En escala",  dot: "bg-blue-400"  },
  { key: "overdue",   label: "Vencido",    dot: "bg-red-500"   },
];

const filteredSortedPackageRows = useMemo(() => {
  let rows = [...packageRows];

  // Filtro por estado
  if (envioStatusFilter !== "all") {
    rows = rows.filter(p => {
      if (envioStatusFilter === "delivered") return p.delivered;
      if (envioStatusFilter === "inAir")     return p.inAir && !p.delivered;
      if (envioStatusFilter === "escala")    return !p.delivered && !p.inAir;
      if (envioStatusFilter === "overdue") {
        const { status } = computeSLA(
          { ...p.latest, from: p.origin, to: p.dest }, simulatedMinute);
        return status === "red";
      }
      return true;
    });
  }

  // Ordenamiento
  const dir = envioSortDir === "desc" ? 1 : -1;
  if (envioSort === "maletas")
    rows.sort((a, b) => dir * (b.bags - a.bags));
  else if (envioSort === "sla") {
    rows.sort((a, b) => {
      const pa = computeSLA({ ...a.latest, from: a.origin, to: a.dest }, simulatedMinute).pct;
      const pb = computeSLA({ ...b.latest, from: b.origin, to: b.dest }, simulatedMinute).pct;
      return dir * (pb - pa);
    });
  } else if (envioSort === "nombre")
    rows.sort((a, b) => dir * a.base.localeCompare(b.base, undefined, { numeric: true }));
  else // reciente
    rows.sort((a, b) => dir * (b.latest.minute - a.latest.minute));

  // El seleccionado siempre primero (independiente del orden)
  if (selectedShipment?.bagId) {
    const selBase = packageBase(selectedShipment.bagId);
    const idx = rows.findIndex(p => p.base === selBase);
    if (idx > 0) rows.unshift(rows.splice(idx, 1)[0]);
  }

  return rows;
}, [packageRows, envioSort, envioSortDir, envioStatusFilter, simulatedMinute, selectedShipment]);


  // ── Contadores globales ───────────────────────────────────────────────────
  const delivered = safeKpis.deliveredOnTime;
  const overdue   = safeKpis.outOfDeadline;
  const inTransit = (isPlanning || safeKpis.activeFlights === 0)
    ? 0
    : Math.max(0, safeKpis.routedBags - delivered - overdue);

  // ── Desglose SLA: Verde / Amarillo / Rojo ─────────────────────────────────
  const slaBreakdown = {
    green:  safeKpis.slaOnTrack  ?? 0,
    yellow: safeKpis.slaCritical ?? 0,
    red:    safeKpis.outOfDeadline ?? 0,
  };

  return (
    <div className="flex flex-col gap-2 text-xs">

      {showSla && (<>
      {/* ── Monitor de Plazos (SLA) ─────────────────────────────────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Monitor de Plazos (SLA)
        </p>
        <input
          value={slaSearch}
          onChange={e => setSlaSearch(e.target.value)}
          placeholder="Buscar por ID, vuelo, ciudad o país…"
          className="w-full bg-[#021020] border border-white/10 rounded
                     px-2 py-1 text-[11px] text-gray-300 mb-2
                     focus:outline-none focus:border-teal"
        />
        {/* Selección de Envíos activa: este monitor queda FIJADO a ese paquete/
            maleta (sus eventos no se entierran entre los demás). */}
        {focusLotId && (
          <p className="text-teal/90 text-[10px] mb-2 leading-tight
                        bg-teal/10 border border-teal/30 rounded px-2 py-1">
            <Pin size={10} className="inline -mt-0.5 mr-1"/>
            Mostrando solo <b className="font-mono">{focusLotId}</b>
            {" "}(selección de Envíos) — clic en el paquete para des-seleccionar.
          </p>
        )}
        <table className="w-full">
          <thead>
            <tr className="text-gray-500 border-b border-white/10">
              <th className="text-left py-1">Paquete / Ruta</th>
              <th className="text-center py-1">Maletas</th>
              <th className="text-left py-1">Tipo SLA</th>
              <th className="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {recentEvents.length > 0 ? (
              recentEvents.map((event, idx) => (
                <tr key={`sla-${event.lotId || getPackageId(event)}-${idx}`}
                    className="border-b border-white/5">
                  <td className="py-1.5 text-gray-300">
                    <span className="text-teal font-mono font-bold text-[10px] break-all">
                      {event.lotId || getPackageId(event)}
                    </span>
                    <br/>
                    {(() => {
  const ep = lotEndpoints.get(event.lotId);
  const origin = ep?.from || event.from;
  const dest   = ep?.to   || event.to;
  return (
    <span className="text-gray-500" title={`${origin} → ${dest}`}>
      {airportName(origin)} → {airportName(dest)}
    </span>
  );
})()}
                  </td>
                  <td className="py-1.5 text-center text-gray-300 font-bold text-[10px]">
                    {event.bags || 1}
                  </td>
                  <td className="py-1.5 text-gray-500 text-[10px]">
                    {slaTypeLabel(event.slaLimitMinutes)}
                  </td>
                  <td className="py-1.5">
                    <SLAStatusBadge event={event} simulatedMinute={simulatedMinute} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-4 text-center text-gray-600 text-[10px]">
                  {focusLotId
                    ? `${focusLotId} aún no registra eventos (esperando salida)`
                    : focusFlightId
                      ? (flightLotRows?.length
                          ? `Vuelo ${focusFlightId}: ${flightLotRows.reduce((s, l) => s + (l.bags || 0), 0)} maletas en ${flightLotRows.length} paquete(s) — detalle en la tarjeta de Envíos`
                          : focusFlightBags > 0
                            ? `El vuelo ${focusFlightId} lleva ${focusFlightBags} maletas — consultando sus paquetes…`
                            : `El vuelo ${focusFlightId} va vacío (sin maletas)`)
                      : focusCodes.length
                        ? "Sin paquetes para el filtro actual"
                        : running ? "Esperando eventos..." : "Inicia la simulación"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Semáforo SLA global ──────────────────────────────────────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Semáforo SLA — maletas acumuladas
        </p>
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            ["Regular",       slaBreakdown.green,  "#16a34a", "≤ 50% del plazo"],
            ["Crítico",        slaBreakdown.yellow, "#ca8a04", "50%–100% del plazo"],
            ["Fuera de plazo", slaBreakdown.red,    "#dc2626", "> 100% del plazo"],
          ].map(([label, val, color, hint]) => (
            <div key={label} className="bg-[#021020] rounded p-1.5">
              <p style={{ color }} className="text-lg font-bold">{val || 0}</p>
              <p className="text-gray-400 text-[10px] leading-tight">{label}</p>
              <p className="text-gray-600 text-[9px] leading-tight mt-0.5">{hint}</p>
            </div>
          ))}
        </div>
      </div>
      </>)}

      {/* ── Buscador de paquete (Envíos) ────────────────────────────────── */}
      {showEnvios && (
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Detalle por Paquete
        </p>
        {flightFallback && (
          <p className={`text-[10px] mb-2 leading-tight ${
            flightLotRows?.length || focusFlightBags > 0
              ? "text-teal/90" : "text-yellow-400/80"}`}>
            {flightLotRows?.length
              ? <>Vuelo {focusFlightId}: <b>{flightLotRows.reduce((s, l) => s + (l.bags || 0), 0)}</b>{" "}
                  maletas en {flightLotRows.length} paquete{flightLotRows.length === 1 ? "" : "s"} —
                  detalle abajo (en vivo, también en el aire).</>
              : flightLotRows && flightLotRows.length === 0 && focusFlightBags === 0
                ? <>El vuelo {focusFlightId} va vacío (sin maletas) — mostrando los
                    que pasan por su origen/destino.</>
                : <>Consultando la carga del vuelo {focusFlightId}…</>}
          </p>
        )}
        <input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Busca ID de paquete, vuelo o ruta"
          className="w-full bg-[#021020] border border-white/10 rounded
                     px-2 py-1 text-xs text-gray-300 mb-2
                     focus:outline-none focus:border-teal"
        />

{/* Filtro por estado */}
<div className="flex gap-0.5 flex-wrap mb-1.5">
  {ENVIO_STATUS_CHIPS.map(c => (
    <button key={c.key} onClick={() => setEnvioStatusFilter(c.key)}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition border
        ${envioStatusFilter === c.key
          ? "border-teal/60 bg-teal/10 text-gray-200"
          : "border-white/10 text-gray-400 hover:text-white"}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`}/>{c.label}
    </button>
  ))}
</div>
{/* Ordenamiento */}
<div className="flex gap-0.5 flex-wrap mb-2">
  {ENVIO_SORT_OPTIONS.map(o => (
    <button key={o.key} onClick={() => handleEnvioSort(o.key)}
      className={`text-[9px] px-1.5 py-0.5 rounded transition border
        ${envioSort === o.key
          ? "bg-teal/20 text-teal border-teal/40"
          : "bg-[#021020] text-gray-500 border-white/10 hover:text-white"}`}>
      {o.label}{envioSort === o.key ? (envioSortDir === "desc" ? " ▼" : " ▲") : ""}
    </button>
  ))}
</div>

        <table className="w-full">
  <thead>
    <tr className="text-gray-500 border-b border-white/10">
      <th className="text-left py-1 w-4"/>
      <th className="text-left py-1">Paquete</th>
      <th className="text-left py-1">Origen → Destino</th>
      <th className="text-center py-1">Maletas</th>
      <th className="text-left py-1">SLA</th>
    </tr>
  </thead>
  <tbody>
    {/* Vuelo enfocado sin eventos en el historial (tope 300 con el dataset
        completo): sus paquetes vienen del backend (/flightLots) y se muestran
        EN VIVO — también con el avión en el aire, sin esperar al aterrizaje. */}
    {flightLotRows?.length ? (
      flightLotRows.map((l, i) => {
        const tag = l.status === "current"  ? ["A bordo",   "text-yellow-400"]
                  : l.status === "upcoming" ? ["Por salir", "text-blue-400"]
                  :                           ["Voló",      "text-green-400"];
        return (
          <tr key={`fl-${l.lotId}-${l.departureMinute}-${i}`}
              className="border-b border-white/5">
            <td className="py-1"/>
            <td className="py-1.5 text-[10px]">
              <span className="text-teal font-mono font-bold">{l.lotId}</span>
            </td>
            <td className="py-1.5 text-[10px] text-gray-400"
                title={`${l.from} → ${l.to}`}>
              <span className="text-gray-300">{airportName(l.from)}</span>
              <span className="text-gray-600 mx-1">→</span>
              <span className="text-gray-300">{airportName(l.to)}</span>
            </td>
            <td className="py-1.5 text-center text-gray-300 font-bold text-[10px]">
              {l.bags || 0}
            </td>
            <td className={`py-1.5 text-[10px] ${tag[1]}`}>{tag[0]}</td>
          </tr>
        );
      })
    ) : filteredSortedPackageRows.length > 0 ? (
      filteredSortedPackageRows.map((pkg) => {
        const isSel   = selectedShipment?.bagId === pkg.base;
        // Sub-lote de este paquete seleccionado → mantener desplegado para que
        // la fila resaltada (y sus datos) queden siempre visibles.
        const subSelIn = !!selectedShipment?.sub
          && packageBase(selectedShipment.bagId) === pkg.base;
        const isExp   = expandedPkg === pkg.base || subSelIn;
        const hasSubs = pkg.subs.length > 0;
        const globalStatus = pkg.delivered ? ["Entregado", "text-green-400"]
                           : pkg.inAir     ? ["En vuelo",  "text-yellow-400"]
                           :                 ["En escala", "text-blue-400"];
        // Clic en el paquete: TODAS las rutas del lote (el backend agrupa por base).
        const clickPkg = () => onShipmentClick?.({
          ...pkg.latest, pkgId: pkg.base, lotId: pkg.base,
          from: pkg.origin, to: pkg.dest,
        });

        return (
          <Fragment key={`pkg-${pkg.base}`}>
            {/* ── Fila del PAQUETE (nivel 1) ── */}
            <tr className={`border-b border-white/5 transition
                  ${isSel || subSelIn ? "bg-teal/10 ring-1 ring-inset ring-teal/30"
                                      : "hover:bg-white/5"}`}>
              <td className="py-1.5">
                {hasSubs && (
                  <button onClick={() => setExpandedPkg(isExp ? null : pkg.base)}
                    title={isExp ? "Ocultar maletas" : `Ver ${pkg.subs.length} maletas/sub-lotes`}
                    className="text-gray-500 hover:text-teal transition text-[10px] px-1">
                    {isExp ? "▴" : "▾"}
                  </button>
                )}
              </td>
              <td className="py-1.5 text-[10px] cursor-pointer"
                  onClick={clickPkg}
                  title={isSel ? "Seleccionado (fijado arriba) — clic para des-seleccionar"
                               : "Clic: todas las rutas del paquete en el mapa"}>
                {(isSel || subSelIn) && <Pin size={9} className="inline -mt-0.5 mr-0.5 text-teal"/>}
                <span className="text-teal font-mono font-bold">{pkg.base}</span>
                {hasSubs && (
                  <span className="text-gray-500 ml-1">×{pkg.subs.length}</span>
                )}
                <span className={`ml-1.5 text-[9px] ${globalStatus[1]}`}>
                  {globalStatus[0]}
                </span>
              </td>
              <td className="py-1.5 text-[10px] text-gray-400 cursor-pointer"
                  onClick={clickPkg}
                  title={`${pkg.origin} → ${pkg.dest}`}>
                <span className="text-gray-300">{airportName(pkg.origin)}</span>
                <span className="text-gray-600 mx-1">→</span>
                <span className="text-gray-300">{airportName(pkg.dest)}</span>
              </td>
              <td className="py-1.5 text-center text-gray-300 font-bold text-[10px]">
                {pkg.bags}
              </td>
              <td className="py-1.5">
                <SLAStatusBadge
                  event={{ ...pkg.latest, from: pkg.origin, to: pkg.dest }}
                  simulatedMinute={simulatedMinute} />
              </td>
            </tr>

            {/* ── Filas de MALETAS/sub-lotes (nivel 2, desplegable) ──
                Independientes del paquete: clic → SOLO la ruta de ese sub-lote. */}
{isExp && pkg.subs.map(sub => {
  const subSel     = selectedShipment?.bagId === sub.pkgId;
  const suffix     = sub.pkgId.startsWith(pkg.base)
    ? sub.pkgId.slice(pkg.base.length) : sub.pkgId;
  const subStatus  = sub.type === "landed" && sub.finalDestination
    ? ["Entregado", "text-green-400"]
    : sub.type === "departed"
      ? ["En vuelo",  "text-yellow-400"]
      : ["En escala", "text-blue-400"];
  const sep        = lotEndpoints.get(sub.pkgId);
  const isSubExp   = expandedSubLot === sub.pkgId;
  const isSubLoad  = loadingSubLot  === sub.pkgId;
  const legs       = subLotPaths[sub.pkgId] ?? [];

  return (
    <Fragment key={`sub-${sub.pkgId}`}>
      {/* Fila del sub-lote */}
      <tr className={`border-b border-white/5 bg-[#021020]/50 transition
            ${subSel ? "bg-teal/15" : "hover:bg-white/5"}`}>
        <td className="py-1 pl-3 text-[9px] text-gray-600">└</td>
        <td className="py-1 text-[10px]">
          <div className="flex items-center gap-1">
            {/* Botón expandir tramos */}
            <button onClick={() => expandSubLot(sub.pkgId)}
              title={isSubExp ? "Ocultar tramos" : "Ver recorrido de esta maleta"}
              className="text-gray-500 hover:text-teal transition text-[9px] shrink-0">
              {isSubLoad ? "…" : isSubExp ? "▴" : "▾"}
            </button>
            <span
              onClick={() => onShipmentClick?.({ ...sub, sub: true })}
              title="Clic: SOLO la ruta de esta maleta en el mapa"
              className="cursor-pointer">
              <span className="text-gray-500 font-mono">{pkg.base}</span>
              <span className="text-teal font-mono font-bold">{suffix}</span>
              <span className={`ml-1 text-[9px] ${subStatus[1]}`}>{subStatus[0]}</span>
            </span>
          </div>
        </td>
        <td className="py-1 text-[9px] text-gray-500 cursor-pointer"
            onClick={() => onShipmentClick?.({ ...sub, sub: true })}
            title={`${sep?.from || sub.from} → ${sep?.to || sub.to}`}>
          {airportName(sep?.from || sub.from)}
          <span className="text-gray-700 mx-1">→</span>
          {airportName(sep?.to || sub.to)}
        </td>
        <td className="py-1 text-center text-gray-400 text-[10px]">
          {sub.bags || 0}
        </td>
        <td className="py-1 text-gray-500 text-[9px] font-mono">
          {sub.flightId || "—"}
        </td>
      </tr>

      {/* Tramos del sub-lote (expandible) */}
      {isSubExp && (
        isSubLoad ? (
          <tr key={`subload-${sub.pkgId}`}>
            <td colSpan={5} className="py-1 pl-10 text-gray-600 text-[9px]">
              Cargando tramos…
            </td>
          </tr>
        ) : legs.length === 0 ? (
          <tr key={`subemp-${sub.pkgId}`}>
            <td colSpan={5} className="py-1 pl-10 text-gray-600 text-[9px]">
              Sin tramos disponibles aún
            </td>
          </tr>
        ) : (
          legs.map((leg, li) => {
            const legIcon = leg.status === "done"    ? ["●", "text-green-400"]
                          : leg.status === "current" ? ["»", "text-yellow-400"]
                          :                            ["○", "text-gray-500"];
            return (
              <tr key={`leg-${sub.pkgId}-${li}`}
                  className="border-b border-white/5 bg-[#010d1a]">
                <td className="py-0.5 pl-8 text-[8px] text-gray-700">│</td>
                <td className="py-0.5 text-[9px]">
                  <span className={`mr-1 ${legIcon[1]}`}>{legIcon[0]}</span>
                  <span className="text-gray-500 font-mono">{leg.flightId || "—"}</span>
                  {leg.finalDestination && (
                    <span className="text-green-500 ml-1 text-[8px]">● destino</span>
                  )}
                </td>
                <td className="py-0.5 text-[9px] text-gray-600"
                    title={`${leg.from} → ${leg.to}`}>
                  <span className={leg.status !== "upcoming" ? "text-gray-400" : ""}>
                    {airportName(leg.from)}
                  </span>
                  <span className="text-gray-700 mx-1">→</span>
                  <span className={leg.status === "done" ? "text-gray-400" : ""}>
                    {airportName(leg.to)}
                  </span>
                </td>
                <td className="py-0.5 text-center text-gray-700 text-[9px]">—</td>
                <td className={`py-0.5 text-[9px] font-medium ${legIcon[1]}`}>
                  {leg.status === "done"    ? "Completado"
                 : leg.status === "current" ? "En curso"
                 :                            "Pendiente"}
                </td>
              </tr>
            );
          })
        )
      )}
    </Fragment>
  );
})}
          </Fragment>
        );
      })
    ) : (
      <tr>
        <td colSpan={5} className="py-3 text-center text-gray-600 text-[10px]">
          {envioStatusFilter !== "all"
  ? "Sin paquetes para ese estado"
  : filterText
  ? "Sin coincidencias"
            : focusFlightId
              ? (focusFlightBags > 0
                  ? `El vuelo ${focusFlightId} lleva ${focusFlightBags} maletas — consultando sus paquetes…`
                  : `El vuelo ${focusFlightId} va vacío (sin maletas)`)
              : focusCodes.length
                ? "Sin paquetes para el filtro actual"
                : running ? "Esperando datos..." : "Inicia la simulación"}
        </td>
      </tr>
    )}
  </tbody>
</table>
      </div>
      )}

      {/* ── Contadores globales de maletas (Resumen) ────────────────────── */}
      {showResumen && (<>
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Maletas
        </p>
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            ["Entregadas",            delivered, "#16a34a"],
            ["En tránsito / Transb.", inTransit, "#ca8a04"],
            ["Fuera de plazo",        overdue,   "#dc2626"],
          ].map(([label, val, color]) => (
            <div key={label} className="bg-[#021020] rounded p-1">
              <p style={{ color }} className="text-lg font-bold">{val || 0}</p>
              <p className="text-gray-500 text-[10px] leading-tight">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── KPIs operacionales ──────────────────────────────────────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <div className="grid grid-cols-2 gap-1">
          {[
            ["Vuelos en Curso",       safeKpis.activeFlights],
            ["Saturación al Colapso", `${safeKpis.saturationPercent}%`],
          ].map(([label, val]) => (
            <div key={label} className="bg-[#021020] rounded p-2 text-center">
              <p className="text-2xl font-bold text-white">{val}</p>
              <p className="text-gray-500 text-[10px] uppercase">{label}</p>
            </div>
          ))}
        </div>
        {/* Llenado de flota (mismo cálculo que Reportes) y de almacenes (%) */}
        <div className="grid grid-cols-2 gap-1 mt-1">
          {[
            ["Llenado de Flota",     fleetFill == null ? "—" : `${fleetFill}%`,
              fleetFill ?? 0],
            ["Llenado de Almacenes", `${safeKpis.occupancyPercent ?? 0}%`,
              safeKpis.occupancyPercent ?? 0],
          ].map(([label, val, pct]) => (
            <div key={label} className="bg-[#021020] rounded p-2 text-center">
              {/* Semáforo: >60% amarillo, >80% rojo (regla de negocio) */}
              <p className={`text-2xl font-bold ${
                pct > 80 ? "text-red-400" : pct > 60 ? "text-yellow-400" : "text-green-400"}`}>
                {val}
              </p>
              <p className="text-gray-500 text-[10px] uppercase">{label}</p>
            </div>
          ))}
        </div>
        <div className="bg-[#021020] rounded p-2 text-center mt-1">
          <p className="text-gray-500 text-[10px] uppercase">
            Tiempo de Entrega Promedio
          </p>
          <p className="text-2xl font-bold text-white">
            {Number(safeKpis.avgDeliveryDays || 0).toFixed(2)} días
          </p>
        </div>
      </div>
      </>)}
    </div>
  );
}