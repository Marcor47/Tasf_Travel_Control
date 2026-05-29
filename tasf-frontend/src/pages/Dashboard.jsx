import { useState, useEffect } from "react";
import SLAMonitor        from "../components/panels/SLAMonitor";
import WarehouseCapacity from "../components/panels/WarehouseCapacity";
import WorldMap          from "../components/map/WorldMap";
import CollapseAlert     from "../components/modals/CollapseAlert";

export default function Dashboard({ mode, simulation, onStop }) {
  const [showCollapse, setShowCollapse] = useState(false);
  const kpis = simulation?.kpis ?? {};

  // Punto 3: disparar modal automáticamente cuando el backend
  // reporta collapsed=true
  useEffect(() => {
    if (simulation?.collapsed) {
      setShowCollapse(true);
    }
  }, [simulation?.collapsed]);

  // Cerrar modal si se reinicia la simulación
  useEffect(() => {
    if (simulation?.running && !simulation?.collapsed) {
      setShowCollapse(false);
    }
  }, [simulation?.running, simulation?.collapsed]);

  const simulatedNow = simulation?.simulatedMinute   // si agregaste el campo
  ?? 0;
  return (
    <div className="relative flex gap-2 p-2 h-[calc(100vh-72px)]">

      {/* Panel izquierdo */}
      <div className="w-64 flex-shrink-0 overflow-y-auto">
        <SLAMonitor
          kpis={kpis}
          events={simulation?.events ?? []}
          running={simulation?.running ?? false}
          simulatedNow={simulatedNow}
        />
      </div>

      {/* Mapa central */}
      <div className="flex-1 relative">
        <WorldMap
          airports={simulation?.airports ?? []}
          routes={simulation?.routes ?? []}
          running={simulation?.running ?? false}
          message={simulation?.message ?? ""}/>

        {/* Modal de colapso — se abre solo cuando collapsed=true */}
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
  );
}
