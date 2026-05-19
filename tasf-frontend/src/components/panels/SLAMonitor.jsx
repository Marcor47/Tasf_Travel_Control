import { packages, baggage, kpis } from "../../data/mockData";
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

export default function SLAMonitor() {
  return (
    <div className="flex flex-col gap-2 text-xs">
      {/* Monitor de plazos */}
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
            {packages.map(p => (
              <tr key={p.id} className="border-b border-white/5">
                <td className="py-1 text-gray-300">{p.id}</td>
                <td className="py-1 text-gray-400">
                  {p.origin} → {p.destination}
                </td>
                <td className="py-1">
                  <StatusDot s={p.status}/>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Detalle del paquete */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Detalle del Paquete
        </p>
        <input placeholder="Ingrese número de paquete o maleta"
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
            {baggage.map(b => (
              <tr key={b.id} className="border-b border-white/5">
                <td className="py-1 text-gray-300">{b.id}</td>
                <td className="py-1 text-gray-400">{b.lot}</td>
                <td className="py-1 text-gray-400">{b.client}</td>
                <td className="py-1"><StatusDot s={b.status}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Contadores maletas */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Maletas
        </p>
        <div className="grid grid-cols-3 gap-1 text-center">
          {[
            ["Entregadas",     kpis.deliveredOnTime, "text-green-400"],
            ["En Riesgo",      kpis.atRisk,          "text-yellow-400"],
            ["Fuera de plazo", kpis.outOfDeadline,   "text-red-400"],
          ].map(([label, val, color]) => (
            <div key={label} className="bg-[#021020] rounded p-1">
              <p className={`text-lg font-bold ${color}`}>{val}</p>
              <p className="text-gray-500 text-[10px]">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <div className="grid grid-cols-2 gap-1">
          {[
            ["Vuelos en Curso",        kpis.activeFlights,      ""],
            ["Saturación al Colapso",  kpis.saturationPercent+"%",""],
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
            {kpis.avgDeliveryDays} días
          </p>
        </div>
      </div>
    </div>
  );
}