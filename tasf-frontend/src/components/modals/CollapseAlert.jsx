import { AlertTriangle, X } from "lucide-react";

export default function CollapseAlert({ onClose, onStop, message, kpis = {} }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center
                    bg-black/70 z-50">
      <div className="bg-[#1a0a0a] border-2 border-red-600 rounded-lg
                      p-6 max-w-lg w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-2 text-red-500 font-bold mb-3 text-sm">
          <AlertTriangle size={18}/>
          COLAPSO LOGÍSTICO DETECTADO
        </div>

        <p className="text-gray-300 text-sm mb-4">
          {message || "La capacidad de almacén ha sido excedida en uno o más aeropuertos."}
        </p>

        {/* KPIs del momento del colapso */}
        <div className="grid grid-cols-3 gap-2 mb-5 text-center">
          {[
            ["Ocupación",      `${kpis.occupancyPercent  ?? 0}%`, "text-red-400"],
            ["En Riesgo",       kpis.atRisk              ?? 0,    "text-orange-400"],
            ["Fuera de Plazo",  kpis.outOfDeadline       ?? 0,    "text-red-400"],
          ].map(([l, v, c]) => (
            <div key={l} className="bg-[#2a0a0a] rounded p-2">
              <p className={`text-xl font-bold ${c}`}>{v}</p>
              <p className="text-gray-600 text-[10px] uppercase">{l}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { onStop?.(); onClose(); }}
            className="flex-1 bg-red-700 hover:bg-red-600 text-white
                       text-sm py-2 rounded font-medium transition">
            TERMINAR SIMULACIÓN
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white/10 hover:bg-white/20
                       text-gray-300 text-sm rounded transition">
            Ignorar
          </button>
          <button onClick={onClose}
            className="p-2 text-gray-500 hover:text-white transition">
            <X size={16}/>
          </button>
        </div>
      </div>
    </div>
  );
}
