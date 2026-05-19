import { airports as mockAirports, kpis as mockKpis } from "../../data/mockData";
import { getWarehouseColor } from "../../hooks/useStatusColor";

export default function WarehouseCapacity({ airports = mockAirports, kpis = mockKpis }) {
  const shownAirports = airports.length ? airports : mockAirports;
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Capacidad de Almacenes
        </p>
        <div className="flex flex-col gap-2">
          {shownAirports.map(a => {
            const capacity = Math.max(1, a.capacity || 0);
            const current = Math.max(0, a.current || 0);
            const pct   = Math.min(100, Math.round(current / capacity * 100));
            const color = getWarehouseColor(pct);
            const bar   = color === "green"
              ? "bg-green-500" : color === "amber"
              ? "bg-yellow-500" : "bg-red-500";
            const txt   = color === "green"
              ? "text-green-400" : color === "amber"
              ? "text-yellow-400" : "text-red-400";
            return (
              <div key={a.code}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-gray-300">{a.name || a.code}</span>
                  <span className={`font-bold ${txt}`}>{pct}%</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div className={`${bar} h-1.5 rounded-full`}
                       style={{ width:`${pct}%` }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ocupación global */}
      <div className="bg-[#031525] border border-teal/20 rounded p-3 text-center">
        <p className="text-gray-500 text-[10px] uppercase mb-1">Ocupación</p>
        <p className="text-4xl font-bold text-white">
          {kpis.occupancyPercent ?? 0}%
        </p>
      </div>

      <div className="bg-[#031525] border border-teal/20 rounded p-3 text-center">
        <p className="text-gray-500 text-[10px] uppercase mb-1">
          Replanificaciones
        </p>
        <p className="text-4xl font-bold text-white">
          {kpis.replanifications ?? 0}
        </p>
      </div>
    </div>
  );
}
