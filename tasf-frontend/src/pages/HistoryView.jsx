import { useState, useEffect, useRef } from "react";

const MAX_HISTORY = 300;

// Los vuelos son siempre directos (sin escalas).
// La "conexión" es responsabilidad del envío, no del vuelo.
//
// Estados posibles de un evento de vuelo:
// - departed → el vuelo salió y está en el aire
// - landed   → el vuelo llegó a su destino de tramo
//
// El campo finalDestination solo se usa como indicador visual (★)
// para señalar que ese vuelo trajo lotes a su destino final de envío,
// pero no define un estado distinto del vuelo en sí.

function eventLabel(type) {
  if (type === "departed") return {
    text: "En Vuelo",
    sub:  "Vuelo en tránsito",
    bg:   "bg-yellow-700",
    dot:  "bg-yellow-400",
  };
  return {
    text: "Aterrizó",
    sub:  "Vuelo completó su tramo",
    bg:   "bg-green-700",
    dot:  "bg-green-400",
  };
}

function StatusBadge({ type }) {
  const { text, bg } = eventLabel(type);
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] text-white ${bg}`}>
      {text}
    </span>
  );
}

const FILTERS = [
  { key: "all",      label: "Todos"    },
  { key: "departed", label: "En Vuelo" },
  { key: "landed",   label: "Aterrizó" },
];

function matchFilter(filter, e) {
  if (filter === "all")      return true;
  if (filter === "departed") return e.type === "departed";
  if (filter === "landed")   return e.type === "landed";
  return true;
}

export default function HistoryView({ events = [], running = false }) {
  const [history, setHistory] = useState([]);
  const [filter,  setFilter]  = useState("all");
  const [search,  setSearch]  = useState("");
  const prevLen               = useRef(0);

  useEffect(() => {
    if (!events || events.length === 0) return;
    if (events.length === prevLen.current) return;
    prevLen.current = events.length;

    setHistory(h => {
      const combined = [...events.slice().reverse(), ...h];
      const seen = new Set();
      return combined
        .filter(e => {
          // finalDestination en la clave evita colapsar las dos filas
          // "landed" que puede generar un mismo vuelo cuando transporta
          // lotes con destinos finales distintos
          const k = `${e.minute}-${e.flightId}-${e.type}-${e.finalDestination}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, MAX_HISTORY);
    });
  }, [events]);

  useEffect(() => {
    if (running) {
      setHistory([]);
      prevLen.current = 0;
    }
  }, [running]);

  const filtered = history.filter(e => {
    if (!matchFilter(filter, e)) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        e.from?.toLowerCase().includes(s)     ||
        e.to?.toLowerCase().includes(s)       ||
        e.flightId?.toLowerCase().includes(s)
      );
    }
    return true;
  });

  const counts = {
    enVuelo:     history.filter(e => e.type === "departed").length,
    aterrizados: history.filter(e => e.type === "landed").length,
  };

  return (
    <div className="p-4 h-full flex flex-col">

      <div className="mb-3">
        <h2 className="text-teal font-bold text-base uppercase tracking-wide">
          Historial de Vuelos con Equipaje
        </h2>
        <p className="text-gray-500 text-[10px] mt-0.5">
          Cada fila es un evento de un vuelo directo (salida o llegada).
          El ★ indica que ese vuelo entregó lotes en su destino final de envío.
          Últimos {MAX_HISTORY} eventos de la sesión.
        </p>
      </div>

      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por origen, destino o vuelo..."
          className="bg-[#031525] border border-teal/20 rounded px-3 py-1.5
                     text-xs text-gray-300 focus:outline-none focus:border-teal w-56"
        />
        <span className="ml-auto text-gray-600 text-xs">
          {filtered.length} / {history.length} eventos
        </span>
      </div>

      <div className="flex gap-1 mb-3 flex-wrap">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1 rounded text-xs font-medium transition
              ${filter === f.key
                ? "bg-teal text-white"
                : "bg-[#031525] border border-teal/20 text-gray-400 hover:text-white"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto bg-[#031525] border border-teal/20 rounded">
        {history.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm text-center px-4">
              {running
                ? "Esperando vuelos de la simulación..."
                : "Inicia la simulación para ver el historial de vuelos"}
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-gray-600 text-sm">
              Sin resultados para el filtro seleccionado
            </p>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[#021020] border-b border-teal/20">
                <th className="text-left px-3 py-2 text-gray-500 font-medium w-8">#</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Vuelo</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Tramo</th>
                <th className="text-right px-3 py-2 text-gray-500 font-medium">Maletas</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Estado</th>
                <th className="text-left px-3 py-2 text-gray-500 font-medium">Hora sim.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr
                  key={`${e.minute}-${e.flightId}-${e.type}-${e.finalDestination}-${i}`}
                  className={`border-b border-white/5 hover:bg-white/5 transition
                    ${e.type === "landed" ? "bg-green-900/10" : ""}`}
                >
                  <td className="px-3 py-1.5 text-gray-600">{i + 1}</td>

                  <td className="px-3 py-1.5 text-gray-300 font-mono text-[10px]">
                    {e.flightId || "—"}
                  </td>

                  <td className="px-3 py-1.5">
                    <span className="text-teal font-medium">{e.from}</span>
                    <span className="text-gray-600 mx-1">→</span>
                    <span className="text-gray-200">{e.to}</span>
                    {e.type === "landed" && e.finalDestination && (
                      <span
                        className="text-green-500 ml-1 text-[10px]"
                        title="Este vuelo entregó lotes en su destino final de envío"
                      >★</span>
                    )}
                  </td>

                  <td className="px-3 py-1.5 text-gray-400 text-right tabular-nums">
                    {(e.bags || 0).toLocaleString()}
                  </td>

                  <td className="px-3 py-1.5">
                    <StatusBadge type={e.type} />
                  </td>

                  <td className="px-3 py-1.5 text-gray-500 font-mono text-[10px]">
                    {e.clock || `min ${e.minute}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            ["En Vuelo",    counts.enVuelo,     "text-yellow-400",
             "Vuelos actualmente en el aire"],
            ["Aterrizados", counts.aterrizados, "text-green-400",
             "Vuelos que completaron su tramo"],
          ].map(([label, val, color, sub]) => (
            <div
              key={label}
              className="bg-[#031525] border border-teal/20 rounded p-2 text-center"
            >
              <p className={`text-xl font-bold ${color}`}>{val}</p>
              <p className="text-gray-400 text-[10px] uppercase">{label}</p>
              <p className="text-gray-600 text-[9px] mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}