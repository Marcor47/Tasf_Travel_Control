import { getWarehouseColor } from "../hooks/useStatusColor";
import { STATIC_AIRPORTS }   from "../data/staticAirports";

export default function LiveMonitor({ simulation }) {
  const running  = simulation?.running  ?? false;
  const kpis     = simulation?.kpis     ?? {};
  const routes   = simulation?.routes   ?? [];
  const clock    = simulation?.clock    ?? "Dia --  00:00";
  const alerts   = simulation?.alerts   ?? [];

  // Aeropuertos: usar datos reales del backend ordenados por ocupación desc
  // Si aún no hay simulación, mostrar los estáticos con current=0
  const rawAirports = simulation?.airports?.length
      ? simulation.airports
      : STATIC_AIRPORTS;

  const airports = [...rawAirports]
      .sort((a, b) => {
        const pA = (a.current || 0) / Math.max(1, a.capacity || 1);
        const pB = (b.current || 0) / Math.max(1, b.capacity || 1);
        return pB - pA;
      })
      .slice(0, 12);

  // Vuelos activos del backend (solo departed)
  const activeFlights = routes.filter(r => r.status === "departed");

  // KPIs seguros
  const safeKpis = {
    activeFlights:     kpis.activeFlights     ?? 0,
    occupancyPercent:  kpis.occupancyPercent  ?? 0,
    saturationPercent: kpis.saturationPercent ?? 0,
    routedBags:        kpis.routedBags        ?? 0,
    totalBags:         kpis.totalBags         ?? 0,
    deliveredOnTime:   kpis.deliveredOnTime   ?? 0,
    avgDeliveryDays:   kpis.avgDeliveryDays   ?? 0,
  };

  // Llenado real de la flota = maletas en el aire / capacidad en el aire.
  // Incluye los aviones vacíos (suman capacidad pero 0 maletas), así que ya
  // no se queda clavado en 100%.
  const fleetCap  = activeFlights.reduce((s, r) => s + (r.capacity || 0), 0);
  const fleetBags = activeFlights.reduce((s, r) => s + (r.bags     || 0), 0);
  const utilizationPct = fleetCap > 0 ? Math.round(fleetBags / fleetCap * 100) : 0;

  return (
    <div className="p-4 h-full overflow-y-auto">
      {/* Header con reloj */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-teal font-bold text-base uppercase tracking-wide">
          Monitoreo en Vivo
        </h2>
        <div className="flex items-center gap-3">
          {running && (
            <span className="text-green-400 text-xs animate-pulse">
              ● En vivo
            </span>
          )}
          <span className="text-gray-400 text-xs font-mono">{clock}</span>
        </div>
      </div>

      {/* KPIs superiores */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        {[
          ["Vuelos Activos",    safeKpis.activeFlights,           "text-white"],
          ["Ocupación Red",     `${safeKpis.occupancyPercent}%`,  safeKpis.occupancyPercent  > 85 ? "text-red-400" : safeKpis.occupancyPercent  > 60 ? "text-yellow-400" : "text-white"],
          ["Saturación",        `${safeKpis.saturationPercent}%`, safeKpis.saturationPercent > 85 ? "text-red-400" : safeKpis.saturationPercent > 60 ? "text-yellow-400" : "text-white"],
          ["Llenado de Flota",  `${utilizationPct}%`,             utilizationPct > 85 ? "text-red-400" : utilizationPct > 60 ? "text-yellow-400" : "text-green-400"],
        ].map(([label, val, color]) => (
          <div key={label}
               className="bg-[#031525] border border-teal/20 rounded p-3 text-center">
            <p className={`text-2xl font-bold ${color}`}>{val}</p>
            <p className="text-gray-500 text-[10px] uppercase mt-1">{label}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Panel izquierdo: Capacidad de Almacenes */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-2">
            Capacidad de Almacenes — Top 12
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-white/10">
                <th className="text-left py-1">Aeropuerto</th>
                <th className="text-left py-1">Carga</th>
                <th className="text-left py-1">Estado</th>
              </tr>
            </thead>
            <tbody>
              {airports.map(a => {
                const capacity = Math.max(1, a.capacity || 0);
                const current  = Math.max(0, a.current  || 0);
                const pct      = Math.round(current / capacity * 100);
                const clamp    = Math.min(100, pct);
                const color    = getWarehouseColor(pct);
                const barColor = color === "green"  ? "bg-green-500"
                               : color === "amber"  ? "bg-yellow-500"
                               : "bg-red-500";
                const dot      = color === "green"  ? "bg-green-400"
                               : color === "amber"  ? "bg-yellow-400"
                               : "bg-red-400";
                return (
                  <tr key={a.code} className="border-b border-white/5">
                    <td className="py-1.5">
                      <p className="text-teal font-medium">{a.name || a.code}</p>
                      <div className="w-28 bg-white/10 rounded-full h-1 mt-1">
                        <div className={`h-1 rounded-full transition-all duration-500 ${barColor}`}
                             style={{ width: `${clamp}%` }}/>
                      </div>
                    </td>
                    <td className="py-1.5 text-gray-400">
                      {current.toLocaleString()} / {capacity.toLocaleString()}
                      <span className="text-gray-600 ml-1">({pct}%)</span>
                      {pct > 100 && <span className="text-red-400 ml-1">⚠</span>}
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

        {/* Panel derecho: Vuelos activos */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-2">
            Vuelos Activos ({activeFlights.length})
          </p>
          {activeFlights.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <p className="text-gray-600 text-xs">
                {running ? "Sin vuelos activos en este momento" : "Inicia la simulación"}
              </p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-white/10">
                  <th className="text-left py-1">#</th>
                  <th className="text-left py-1">Ruta</th>
                  <th className="text-left py-1">Maletas</th>
                  <th className="text-left py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {activeFlights.slice(0, 12).map((r, i) => (
                  <tr key={`${r.from}-${r.to}-${i}`}
                      className="border-b border-white/5">
                    <td className="py-1.5 text-gray-600">{i + 1}</td>
                    <td className="py-1.5">
                      <span className="text-teal">{r.from}</span>
                      <span className="text-gray-600 mx-1">→</span>
                      <span className="text-gray-200">{r.to}</span>
                    </td>
                    <td className="py-1.5 text-gray-400">
                      {(r.bags || 0).toLocaleString()}
                    </td>
                    <td className="py-1.5">
                      <span className="text-yellow-400 font-medium text-[10px]">
                        ✈ En vuelo
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* KPIs de maletas */}
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            {[
              ["Total Maletas",   safeKpis.totalBags.toLocaleString(),       "text-white"],
              ["Ruteadas",        safeKpis.routedBags.toLocaleString(),       "text-green-400"],
              ["Entregadas",      safeKpis.deliveredOnTime.toLocaleString(),  "text-teal"],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-[#021020] rounded p-2">
                <p className={`text-lg font-bold ${c}`}>{v}</p>
                <p className="text-gray-500 text-[10px] uppercase">{l}</p>
              </div>
            ))}
          </div>

          {/* Tiempo promedio */}
          <div className="mt-2 bg-[#021020] rounded p-2 text-center">
            <p className="text-gray-500 text-[10px] uppercase mb-1">
              Tiempo Promedio de Entrega
            </p>
            <p className="text-xl font-bold text-white">
              {Number(safeKpis.avgDeliveryDays || 0).toFixed(2)} días
            </p>
          </div>
        </div>
      </div>

      {/* ── Alertas de operación: registros de lotes y cancelaciones ──────── */}
      <div className="mt-4 bg-[#031525] border border-teal/20 rounded p-3">
        <p className="text-teal text-xs font-bold uppercase mb-2">
          Alertas de Operación
        </p>
        {alerts.length === 0 ? (
          <p className="text-gray-600 text-xs text-center py-6">
            Aquí aparecerán las altas de lotes (registro) y las cancelaciones de
            vuelos a medida que ocurran.
          </p>
        ) : (
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
            {alerts.map(a => (
              <div key={a.id}
                   className="flex items-start gap-2 text-xs bg-[#021020] rounded px-2 py-1.5">
                <span className={`flex-shrink-0 font-bold ${
                  a.type === "cancel" ? "text-red-400" : "text-green-400"}`}>
                  {a.type === "cancel" ? "✕" : "＋"}
                </span>
                <span className="text-gray-300 flex-1">{a.text}</span>
                <span className="text-gray-600 font-mono text-[10px] flex-shrink-0">
                  {a.time instanceof Date ? a.time.toLocaleTimeString("es-ES") : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
