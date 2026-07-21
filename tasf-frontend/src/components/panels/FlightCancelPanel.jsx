import { useState, useMemo } from "react";
import { Plane } from "lucide-react";
import { airportName, AIRPORT_META } from "../../data/staticAirports";

// Minuto del día (0–1439) → "HH:MM".
const hhmm = (m) => {
  const x = (((m ?? 0) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};

const SORT_FIELDS = {
  flightId:        (f) => f.flightId,
  origin:          (f) => f.origin,
  destination:     (f) => f.destination,
  departureMinute: (f) => f.departureMinute,
  arrivalMinute:   (f) => f.arrivalMinute ?? f.departureMinute,
};

function SortHeader({ label, field, sortField, sortDir, onSort }) {
  const active = sortField === field;
  return (
    <th className="text-left py-1 cursor-pointer select-none hover:text-teal transition"
        onClick={() => onSort(field)}>
      {label}{active ? (sortDir === "asc" ? " ▲" : " ▼") : " ↕"}
    </th>
  );
}

/**
 * Panel de cancelación de vuelos. `flights` son TODOS los vuelos vivos de la red
 * (endpoint /scheduledFlights): al buscar por ciudad o código se listan todos los
 * que coinciden (no solo los próximos 120 min). Cada vuelo trae `cancelTarget`
 * ("hoy"/"mañana") = qué instancia cancelaría la regla de 1 h, y `alreadyCancelled`.
 * Al cancelar se pasa al padre el detalle para el popup de confirmación.
 */
export default function FlightCancelPanel({
  flights = [], onCancel, embedded = false, simulatedNow = 0,
}) {
  const [open,       setOpen]       = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField,  setSortField]  = useState("departureMinute");
  const [sortDir,    setSortDir]    = useState("asc");

  const handleSort = (field) => {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  };

  const norm = s => (s || "").toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");

  const filtered = useMemo(() => {
    const q = norm(searchTerm.trim());
    if (!q) return [];
    return flights.filter(f => {
      const om = AIRPORT_META[f.origin]      || {};
      const dm = AIRPORT_META[f.destination] || {};
      return [f.flightId, f.origin, f.destination,
              om.name, om.country, dm.name, dm.country]
        .some(s => norm(s).includes(q));
    });
  }, [flights, searchTerm]);

  const sorted = useMemo(() => {
    const getter = SORT_FIELDS[sortField] ?? SORT_FIELDS.departureMinute;
    return [...filtered].sort((a, b) => {
      const va = getter(a), vb = getter(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDir]);

  // Detalle del popup (qué vuelo, hoy/mañana, horas) al confirmar la cancelación.
  const doCancel = (f) => {
    onCancel(f.flightId, {
      flightId: f.flightId, from: f.origin, to: f.destination,
      dia: f.cancelTarget || "hoy",
      salida: hhmm(f.departureMinute),
      canceladoA: hhmm(simulatedNow),
    });
    setConfirming(null);
  };

  const content = (
    <div className="flex flex-col h-full min-h-0">
      <input
        type="text"
        value={searchTerm}
        onChange={e => setSearchTerm(e.target.value)}
        placeholder="Buscar por vuelo, ciudad o país (ej. Lima)…"
        className="w-full bg-[#031525] border border-white/10 rounded px-2 py-1
                   text-[11px] text-gray-300 placeholder-gray-600
                   focus:outline-none focus:border-teal mb-2 shrink-0"
      />
      {!searchTerm.trim() ? (
        <p className="text-gray-600 text-[10px] text-center py-3">
          Escribe para buscar un vuelo a cancelar
          <span className="block text-gray-700 mt-0.5">
            {flights.length} vuelos en la red
          </span>
        </p>
      ) : sorted.length === 0 ? (
        <p className="text-gray-600 text-[10px] text-center py-3">
          Sin resultados para esa búsqueda
        </p>
      ) : (
        <>
          <p className="text-teal text-[10px] font-bold uppercase mb-1 shrink-0">
            Vuelos de la red
            <span className="text-gray-500 normal-case font-normal ml-1">
              ({sorted.length} resultado{sorted.length !== 1 ? "s" : ""})
            </span>
          </p>
          <div className="overflow-y-auto flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[#021020]/95">
                <tr className="text-gray-500 border-b border-white/10 text-[10px]">
                  <SortHeader label="Vuelo"   field="flightId"        sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                  <SortHeader label="Origen"  field="origin"          sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                  <SortHeader label="Destino" field="destination"     sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                  <SortHeader label="Salida"  field="departureMinute" sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                  <SortHeader label="Llegada" field="arrivalMinute"   sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                  <th className="text-left py-1">Carga</th>
                  <th className="text-left py-1">Cancela</th>
                  <th className="py-1"/>
                </tr>
              </thead>
              <tbody>
                {sorted.map(f => (
                  <tr key={f.flightId}
                      className="border-b border-white/5 hover:bg-white/5 transition">
                    <td className="py-1.5 text-teal font-mono text-[10px] font-bold">
                      {f.flightId}
                    </td>
                    <td className="py-1.5 text-gray-300 text-[10px]" title={f.origin}>
                      {airportName(f.origin)}
                    </td>
                    <td className="py-1.5 text-gray-300 text-[10px]" title={f.destination}>
                      {airportName(f.destination)}
                    </td>
                    <td className="py-1.5 text-gray-400 text-[10px] font-mono">
                      {hhmm(f.departureMinute)}
                    </td>
                    <td className="py-1.5 text-gray-400 text-[10px] font-mono">
                      {hhmm(f.arrivalMinute)}
                    </td>
                    <td className="py-1.5 text-gray-400 text-[10px]">
                      {f.load ?? 0}/{f.capacity}
                    </td>
                    {/* Tag hoy/mañana: qué instancia cancelaría la regla de 1 h. */}
                    <td className="py-1.5">
                      <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                        f.cancelTarget === "mañana"
                          ? "bg-orange-900/40 text-orange-300"
                          : "bg-red-900/30 text-red-300"}`}>
                        {f.cancelTarget || "hoy"}
                      </span>
                    </td>
                    <td className="py-1.5">
                      {f.alreadyCancelled ? (
                        <span className="text-gray-600 text-[9px]">ya cancelado</span>
                      ) : confirming === f.flightId ? (
                        <div className="flex gap-1">
                          <button onClick={() => doCancel(f)}
                            className="bg-red-700 hover:bg-red-600 text-white
                                       text-[10px] px-1.5 py-0.5 rounded transition">
                            Sí
                          </button>
                          <button onClick={() => setConfirming(null)}
                            className="bg-gray-700 hover:bg-gray-600 text-white
                                       text-[10px] px-1.5 py-0.5 rounded transition">
                            No
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirming(f.flightId)}
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
          </div>
        </>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <div className="absolute left-4 bottom-16 z-10 w-96">
      <button onClick={() => setOpen(o => !o)}
        className="ml-auto flex items-center justify-between w-full
                   bg-[#021020]/90 border border-red-800/50 rounded
                   px-3 py-1.5 text-xs text-red-400 font-bold
                   hover:bg-red-900/30 transition mb-1">
        <span className="flex items-center gap-1"><Plane size={12} className="shrink-0"/> Cancelar vuelo</span>
        <span className="flex items-center gap-2">
          <span className="text-gray-500 font-normal">{flights.length} vuelos</span>
          <span>{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div className="bg-[#021020]/95 border border-teal/20 rounded p-2
                        max-h-80 flex flex-col">
          {content}
        </div>
      )}
    </div>
  );
}
