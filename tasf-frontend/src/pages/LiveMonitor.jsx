import { airports as mockAirports, fleetStatus, kpis as mockKpis } from "../data/mockData";
import { getWarehouseColor } from "../hooks/useStatusColor";

export default function LiveMonitor({ simulation }) {
  const airports = simulation?.airports?.length ? simulation.airports : mockAirports;
  const routes = simulation?.routes?.length ? simulation.routes : [];
  const kpis = { ...mockKpis, ...(simulation?.kpis || {}) };

  return (
    <div className="p-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-2">
            Capacidad de Almacenes - Distribucion en Vivo
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-1">Ubicacion</th>
                <th className="text-left py-1">Capacidad</th>
                <th className="text-left py-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {airports.slice(0, 10).map(a => {
                const capacity = Math.max(1, a.capacity || 0);
                const current = Math.max(0, a.current || 0);
                const pct = Math.min(100, Math.round(current / capacity * 100));
                const color = getWarehouseColor(pct);
                const dot = color === "green" ? "bg-green-400"
                  : color === "amber" ? "bg-yellow-400"
                  : "bg-red-400";
                return (
                  <tr key={a.code} className="border-b border-white/5">
                    <td className="py-1.5">
                      <p className="text-teal font-medium">{a.name || a.code}</p>
                      <div className="w-24 bg-white/10 rounded-full h-1 mt-1">
                        <div className={`h-1 rounded-full ${
                          color === "green" ? "bg-green-500"
                          : color === "amber" ? "bg-yellow-500"
                          : "bg-red-500"}`}
                          style={{ width: `${pct}%` }}/>
                      </div>
                    </td>
                    <td className="py-1.5 text-gray-400">
                      {current} / {capacity} ({pct}%)
                    </td>
                    <td className="py-1.5">
                      <span className={`w-2.5 h-2.5 rounded-full inline-block ${dot}`}/>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <div className="flex justify-between items-center mb-2">
            <p className="text-teal text-xs font-bold uppercase">
              Estado de la Flota
            </p>
            <span className="text-[10px] text-gray-500">
              {simulation?.clock || "Dia --  00:00"}
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-1">ID</th>
                <th className="text-left py-1">Ruta</th>
                <th className="text-left py-1">Maletas</th>
                <th className="text-left py-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {routes.length ? routes.slice(0, 8).map((route, idx) => (
                <tr key={`${route.from}-${route.to}-${idx}`} className="border-b border-white/5">
                  <td className="py-1.5 text-gray-300">SIM-{idx + 1}</td>
                  <td className="py-1.5 text-gray-400">{route.from} - {route.to}</td>
                  <td className="py-1.5 text-gray-400">{route.bags}</td>
                  <td className="py-1.5">
                    <span className={`font-bold text-xs ${
                      route.status === "landed" ? "text-green-400" : "text-yellow-400"}`}>
                      {route.status === "landed" ? "Aterrizado" : "En vuelo"}
                    </span>
                  </td>
                </tr>
              )) : fleetStatus.map(f => (
                <tr key={f.id} className="border-b border-white/5">
                  <td className="py-1.5 text-gray-300">{f.id}</td>
                  <td className="py-1.5 text-gray-400">{f.route}</td>
                  <td className="py-1.5 text-gray-400">{f.used} / {f.capacity}</td>
                  <td className="py-1.5">
                    <span className={`font-bold text-xs ${
                      f.pct >= 90 ? "text-red-400"
                      : f.pct >= 70 ? "text-yellow-400"
                      : "text-green-400"}`}>
                      {f.pct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            {[
              ["Vuelos Activos",      kpis.activeFlights, "text-white"],
              ["Ocupacion Red",       `${kpis.occupancyPercent}%`, "text-yellow-400"],
              ["Ruteadas",            kpis.routedBags || 0, "text-green-400"],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-[#021020] rounded p-2">
                <p className={`text-lg font-bold ${c}`}>{v}</p>
                <p className="text-gray-500 text-[10px] uppercase">{l}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
