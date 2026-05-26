import { statusLabel } from "../../hooks/useStatusColor";

function StatusDot({ s }) {
  const st = statusLabel[s] || statusLabel.ok;
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded
                      ${st.bg} text-white`}>
      <span className={`w-2 h-2 rounded-full ${st.dot}`}/>
      {st.text}
    </span>
  );
}

function eventStatus(event) {
  if (event.type === "landed" && event.finalDestination) return "ok";
  if (event.type === "landed") return "transit";
  return "alert";
}

// Kpis vacíos para mostrar cuando no hay simulación activa
const EMPTY_KPIS = {
  activeFlights:      0,
  saturationPercent:  0,
  occupancyPercent:   0,
  avgDeliveryDays:    0,
  replanifications:   0,
  deliveredOnTime:    0,
  atRisk:             0,
  outOfDeadline:      0,
  totalBags:          0,
  routedBags:         0,
};

export default function SLAMonitor({ kpis = {}, events = [], running = false }) {
  // Nunca mostrar mock — usar zeros hasta que la simulación mande datos reales
  const safeKpis = {
    ...EMPTY_KPIS,
    ...Object.fromEntries(
      Object.entries(kpis).filter(([, v]) => v !== undefined && v !== null)
    ),
  };

  // Solo los últimos 5 eventos, más recientes primero
  const liveEvents = events.length ? [...events].reverse().slice(0, 5) : [];

  return (
    <div className="flex flex-col gap-2 text-xs">

      {/* Monitor de Plazos (SLA) */}
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
              liveEvents.map((event, idx) => (
                <tr key={`${event.minute}-${event.type}-${idx}`}
                    className="border-b border-white/5">
                  <td className="py-1 text-gray-300">
                    {event.type === "landed" ? "ARR" : "DEP"}-{idx + 1}
                  </td>
                  <td className="py-1 text-gray-400">
                    {event.from} - {event.to} ({event.bags})
                  </td>
                  <td className="py-1">
                    <StatusDot s={eventStatus(event)}/>
                  </td>
                </tr>
              ))
            ) : (
              // Sin simulación activa: mostrar placeholder vacío
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

      {/* Detalle del Paquete */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Detalle del Paquete
        </p>
        <input
          placeholder="Ingrese numero de paquete o maleta"
          className="w-full bg-[#021020] border border-white/10 rounded
                     px-2 py-1 text-xs text-gray-300 mb-2
                     focus:outline-none focus:border-teal"/>
        <table className="w-full">
          <thead>
            <tr className="text-gray-500 border-b border-white/10">
              <th className="text-left py-1">Maleta</th>
              <th className="text-left py-1">Lote</th>
              <th className="text-left py-1">Cliente</th>
              <th className="text-left py-1">Estado</th>
            </tr>
          </thead>
          <tbody>
            {/* Sin mock: tabla vacía hasta que haya búsqueda real */}
            <tr>
              <td colSpan={4}
                  className="py-3 text-center text-gray-600 text-[10px]">
                Busque por ID de paquete
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Contadores Maletas */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Maletas
        </p>
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            ["Entregadas",     safeKpis.deliveredOnTime, "text-green-400"],
            ["En Riesgo",      safeKpis.atRisk,          "text-yellow-400"],
            ["Fuera de plazo", safeKpis.outOfDeadline,   "text-red-400"],
          ].map(([label, val, color]) => (
            <div key={label} className="bg-[#021020] rounded p-1">
              <p className={`text-lg font-bold ${color}`}>{val}</p>
              <p className="text-gray-500 text-[10px]">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* KPIs operacionales */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <div className="grid grid-cols-2 gap-1">
          {[
            ["Vuelos en Curso",       safeKpis.activeFlights,          ""],
            ["Saturacion al Colapso", `${safeKpis.saturationPercent}%`, ""],
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
