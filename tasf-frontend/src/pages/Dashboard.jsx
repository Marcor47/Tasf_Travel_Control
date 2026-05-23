import { useState } from "react";
import SLAMonitor        from "../components/panels/SLAMonitor";
import WarehouseCapacity from "../components/panels/WarehouseCapacity";
import WorldMap          from "../components/map/WorldMap";
import CollapseAlert     from "../components/modals/CollapseAlert";

export default function Dashboard({ mode, simulation }) {
  const [showCollapse, setShowCollapse] = useState(false);
  const kpis = simulation?.kpis ?? {};

  return (
    <div className="relative flex gap-2 p-2 h-[calc(100vh-72px)]">
      {/* Panel izquierdo */}
      <div className="w-64 flex-shrink-0 overflow-y-auto">
        <SLAMonitor kpis={kpis} events={simulation?.events ?? []}/>
      </div>

      {/* Mapa central */}
      <div className="flex-1 relative">
        <WorldMap
          airports={simulation?.airports ?? []}
          routes={simulation?.routes ?? []}
          running={simulation?.running ?? false}
          message={simulation?.message ?? ""}
        />
        {/* Botón para demo del colapso */}
        {mode === "colapso" && (
          <button
            onClick={() => setShowCollapse(true)}
            className="absolute bottom-4 right-4 bg-red-700 hover:bg-red-600
                       text-white text-xs px-3 py-1 rounded">
            Simular Colapso
          </button>
        )}
        {(showCollapse || simulation?.collapsed) && (
          <CollapseAlert onClose={() => setShowCollapse(false)}/>
        )}
        <div className="absolute left-3 bottom-3 bg-[#021020]/90 border border-teal/20 rounded p-2 text-xs text-gray-300 max-w-md">
          <p className="text-teal font-bold uppercase">Bloque {simulation?.block ?? 0}</p>
          <p>{simulation?.blockStart || "--"} - {simulation?.blockEnd || "--"}</p>
          <p>{simulation?.message}</p>
        </div>
      </div>

      {/* Panel derecho */}
      <div className="w-52 flex-shrink-0 overflow-y-auto">
        <WarehouseCapacity airports={simulation?.airports ?? []} kpis={kpis}/>
      </div>
    </div>
  );
}
