import { useMemo, useState } from "react";

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
  return `PKG-${event.flightId || "XX"}-${event.minute || "00"}`;
}

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
}) {
  const [filterText, setFilterText] = useState("");

  const safeKpis = { ...EMPTY_KPIS, ...Object.fromEntries(
    Object.entries(kpis).filter(([, v]) => v !== undefined && v !== null)
  )};

  const isPlanning = message.startsWith("Planificando");

  // ── Últimos 5 eventos para el monitor de plazos ───────────────────────────
  const recentEvents = useMemo(() => {
    if (!events.length) return [];
    return [...events].reverse().slice(0, 5);
  }, [events]);

  // ── Eventos filtrados para el buscador ───────────────────────────────────
  const filteredEvents = useMemo(() => {
    if (!events.length) return [];
    let result = [...events].reverse();
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      result = result.filter(e =>
        getPackageId(e).toLowerCase().includes(q) ||
        (e.flightId && e.flightId.toLowerCase().includes(q)) ||
        (e.from && e.from.toLowerCase().includes(q)) ||
        (e.to   && e.to.toLowerCase().includes(q))
      );
    }
    return result.slice(0, 5);
  }, [events, filterText]);

  // ── Contadores globales ───────────────────────────────────────────────────
  const delivered = safeKpis.deliveredOnTime;
  const overdue   = safeKpis.outOfDeadline;
  const inTransit = (isPlanning || safeKpis.activeFlights === 0)
    ? 0
    : Math.max(0, safeKpis.routedBags - delivered - overdue);

  // ── Desglose SLA: Verde / Amarillo / Rojo calculado desde events ──────────
  // El semáforo SLA se construye 100% desde los KPIs del backend,
  // que calculan los tres estados directamente sobre los BaggageLot
  // con acceso a registrationHour, dueHour y simulatedNow.
  // Esto evita cualquier doble conteo por eventos departed+landed o transbordos.
  const slaBreakdown = {
    green:  safeKpis.slaOnTrack  ?? 0,
    yellow: safeKpis.slaCritical ?? 0,
    red:    safeKpis.outOfDeadline ?? 0,
  };

  return (
    <div className="flex flex-col gap-2 text-xs">

      {/* ── Monitor de Plazos (SLA) ─────────────────────────────────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Monitor de Plazos (SLA)
        </p>
        <table className="w-full">
          <thead>
            <tr className="text-gray-500 border-b border-white/10">
              <th className="text-left py-1">Vuelo / Ruta</th>
              <th className="text-left py-1">Tipo SLA</th>
              <th className="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {recentEvents.length > 0 ? (
              recentEvents.map((event, idx) => (
                <tr key={`sla-${getPackageId(event)}-${idx}`}
                    className="border-b border-white/5">
                  <td className="py-1.5 text-gray-300">
                    <span className="text-teal font-mono font-bold text-[10px]">
                      {event.flightId}
                    </span>
                    <br/>
                    <span className="text-gray-500">{event.from} → {event.to}</span>
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
                <td colSpan={3} className="py-4 text-center text-gray-600 text-[10px]">
                  {running ? "Esperando eventos..." : "Inicia la simulación"}
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

      {/* ── Buscador de vuelo / paquete ──────────────────────────────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Detalle del Paquete
        </p>
        <input
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
          placeholder="Busca por vuelo, aeropuerto de origen o destino..."
          className="w-full bg-[#021020] border border-white/10 rounded
                     px-2 py-1 text-xs text-gray-300 mb-2
                     focus:outline-none focus:border-teal"
        />
        <table className="w-full">
          <thead>
            <tr className="text-gray-500 border-b border-white/10">
              <th className="text-left py-1">Vuelo</th>
              <th className="text-left py-1">Ruta</th>
              <th className="text-left py-1">Maletas</th>
              <th className="text-left py-1">Estado SLA</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length > 0 ? (
              filteredEvents.map((event, idx) => (
                <tr key={`detail-${getPackageId(event)}-${idx}`}
                    className="border-b border-white/5">
                  <td className="py-1.5 text-teal font-mono font-bold text-[10px]">
                    {event.flightId || `FLT-${idx + 1}`}
                  </td>
                  <td className="py-1.5 text-gray-400">
                    {event.from} → {event.to}
                  </td>
                  <td className="py-1.5 text-gray-300">{event.bags}</td>
                  <td className="py-1.5">
                    <SLAStatusBadge event={event} simulatedMinute={simulatedMinute} />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-600 text-[10px]">
                  {filterText ? "Sin coincidencias" : "Esperando datos..."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Contadores globales de maletas ───────────────────────────────── */}
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
        <div className="bg-[#021020] rounded p-2 text-center mt-1">
          <p className="text-gray-500 text-[10px] uppercase">
            Tiempo de Entrega Promedio
          </p>
          <p className="text-2xl font-bold text-white">
            {Number(safeKpis.avgDeliveryDays || 0).toFixed(2)} días
          </p>
        </div>
      </div>
    </div>
  );
}