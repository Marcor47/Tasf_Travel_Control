import { useState, useEffect, useRef } from "react";
import SLAMonitor        from "../components/panels/SLAMonitor";
import WarehouseCapacity from "../components/panels/WarehouseCapacity";
import WorldMap          from "../components/map/WorldMap";
import CollapseAlert     from "../components/modals/CollapseAlert";
import FlightCancelPanel from "../components/panels/FlightCancelPanel";

const MODE_CONFIG = {
  diadia:  { selector: "Día a simular",  suffix: "(1 día — tiempo real)", showDays: false },
  periodo: { selector: "Día de inicio",  suffix: null,                    showDays: true  },
  colapso: { selector: "Día de inicio",  suffix: "(hasta colapso)",       showDays: false },
};

const NUM_DAYS_OPTIONS = [2, 3, 4, 5];

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
  cancelFlight,
  realSeconds = 0, // ← nuevo, viene del hook vía App
}) {
  const [showCollapse, setShowCollapse] = useState(false);


  const kpis         = simulation?.kpis ?? {};
  const running      = simulation?.running ?? false;
  const simulatedNow = simulation?.simulatedMinute ?? 0;
  const cfg          = MODE_CONFIG[mode] ?? MODE_CONFIG.diadia;




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
    <div className="flex flex-col gap-2 p-2 h-[calc(100vh-72px)]">

      {/* ── Selector de fecha + contadores ───────────────────────────────── */}
      <div className="flex items-center gap-3 bg-[#031525] border border-teal/20
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

        {/* Contadores de tiempo */}
        {running && (
          <div className="ml-auto flex items-center gap-4">
            <div className="text-center">
              <p className="text-gray-500 text-[9px] uppercase leading-none">Tiempo real</p>
              <p className="text-white text-xs font-mono font-bold">
                {formatRealTime(realSeconds)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-gray-500 text-[9px] uppercase leading-none">Tiempo simulado</p>
              <p className="text-teal text-xs font-mono font-bold">
                {formatSimTime(simElapsedMinutes)}
              </p>
            </div>
            <span className="text-green-400 text-xs animate-pulse">● En curso</span>
          </div>
        )}
      </div>

      {/* ── Paneles principales ───────────────────────────────────────────── */}
      <div className="flex gap-2 flex-1 min-h-0">

        {/* Panel izquierdo — más ancho */}
        <div className="w-72 flex-shrink-0 overflow-y-auto">
          <SLAMonitor
            kpis={kpis}
            events={simulation?.history ?? []}
            running={running}
            simulatedNow={simulatedNow}
          />
        </div>

        {/* Mapa central */}
        <div className="flex-1 relative">
        <WorldMap
          airports={simulation?.airports ?? []}
          routes={simulation?.routes ?? []}
          running={running}
          message={simulation?.message ?? ""}
          simulatedMinute={simulatedNow}
          activeFlightsCount={kpis?.activeFlights ?? 0}/>

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

        {/* Panel derecho — más ancho */}
        <div className="w-64 flex-shrink-0 overflow-y-auto">
          <WarehouseCapacity
            airports={simulation?.airports ?? []}
            kpis={kpis}/>
        </div>
      </div>
    </div>
  );
}