import { useState, useEffect, useRef } from "react";

const MAX_HISTORY = 300;

// Vuelos siempre directos. finalDestination indica si las maletas
// de esta fila llegan aquí a su destino final (true) o necesitan
// un vuelo adicional desde este aeropuerto (false).
//
// Un mismo vuelo puede generar DOS filas "landed" si transporta
// maletas con destinos finales distintos — ambas son válidas:
//   · landed + finalDestination  → esas maletas se entregan aquí
//   · landed + !finalDestination → esas maletas toman otro vuelo

function eventLabel(type, finalDestination) {
  if (type === "departed") return {
    text: "En Vuelo",
    sub:  "Vuelo en tránsito",
    bg:   "bg-yellow-700",
  };
  if (type === "landed" && finalDestination) return {
    text: "Entregado",
    sub:  "Maletas en su destino final",
    bg:   "bg-green-700",
  };
  return {
    text: "Transbordo",
    sub:  "Maletas conectan con otro vuelo",
    bg:   "bg-blue-700",
  };
}

function StatusBadge({ type, finalDestination }) {
  const { text, bg } = eventLabel(type, finalDestination);
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] text-white ${bg}`}>
      {text}
    </span>
  );
}

const FILTERS = [
  { key: "all",        label: "Todos"      },
  { key: "departed",   label: "En Vuelo"   },
  { key: "transbordo", label: "Transbordo" },
  { key: "entregado",  label: "Entregado"  },
];

function matchFilter(filter, e) {
  if (filter === "all")        return true;
  if (filter === "departed")   return e.type === "departed";
  if (filter === "transbordo") return e.type === "landed" && !e.finalDestination;
  if (filter === "entregado")  return e.type === "landed" &&  e.finalDestination;
  return true;
}

export default function HistoryView({ events = [], running = false }) {
  const [history, setHistory] = useState([]);
  const [filter,  setFilter]  = useState("all");
  const [search,  setSearch]  = useState("");
  const prevEventsRef         = useRef([]);

  useEffect(() => {
    if (!events || events.length === 0) return;

    // Comparar por contenido real, no por longitud — robusto ante arrays
    // que lleguen con la misma longitud pero distintos elementos.
    // finalDestination incluido para no perder la segunda fila "landed"
    // que genera un mismo vuelo con maletas de destinos distintos.
    const prev   = prevEventsRef.current;
    const newEvs = events.filter(e =>
      !prev.some(p =>
        p.minute           === e.minute            &&
        p.flightId         === e.flightId          &&
        p.type             === e.type              &&
        p.finalDestination === e.finalDestination
      )
    );
    if (newEvs.length === 0) return;
    prevEventsRef.current = events;

    setHistory(h => {
      const combined = [...newEvs.slice().reverse(), ...h];
      const seen = new Set();
      return combined
        .filter(e => {
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
      prevEventsRef.current = [];
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

  // "En Vuelo" cuenta vuelos (unidad = vuelo).
  // "Transbordo" y "Entregado" suman maletas (unidad = maleta):
  // al operador le interesa saber cuántos vuelos están en el aire,
  // pero cuántas maletas están pendientes o ya entregadas.
  const counts = {
    enVuelo:    history.filter(e => e.type === "departed").length,
    transbordo: history
      .filter(e => e.type === "landed" && !e.finalDestination)
      .reduce((sum, e) => sum + (e.bags || 0), 0),
    entregado: history
      .filter(e => e.type === "landed" && e.finalDestination)
      .reduce((sum, e) => sum + (e.bags || 0), 0),
  };

  return (
    <div className="p-4 h-full flex flex-col">

      <div className="mb-3">
        <h2 className="text-teal font-bold text-base uppercase tracking-wide">
          Historial de Vuelos con Equipaje
        </h2>
        <p className="text-gray-500 text-[10px] mt-0.5">
          Cada fila es un evento de vuelo directo (salida o llegada).
          Un mismo vuelo puede generar dos filas al aterrizar: una por las
          maletas que llegan a su destino final y otra por las que continúan
          en otro vuelo. Últimos {MAX_HISTORY} eventos de la sesión.
        </p>
      </div>

      <div className="flex gap-2 mb-2 flex-wrap items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por vuelo, origen o destino..."
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
                    ${e.type === "landed" &&  e.finalDestination ? "bg-green-900/10" : ""}
                    ${e.type === "landed" && !e.finalDestination ? "bg-blue-900/10"  : ""}`}
                >
                  <td className="px-3 py-1.5 text-gray-600">{i + 1}</td>

                  <td className="px-3 py-1.5 text-gray-300 font-mono text-[10px]">
                    {e.flightId || "—"}
                  </td>

                  <td className="px-3 py-1.5">
                    <span className="text-teal font-medium">{e.from}</span>
                    <span className="text-gray-600 mx-1">→</span>
                    <span className="text-gray-200">{e.to}</span>
                  </td>

                  <td className="px-3 py-1.5 text-gray-400 text-right tabular-nums">
                    {(e.bags || 0).toLocaleString()}
                  </td>

                  <td className="px-3 py-1.5">
                    <StatusBadge type={e.type} finalDestination={e.finalDestination} />
                  </td>

                  <td className="px-3 py-1.5 text-gray-500 font-mono text-[10px]">
                    {e.clock || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {[
            ["En Vuelo",   counts.enVuelo,    "text-yellow-400", "vuelos en el aire"],
            ["Transbordo", counts.transbordo, "text-blue-400",   "maletas conectando con otro vuelo"],
            ["Entregado",  counts.entregado,  "text-green-400",  "maletas en destino final"],
          ].map(([label, val, color, sub]) => (
            <div
              key={label}
              className="bg-[#031525] border border-teal/20 rounded p-2 text-center"
            >
              <p className={`text-xl font-bold ${color}`}>{val}</p>
              <p className="text-gray-400 text-[10px] uppercase">{label}</p>
              <p className="text-gray-500 text-[10px] mt-0.5">{sub}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}