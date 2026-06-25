import { useState, useMemo } from "react";

const SORT_FIELDS = {
  flightId:       (f) => f.flightId,
  origin:         (f) => f.origin,
  destination:    (f) => f.destination,
  departureMinute:(f) => f.departureMinute,
  arrivalMinute:  (f) => f.arrivalMinute ?? f.departureMinute,
};

function SortHeader({ label, field, sortField, sortDir, onSort }) {
  const active = sortField === field;
  return (
    <th
      className="text-left py-1 cursor-pointer select-none hover:text-teal transition"
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (sortDir === "asc" ? " ▲" : " ▼") : " ↕"}
    </th>
  );
}

export default function FlightCancelPanel({ flights = [], onCancel }) {
  const [open,        setOpen]        = useState(false);
  const [confirming,  setConfirming]  = useState(null);
  const [searchTerm,  setSearchTerm]  = useState("");
  const [sortField,   setSortField]   = useState("departureMinute");
  const [sortDir,     setSortDir]     = useState("asc");

  const handleOpen = () => setOpen(o => !o);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return flights.filter(f => {
      if (!term) return true;
      return (
        f.flightId?.toLowerCase().includes(term) ||
        f.origin?.toLowerCase().includes(term) ||
        f.destination?.toLowerCase().includes(term)
      );
    });
  }, [flights, searchTerm]);

  const sorted = useMemo(() => {
    const getter = SORT_FIELDS[sortField] ?? SORT_FIELDS.departureMinute;
    return [...filtered].sort((a, b) => {
      const va = getter(a);
      const vb = getter(b);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortDir]);

  return (
    <div className="absolute right-3 bottom-16 z-10 w-96">

      <button
        onClick={handleOpen}
        className="ml-auto flex items-center justify-between w-full
                   bg-[#021020]/90 border border-red-800/50 rounded
                   px-3 py-1.5 text-xs text-red-400 font-bold
                   hover:bg-red-900/30 transition mb-1">
        <span>✈ Cancelar vuelo</span>
        <span className="flex items-center gap-2">
          <span className="text-gray-500 font-normal">{flights.length} vuelos</span>
          <span>{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div className="bg-[#021020]/95 border border-teal/20 rounded p-2
                        w-[480px] max-h-80 flex flex-col">

          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Buscar por código, origen o destino…"
            className="w-full bg-[#031525] border border-white/10 rounded px-2 py-1
                       text-[11px] text-gray-300 placeholder-gray-600
                       focus:outline-none focus:border-teal mb-2"
          />

          <p className="text-teal text-[10px] font-bold uppercase mb-1">
            Próximos vuelos sin despegar
            {searchTerm && (
              <span className="text-gray-500 normal-case font-normal ml-1">
                ({sorted.length} resultado{sorted.length !== 1 ? "s" : ""})
              </span>
            )}
          </p>

          <div className="overflow-y-auto flex-1">
            {sorted.length === 0 ? (
              <p className="text-gray-600 text-[10px] text-center py-3">
                {searchTerm ? "Sin resultados para esa búsqueda" : "No hay vuelos próximos disponibles"}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#021020]/95">
                  <tr className="text-gray-500 border-b border-white/10 text-[10px]">
                    <SortHeader label="Vuelo"   field="flightId"        sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                    <SortHeader label="Origen"  field="origin"          sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                    <SortHeader label="Destino" field="destination"     sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                    <SortHeader label="Salida"  field="departureMinute" sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                    <SortHeader label="Llegada" field="arrivalMinute"   sortField={sortField} sortDir={sortDir} onSort={handleSort}/>
                    <th className="text-left py-1">Carga</th>
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
                      <td className="py-1.5 text-gray-300 text-[10px]">{f.origin}</td>
                      <td className="py-1.5 text-gray-300 text-[10px]">{f.destination}</td>
                      <td className="py-1.5 text-gray-400 text-[10px] font-mono">
                        {f.departureClock?.split("  ")[1] ?? "--:--"}
                      </td>
                      <td className="py-1.5 text-gray-400 text-[10px] font-mono">
                        {f.arrivalClock?.split("  ")[1] ?? "--:--"}
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
        </div>
      )}
    </div>
  );
}
