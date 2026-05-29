import { useMemo } from "react";

// ── Lógica de 3 estados SLA ──────────────────────────────────────────────────
// Verde  → entregado (landed en destino final)
// Amarillo → en tránsito / aún no se entrega
// Rojo   → pasó el plazo (outOfDeadline / tardiness > 0)

function slaStatus(event, simulatedNow) {
  // Rojo: el evento tiene tardiness marcado por el backend
  if (event.overDeadline) return "red";

  // Rojo: si tiene dueMinute y ya pasó ese límite y aún no llegó
  if (event.dueMinute && event.minute > event.dueMinute) return "red";

  // Verde: aterrizó en destino final
  if (event.type === "landed" && event.finalDestination) return "green";

  // Amarillo: cualquier estado intermedio (en vuelo, escala, esperando)
  return "yellow";
}

const STATUS_CONFIG = {
  green:  { bg: "#16a34a", dot: "#bbf7d0", text: "Entregado"  },
  yellow: { bg: "#ca8a04", dot: "#fef08a", text: "En tránsito" },
  red:    { bg: "#dc2626", dot: "#fecaca", text: "Fuera de plazo" },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.yellow;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, padding: "2px 6px", borderRadius: 4,
      background: cfg.bg, color: "#fff", whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: cfg.dot, flexShrink: 0,
      }}/>
      {cfg.text}
    </span>
  );
}

// ── KPIs vacíos ──────────────────────────────────────────────────────────────
const EMPTY_KPIS = {
  activeFlights: 0, saturationPercent: 0, occupancyPercent: 0,
  avgDeliveryDays: 0, replanifications: 0, deliveredOnTime: 0,
  atRisk: 0, outOfDeadline: 0, totalBags: 0, routedBags: 0,
};

export default function SLAMonitor({ kpis = {}, events = [], running = false, simulatedNow = 0 }) {
  const safeKpis = {
    ...EMPTY_KPIS,
    ...Object.fromEntries(
      Object.entries(kpis).filter(([, v]) => v !== undefined && v !== null)
    ),
  };

  // Últimos 5 eventos, más recientes primero
  const liveEvents = useMemo(
    () => (events.length ? [...events].reverse().slice(0, 5) : []),
    [events]
  );

  // ── Contadores de maletas con 3 estados ─────────────────────────────────
  // Verde  = deliveredOnTime
  // Amarillo = en tránsito (ruteadas pero aún no entregadas)
  // Rojo   = outOfDeadline
  const delivered = safeKpis.deliveredOnTime;
  const overdue   = safeKpis.outOfDeadline;
  const inTransit = Math.max(0, safeKpis.routedBags - delivered - overdue);

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
              <th className="text-left py-1">Paquete</th>
              <th className="text-left py-1">Ruta</th>
              <th className="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {liveEvents.length > 0 ? (
              liveEvents.map((event, idx) => {
                const status = slaStatus(event, simulatedNow);
                return (
                  <tr key={`${event.minute}-${event.type}-${idx}`}
                      className="border-b border-white/5">
                    <td className="py-1 text-gray-300">
                      {event.type === "landed" ? "ARR" : "DEP"}-{idx + 1}
                    </td>
                    <td className="py-1 text-gray-400">
                      {event.from} → {event.to} ({event.bags})
                    </td>
                    <td className="py-1">
                      <StatusBadge status={status} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={3}
                    className="py-4 text-center text-gray-600 text-[10px]">
                  {running ? "Esperando eventos..." : "Inicia la simulación"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Detalle del Paquete ─────────────────────────────────────────── */}
      {/* Muestra filas de todos los eventos aunque no se busque por ID     */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Detalle del Paquete
        </p>
        <input
          placeholder="Filtrar por número de paquete o maleta (opcional)"
          className="w-full bg-[#021020] border border-white/10 rounded
                     px-2 py-1 text-xs text-gray-300 mb-2
                     focus:outline-none focus:border-teal"/>
        <table className="w-full">
          <thead>
            <tr className="text-gray-500 border-b border-white/10">
              <th className="text-left py-1">Vuelo</th>
              <th className="text-left py-1">Ruta</th>
              <th className="text-left py-1">Maletas</th>
              <th className="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {liveEvents.length > 0 ? (
              liveEvents.map((event, idx) => {
                const status = slaStatus(event, simulatedNow);
                return (
                  <tr key={`detail-${event.minute}-${idx}`}
                      className="border-b border-white/5">
                    <td className="py-1 text-gray-300 font-mono text-[10px]">
                      {event.flightId || `FLT-${idx + 1}`}
                    </td>
                    <td className="py-1 text-gray-400">
                      {event.from} → {event.to}
                    </td>
                    <td className="py-1 text-gray-300">{event.bags}</td>
                    <td className="py-1">
                      <StatusBadge status={status} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4}
                    className="py-3 text-center text-gray-600 text-[10px]">
                  {running ? "Esperando datos..." : "Inicia la simulación"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Contadores Maletas — 3 estados ─────────────────────────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Maletas
        </p>
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            ["Entregadas",      delivered, "#16a34a"],
            ["En tránsito",     inTransit, "#ca8a04"],
            ["Fuera de plazo",  overdue,   "#dc2626"],
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
            {Number(safeKpis.avgDeliveryDays || 0).toFixed(2)} dias
          </p>
        </div>
      </div>
    </div>
  );
}