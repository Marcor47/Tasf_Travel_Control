import { useState, useMemo, useEffect, useRef } from "react";

/* ──────────────────────────────────────────────────────────────────────────
 * DateTimePicker
 * Reemplaza la antigua lista desplegable de fechas + <input type="time"> por:
 *   • un calendario mensual donde SOLO son seleccionables las fechas que
 *     existen en el dataset (availableDates). El resto se ve atenuado y no
 *     se puede pulsar.
 *   • un reloj configurable (hora / minuto) para la hora de inicio.
 *
 * Contrato de props (idéntico al que ya usaba el Dashboard):
 *   selectedDate         "YYYY-MM-DD"  — fecha elegida
 *   availableDates       string[]      — fechas válidas del dataset, ISO, ordenadas
 *   onDateChange(iso)                  — callback al elegir una fecha
 *   selectedStartMinute  number        — minuto del día (0..1439)
 *   onStartMinuteChange(min)           — callback al cambiar hora/minuto
 *   disabled             boolean       — bloquea la edición (simulación en curso)
 * ────────────────────────────────────────────────────────────────────────── */

const WEEKDAYS = ["L", "M", "X", "J", "V", "S", "D"];
const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// "YYYY-MM-DD" → {y, m (0-based), d}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m: m - 1, d };
}
// componentes → "YYYY-MM-DD"
function toISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
// Lunes = 0 … Domingo = 6 para un (y, m, d)
function weekdayMonFirst(y, m, d) {
  return (new Date(y, m, d).getDay() + 6) % 7;
}

function yearRange(minY, maxY) {
  const out = [];
  for (let y = minY; y <= maxY; y++) out.push(y);
  return out;
}

