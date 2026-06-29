import { getWarehouseColor } from "../../hooks/useStatusColor";
import { STATIC_AIRPORTS, AIRPORT_META, airportMatches, airportName } from "../../data/staticAirports";

function whSem(a) {
  const cur = a.current || 0;
  if (cur === 0) return "empty";
  return getWarehouseColor(Math.round(cur / Math.max(1, a.capacity) * 100));
}

export default function WarehouseCapacity({
  airports = [], kpis = {},
  filter = "", sem = "all",        // filtro/semáforo controlados por el padre (barra compartida)
  focusCodes = [],                 // aeropuertos en foco (clic en mapa / vuelo / envío)
  selectedCode = null, onAirportClick,
}) {
  // Foco activo = un aeropuerto/clic en el mapa o un vuelo/envío seleccionado.
  // Restringe la lista a esos almacenes (coherente con el mapa y los demás
  // paneles). El filtro de texto propio lo produce este mismo panel, así que
  // intersectar con focusCodes es idempotente cuando el foco viene de aquí.
  const focusSet  = new Set(focusCodes);
  const hasFilter = filter.trim().length > 0 || sem !== "all" || focusSet.size > 0;

  // Fuente: datos en vivo del backend si existen; si no (antes de iniciar)
  // usamos los estáticos del dataset para poder filtrar igualmente.
  const source = airports.length > 0 ? airports : STATIC_AIRPORTS;

  // Filtro por foco + texto (código/país/región) + semáforo, ORDENADO por
  // ocupación. Sin filtros: top 10 por ocupación (comportamiento original).
  const matched = [...source]
    .filter(a => airports.length > 0 ? a.capacity > 0 : true)
    .filter(a => focusSet.size ? focusSet.has(a.code) : true)
    .filter(a => filter.trim() ? airportMatches(a, filter) : true)
    .filter(a => sem === "all" || whSem(a) === sem)
    .sort((a, b) => ((b.current || 0) / Math.max(1, b.capacity)) -
                    ((a.current || 0) / Math.max(1, a.capacity)));
  const shownAirports = (hasFilter || airports.length === 0) ? matched : matched.slice(0, 10);

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
          {!hasFilter && airports.length > 10 && (
            <span className="text-gray-500 normal-case ml-1">
              (top 10 de {airports.length})
            </span>
          )}
        </p>

        {hasFilter && (
          <p className="text-gray-500 text-[10px] mb-1">
            {shownAirports.length} coincidencia{shownAirports.length === 1 ? "" : "s"}
            {shownAirports.length > 0 && " · resaltadas en el mapa"}
          </p>
        )}

        {shownAirports.length === 0 ? (
          <p className="text-gray-600 text-center py-4 text-[10px]">
            {hasFilter
              ? "Sin coincidencias"
              : "Inicia la simulación para ver datos"}
          </p>
        ) : (
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            {shownAirports.map(a => {
              const capacity = Math.max(1, a.capacity || 0);
              const current  = Math.max(0, a.current  || 0);
              const pct      = Math.round(current / capacity * 100);
              const clampPct = Math.min(100, pct);
              const empty    = current === 0;                 // vacío → gris
              const color    = getWarehouseColor(pct);
              const bar      = empty                ? "bg-gray-600"
                             : color === "green"  ? "bg-green-500"
                             : color === "amber"  ? "bg-yellow-500"
                             : "bg-red-500";
              const txt      = empty                ? "text-gray-400"
                             : color === "green"  ? "text-green-400"
                             : color === "amber"  ? "text-yellow-400"
                             : "text-red-400";
              const country  = AIRPORT_META[a.code]?.country;
              const isSel    = a.code === selectedCode;
              return (
                <button key={a.code}
                  onClick={() => onAirportClick?.(a.code)}
                  title="Resaltar en el mapa y filtrar"
                  className={`w-full text-left rounded px-1 py-0.5 -mx-1 transition
                    ${isSel ? "bg-teal/15 ring-1 ring-teal/40" : "hover:bg-white/5"}`}>
                  <div className="flex justify-between mb-0.5">
                    <span className="text-gray-300 truncate max-w-[140px]"
                          title={a.code}>
                      {airportName(a.code)}
                      {country && (
                        <span className="text-gray-500 ml-1">· {country}</span>
                      )}
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
                </button>
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
