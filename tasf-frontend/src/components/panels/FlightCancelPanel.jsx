import { useState, useMemo, useEffect, useRef } from "react";

// Congela la lista de vuelos por FREEZE_MS después de cualquier actualización.
// Así en modo periodo (donde los vuelos cambian cada segundo) la tabla no
// baila y el usuario puede apuntar con el ratón sin que se mueva.
const FREEZE_MS = 4000;

export default function FlightCancelPanel({ flights = [], onCancel }) {
  const [open,        setOpen]        = useState(false);
  const [search,      setSearch]      = useState("");
  // Vuelo con cancelación en curso: { flightId, remaining }
  const [cancelling,  setCancelling]  = useState(null);
  // Lista congelada que no salta mientras el usuario interactúa
  const [frozen,      setFrozen]      = useState([]);
  const freezeTimer   = useRef(null);
  const countdownRef  = useRef(null);

  // ── Lista congelada ──────────────────────────────────────────────────────
  // Al recibir vuelos nuevos, solo actualizamos si no hay ningún freeze activo.
  // Cuando open cambia a true, forzamos una actualización inicial.
  useEffect(() => {
    if (!open) return;
    if (freezeTimer.current) return;           // congelada: ignorar actualización
    setFrozen(flights);
  }, [flights, open]);

  const freeze = () => {
    clearTimeout(freezeTimer.current);
    freezeTimer.current = setTimeout(() => {
      freezeTimer.current = null;
      setFrozen(flights);                      // actualizar al descongelar
    }, FREEZE_MS);
  };

  // Al abrir el panel, cargar la lista actual inmediatamente
  const handleOpen = () => {
    setOpen(o => {
      if (!o) setFrozen(flights);
      return !o;
    });
  };

  // ── Countdown de arrepentimiento ─────────────────────────────────────────
  useEffect(() => {
    if (!cancelling) return;
    if (cancelling.remaining <= 0) {
      // Tiempo agotado → ejecutar cancelación
      onCancel?.(cancelling.flightId, cancelling.meta);
      setCancelling(null);
      return;
    }
    countdownRef.current = setTimeout(() =>
      setCancelling(c => c ? { ...c, remaining: c.remaining - 1 } : null)
    , 1000);
    return () => clearTimeout(countdownRef.current);
  }, [cancelling, onCancel]);

  const startCancel = (f) => {
    freeze();
    setCancelling({
      flightId: f.flightId,
      remaining: 4,
      meta: { from: f.origin, to: f.destination, bags: f.assigned },
    });
  };

  const undoCancel = () => {
    clearTimeout(countdownRef.current);
    setCancelling(null);
  };

  // ── Filtro + orden ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const src = [...frozen].sort((a, b) => a.departureMinute - b.departureMinute);
    if (!q) return src;
    return src.filter(f =>
      f.flightId?.toLowerCase().includes(q) ||
      f.origin?.toLowerCase().includes(q) ||
      f.destination?.toLowerCase().includes(q)
    );
  }, [frozen, search]);

  return (
    <div className="absolute right-3 bottom-16 z-10 w-96">

      {/* Toggle */}
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

      {/* Banner de cancelación en curso — siempre visible aunque el panel esté cerrado */}
      {cancelling && (
        <div className="bg-red-950/90 border border-red-700 rounded px-3 py-2
                        flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-red-300 text-[11px] font-mono font-bold shrink-0">
              {cancelling.flightId}
            </span>
            <span className="text-red-400 text-[10px] truncate">
              {cancelling.meta.from}→{cancelling.meta.to}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Barra de progreso visual */}
            <div className="w-16 h-1.5 bg-red-900 rounded overflow-hidden">
              <div
                className="h-full bg-red-500 transition-all duration-1000"
                style={{ width: `${(cancelling.remaining / 4) * 100}%` }}/>
            </div>
            <span className="text-red-300 text-[10px] font-mono w-4 text-right">
              {cancelling.remaining}s
            </span>
            <button
              onClick={undoCancel}
              className="bg-gray-700 hover:bg-gray-600 text-white
                         text-[10px] px-2 py-0.5 rounded transition font-bold">
              Deshacer
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="bg-[#021020]/95 border border-teal/20 rounded p-2">

          {/* Buscador */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar vuelo, origen, destino…"
            className="w-full bg-[#031525] border border-white/10 rounded
                       px-2 py-1 text-xs text-gray-300 mb-2
                       focus:outline-none focus:border-teal"
          />

          <div className="flex items-center justify-between mb-1">
            <p className="text-teal text-[10px] font-bold uppercase">
              Próximos vuelos — más cercanos primero
            </p>
            <span className="text-gray-600 text-[9px]">
              {filtered.length} de {frozen.length}
            </span>
          </div>

          {/* Tabla con altura fija para que no salte al actualizarse */}
          <div className="h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-600 text-[10px]">
                  {search ? "Sin coincidencias" : "No hay vuelos próximos"}
                </p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#021020] z-10">
                  <tr className="text-gray-500 border-b border-white/10 text-[10px]">
                    <th className="text-left py-1 pr-2">Vuelo</th>
                    <th className="text-left py-1 pr-2">Ruta</th>
                    <th className="text-left py-1 pr-2">Sale</th>
                    <th className="text-left py-1 pr-2">Carga</th>
                    <th className="py-1"/>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(f => {
                    const isCancelling = cancelling?.flightId === f.flightId;
                    return (
                      <tr key={f.flightId}
                          className={`border-b border-white/5 transition
                            ${isCancelling
                              ? "bg-red-900/20 opacity-60"
                              : "hover:bg-white/5"}`}>
                        <td className="py-1.5 pr-2 text-teal font-mono text-[10px] font-bold">
                          {f.flightId}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-300 text-[10px]">
                          {f.origin}→{f.destination}
                        </td>
                        <td className="py-1.5 pr-2 text-gray-400 text-[10px] font-mono">
                          {f.departureClock?.split("  ")[1] ?? "--:--"}
                        </td>
                        <td className="py-1.5 pr-2">
                          <span className={`text-[10px] ${
                            f.assigned > f.capacity * 0.8
                              ? "text-orange-400"
                              : "text-gray-400"}`}>
                            {f.assigned}/{f.capacity}
                          </span>
                        </td>
                        <td className="py-1.5 text-right">
                          {isCancelling ? (
                            <span className="text-red-500 text-[10px]">cancelando…</span>
                          ) : (
                            <button
                              onClick={() => startCancel(f)}
                              disabled={!!cancelling}
                              className="bg-red-900/40 hover:bg-red-700 text-red-400
                                         hover:text-white text-[10px] px-2 py-0.5 rounded
                                         border border-red-800/50 transition
                                         disabled:opacity-30 disabled:cursor-not-allowed">
                              Cancelar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}