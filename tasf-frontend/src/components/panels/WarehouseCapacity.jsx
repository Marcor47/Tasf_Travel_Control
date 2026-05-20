import { airports as mockAirports, kpis as mockKpis } from "../../data/mockData";
import { getWarehouseColor } from "../../hooks/useStatusColor";

export default function WarehouseCapacity({ airports = [], kpis = {} }) {
  // Bug fix: nunca caer a mockAirports si ya tenemos datos reales,
  // aunque el array llegue vacío entre bloques. Usamos mockAirports
  // SOLO si airports es exactamente el valor default (array vacío literal).
  const shownAirports = airports.length > 0 ? airports : mockAirports;

  // Bug fix: mezclar kpis reales con fallback campo por campo,
  // nunca reemplazar el objeto entero con mockKpis cuando kpis llega parcial.
  const safeKpis = {
    occupancyPercent:  kpis.occupancyPercent  ?? mockKpis.occupancyPercent,
    replanifications:  kpis.replanifications  ?? mockKpis.replanifications,
    saturationPercent: kpis.saturationPercent ?? mockKpis.saturationPercent,
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Capacidad de Almacenes
        </p>
        <div className="flex flex-col gap-2">
          {shownAirports.map(a => {
            const capacity = Math.max(1, a.capacity || 0);
            const current  = Math.max(0, a.current  || 0);
            // Permitir >100% para detectar colapso visualmente
            const pct      = Math.round(current / capacity * 100);
            const clampPct = Math.min(100, pct);
            const color    = getWarehouseColor(pct);     // usa pct real para color
            const bar      = color === "green"  ? "bg-green-500"
                           : color === "amber"  ? "bg-yellow-500"
                           : "bg-red-500";
            const txt      = color === "green"  ? "text-green-400"
                           : color === "amber"  ? "text-yellow-400"
                           : "text-red-400";
            return (
              <div key={a.code}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-gray-300">{a.name || a.code}</span>
                  <span className={`font-bold ${txt}`}>
                    {pct}%{pct > 100 ? " ⚠" : ""}
                  </span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div className={`${bar} h-1.5 rounded-full transition-all duration-500`}
                       style={{ width:`${clampPct}%` }}/>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Ocupación global */}
      <div className="bg-[#031525] border border-teal/20 rounded p-3 text-center">
        <p className="text-gray-500 text-[10px] uppercase mb-1">Ocupación</p>
        <p className={`text-4xl font-bold ${
          safeKpis.occupancyPercent > 85 ? "text-red-400"
        : safeKpis.occupancyPercent > 60 ? "text-yellow-400"
        : "text-white"}`}>
          {safeKpis.occupancyPercent}%
        </p>
      </div>

      {/* Saturación */}
      <div className="bg-[#031525] border border-teal/20 rounded p-3 text-center">
        <p className="text-gray-500 text-[10px] uppercase mb-1">
          Saturación al Colapso
        </p>
        <p className={`text-4xl font-bold ${
          safeKpis.saturationPercent > 85 ? "text-red-400"
        : safeKpis.saturationPercent > 60 ? "text-yellow-400"
        : "text-white"}`}>
          {safeKpis.saturationPercent}%
        </p>
      </div>

      <div className="bg-[#031525] border border-teal/20 rounded p-3 text-center">
        <p className="text-gray-500 text-[10px] uppercase mb-1">
          Replanificaciones
        </p>
        <p className="text-4xl font-bold text-white">
          {safeKpis.replanifications}
        </p>
      </div>
    </div>
  );
}
