import { useState } from "react";

export default function FlightCancelPanel({ flights = [], onCancel }) {
  const [open,       setOpen]       = useState(false);
  const [confirming, setConfirming] = useState(null);

  return (
    <div className="absolute right-3 bottom-16 z-10">

      {/* Botón toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        className="ml-auto block bg-[#021020]/90 border border-red-800/50
                   rounded px-3 py-1.5 text-xs text-red-400 font-bold
                   hover:bg-red-900/40 transition mb-1">
        ✈ Cancelar vuelo {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="bg-[#021020]/95 border border-teal/20 rounded p-2
                        w-80 max-h-64 overflow-y-auto">
          <p className="text-teal text-[10px] font-bold uppercase mb-2">
            Próximos vuelos sin despegar
          </p>

          {flights.length === 0 ? (
            <p className="text-gray-600 text-[10px] text-center py-3">
              No hay vuelos próximos disponibles
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-white/10 text-[10px]">
                  <th className="text-left py-1">Vuelo</th>
                  <th className="text-left py-1">Ruta</th>
                  <th className="text-left py-1">Salida</th>
                  <th className="text-left py-1">Carga</th>
                  <th className="py-1"/>
                </tr>
              </thead>
              <tbody>
                {flights.map(f => (
                  <tr key={f.flightId}
                      className="border-b border-white/5 hover:bg-white/5 transition">
                    <td className="py-1.5 text-teal font-mono text-[10px] font-bold">
                      {f.flightId}
                    </td>
                    <td className="py-1.5 text-gray-300 text-[10px]">
                      {f.origin}→{f.destination}
                    </td>
                    <td className="py-1.5 text-gray-400 text-[10px] font-mono">
                      {f.departureClock?.split("  ")[1] ?? "--:--"}
                    </td>
                    <td className="py-1.5 text-gray-400 text-[10px]">
                      {f.assigned}/{f.capacity}
                    </td>
                    <td className="py-1.5">
                      {confirming === f.flightId ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => { onCancel(f.flightId); setConfirming(null); }}
                            className="bg-red-700 hover:bg-red-600 text-white
                                       text-[10px] px-1.5 py-0.5 rounded transition">
                            Sí
                          </button>
                          <button
                            onClick={() => setConfirming(null)}
                            className="bg-gray-700 hover:bg-gray-600 text-white
                                       text-[10px] px-1.5 py-0.5 rounded transition">
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirming(f.flightId)}
                          className="bg-red-900/40 hover:bg-red-700 text-red-400
                                     hover:text-white text-[10px] px-2 py-0.5 rounded
                                     border border-red-800/50 transition">
                          Cancelar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}