import { useMemo, useState } from "react";
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

const parseLotId = (lotId) => {
  const m = /^(.+)-(\d+)$/.exec(lotId || "");
  return m ? { base: m[1], suffix: `-${m[2]}` } : { base: lotId || "—", suffix: "" };
};

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
  view = "all",
  selectedShipment = null, onShipmentClick,
  searchText, onSearchChange,
  fleetFill = null,
  fetchShipmentPaths = null,
}) {
  const [internalFilter, setInternalFilter] = useState("");
  const [slaSearch, setSlaSearch] = useState("");
  const [expandedLot, setExpandedLot]   = useState(null);
const [lotPaths,    setLotPaths]       = useState({});
const [loadingLot,  setLoadingLot]     = useState(null);



const expandLot = async (lotId) => {
  if (expandedLot === lotId) { setExpandedLot(null); return; }
  setExpandedLot(lotId);
  if (lotPaths[lotId]) return;  // ya cargado
  if (!fetchShipmentPaths) return;
  setLoadingLot(lotId);
  try {
    const paths = await fetchShipmentPaths(lotId);
    setLotPaths(p => ({ ...p, [lotId]: paths ?? [] }));
  } catch (e) {
    setLotPaths(p => ({ ...p, [lotId]: [] }));
  } finally {
    setLoadingLot(null);
  }
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
    return list.slice(0, slaSearch.trim() ? 20 : 5);
  }, [focusedEvents, slaSearch]);

  // ── Una fila por PAQUETE (lote), con su ID real (lotId) ───────────────────
  // El lote es la unidad: todas sus maletas viajan juntas por la misma ruta
  // (con transbordos). Deduplicamos por lotId y mostramos el ID real.
