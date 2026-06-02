import { useState, useEffect } from "react";
import SLAMonitor        from "../components/panels/SLAMonitor";
import WarehouseCapacity from "../components/panels/WarehouseCapacity";
import WorldMap          from "../components/map/WorldMap";
import CollapseAlert     from "../components/modals/CollapseAlert";

const MODE_LABELS = {
  diadia:  { selector: "Día a simular",  suffix: "(1 día)"                 },
  periodo: { selector: "Día de inicio",  suffix: "(5 días consecutivos)"   },
  colapso: { selector: "Día de inicio",  suffix: "(hasta colapso)"         },
};

export default function Dashboard({
  mode, simulation, onStop,
  availableDates = [], selectedDate = "", onDateChange,
}) {
  const [showCollapse, setShowCollapse] = useState(false);
  const kpis         = simulation?.kpis ?? {};
  const running      = simulation?.running ?? false;
  const simulatedNow = simulation?.simulatedMinute ?? 0;
  const labels       = MODE_LABELS[mode] ?? MODE_LABELS.diadia;

  useEffect(() => {
    if (simulation?.collapsed) setShowCollapse(true);
  }, [simulation?.collapsed]);

  useEffect(() => {
    if (running && !simulation?.collapsed) setShowCollapse(false);
  }, [running, simulation?.collapsed]);

  return (
    <div className="flex flex-col gap-2 p-2 h-[calc(100vh-72px)]">

      {/* ── Selector de fecha ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 bg-[#031525] border border-teal/20
                      rounded px-3 py-2 flex-shrink-0">
        <span className="text-teal text-xs font-bold uppercase whitespace-nowrap">
          {labels.selector}
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
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {availableDates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        )}

        <span className="text-gray-500 text-xs">{labels.suffix}</span>

        {running && (
          <span className="ml-auto text-green-400 text-xs animate-pulse">
            ● Simulación en curso
          </span>
        )}
      </div>

      {/* ── Paneles principales ───────────────────────────────────────────── */}
      <div className="flex gap-2 flex-1 min-h-0">

        {/* Panel izquierdo */}
        <div className="w-64 flex-shrink-0 overflow-y-auto">
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
            message={simulation?.message ?? ""}/>

          {showCollapse && (
            <CollapseAlert
              onClose={() => setShowCollapse(false)}
              onStop={onStop}
              message={simulation?.message}
              kpis={kpis}/>
          )}

          {/* Info bloque actual */}
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

        {/* Panel derecho */}
        <div className="w-52 flex-shrink-0 overflow-y-auto">
          <WarehouseCapacity
            airports={simulation?.airports ?? []}
            kpis={kpis}/>
        </div>
      </div>
    </div>
  );
}