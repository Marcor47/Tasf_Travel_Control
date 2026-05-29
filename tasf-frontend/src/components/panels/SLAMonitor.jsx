import { useMemo, useState } from "react";

// ── Lógica de Configuración Visual (Colores del SLA) ─────────────────────────
const STATUS_CONFIG = {
  green:  { bg: "#16a34a", dot: "#bbf7d0" },
  yellow: { bg: "#ca8a04", dot: "#fef08a" },
  red:    { bg: "#dc2626", dot: "#fecaca" },
};

// Componente Badge que calcula dinámicamente el texto según las reglas del historial
// pero hereda los colores del SLA (Amarillo para En tránsito y Transbordo)
function SLAStatusBadge({ event }) {
  let status = "yellow";
  
  // 1. Determinar color del semáforo SLA
  if (event.overDeadline) {
    status = "red";
  } else if (event.dueMinute && event.minute > event.dueMinute) {
    status = "red";
  } else if (event.type === "landed" && event.finalDestination) {
    status = "green";
  }

  // 2. Determinar texto específico del estado operativo
  let text = "En tránsito";
  if (status === "green") {
    text = "Entregado";
  } else if (status === "red") {
    text = "Fuera de plazo";
  } else if (event.type === "landed" && !event.finalDestination) {
    // Si ha aterrizado pero no es destino final, es un Transbordo (mantiene color amarillo)
    text = "Transbordo";
  }

  const cfg = STATUS_CONFIG[status];

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
      {text}
    </span>
  );
}

const EMPTY_KPIS = {
  activeFlights: 0, saturationPercent: 0, occupancyPercent: 0,
  avgDeliveryDays: 0, replanifications: 0, deliveredOnTime: 0,
  atRisk: 0, outOfDeadline: 0, totalBags: 0, routedBags: 0,
};

// ── Generador de ID Único Consistente ────────────────────────────────────────
function getPackageId(event) {
  if (event.packageId) return event.packageId;
  return `PKG-${event.flightId || "XX"}-${event.minute || "00"}`;
}

export default function SLAMonitor({ kpis = {}, events = [], running = false, message = "" }) {
  const [filterText, setFilterText] = useState("");

  const safeKpis = {
    ...EMPTY_KPIS,
    ...Object.fromEntries(
      Object.entries(kpis).filter(([, v]) => v !== undefined && v !== null)
    ),
  };

  const isPlanning = message.startsWith("Planificando");

  // ── 1. Lista Fija para Monitor de Plazos (SLA) ──
  const recentEvents = useMemo(() => {
    if (!events.length) return [];
    return [...events].reverse().slice(0, 5);
  }, [events]);

  // ── 2. Lista Filtrada EXCLUSIVA para Detalle del Paquete ──
  const filteredEvents = useMemo(() => {
    if (!events.length) return [];
    
    let result = [...events].reverse();

    if (filterText.trim()) {
      const query = filterText.toLowerCase();
      result = result.filter(event => {
        const pkgId = getPackageId(event).toLowerCase();
        return (
          pkgId.includes(query) ||
          (event.flightId && event.flightId.toLowerCase().includes(query)) ||
          (event.from && event.from.toLowerCase().includes(query)) ||
          (event.to && event.to.toLowerCase().includes(query))
        );
      });
    }

    return result.slice(0, 5);
  }, [events, filterText]);

  // ── Contadores de maletas calculados ──
  const delivered = safeKpis.deliveredOnTime;
  const overdue   = safeKpis.outOfDeadline;
  
  const inTransit = (isPlanning || safeKpis.activeFlights === 0)
    ? 0
    : Math.max(0, safeKpis.routedBags - delivered - overdue);

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
              <th className="text-left py-1">Paquete ID</th>
              <th className="text-left py-1">Ruta</th>
              <th className="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {recentEvents.length > 0 ? (
              recentEvents.map((event, idx) => {
                const pkgId = getPackageId(event);
                return (
                  <tr key={`sla-${pkgId}-${idx}`} className="border-b border-white/5">
                    <td className="py-1 text-teal font-mono font-bold">
                      {pkgId}
                    </td>
                    <td className="py-1 text-gray-400">
                      {event.from} → {event.to} ({event.bags} maletas)
                    </td>
                    <td className="py-1">
                      <SLAStatusBadge event={event} />
                    </td>
                  </tr>
                );
              })
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

      {/* ── Detalle del Paquete (Buscador Operacional Exclusivo) ─────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Detalle del Paquete
        </p>
        <input
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="Busca por ID de paquete (ej. PKG...), vuelo o aeropuerto..."
          className="w-full bg-[#021020] border border-white/10 rounded
                     px-2 py-1 text-xs text-gray-300 mb-2
                     focus:outline-none focus:border-teal"
        />
        <table className="w-full">
          <thead>
            <tr className="text-gray-500 border-b border-white/10">
              <th className="text-left py-1">Paquete / Vuelo</th>
              <th className="text-left py-1">Ruta</th>
              <th className="text-left py-1">Maletas</th>
              <th className="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.length > 0 ? (
              filteredEvents.map((event, idx) => {
                const pkgId = getPackageId(event);
                return (
                  <tr key={`detail-${pkgId}-${idx}`} className="border-b border-white/5">
                    <td className="py-1 font-mono text-[10px]">
                      <span className="text-teal font-bold">{pkgId}</span>
                      <br/>
                      <span className="text-gray-500">{event.flightId || `FLT-${idx + 1}`}</span>
                    </td>
                    <td className="py-1 text-gray-400">
                      {event.from} → {event.to}
                    </td>
                    <td className="py-1 text-gray-300">{event.bags}</td>
                    <td className="py-1">
                      <SLAStatusBadge event={event} />
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td colSpan={4} className="py-3 text-center text-gray-600 text-[10px]">
                  {filterText ? "No se encontraron coincidencias" : "Esperando datos..."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Contadores Maletas — 3 estados unificados ───────────────────── */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Maletas
        </p>
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            ["Entregadas",            delivered, "#16a34a"],
            ["En tránsito / Transb.", inTransit, "#ca8a04"], // Nombre de etiqueta ajustado
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