const bagLevelDetails = useMemo(() => {
  if (!focusedEvents.length) return [];

  const byLot = new Map();
  for (const e of focusedEvents) {
    const lotId = e.lotId || getPackageId(e);
    if (!byLot.has(lotId) || e.minute > byLot.get(lotId).minute) {
      byLot.set(lotId, { ...e, pkgId: lotId });
    }
  }

  let result = [...byLot.values()].sort((a, b) => b.minute - a.minute);

  if (filterText.trim()) {
    const norm = s => (s||"").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const q = norm(filterText.trim());
    result = result.filter(b => {
      const ep = lotEndpoints.get(b.pkgId);
      const om = AIRPORT_META[ep?.from || b.from] || {};
      const dm = AIRPORT_META[ep?.to   || b.to]   || {};
      return [b.pkgId, b.flightId, ep?.from || b.from, ep?.to || b.to,
              om.name, om.country, dm.name, dm.country]
        .some(s => norm(s).includes(q));
    });
  }

  return result.slice(0, 30);
}, [focusedEvents, filterText, lotEndpoints]);

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
                  {focusFlightId
                    ? `El vuelo ${focusFlightId} no lleva paquetes registrados (vacío)`
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
          <p className="text-yellow-400/80 text-[10px] mb-2 leading-tight">
            El vuelo {focusFlightId} aún no registra paquetes (en vuelo o vacío) —
            mostrando los que pasan por su origen/destino.
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
    {bagLevelDetails.length > 0 ? (
      bagLevelDetails.map((bag, idx) => {
        const ep       = lotEndpoints.get(bag.pkgId);
        const origin   = ep?.from || bag.from;
        const dest     = ep?.to   || bag.to;
        const { base, suffix } = parseLotId(bag.pkgId);
        const isSel    = selectedShipment?.bagId === bag.pkgId;
        const isExp    = expandedLot === bag.pkgId;
        const isLoading = loadingLot === bag.pkgId;
        const paths    = lotPaths[bag.pkgId] ?? [];

        // Estado global del sub-lote basado en su evento más reciente
        const isDelivered = bag.type === "landed" && bag.finalDestination;
        const isInAir     = bag.type === "departed";
        const globalStatus = isDelivered ? ["✓ Entregado",  "text-green-400"]
                           : isInAir     ? ["✈ En vuelo",   "text-yellow-400"]
                           :               ["⇄ En escala",  "text-blue-400"];

        return (
          <>
            {/* ── Fila del paquete (nivel 1) ── */}
            <tr key={`pkg-${bag.pkgId}-${idx}`}
                className={`border-b border-white/5 transition
                  ${isSel ? "bg-teal/10" : "hover:bg-white/5"}`}>
              <td className="py-1.5">
                <button onClick={() => expandLot(bag.pkgId)}
                  className="text-gray-500 hover:text-teal transition text-[10px] px-1">
                  {isLoading ? "…" : isExp ? "▴" : "▾"}
                </button>
              </td>
              <td className="py-1.5 text-[10px] cursor-pointer"
                  onClick={() => onShipmentClick?.(bag)}>
                <span className="text-gray-300 font-mono font-bold">{base}</span>
                {suffix && <span className="text-teal font-mono">{suffix}</span>}
                <span className={`ml-1.5 text-[9px] ${globalStatus[1]}`}>
                  {globalStatus[0]}
                </span>
              </td>
              <td className="py-1.5 text-[10px] text-gray-400 cursor-pointer"
                  onClick={() => onShipmentClick?.(bag)}
                  title={`${origin} → ${dest}`}>
                <span className="text-gray-300">{airportName(origin)}</span>
                <span className="text-gray-600 mx-1">→</span>
                <span className="text-gray-300">{airportName(dest)}</span>
              </td>
              <td className="py-1.5 text-center text-gray-300 font-bold text-[10px]">
                {bag.bags || 0}
              </td>
              <td className="py-1.5">
                <SLAStatusBadge event={{ ...bag, from: origin, to: dest }}
                                simulatedMinute={simulatedMinute} />
              </td>
            </tr>

            {/* ── Filas de tramos (nivel 2, expandible) ── */}
            {isExp && (
              isLoading ? (
                <tr key={`loading-${bag.pkgId}`}>
                  <td colSpan={5} className="py-1 pl-6 text-gray-600 text-[10px]">
                    Cargando tramos…
                  </td>
                </tr>
              ) : paths.length === 0 ? (
                <tr key={`empty-${bag.pkgId}`}>
                  <td colSpan={5} className="py-1 pl-6 text-gray-600 text-[10px]">
                    Sin tramos disponibles
                  </td>
                </tr>
              ) : (
                paths.flatMap((path, pi) =>
                  (path.legs ?? []).map((leg, li) => {
                    const statusIcon = leg.status === "done"     ? ["✓", "text-green-400"]
                                     : leg.status === "current"  ? ["✈", "text-yellow-400"]
                                     :                             ["○", "text-gray-500"];
                    return (
                      <tr key={`leg-${bag.pkgId}-${pi}-${li}`}
                          className="border-b border-white/5 bg-[#021020]/40">
                        <td className="py-1 pl-4 text-[9px] text-gray-600">└</td>
                        <td className="py-1 text-[9px]">
                          <span className={`mr-1 ${statusIcon[1]}`}>{statusIcon[0]}</span>
                          <span className="text-gray-500 font-mono">{leg.flightId || "—"}</span>
                        </td>
                        <td className="py-1 text-[9px] text-gray-500"
                            title={`${leg.from} → ${leg.to}`}>
                          <span>{airportName(leg.from)}</span>
                          <span className="text-gray-700 mx-1">→</span>
                          <span>{airportName(leg.to)}</span>
                          {leg.finalDestination && (
                            <span className="text-green-500 ml-1">★</span>
                          )}
                        </td>
                        <td className="py-1 text-center text-gray-600 text-[9px]">—</td>
                        <td className="py-1 text-gray-600 text-[9px] font-mono">
                          {leg.status === "done"    ? "Completado"
                         : leg.status === "current" ? "En curso"
                         :                            "Pendiente"}
                        </td>
                      </tr>
                    );
                  })
                )
              )
            )}
          </>
        );
      })
    ) : (
      <tr>
        <td colSpan={5} className="py-3 text-center text-gray-600 text-[10px]">
          {filterText
            ? "Sin coincidencias"
            : focusFlightId
              ? `El vuelo ${focusFlightId} no lleva paquetes registrados`
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
              <p className={`text-2xl font-bold ${
                pct > 85 ? "text-red-400" : pct > 60 ? "text-yellow-400" : "text-white"}`}>
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