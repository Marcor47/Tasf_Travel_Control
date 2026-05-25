import { useState, useEffect, useRef } from "react";

const MAX_HISTORY = 200;

function statusBadge(type, finalDestination) {
  if (type === "landed" && finalDestination)
    return <span className="px-2 py-0.5 rounded text-[10px] bg-green-700 text-white">Entregado</span>;
  if (type === "landed")
    return <span className="px-2 py-0.5 rounded text-[10px] bg-blue-700 text-white">En Tránsito</span>;
  return <span className="px-2 py-0.5 rounded text-[10px] bg-yellow-700 text-white">Despegó</span>;
}

export default function HistoryView({ events = [], running = false }) {
  const [history, setHistory] = useState([]);
  const [filter, setFilter]   = useState("all");
  const [search, setSearch]   = useState("");
  const prevEventsRef          = useRef([]);

  // Acumular eventos nuevos en el historial
  useEffect(() => {
    if (!events || events.length === 0) return;
    const prev = prevEventsRef.current;
    const newEvs = events.filter(e =>
      !prev.some(p => p.minute === e.minute && p.flightId === e.flightId && p.type === e.type)
    );
    if (newEvs.length === 0) return;
    prevEventsRef.current = events;
    setHistory(h => {
      const combined = [...newEvs.reverse(), ...h];
      return combined.slice(0, MAX_HISTORY);
    });
  }, [events]);

  // Limpiar historial cuando se reinicia la simulación
  useEffect(() => {
    if (!running) return;
    setHistory([]);
    prevEventsRef.current = [];
  }, [running]);

  const filtered = history.filter(e => {
    if (filter === "landed"   && e.type !== "landed")   return false;
    if (filter === "departed" && e.type !== "departed") return false;
    if (filter === "delivered" && !(e.type === "landed" && e.finalDestination)) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!e.from?.toLowerCase().includes(s) && !e.to?.toLowerCase().includes(s)
          && !e.flightId?.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  return (
    <div className="p-4 h-full flex flex-col">
      <h2 className="text-teal font-bold text-base mb-3 uppercase tracking-wide">
        Historial de Vuelos
      </h2>

      {/* Filtros */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por ruta o vuelo..."
          className="bg-[#031525] border border-teal/20 rounded px-3 py-1.5
                     text-xs text-gray-300 focus:outline-none focus:border-teal w-48"/>
        {[
          ["all",       "Todos"],
          ["departed",  "Despegados"],
          ["landed",    "Aterrizados"],
          ["delivered", "Entregados"],
        ].map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className={`px-3 py-1.5 rounded text-xs font-medium transition
              ${filter === val
                ? "bg-teal text-white"
                : "bg-[#031525] border border-teal/20 text-gray-400 hover:text-white"}`}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-gray-600 text-xs self-center">
          {filtered.length} / {history.length} eventos
        </span>
      </div>

      {/* Tabla */}
      <div className="flex-1 overflow-y-auto bg-[#031525] border border-teal/20 rounded">
        {history.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm">
              {running
                ? "Esperando eventos de la simulación..."
                : "Inicia la simulación para ver el historial"}
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className="bg-[#021020] border-b border-teal/20">
                <th className="text-left px-3 py-2 text-gray-500 font-medium">#</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Vuelo</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Ruta</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Maletas</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Estado</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Min.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={`${e.minute}-${e.flightId}-${e.type}-${i}`}
                    className={`border-b border-white/5 hover:bg-white/5 transition
                      ${e.type === "landed" && e.finalDestination ? "bg-green-900/10" : ""}`}>
                  <td className="px-3 py-1.5 text-gray-600">{i + 1}</td>
                  <td className="px-3 py-1.5 text-gray-300 font-mono">{e.flightId || "—"}</td>
                  <td className="px-3 py-1.5 text-gray-300">
                    <span className="text-teal">{e.from}</span>
                    <span className="text-gray-600 mx-1">→</span>
                    <span className="text-gray-200">{e.to}</span>
                  </td>
                  <td className="px-3 py-1.5 text-gray-400">{e.bags?.toLocaleString()}</td>
                  <td className="px-3 py-1.5">{statusBadge(e.type, e.finalDestination)}</td>
                  <td className="px-3 py-1.5 text-gray-600 font-mono">{e.minute}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Resumen al pie */}
      {history.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            ["Despegados",  history.filter(e => e.type === "departed").length,  "text-yellow-400"],
            ["Aterrizados", history.filter(e => e.type === "landed").length,    "text-blue-400"],
            ["Entregados",  history.filter(e => e.type === "landed" && e.finalDestination).length, "text-green-400"],
          ].map(([label, val, color]) => (
            <div key={label} className="bg-[#031525] border border-teal/20 rounded p-2 text-center">
              <p className={`text-xl font-bold ${color}`}>{val}</p>
              <p className="text-gray-600 text-[10px] uppercase">{label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
