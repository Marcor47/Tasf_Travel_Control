import { getWarehouseColor } from "../../hooks/useStatusColor";
import { STATIC_AIRPORTS, AIRPORT_META, airportMatches } from "../../data/staticAirports";

const SEM_CHIPS = [
  { key: "all",   label: "Todos", dot: "bg-gray-400" },
  { key: "green", label: "",      dot: "bg-green-500" },
  { key: "amber", label: "",      dot: "bg-yellow-500" },
  { key: "red",   label: "",      dot: "bg-red-500" },
  { key: "empty", label: "Vacío", dot: "bg-gray-500" },
];

function whSem(a) {
  const cur = a.current || 0;
  if (cur === 0) return "empty";
  return getWarehouseColor(Math.round(cur / Math.max(1, a.capacity) * 100));
}

export default function WarehouseCapacity({
  airports = [], kpis = {},
  filter = "", onFilterChange,
  sem = "all", onSemChange,        // semáforo controlado por el padre (resalta en el mapa)
  selectedCode = null, onAirportClick,
}) {
  const hasFilter = filter.trim().length > 0 || sem !== "all";

  // Fuente: datos en vivo del backend si existen; si no (antes de iniciar)
  // usamos los estáticos del dataset para poder filtrar igualmente.
  const source = airports.length > 0 ? airports : STATIC_AIRPORTS;

  // Filtro por texto (código/país/región) + semáforo, ORDENADO por ocupación.
  // Sin filtros: top 10 por ocupación (comportamiento original).
  const matched = [...source]
    .filter(a => airports.length > 0 ? a.capacity > 0 : true)
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

        {/* Filtro por código, país o región — resalta también en el mapa */}
        <div className="relative mb-2">
          <input
            value={filter}
            onChange={e => onFilterChange?.(e.target.value)}
            placeholder="Filtrar por código, país o región…"
            className="w-full bg-[#021020] border border-white/10 rounded
                       px-2 py-1 pr-6 text-[11px] text-gray-300
                       focus:outline-none focus:border-teal"
          />
          {filter.trim() && (
            <button
              onClick={() => onFilterChange?.("")}
              title="Limpiar filtro"
              className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500
                         hover:text-white text-xs px-1">
              ✕
            </button>
          )}
        </div>

        {/* Filtro por semáforo de ocupación (incluye vacío) */}
        <div className="flex gap-1 mb-2">
          {SEM_CHIPS.map(c => (
            <button key={c.key} onClick={() => onSemChange?.(c.key)}
              title={c.key}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition border
                ${sem === c.key ? "border-teal/60 bg-teal/10 text-gray-200"
                                : "border-white/10 text-gray-400 hover:text-white"}`}>
              <span className={`w-2 h-2 rounded-full ${c.dot}`}/>{c.label}
            </button>
          ))}
        </div>

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
              const color    = getWarehouseColor(pct);
              const bar      = color === "green"  ? "bg-green-500"
                             : color === "amber"  ? "bg-yellow-500"
                             : "bg-red-500";
              const txt      = color === "green"  ? "text-green-400"
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
                    <span className="text-gray-300 truncate max-w-[140px]">
                      {a.name || a.code}
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
