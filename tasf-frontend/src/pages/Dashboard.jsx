import { useState } from "react";
import SLAMonitor        from "../components/panels/SLAMonitor";
import WarehouseCapacity from "../components/panels/WarehouseCapacity";
import WorldMap          from "../components/map/WorldMap";
import CollapseAlert     from "../components/modals/CollapseAlert";

export default function Dashboard({ mode }) {
  const [showCollapse, setShowCollapse] = useState(false);

  return (
    <div className="relative flex gap-2 p-2 h-[calc(100vh-72px)]">
      {/* Panel izquierdo */}
      <div className="w-64 flex-shrink-0 overflow-y-auto">
        <SLAMonitor/>
      </div>

      {/* Mapa central */}
      <div className="flex-1 relative">
        <WorldMap/>
        {/* Botón para demo del colapso */}
        {mode === "colapso" && (
          <button
            onClick={() => setShowCollapse(true)}
            className="absolute bottom-4 right-4 bg-red-700 hover:bg-red-600
                       text-white text-xs px-3 py-1 rounded">
            Simular Colapso
          </button>
        )}
        {showCollapse && (
          <CollapseAlert onClose={() => setShowCollapse(false)}/>
        )}
      </div>

      {/* Panel derecho */}
      <div className="w-52 flex-shrink-0 overflow-y-auto">
        <WarehouseCapacity/>
      </div>
    </div>
  );
}