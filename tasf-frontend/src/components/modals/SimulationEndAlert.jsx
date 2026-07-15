import { CheckCircle2, Download, X } from "lucide-react";

// % de maletas dentro de plazo según el plan vigente al cierre. Con 0 maletas
// no hay universo que medir: se reporta 100% (nada quedó fuera de plazo).
function pctOnTime(kpis) {
  const total = kpis.totalBags ?? 0;
  if (total <= 0) return 100;
  return Math.round(((total - (kpis.outOfDeadline ?? 0)) / total) * 100);
}

// Descarga un resumen .txt con los resultados finales de la corrida.
function downloadResults(kpis, clock, mode) {
  const lines = [
    "TASF.B2B — RESUMEN DE SIMULACIÓN DE PERÍODO",
    "=".repeat(45),
    "",
    `Modo:                     ${mode === "colapso" ? "Hasta colapso" : "Período (5 días)"}`,
    `Reloj simulado al cierre: ${clock ?? "—"}`,
    "",
    `Maletas procesadas:       ${kpis.totalBags ?? 0}`,
    `Maletas ruteadas:         ${kpis.routedBags ?? 0}`,
    `Entregadas a tiempo:      ${kpis.deliveredOnTime ?? 0}`,
    `Fuera de plazo:           ${kpis.outOfDeadline ?? 0}`,
    `Entrega dentro de plazo:  ${pctOnTime(kpis)}%`,
    `Replanificaciones:        ${kpis.replanifications ?? 0}`,
    "Colapsos detectados:      0 (la simulación completó todo el período)",
    "",
    `Generado: ${new Date().toLocaleString()}`,
  ].join("\n");
  const url = URL.createObjectURL(
    new Blob([lines], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "tasf-resumen-simulacion.txt";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Modal de FIN DE SIMULACIÓN de período (5 días / hasta colapso sin colapsar).
 * Aparece cuando el backend emite running=false con "Simulación finalizada":
 * el reloj simulado alcanzó simulationEnd. Un colapso NO pasa por aquí — eso
 * lo cubre CollapseAlert.
 */
export default function SimulationEndAlert({ onClose, kpis = {}, clock, mode }) {
  const pct = pctOnTime(kpis);
  return (
    <div className="absolute inset-0 flex items-center justify-center
                    bg-black/70 z-50">
      <div className="bg-[#031a12] border-2 border-green-600 rounded-lg
                      p-6 max-w-lg w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-2 text-green-400 font-bold mb-1 text-sm">
          <CheckCircle2 size={18}/>
          SIMULACIÓN DE PERÍODO COMPLETADA
        </div>
        <p className="text-gray-400 text-xs mb-4">
          El período simulado terminó de ejecutarse
          {clock ? <> — reloj final: <span className="text-gray-200 font-mono">{clock}</span></> : null}.
          Sin colapsos detectados.
        </p>

        {/* Resumen final de la corrida */}
        <div className="grid grid-cols-3 gap-2 mb-3 text-center">
          {[
            ["Maletas procesadas", (kpis.totalBags ?? 0).toLocaleString(), "text-gray-100"],
            ["Entrega a tiempo",   `${pct}%`,
              pct >= 90 ? "text-green-400" : pct >= 70 ? "text-yellow-400" : "text-red-400"],
            ["Fuera de plazo",     (kpis.outOfDeadline ?? 0).toLocaleString(),
              (kpis.outOfDeadline ?? 0) > 0 ? "text-red-400" : "text-green-400"],
          ].map(([l, v, c]) => (
            <div key={l} className="bg-black/30 rounded p-2 border border-green-900/40">
              <p className={`text-xl font-bold ${c}`}>{v}</p>
              <p className="text-gray-600 text-[10px] uppercase">{l}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2 mb-5 text-center">
          {[
            ["Ruteadas",           (kpis.routedBags ?? 0).toLocaleString()],
            ["Entregadas a tiempo",(kpis.deliveredOnTime ?? 0).toLocaleString()],
            ["Replanificaciones",  (kpis.replanifications ?? 0).toLocaleString()],
          ].map(([l, v]) => (
            <div key={l} className="bg-black/30 rounded p-2 border border-white/5">
              <p className="text-sm font-bold text-gray-200">{v}</p>
              <p className="text-gray-600 text-[10px] uppercase">{l}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 bg-green-700 hover:bg-green-600 text-white
                       text-sm py-2 rounded font-medium transition">
            CERRAR
          </button>
          <button
            onClick={() => downloadResults(kpis, clock, mode)}
            title="Descargar resumen de resultados (.txt)"
            className="flex items-center gap-1 px-3 py-2 bg-white/10
                       hover:bg-white/20 text-gray-300 text-sm rounded transition">
            <Download size={14}/> Descargar resultados
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
