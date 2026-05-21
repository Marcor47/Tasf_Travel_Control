import { getWarehouseColor } from "../../hooks/useStatusColor";

export default function WarehouseCapacity({ airports = [], kpis = {} }) {
  // Solo mostrar aeropuertos con datos reales del backend
  // Mostrar máximo 10 ordenados por ocupación descendente para no saturar la vista
  const shownAirports = airports.length > 0
    ? [...airports]
        .filter(a => a.capacity > 0)
        .sort((a, b) => {
          const pctA = (a.current || 0) / a.capacity;
          const pctB = (b.current || 0) / b.capacity;
          return pctB - pctA;
        })
        .slice(0, 10)
    : [];

  const safeKpis = {
    occupancyPercent:  kpis.occupancyPercent  ?? 0,
    replanifications:  kpis.replanifications  ?? 0,
    saturationPercent: kpis.saturationPercent ?? 0,
  };

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="bg-[#031525] border border-teal/20 rounded p-2">
        <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
          Capacidad de Almacenes
          {airports.length > 10 && (
            <span className="text-gray-500 normal-case ml-1">
              (top 10 de {airports.length})
            </span>
          )}
        </p>

        {shownAirports.length === 0 ? (
          <p className="text-gray-600 text-center py-4 text-[10px]">
            Inicia la simulación para ver datos
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {shownAirports.map(a => {
              const capacity = Math.max(1, a.capacity || 0);
              const current  = Math.max(0, a.current  || 0);
              const pct      = Math.round(current / capacity * 100);
              const clampPct = Math.min(100, pct);
              const color    = getWarehouseColor(pct);
              const bar      = color === "green"  ? "bg-green-500"
                             : color === "amber"  ? "bg-yellow-500"
                             : "bg-red-500";
              const txt      = color === "green"  ? "text-green-400"
                             : color === "amber"  ? "text-yellow-400"
                             : "text-red-400";
              return (
                <div key={a.code}>
                  <div className="flex justify-between mb-0.5">
                    <span className="text-gray-300 truncate max-w-[110px]">
                      {a.name || a.code}
                    </span>
                    <span className={`font-bold ${txt} flex-shrink-0`}>
                      {pct}%{pct > 100 ? " ⚠" : ""}
                    </span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-1.5">
                    <div className={`${bar} h-1.5 rounded-full
                                    transition-all duration-700`}
                         style={{ width:`${clampPct}%` }}/>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Ocupación global */}
      <div className="bg-[#031525] border border-teal/20 rounded p-3 text-center">
        <p className="text-gray-500 text-[10px] uppercase mb-1">Ocupación</p>
        <p className={`text-4xl font-bold transition-colors duration-500 ${
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
        <p className={`text-4xl font-bold transition-colors duration-500 ${
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
