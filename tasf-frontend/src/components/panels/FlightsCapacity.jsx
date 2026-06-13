import { useState } from "react";

/**
 * Lista de todos los vuelos disponibles con su capacidad.
 * Mismo estilo de tarjeta que los demás paneles. Vive dentro de un panel
 * lateral colapsable, así que aquí solo se ocupa de su contenido.
 */
export default function FlightsCapacity({ flights = [] }) {
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();

  const filtered = query
    ? flights.filter(f =>
        (f.id          || "").toLowerCase().includes(query) ||
        (f.origin      || "").toLowerCase().includes(query) ||
        (f.destination || "").toLowerCase().includes(query))
    : flights;

  return (
    <div className="bg-[#031525] border border-teal/20 rounded p-2 mt-2">
      <p className="text-teal font-bold mb-2 uppercase tracking-wide text-[10px]">
        Vuelos y Capacidad
        <span className="text-gray-500 normal-case ml-1">({flights.length})</span>
      </p>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Filtrar por origen, destino o vuelo…"
        className="w-full bg-[#021020] border border-white/10 rounded
                   px-2 py-1 text-[11px] text-gray-300 mb-2
                   focus:outline-none focus:border-teal"
      />

      {flights.length === 0 ? (
        <p className="text-gray-600 text-center py-4 text-[10px]">
          Cargando vuelos…
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-600 text-center py-4 text-[10px]">
          Sin coincidencias
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[#031525]">
              <tr className="text-gray-500 border-b border-white/10 text-[10px]">
                <th className="text-left py-1">Ruta</th>
                <th className="text-left py-1">Salida</th>
                <th className="text-left py-1">Llegada</th>
                <th className="text-right py-1">Cap.</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => (
                <tr key={f.id} className="border-b border-white/5">
                  <td className="py-1">
                    <span className="text-teal">{f.origin}</span>
                    <span className="text-gray-600 mx-1">→</span>
                    <span className="text-gray-200">{f.destination}</span>
                  </td>
                  <td className="py-1 text-gray-400 font-mono text-[10px]">
                    {f.departureClock}
                  </td>
                  <td className="py-1 text-gray-400 font-mono text-[10px]">
                    {f.arrivalClock}
                  </td>
                  <td className="py-1 text-right text-gray-300 font-bold tabular-nums">
                    {(f.capacity || 0).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
