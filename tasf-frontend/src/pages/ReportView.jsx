import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { reportData } from "../data/mockData";

export default function ReportView() {
  return (
    <div className="p-4">
      {/* KPIs superiores */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label:"Total de Maletas",       val:reportData.totalBaggage.toLocaleString(), sub:"+12.4% vs anterior", color:"text-white"      },
          { label:"Tiempo Prom. de Envío",  val:`${reportData.avgDeliveryMin} min`,       sub:"+2.1m vs anterior",  color:"text-white"      },
          { label:"Total Replanificaciones",val:reportData.replanifications,              sub:"● Estable",          color:"text-green-400"  },
          { label:"Uso Prom. de Aeronaves", val:`${reportData.fleetUsagePct}%`,           sub:"Buena eficiencia",   color:"text-green-400"  },
        ].map(k => (
          <div key={k.label}
            className="bg-[#031525] border border-teal/20 rounded p-3">
            <p className="text-gray-500 text-[10px] uppercase mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.val}</p>
            <p className="text-gray-600 text-[10px] mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Gráfica flujo inventario */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-3">
            Evolución del Flujo de Inventario
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={reportData.inventoryFlow}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C7293" opacity={0.2}/>
              <XAxis dataKey="time" tick={{ fill:"#9DBDCC", fontSize:10 }}/>
              <YAxis tick={{ fill:"#9DBDCC", fontSize:10 }}/>
              <Tooltip
                contentStyle={{ background:"#021B33", border:"1px solid #1C7293" }}
                labelStyle={{ color:"#9DBDCC" }}/>
              <Legend wrapperStyle={{ fontSize:10 }}/>
              <Line type="monotone" dataKey="delivered"  stroke="#2A9D8F" strokeWidth={2} dot={false} name="Entregada"/>
              <Line type="monotone" dataKey="inTransit"  stroke="#F4A261" strokeWidth={2} dot={false} name="En Tránsito"/>
              <Line type="monotone" dataKey="warehouse"  stroke="#E76F51" strokeWidth={2} dot={false} name="Almacén"/>
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Cumplimiento */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-3">
            Cumplimiento
          </p>
          <div className="flex flex-col gap-3">
            {reportData.compliance.map(c => (
              <div key={c.hub}>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-300 text-xs">{c.hub}</span>
                  <span className={`text-xs font-bold ${
                    c.status === "ok" ? "text-green-400" : "text-yellow-400"}`}>
                    {c.pct}% {c.status === "ok" ? "A tiempo" : "En Riesgo"}
                  </span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${
                    c.status === "ok" ? "bg-green-500" : "bg-yellow-500"}`}
                    style={{ width:`${c.pct}%` }}/>
                </div>
              </div>
            ))}
          </div>
          <p className="text-gray-600 text-[10px] mt-3">
            Se compara cuántos pedidos fueron entregados dentro del tiempo estimado
          </p>
        </div>
      </div>

      {/* Incidente crítico */}
      <div className="mt-4 bg-[#1a0505] border border-red-800 rounded p-3">
        <p className="text-red-500 text-xs font-bold uppercase mb-2">
          ⚠ Incidente Crítico
        </p>
        <p className="text-gray-300 text-xs mb-2">
          <strong>TIMELINE:</strong> Posible colapso detectado en el día 14,
          a las 03:22 horas.
        </p>
        {[
          ["Causa",            "Sobrecarga del almacén en CDG_HUB_DELTA. Capacidad excedida en 142% por la llegada del vuelo AF022."],
          ["Efecto en cascada","4.2k maletas reenviadas al almacén de LHR. Replanificación automática."],
          ["Estado de mitigación","El sistema se recuperó a las 06:45. Las maletas llegaron dentro del plazo."],
        ].map(([t, d]) => (
          <p key={t} className="text-xs text-gray-400 mb-1">
            <span className="text-red-400 font-medium">● {t}:</span> {d}
          </p>
        ))}
      </div>
    </div>
  );
}