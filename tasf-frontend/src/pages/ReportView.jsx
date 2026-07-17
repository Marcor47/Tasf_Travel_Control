import { useState, useEffect, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { AlertTriangle, Check, X } from "lucide-react";

export default function ReportView({ simulation }) {
  const kpis    = simulation?.kpis    ?? {};
  const running = simulation?.running ?? false;
  const clock   = simulation?.clock   ?? "";
  const block   = simulation?.block   ?? 0;

  // Plan de ruteo del ÚLTIMO bloque planificado (el backend solo conserva el
  // último — sin histórico en RAM). Se refresca al cambiar de bloque, al
  // detener/terminar, y de fondo mientras corre (por replanes de día a día).
  const [blockPlan, setBlockPlan] = useState(null);
  const [planQuery, setPlanQuery] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const p = await simulation?.fetchLastBlockPlan?.();
      if (alive && p) setBlockPlan(p);
    };
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, running]);

  // Acumular puntos de la gráfica a lo largo de la simulación
  const [flowHistory, setFlowHistory] = useState([]);
  const prevClock = useRef("");

  useEffect(() => {
    if (!running) return;
    if (clock === prevClock.current) return;
    prevClock.current = clock;

    setFlowHistory(h => {
      const point = {
        time:      clock.split("  ")[1] || clock,
        entregadas: kpis.deliveredOnTime  ?? 0,
        ruteadas:   kpis.routedBags       ?? 0,
        enRiesgo:   kpis.atRisk           ?? 0,
      };
      const next = [...h, point];
      return next.slice(-48); // mantener últimos 48 puntos (2 días a 1h)
    });
  }, [clock, running, kpis]);

  // Limpiar al reiniciar
  useEffect(() => {
    if (running) setFlowHistory([]);
  }, [running]);

  const safeKpis = {
    totalBags:        kpis.totalBags        ?? 0,
    routedBags:       kpis.routedBags       ?? 0,
    deliveredOnTime:  kpis.deliveredOnTime  ?? 0,
    atRisk:           kpis.atRisk           ?? 0,
    outOfDeadline:    kpis.outOfDeadline    ?? 0,
    replanifications: kpis.replanifications ?? 0,
    occupancyPercent: kpis.occupancyPercent ?? 0,
    avgDeliveryDays:  kpis.avgDeliveryDays  ?? 0,
    activeFlights:    kpis.activeFlights    ?? 0,
  };

  // Llenado real de la flota = maletas en el aire / capacidad en el aire
  // (incluye aviones vacíos, así no se queda clavado en 100%).
  const activeRoutes = (simulation?.routes ?? []).filter(r => r.status === "departed");
  const fleetCapTot  = activeRoutes.reduce((s, r) => s + (r.capacity || 0), 0);
  const fleetBagsTot = activeRoutes.reduce((s, r) => s + (r.bags     || 0), 0);
  const fleetUsage   = fleetCapTot > 0 ? Math.round(fleetBagsTot / fleetCapTot * 100) : 0;

  const onTimePct = safeKpis.routedBags > 0
      ? Math.round(safeKpis.deliveredOnTime / safeKpis.routedBags * 100)
      : 0;

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-teal font-bold text-base uppercase tracking-wide">
          Reporte de Rendimiento
        </h2>
        {!running && flowHistory.length === 0 && (
          <span className="text-gray-600 text-xs">
            Inicia la simulación para ver datos
          </span>
        )}
        {running && (
          <span className="text-green-400 text-xs animate-pulse">
            ● Actualizando en vivo
          </span>
        )}
      </div>

      {/* KPIs principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          {
            label: "Total Maletas",
            val:   safeKpis.totalBags.toLocaleString(),
            sub:   `${safeKpis.routedBags.toLocaleString()} ruteadas`,
            color: "text-white",
          },
          {
            label: "Tiempo Prom. Entrega",
            val:   `${Number(safeKpis.avgDeliveryDays).toFixed(2)} días`,
            sub:   `${safeKpis.activeFlights} vuelos activos`,
            color: "text-white",
          },
          {
            label: "Replanificaciones",
            val:   safeKpis.replanifications,
            sub:   safeKpis.replanifications === 0 ? "● Estable" : "● Activo",
            color: safeKpis.replanifications > 0 ? "text-yellow-400" : "text-green-400",
          },
          {
            label: "Llenado de Flota",
            val:   `${fleetUsage}%`,
            sub:   `Ocupación red: ${safeKpis.occupancyPercent}%`,
            color: fleetUsage > 80 ? "text-red-400"
                 : fleetUsage > 60 ? "text-yellow-400"
                 : "text-green-400",
          },
        ].map(k => (
          <div key={k.label}
               className="bg-[#031525] border border-teal/20 rounded p-3">
            <p className="text-gray-500 text-[10px] uppercase mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.val}</p>
            <p className="text-gray-600 text-[10px] mt-1">{k.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Gráfica de flujo en tiempo real */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-3">
            Evolución del Flujo de Maletas
          </p>
          {flowHistory.length < 2 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-gray-600 text-xs">
                {running ? "Acumulando datos..." : "Sin datos de simulación"}
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={flowHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1C7293" opacity={0.2}/>
                <XAxis dataKey="time"
                  tick={{ fill:"#9DBDCC", fontSize:9 }}
                  interval="preserveStartEnd"/>
                <YAxis tick={{ fill:"#9DBDCC", fontSize:9 }}/>
                <Tooltip
                  contentStyle={{ background:"#021B33", border:"1px solid #1C7293" }}
                  labelStyle={{ color:"#9DBDCC" }}/>
                <Legend wrapperStyle={{ fontSize:10 }}/>
                <Line type="monotone" dataKey="entregadas"
                  stroke="#2A9D8F" strokeWidth={2} dot={false} name="Entregadas"/>
                <Line type="monotone" dataKey="ruteadas"
                  stroke="#F4A261" strokeWidth={2} dot={false} name="Ruteadas"/>
                <Line type="monotone" dataKey="enRiesgo"
                  stroke="#E76F51" strokeWidth={2} dot={false} name="En Riesgo"/>
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Cumplimiento */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-3">
            Cumplimiento
          </p>
          <div className="flex flex-col gap-3">
            {[
              {
                label:  "Maletas Entregadas a Tiempo",
                pct:    onTimePct,
                status: onTimePct >= 80 ? "ok" : "risk",
              },
              {
                label:  "Maletas Ruteadas",
                pct:    safeKpis.totalBags > 0
                        ? Math.round(safeKpis.routedBags / safeKpis.totalBags * 100)
                        : 0,
                status: "ok",
              },
              {
                label:  "Ocupación de Almacenes",
                pct:    safeKpis.occupancyPercent,
                status: safeKpis.occupancyPercent > 85 ? "risk" : "ok",
              },
              {
                label:  "Maletas Sin Incidentes",
                pct:    safeKpis.totalBags > 0
                        ? Math.round((safeKpis.totalBags - safeKpis.atRisk)
                                      / safeKpis.totalBags * 100)
                        : 100,
                status: safeKpis.atRisk > 0 ? "risk" : "ok",
              },
            ].map(c => (
              <div key={c.label}>
                <div className="flex justify-between mb-1">
                  <span className="text-gray-300 text-xs">{c.label}</span>
                  <span className={`text-xs font-bold inline-flex items-center gap-1 ${
                    c.status === "ok" ? "text-green-400" : "text-yellow-400"}`}>
                    {c.pct}% {c.status === "ok"
                      ? <Check size={11} className="shrink-0"/>
                      : <AlertTriangle size={11} className="shrink-0"/>}
                  </span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full transition-all duration-700 ${
                    c.status === "ok" ? "bg-green-500" : "bg-yellow-500"}`}
                    style={{ width: `${Math.min(100, c.pct)}%` }}/>
                </div>
              </div>
            ))}
          </div>
          <p className="text-gray-600 text-[10px] mt-4">
            Datos calculados en tiempo real durante la simulación activa.
          </p>
        </div>
      </div>

      {/* ── Plan de ruteo del último bloque planificado ────────────────────
          Solo se conserva EL ÚLTIMO plan (el backend lo sobrescribe por bloque
          para no acumular RAM). Persiste al detener/terminar la simulación. */}
      {blockPlan && blockPlan.lots?.length > 0 && (
        <div className="mt-4 bg-[#031525] border border-teal/20 rounded p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p className="text-teal text-xs font-bold uppercase">
              Plan de Ruteo — Bloque {blockPlan.block}
              <span className="text-gray-500 normal-case font-normal ml-2">
                {blockPlan.blockStart} → {blockPlan.blockEnd}
                {" · "}{blockPlan.totalLots.toLocaleString()} paquete{blockPlan.totalLots === 1 ? "" : "s"}
                {blockPlan.totalLots > blockPlan.lots.length &&
                  ` (mostrando ${blockPlan.lots.length})`}
              </span>
            </p>
            <input
              value={planQuery}
              onChange={e => setPlanQuery(e.target.value)}
              placeholder="Filtrar por ID, origen o destino…"
              className="bg-[#021020] border border-white/10 rounded px-2 py-1
                         text-[11px] text-gray-300 focus:outline-none focus:border-teal w-56"/>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#031525]">
                <tr className="text-gray-500 border-b border-white/10 text-[10px] uppercase">
                  <th className="text-left py-1">Paquete</th>
                  <th className="text-right py-1 pr-3">Maletas</th>
                  <th className="text-left py-1">Ruta</th>
                  <th className="text-left py-1">Salida</th>
                  <th className="text-left py-1">Llegada</th>
                  <th className="text-left py-1">Estado</th>
                </tr>
              </thead>
              <tbody>
                {blockPlan.lots
                  .filter(l => {
                    const q = planQuery.trim().toLowerCase();
                    return !q
                      || (l.lotId || "").toLowerCase().includes(q)
                      || (l.origin || "").toLowerCase().includes(q)
                      || (l.destination || "").toLowerCase().includes(q);
                  })
                  .slice(0, 200)
                  .map(l => (
                  <tr key={l.lotId} className="border-b border-white/5">
                    <td className="py-1 text-teal font-mono text-[10px] break-all">{l.lotId}</td>
                    <td className="py-1 text-right pr-3 text-gray-300 tabular-nums">
                      {l.qty.toLocaleString()}
                    </td>
                    <td className="py-1 text-gray-300">
                      {l.path.length === 0
                        ? <span className="text-red-400">sin ruta</span>
                        : l.path.join(" → ")}
                    </td>
                    <td className="py-1 text-gray-500 font-mono text-[10px]">
                      {(l.departureClock || "").split("  ")[1] || "—"}
                    </td>
                    <td className="py-1 text-gray-500 font-mono text-[10px]">
                      {(l.arrivalClock || "").split("  ")[1] || "—"}
                    </td>
                    <td className="py-1">
                      {l.path.length === 0
                        ? <span className="text-red-400 inline-flex items-center gap-1">
                            <X size={10} className="shrink-0"/> no planificado</span>
                        : l.late
                          ? <span className="text-yellow-400 inline-flex items-center gap-1">
                              <AlertTriangle size={10} className="shrink-0"/> con retraso</span>
                          : <span className="text-green-400 inline-flex items-center gap-1">
                              <Check size={10} className="shrink-0"/> a tiempo</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Panel de incidente si hay colapso */}
      {simulation?.collapsed && (
        <div className="mt-4 bg-[#1a0505] border border-red-700 rounded p-3">
          <p className="text-red-500 text-xs font-bold uppercase mb-2
                        flex items-center gap-1">
            <AlertTriangle size={12} className="shrink-0"/> Colapso Logístico Detectado
          </p>
          <p className="text-gray-300 text-xs mb-2">
            {simulation.message}
          </p>
          <div className="grid grid-cols-3 gap-2 text-center mt-3">
            {[
              ["Ocupación al colapso", `${safeKpis.occupancyPercent}%`, "text-red-400"],
              ["Maletas en riesgo",    safeKpis.atRisk.toLocaleString(), "text-orange-400"],
              ["Fuera de plazo",       safeKpis.outOfDeadline,           "text-red-400"],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-[#021020] rounded p-2">
                <p className={`text-xl font-bold ${c}`}>{v}</p>
                <p className="text-gray-600 text-[10px] uppercase">{l}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