export default function DateTimePicker({
  selectedDate = "",
  availableDates = [],
  onDateChange,
  selectedStartMinute = 0,
  onStartMinuteChange,
  disabled = false,
}) {
  // Conjunto de fechas válidas para búsquedas O(1)
  const validSet = useMemo(() => new Set(availableDates), [availableDates]);
  const firstValid = availableDates[0] || "";
  const lastValid  = availableDates[availableDates.length - 1] || "";

  // Mes visible en el calendario ({y, m}). Arranca en el mes de la fecha
  // seleccionada, o en el de la primera fecha disponible.
  const initial = parseISO(selectedDate || firstValid || "2026-01-01");
  const [view, setView] = useState({ y: initial.y, m: initial.m });

  // Si cambia la fecha seleccionada desde fuera, sincroniza el mes mostrado.
  useEffect(() => {
    if (selectedDate) {
      const p = parseISO(selectedDate);
      setView(v => (v.y === p.y && v.m === p.m ? v : { y: p.y, m: p.m }));
    }
  }, [selectedDate]);

  // Popover abierto/cerrado y cierre al hacer clic fuera.
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = e => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // ── Límites de navegación: no salir del rango del dataset ────────────────
  const minView = firstValid ? parseISO(firstValid) : null;
  const maxView = lastValid  ? parseISO(lastValid)  : null;
  const atMin = minView && (view.y < minView.y ||
    (view.y === minView.y && view.m <= minView.m));
  const atMax = maxView && (view.y > maxView.y ||
    (view.y === maxView.y && view.m >= maxView.m));

  const stepMonth = delta => {
    setView(v => {
      let m = v.m + delta, y = v.y;
      if (m < 0)  { m = 11; y -= 1; }
      if (m > 11) { m = 0;  y += 1; }
      return { y, m };
    });
  };

  // Años disponibles según el dataset (para el <select> de año).
  const years = useMemo(
    () => (minView && maxView ? yearRange(minView.y, maxView.y) : [view.y]),
    [minView, maxView, view.y],
  );

  // Salta a un (año, mes) concreto, recortando al rango válido del dataset.
  const jumpTo = (y, m) => {
    let ny = y, nm = m;
    if (minView && (ny < minView.y || (ny === minView.y && nm < minView.m))) {
      ny = minView.y; nm = minView.m;
    }
    if (maxView && (ny > maxView.y || (ny === maxView.y && nm > maxView.m))) {
      ny = maxView.y; nm = maxView.m;
    }
    setView({ y: ny, m: nm });
  };

  // ── Construcción de la grilla del mes (con huecos previos) ───────────────
  const cells = useMemo(() => {
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
    const lead = weekdayMonFirst(view.y, view.m, 1); // huecos antes del día 1
    const out = [];
    for (let i = 0; i < lead; i++) out.push(null);
    for (let d = 1; d <= daysInMonth; d++) out.push(d);
    return out;
  }, [view]);

  const pickDate = d => {
    if (d == null || disabled) return;
    const iso = toISO(view.y, view.m, d);
    if (!validSet.has(iso)) return;       // solo fechas del dataset
    onDateChange?.(iso);
    setOpen(false);
  };

  // ── Reloj de inicio (hora / minuto) ──────────────────────────────────────
  const hh = Math.floor(selectedStartMinute / 60);
  const mm = selectedStartMinute % 60;
  const setHour = h => onStartMinuteChange?.(
    Math.min(23, Math.max(0, h)) * 60 + mm);
  const setMin  = m => onStartMinuteChange?.(
    hh * 60 + Math.min(59, Math.max(0, m)));

  const prettyDate = selectedDate
    ? (() => { const p = parseISO(selectedDate);
        return `${String(p.d).padStart(2, "0")} ${MONTHS[p.m].slice(0, 3)} ${p.y}`; })()
    : "—";
  const prettyTime =
    `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;

  return (
    <div ref={rootRef} className="relative inline-block">
      {/* Disparador: muestra fecha + hora elegidas */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-2 bg-[#021020] border border-white/10 rounded
                   px-2.5 py-1 text-xs text-gray-300 hover:border-teal/60
                   focus:outline-none focus:border-teal transition
                   disabled:opacity-40 disabled:cursor-not-allowed"
        title="Elegir fecha y hora de inicio"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             className="text-teal" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M3 9h18M8 2v4M16 2v4" />
        </svg>
        <span className="text-gray-300">{prettyDate}</span>
        <span className="text-gray-600">·</span>
        <span className="text-teal font-mono">{prettyTime}</span>
        <span className="text-gray-500 text-[9px]">{open ? "▴" : "▾"}</span>
      </button>

      {/* Popover: calendario + reloj */}
      {open && !disabled && (
        <div className="absolute left-0 top-full mt-1 z-50 w-[268px]
                        bg-[#031525] border border-teal/30 rounded-lg shadow-2xl
                        shadow-black/60 p-3">
          {/* Cabecera de navegación de mes */}
          <div className="flex items-center gap-1 mb-2">
            <button type="button" onClick={() => stepMonth(-1)} disabled={atMin}
              className="w-6 h-6 shrink-0 grid place-items-center rounded text-gray-400
                         hover:bg-white/10 hover:text-teal transition
                         disabled:opacity-25 disabled:cursor-not-allowed">‹</button>

            <div className="flex-1 flex gap-1">
              {/* Selector de mes */}
              <select
                value={view.m}
                onChange={e => jumpTo(view.y, Number(e.target.value))}
                className="flex-1 bg-[#021020] border border-white/10 rounded px-1 py-1
                           text-xs text-teal font-bold uppercase tracking-wide
                           focus:outline-none focus:border-teal">
                {MONTHS.map((name, idx) => {
                  const disabledOpt =
                    (minView && view.y === minView.y && idx < minView.m) ||
                    (maxView && view.y === maxView.y && idx > maxView.m);
                  return (
                    <option key={name} value={idx} disabled={disabledOpt}
                            className="bg-[#031525]">
                      {name}
                    </option>
                  );
                })}
              </select>

              {/* Selector de año */}
              <select
                value={view.y}
                onChange={e => jumpTo(Number(e.target.value), view.m)}
                className="bg-[#021020] border border-white/10 rounded px-1 py-1
                           text-xs text-teal font-bold tracking-wide
                           focus:outline-none focus:border-teal">
                {years.map(y => (
                  <option key={y} value={y} className="bg-[#031525]">{y}</option>
                ))}
              </select>
            </div>

            <button type="button" onClick={() => stepMonth(1)} disabled={atMax}
              className="w-6 h-6 shrink-0 grid place-items-center rounded text-gray-400
                         hover:bg-white/10 hover:text-teal transition
                         disabled:opacity-25 disabled:cursor-not-allowed">›</button>
          </div>

          {/* Cabecera de días de la semana */}
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {WEEKDAYS.map((w, i) => (
              <div key={i} className="text-center text-[10px] text-gray-600 font-medium">
                {w}
              </div>
            ))}
          </div>

          {/* Grilla del mes */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (d == null) return <div key={`x${i}`} />;
              const iso = toISO(view.y, view.m, d);
              const ok = validSet.has(iso);
              const isSel = iso === selectedDate;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => pickDate(d)}
                  disabled={!ok}
                  title={ok ? iso : "Sin datos en el dataset"}
                  className={[
                    "h-7 rounded text-xs transition",
                    isSel
                      ? "bg-teal text-white font-bold"
                      : ok
                        ? "text-gray-200 hover:bg-teal/25 cursor-pointer"
                        : "text-gray-700 cursor-not-allowed",
                  ].join(" ")}
                >
                  {d}
                </button>
              );
            })}
          </div>

          {/* Aviso si el dataset está vacío */}
          {availableDates.length === 0 && (
            <p className="text-gray-600 text-[10px] italic text-center mt-2">
              Cargando fechas del dataset…
            </p>
          )}

          {/* ── Reloj configurable ──────────────────────────────────────── */}
          <div className="border-t border-white/10 mt-3 pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-teal text-[10px] font-bold uppercase tracking-wide">
                Hora de inicio
              </span>
              <span className="font-mono text-sm text-teal">{prettyTime}</span>
            </div>

            <div className="flex items-center justify-center gap-2">
              {/* Horas */}
              <div className="flex flex-col items-center">
                <button type="button" onClick={() => setHour(hh + 1)}
                  className="w-9 h-5 grid place-items-center rounded text-gray-400
                             hover:bg-white/10 hover:text-teal transition">▲</button>
                <input
                  type="number" min="0" max="23" value={hh}
                  onChange={e => setHour(Number(e.target.value) || 0)}
                  className="w-12 text-center bg-[#021020] border border-white/10 rounded
                             py-1 text-sm font-mono text-gray-200
                             focus:outline-none focus:border-teal
                             [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button type="button" onClick={() => setHour(hh - 1)}
                  className="w-9 h-5 grid place-items-center rounded text-gray-400
                             hover:bg-white/10 hover:text-teal transition">▼</button>
                <span className="text-[9px] text-gray-600 mt-0.5">HH</span>
              </div>

              <span className="text-gray-500 text-lg font-mono pb-4">:</span>

              {/* Minutos */}
              <div className="flex flex-col items-center">
                <button type="button" onClick={() => setMin(mm + 1)}
                  className="w-9 h-5 grid place-items-center rounded text-gray-400
                             hover:bg-white/10 hover:text-teal transition">▲</button>
                <input
                  type="number" min="0" max="59" value={mm}
                  onChange={e => setMin(Number(e.target.value) || 0)}
                  className="w-12 text-center bg-[#021020] border border-white/10 rounded
                             py-1 text-sm font-mono text-gray-200
                             focus:outline-none focus:border-teal
                             [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button type="button" onClick={() => setMin(mm - 1)}
                  className="w-9 h-5 grid place-items-center rounded text-gray-400
                             hover:bg-white/10 hover:text-teal transition">▼</button>
                <span className="text-[9px] text-gray-600 mt-0.5">MM</span>
              </div>
            </div>

            {/* Atajos de hora frecuentes */}
            <div className="flex justify-center gap-1 mt-2">
              {[["00:00", 0], ["06:00", 360], ["12:00", 720], ["18:00", 1080]].map(
                ([label, min]) => (
                  <button key={label} type="button"
                    onClick={() => onStartMinuteChange?.(min)}
                    className={`text-[10px] px-2 py-0.5 rounded transition ${
                      selectedStartMinute === min
                        ? "bg-teal text-white"
                        : "bg-[#021020] text-gray-400 border border-white/10 hover:border-teal/50"
                    }`}>
                    {label}
                  </button>
                ),
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}