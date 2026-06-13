import { useState, useEffect, useRef, useMemo } from "react";
import SLAMonitor        from "../components/panels/SLAMonitor";
import WarehouseCapacity from "../components/panels/WarehouseCapacity";
import FlightsCapacity   from "../components/panels/FlightsCapacity";
import StorageMovements  from "../components/panels/StorageMovements";
import WorldMap          from "../components/map/WorldMap";
import CollapseAlert     from "../components/modals/CollapseAlert";
import FlightCancelPanel from "../components/panels/FlightCancelPanel";
import { STATIC_AIRPORTS, airportMatches } from "../data/staticAirports";

const MODE_CONFIG = {
  diadia:  { selector: "Día a simular",  suffix: "(1 día — tiempo real)", showDays: false },
  periodo: { selector: "Día de inicio",  suffix: null,                    showDays: true  },
  colapso: { selector: "Día de inicio",  suffix: "(hasta colapso)",       showDays: false },
};

// Periodo permitido por el caso: 3, 4, 5 o 7 días
const NUM_DAYS_OPTIONS = [3, 4, 5, 7];

// Formatea segundos totales → "Xd Hh Mm Ss" o "Hh Mm Ss"
function formatRealTime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m`;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

// Formatea minutos simulados → "Xd HH:MM" o "HH:MM"
function formatSimTime(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "00:00";
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

export default function Dashboard({
  mode, simulation, onStop,
  availableDates = [], selectedDate = "", onDateChange,
  selectedNumDays = 5, onNumDaysChange,
  selectedStartMinute = 0, onStartMinuteChange,
  cancelFlight,
  realSeconds = 0, // ← nuevo, viene del hook vía App
}) {
  // Hora de inicio (minuto del día) ↔ valor "HH:MM" del input
  const startTimeValue =
    `${String(Math.floor(selectedStartMinute / 60)).padStart(2, "0")}:` +
    `${String(selectedStartMinute % 60).padStart(2, "0")}`;
  const handleStartTimeChange = e => {
    const [h, m] = e.target.value.split(":").map(Number);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      onStartMinuteChange?.(h * 60 + m);
    }
  };
  const [showCollapse, setShowCollapse] = useState(false);
  // Filtro del panel de almacenes (también resalta en el mapa)
  const [storageFilter, setStorageFilter] = useState("");
  // Paneles laterales colapsables
  const [leftOpen,  setLeftOpen]  = useState(true);
  const [rightOpen, setRightOpen] = useState(true);


  const kpis         = simulation?.kpis ?? {};
  const running      = simulation?.running ?? false;
  const simulatedNow = simulation?.simulatedMinute ?? 0;
  const cfg          = MODE_CONFIG[mode] ?? MODE_CONFIG.diadia;
  // Hora simulada actual (lo que "marca el reloj dentro de la simulación")
  const simClock     = simulation?.clock ?? "--:--";

  // Reloj de pared: hora real actual, avanza cada segundo mientras corre
  const [realNow, setRealNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setRealNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Códigos de aeropuerto que coinciden con el filtro de almacenes — se usan
  // para resaltar tanto en el panel como en el mapa. Usa la misma fuente que
  // el mapa (datos en vivo si existen, si no los estáticos del dataset).
  const liveAirports   = simulation?.airports;
  const highlightCodes = useMemo(() => {
    if (!storageFilter.trim()) return [];
    const src = (liveAirports && liveAirports.length) ? liveAirports : STATIC_AIRPORTS;
    return src.filter(a => airportMatches(a, storageFilter)).map(a => a.code);
  }, [storageFilter, liveAirports]);




  // Tiempo simulado: simulatedNow es minuto absoluto desde BASE_UTC
  // El inicio de la simulación es el primer minuto del día seleccionado
  const simStartMinute = simulation?.simulatedMinute != null && running
    ? (simulation?.block === 1 || simulation?.block === 0
        ? simulatedNow - (simulatedNow % 1440)  // inicio del primer día
        : null)
    : null;

  // Acumulamos el minuto inicial de la simulación
  const simOriginRef = useRef(null);
  useEffect(() => {
    if (running && simulatedNow > 0 && simOriginRef.current === null) {
      // El primer bloque empieza en el inicio del día seleccionado
      simOriginRef.current = simulatedNow - (simulatedNow % 60);
    }
    if (!running) simOriginRef.current = null;
  }, [running, simulatedNow]);

  const simElapsedMinutes = (running && simOriginRef.current != null)
    ? Math.max(0, simulatedNow - simOriginRef.current)
    : 0;

  useEffect(() => {
    if (simulation?.collapsed) setShowCollapse(true);
  }, [simulation?.collapsed]);

  useEffect(() => {
    if (running && !simulation?.collapsed) setShowCollapse(false);
  }, [running, simulation?.collapsed]);

  return (
    <div className="flex flex-col gap-2 p-2 h-[calc(100vh-72px)]
                    overflow-y-auto md:overflow-hidden">

      {/* ── Selector de fecha + contadores ───────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#031525] border border-teal/20
                      rounded px-3 py-2 flex-shrink-0">
        <span className="text-teal text-xs font-bold uppercase whitespace-nowrap">
          {cfg.selector}
        </span>

        {availableDates.length === 0 ? (
          <span className="text-gray-600 text-xs italic">Cargando fechas...</span>
        ) : (
          <select
            value={selectedDate}
            onChange={e => onDateChange?.(e.target.value)}
            disabled={running}
            className="bg-[#021020] border border-white/10 rounded px-2 py-1
                       text-xs text-gray-300 focus:outline-none focus:border-teal
                       disabled:opacity-40 disabled:cursor-not-allowed">
            {availableDates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}

        {/* Hora y minuto de inicio (opcional) */}
        <span className="text-gray-500 text-xs">a las</span>
        <input
          type="time"
          value={startTimeValue}
          onChange={handleStartTimeChange}
          disabled={running}
          title="Hora y minuto de inicio dentro del día"
          className="bg-[#021020] border border-white/10 rounded px-2 py-1
                     text-xs text-gray-300 focus:outline-none focus:border-teal
                     disabled:opacity-40 disabled:cursor-not-allowed"
        />

        {cfg.showDays && (
          <>
            <span className="text-gray-500 text-xs">durante</span>
            <select
              value={selectedNumDays}
              onChange={e => onNumDaysChange?.(Number(e.target.value))}
              disabled={running}
              className="bg-[#021020] border border-white/10 rounded px-2 py-1
                         text-xs text-gray-300 focus:outline-none focus:border-teal
                         disabled:opacity-40 disabled:cursor-not-allowed">
              {NUM_DAYS_OPTIONS.map(n => (
                <option key={n} value={n}>{n} días</option>
              ))}
            </select>
            <span className="text-gray-500 text-xs">
              (~{selectedNumDays * 12} min simulación)
            </span>
          </>
        )}

        {cfg.suffix && (
          <span className="text-gray-500 text-xs">{cfg.suffix}</span>
        )}

        {/* ── Relojes: hora simulada / transcurrido simulado / hora real /
               transcurrido real ──────────────────────────────────────────── */}
        {running && (
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="text-center">
              <p className="text-gray-500 text-[9px] uppercase leading-none">Hora simulada</p>
              <p className="text-teal text-xs font-mono font-bold">
                {simClock}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-500 text-[9px] uppercase leading-none">Tiempo simulado transcurrido</p>
              <p className="text-teal text-xs font-mono font-bold">
                {formatSimTime(simElapsedMinutes)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-500 text-[9px] uppercase leading-none">Hora real</p>
              <p className="text-white text-xs font-mono font-bold">
                {realNow.toLocaleTimeString("es-ES")}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-500 text-[9px] uppercase leading-none">Tiempo real transcurrido</p>
              <p className="text-white text-xs font-mono font-bold">
                {formatRealTime(realSeconds)}
              </p>
            </div>
            <span className="text-green-400 text-xs animate-pulse">● En curso</span>
          </div>
        )}
      </div>

      {/* ── Paneles principales ───────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-2 flex-1 min-h-0">

        {/* Panel izquierdo — SLA (colapsable) */}
        <SidePanel title="Plazos / SLA" side="left"
                   open={leftOpen} onToggle={() => setLeftOpen(o => !o)}
                   widthClass="md:w-72">
          <SLAMonitor
            kpis={kpis}
            events={simulation?.history ?? []}
            running={running}
            simulatedNow={simulatedNow}
          />
          <FlightsCapacity flights={simulation?.flights ?? []} />
        </SidePanel>

        {/* Mapa central */}
        <div className="flex-1 relative min-h-[320px] md:min-h-0">
        <WorldMap
          airports={simulation?.airports ?? []}
          routes={simulation?.routes ?? []}
          running={running}
          message={simulation?.message ?? ""}
          simulatedMinute={simulatedNow}
          activeFlightsCount={kpis?.activeFlights ?? 0}
          highlightCodes={highlightCodes}/>

          {showCollapse && (
            <CollapseAlert
              onClose={() => setShowCollapse(false)}
              onStop={onStop}
              message={simulation?.message}
              kpis={kpis}/>
          )}

          {mode === "diadia" && simulation?.running && (
            <FlightCancelPanel
              flights={simulation?.upcomingFlights ?? []}
              onCancel={cancelFlight}
            />
          )}

          <div className="absolute left-3 bottom-3 bg-[#021020]/90
                          border border-teal/20 rounded p-2 text-xs
                          text-gray-300 max-w-md">
            <p className="text-teal font-bold uppercase">
              Bloque {simulation?.block ?? 0}
            </p>
            <p>{simulation?.blockStart || "---"} - {simulation?.blockEnd || "---"}</p>
            <p>{simulation?.message}</p>
          </div>
        </div>

        {/* Panel derecho — Almacenes (colapsable) */}
        <SidePanel title="Almacenes" side="right"
                   open={rightOpen} onToggle={() => setRightOpen(o => !o)}
                   widthClass="md:w-64">
          <WarehouseCapacity
            airports={simulation?.airports ?? []}
            kpis={kpis}
            filter={storageFilter}
            onFilterChange={setStorageFilter}/>
          <StorageMovements
            history={simulation?.history ?? []}
            filter={storageFilter}
            airports={simulation?.airports ?? []}/>
        </SidePanel>
      </div>
    </div>
  );
}

/**
 * Panel lateral colapsable y responsivo.
 * - Escritorio: abierto ocupa su ancho (md:w-72/64); colapsado se reduce a
 *   una franja vertical con el título girado.
 * - Móvil: ocupa todo el ancho y se apila; colapsado deja solo una barra de
 *   cabecera para expandirlo.
 */
function SidePanel({ title, side, open, onToggle, widthClass, children }) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        title={`Mostrar ${title}`}
        className={`flex-shrink-0 w-full md:w-7 bg-[#031525] border border-teal/20 rounded
                    flex md:flex-col items-center justify-between md:justify-start
                    px-2 py-1 md:py-2 gap-1 hover:border-teal/50 transition`}>
        <span className="text-gray-400 text-[10px] uppercase tracking-wide
                         md:[writing-mode:vertical-rl]">
          {title}
        </span>
        <span className="text-teal text-xs">
          {side === "left" ? "▸" : "◂"}
        </span>
      </button>
    );
  }
  return (
    <div className={`${widthClass} w-full flex-shrink-0 overflow-y-auto
                     max-h-[45vh] md:max-h-none`}>
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="text-gray-500 text-[10px] uppercase tracking-wide">{title}</span>
        <button onClick={onToggle} title={`Ocultar ${title}`}
          className="text-gray-500 hover:text-white text-xs px-1">
          {side === "left" ? "◂" : "▸"}
        </button>
      </div>
      {children}
    </div>
  );
}