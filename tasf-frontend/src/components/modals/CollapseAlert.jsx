import { AlertTriangle, Download, X } from "lucide-react";

// Genera y descarga un informe .txt con la causa del colapso y los KPIs del
// instante en que ocurrió (para diagnóstico / evidencia de la corrida).
function downloadReport(message, kpis) {
  const lines = [
    "TASF.B2B — INFORME DE COLAPSO LOGÍSTICO",
    "=".repeat(45),
    "",
    message || "(sin detalle)",
    "",
    "KPIs al momento del colapso:",
    `  Ocupación de almacenes: ${kpis.occupancyPercent ?? 0}%`,
    `  Maletas en riesgo:      ${kpis.atRisk ?? 0}`,
    `  Fuera de plazo:         ${kpis.outOfDeadline ?? 0}`,
    `  Total maletas:          ${kpis.totalBags ?? 0}`,
    `  Maletas ruteadas:       ${kpis.routedBags ?? 0}`,
    `  Entregadas a tiempo:    ${kpis.deliveredOnTime ?? 0}`,
    "",
    `Generado: ${new Date().toLocaleString()}`,
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([lines], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "tasf-colapso.txt";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Alerta de colapso logístico. El colapso es IRREVERSIBLE: el backend ya
 * detuvo la simulación en el instante de la detección, así que aquí no hay
 * "Ignorar" — solo revisar el estado congelado, exportar el informe o
 * terminar/reiniciar la corrida.
 */
export default function CollapseAlert({ onClose, onStop, message, kpis = {} }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center
                    bg-black/70 z-50">
      <div className="bg-[#1a0a0a] border-2 border-red-600 rounded-lg
                      p-6 max-w-lg w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-2 text-red-500 font-bold mb-3 text-sm">
          <AlertTriangle size={18}/>
          COLAPSO LOGÍSTICO DETECTADO
          <span className="ml-auto text-[10px] font-normal text-red-400/70
                           bg-red-900/30 px-2 py-0.5 rounded">
            Simulación detenida
          </span>
        </div>

        {/* Causa raíz detallada (multilínea, generada por el backend) */}
        <div className="text-gray-300 text-xs mb-4 whitespace-pre-line
                        font-mono leading-relaxed max-h-64 overflow-y-auto
                        bg-black/30 rounded p-3 border border-red-900/40">
          {message || "La capacidad de almacén ha sido excedida en uno o más aeropuertos."}
        </div>

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
            onClick={() => downloadReport(message, kpis)}
            title="Descargar informe del colapso (.txt)"
            className="flex items-center gap-1 px-3 py-2 bg-white/10
                       hover:bg-white/20 text-gray-300 text-sm rounded transition">
            <Download size={14}/> Informe
          </button>
          <button
            onClick={onClose}
            title="Cerrar la alerta y revisar el estado congelado"
            className="px-4 py-2 bg-white/10 hover:bg-white/20
                       text-gray-300 text-sm rounded transition">
            Revisar estado
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
