import { AlertTriangle, X } from "lucide-react";

export default function CollapseAlert({ onClose }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center
                    bg-black/60 z-50">
      <div className="bg-[#1a0a0a] border-2 border-red-600 rounded-lg
                      p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-2 text-red-500 font-bold mb-3">
          <AlertTriangle size={18}/>
          COLAPSO LOGÍSTICO DETECTADO
        </div>
        <p className="text-gray-300 text-sm font-mono mb-1">#B-881024</p>
        <p className="text-gray-400 text-sm mb-4">
          Vuelo AF165, llegó al aeropuerto JFK, excede la capacidad de almacén
        </p>
        <div className="flex gap-2">
          <button onClick={onClose}
            className="flex-1 bg-red-700 hover:bg-red-600 text-white
                       text-sm py-2 rounded font-medium transition">
            TERMINAR SIMULACIÓN
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