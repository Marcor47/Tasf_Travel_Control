import { useEffect, useRef, useState, useMemo } from "react";
import {
  ComposableMap, Geographies, Geography,
  Marker, Line
} from "react-simple-maps";
import { STATIC_AIRPORTS } from "../../data/staticAirports";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

function injectAnimation() {
  if (document.getElementById("route-anim-style")) return;
  const style = document.createElement("style");
  style.id = "route-anim-style";
  style.textContent = `
    @keyframes dashMove {
      from { stroke-dashoffset: 24; }
      to   { stroke-dashoffset: 0; }
    }
    .route-active { animation: dashMove 1.4s linear infinite; }
    .route-plane  { filter: drop-shadow(0 0 5px rgba(244,162,97,0.85)); }
  `;
  document.head.appendChild(style);
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

/**
 * Reloj simulado suavizado.
 *
 * El backend solo emite `simulatedMinute` cada ~800 ms, así que usarlo
 * directamente hace que los aviones salten a tirones. Aquí interpolamos
 * con requestAnimationFrame: medimos la velocidad entre las dos últimas
 * muestras y extrapolamos hacia adelante, con un tope de un paso para no
 * dispararnos si el stream se atasca. El resultado es un minuto continuo
 * que avanza de forma fluida entre emisiones.
 */
function useSmoothMinute(targetMinute, running) {
  const [display, setDisplay] = useState(targetMinute);
  // Inicialización perezosa del ref (sin llamar a performance.now en render)
  const s = useRef(null);
  if (s.current === null) {
    s.current = { curVal: targetMinute, curT: 0, rate: 0, disp: targetMinute };
  }

  // Registrar cada nueva muestra del backend y suavizar la velocidad (EMA).
  // Suavizar la velocidad evita los tirones cuando los broadcast (~800 ms)
  // llegan con jitter (red, GC, etc.).
  useEffect(() => {
    const now = performance.now();
    const r = s.current;
    if (targetMinute < r.curVal) {              // nueva simulación → reset
      r.curVal = targetMinute; r.curT = now; r.rate = 0; r.disp = targetMinute;
      return;
    }
    const dt = now - r.curT;
    if (r.curT > 0 && dt > 0) {
      const inst = (targetMinute - r.curVal) / dt;       // min simulados por ms
      r.rate = r.rate > 0 ? r.rate * 0.65 + inst * 0.35 : inst;
    }
    r.curVal = targetMinute;
    r.curT   = now;
  }, [targetMinute]);

  // Bucle de animación: lee siempre del ref, así NO se reinicia con cada
  // muestra (reiniciar rAF cada 800 ms provocaba microcortes).
  useEffect(() => {
    if (!running) return;
    const NOMINAL_MS = 850; // no extrapolar más de ~1 intervalo si se atasca
    let raf;
    const tick = () => {
      const r = s.current;
      const elapsed = Math.min(performance.now() - r.curT, NOMINAL_MS);
      let est = r.curVal + r.rate * elapsed;
      if (est < r.disp) est = r.disp;   // monotónico: nunca retrocede (sin tirones)
      r.disp = est;
      setDisplay(est);                  // dentro del callback de rAF (asíncrono)
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);

  return running ? display : targetMinute;
}

function planePosition(from, to, route, simulatedMinute) {
  const dep      = route.departureMinute ?? simulatedMinute;
  const arr      = route.arrivalMinute   ?? dep + 1;
  const progress = clamp01((simulatedMinute - dep) / Math.max(1, arr - dep));

  const rad = Math.PI / 180;

  const lat1 = from[1] * rad;
  const lon1 = from[0] * rad;
  const lat2 = to[1] * rad;
  const lon2 = to[0] * rad;

  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.asin(Math.sqrt(a));

  if (c === 0) return { coordinates: from, angle: 0 };

  const A = Math.sin((1 - progress) * c) / Math.sin(c);
  const B = Math.sin(progress * c) / Math.sin(c);

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) / rad;
  const lng = Math.atan2(y, x) / rad;

  const progNext = Math.min(1, progress + 0.001);
  const An = Math.sin((1 - progNext) * c) / Math.sin(c);
  const Bn = Math.sin(progNext * c) / Math.sin(c);
  const xn = An * Math.cos(lat1) * Math.cos(lon1) + Bn * Math.cos(lat2) * Math.cos(lon2);
  const yn = An * Math.cos(lat1) * Math.sin(lon1) + Bn * Math.cos(lat2) * Math.sin(lon2);
  const zn = An * Math.sin(lat1) + Bn * Math.sin(lat2);

  const latNext = Math.atan2(zn, Math.sqrt(xn * xn + yn * yn)) / rad;
  const lngNext = Math.atan2(yn, xn) / rad;

  const mY1 = Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));
  const mY2 = Math.log(Math.tan(Math.PI / 4 + latNext * rad / 2));
  const dx  = (lngNext - lng) * rad;
  const dy  = -(mY2 - mY1);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return { coordinates: [lng, lat], angle };
}

// Identidad estable de una ruta. RouteState no trae flightId, así que se
// distingue por origen-destino + minuto de salida: así dos vuelos concurrentes
// en la misma ruta no se colapsan, y los eventos duplicados del mismo vuelo sí.
const routeKey = r => r.flightId || `${r.from}-${r.to}-${r.departureMinute ?? 0}`;

export default function WorldMap({
  airports = [],
  routes = [],
  onAirportClick,
  running = false,
  message = "",
  simulatedMinute = 0,
  activeFlightsCount = 0,
  highlightCodes = [],
}) {
  useEffect(() => { injectAnimation(); }, []);

  const [showLines,  setShowLines]  = useState(true);
  const [showPlanes, setShowPlanes] = useState(true);
  const [lineMode,   setLineMode]   = useState("limited");
  const [zoom,       setZoom]       = useState(1);
  const [center,     setCenter]     = useState([20, 10]);
  const [dragging,   setDragging]   = useState(false);
  // Selección para resaltado: { kind:"airport", code } | { kind:"route", key } | null
  const [selected,   setSelected]   = useState(null);

  const dragStart    = useRef(null);
  const dragMoved    = useRef(false);
  const mapRef       = useRef(null);

  // Minuto continuo y suavizado para mover los aviones sin saltos.
  // En pausa congelamos la interpolación (los aviones quedan quietos).
  const paused        = message === "Pausado";
  const displayMinute = useSmoothMinute(simulatedMinute, running && !paused);

  // Rutas en el aire: salieron (departed), aún no aterrizan según el backend
  // y, además, el reloj suavizado todavía no alcanza su minuto de llegada.
  // Esta última condición hace que el avión desaparezca exactamente al llegar,
  // sin esperar al siguiente broadcast (~800 ms).
  const allActive = useMemo(() => {
    if (!running || routes.length === 0) return [];
    const seen = new Set();
    return routes
      .filter(r => r.status === "departed")
      .filter(r => displayMinute < (r.arrivalMinute ?? Infinity))
      .filter(r => {
        const k = routeKey(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [running, routes, displayMinute]);

  // Selección efectiva: si la ruta seleccionada ya aterrizó y desapareció,
  // se trata como "sin selección" (derivado, sin tocar el estado).
  const effectiveSelected = useMemo(() => {
    if (selected && selected.kind === "route"
        && !allActive.some(r => routeKey(r) === selected.key)) {
      return null;
    }
    return selected;
  }, [selected, allActive]);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const handler = (e) => {
      e.preventDefault();
      setZoom(z => Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.2 : 0.85))));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragMoved.current = false;
    dragStart.current = { x: e.clientX, y: e.clientY, center: [...center] };
  };

  const handleMouseMove = (e) => {
    if (!dragging || !dragStart.current) return;
    const dx = (e.clientX - dragStart.current.x) / (zoom * 2);
    const dy = (e.clientY - dragStart.current.y) / (zoom * 2);
    if (Math.abs(e.clientX - dragStart.current.x) > 3 ||
        Math.abs(e.clientY - dragStart.current.y) > 3) {
      dragMoved.current = true;
    }
    setCenter([
      dragStart.current.center[0] - dx,
      dragStart.current.center[1] + dy,
    ]);
  };

  const handleMouseUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  // Click en el fondo del mapa (sin arrastrar) limpia la selección
  const handleBackgroundClick = () => {
    if (!dragMoved.current) setSelected(null);
  };

  const shownAirports = airports.length > 0 ? airports : STATIC_AIRPORTS;
  const airportMap    = Object.fromEntries(
    shownAirports.map(a => [a.code, [a.lng, a.lat]])
  );

  const visibleRoutes = lineMode === "limited"
    ? allActive.slice(0, 40)
    : allActive;

  const activeRoutes = (showLines || showPlanes) ? visibleRoutes : [];

  const isCalculating = running && message.startsWith("Planificando");

  // ── Lógica de resaltado ──────────────────────────────────────────────────
  // Aeropuertos conectados al seleccionado (para resaltar también sus vecinos)
  const neighborCodes = useMemo(() => {
    if (!effectiveSelected || effectiveSelected.kind !== "airport") return new Set();
    const code = effectiveSelected.code;
    const set = new Set([code]);
    allActive.forEach(r => {
      if (r.from === code) set.add(r.to);
      if (r.to   === code) set.add(r.from);
    });
    return set;
  }, [effectiveSelected, allActive]);

  // Resaltado externo proveniente del filtro de almacenes (código/país/región).
  // Cuando está activo tiene prioridad sobre la selección por clic.
  const externalHl = useMemo(() => new Set(highlightCodes), [highlightCodes]);
  const filtering  = externalHl.size > 0;

  const routeIsHighlighted = (r) => {
    if (filtering) return externalHl.has(r.from) || externalHl.has(r.to);
    if (!effectiveSelected) return true;
    if (effectiveSelected.kind === "airport")
      return r.from === effectiveSelected.code || r.to === effectiveSelected.code;
    if (effectiveSelected.kind === "route") return routeKey(r) === effectiveSelected.key;
    return true;
  };

  const airportIsHighlighted = (code) => {
    if (filtering) return externalHl.has(code);
    if (!effectiveSelected) return true;
    if (effectiveSelected.kind === "airport") return neighborCodes.has(code);
    if (effectiveSelected.kind === "route") {
      const r = allActive.find(x => routeKey(x) === effectiveSelected.key);
      return !!r && (r.from === code || r.to === code);
    }
    return true;
  };

  const selectAirport = (code) =>
    setSelected(s => (s && s.kind === "airport" && s.code === code)
      ? null : { kind: "airport", code });

  const selectRoute = (key) =>
    setSelected(s => (s && s.kind === "route" && s.key === key)
      ? null : { kind: "route", key });

  return (
    <div
      ref={mapRef}
      className="w-full h-full bg-[#031525] rounded border border-teal/20 relative select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ cursor: dragging ? "grabbing" : zoom > 1 ? "grab" : "default" }}>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between px-2 pt-2 pb-1 gap-2">
        <p className="text-teal text-[10px] font-bold uppercase tracking-wide flex-shrink-0">
          Monitoreo de Rutas y Posición GPS Real
        </p>

        <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
          {isCalculating && (
            <span className="text-[10px] text-yellow-400 animate-pulse">
              ⚙ {message}
            </span>
          )}
          {running && !isCalculating && (
            <span className="text-[10px] text-gray-400">
              ✈ <span className="text-white font-bold">{activeFlightsCount}</span> vuelos activos
              {(showLines || showPlanes) && lineMode === "limited" && activeFlightsCount > 40 && (
                <span className="text-gray-600 ml-1">(mostrando 40 en mapa)</span>
              )}
            </span>
          )}
          {filtering ? (
            <span className="text-[10px] text-teal flex items-center gap-1">
              ◉ {externalHl.size} aeropuerto{externalHl.size === 1 ? "" : "s"} resaltado{externalHl.size === 1 ? "" : "s"}
            </span>
          ) : effectiveSelected && (
            <span className="text-[10px] text-teal flex items-center gap-1">
              ◉ {effectiveSelected.kind === "airport" ? effectiveSelected.code : effectiveSelected.key}
              <button
                onClick={() => setSelected(null)}
                className="ml-1 px-1.5 py-0.5 rounded bg-gray-900/70 border border-white/10
                           text-gray-400 hover:text-white transition">
                ✕ Limpiar
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {zoom > 1 && (
            <button
              onClick={() => { setZoom(1); setCenter([20, 10]); }}
              className="text-[10px] px-2 py-0.5 rounded transition font-medium
                         bg-gray-900/70 text-gray-400 border border-white/10
                         hover:text-white mr-1">
              ↺ Reiniciar
            </button>
          )}
          {running && (
            <>
              <span className="text-gray-600 text-[10px]">Líneas:</span>
              <button
                onClick={() => setShowLines(v => !v)}
                className={`text-[10px] px-2 py-0.5 rounded transition font-medium
                  ${showLines
                    ? "bg-teal/20 text-teal border border-teal/40"
                    : "bg-gray-900/70 text-gray-500 border border-white/10"}`}>
                {showLines ? "ON" : "OFF"}
              </button>
              <span className="text-gray-600 text-[10px] ml-1">Aviones:</span>
              <button
                onClick={() => setShowPlanes(v => !v)}
                className={`text-[10px] px-2 py-0.5 rounded transition font-medium
                  ${showPlanes
                    ? "bg-teal/20 text-teal border border-teal/40"
                    : "bg-gray-900/70 text-gray-500 border border-white/10"}`}>
                {showPlanes ? "ON" : "OFF"}
              </button>
              {(showLines || showPlanes) && (
                <button
                  onClick={() => setLineMode(m => m === "limited" ? "all" : "limited")}
                  className={`text-[10px] px-2 py-0.5 rounded transition font-medium
                    ${lineMode === "limited"
                      ? "bg-teal/10 text-teal border border-teal/30"
                      : "bg-orange-900/40 text-orange-400 border border-orange-700/40"}`}>
                      {lineMode === "limited" ? `≤40 rutas` : `todas (${allActive.length})`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 120 * zoom, center }}
        style={{ width: "100%", height: "calc(100% - 34px)" }}>

        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#0a2540"
                stroke="#1C7293"
                strokeWidth={0.3}
                onClick={handleBackgroundClick}
                style={{
                  default: { outline: "none" },
                  hover:   { outline: "none" },
                  pressed: { outline: "none" },
                }}/>
            ))
          }
        </Geographies>

        {showLines && activeRoutes.map(r => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          const hl = routeIsHighlighted(r);
          return (
            <Line key={`active-${routeKey(r)}`}
              from={from} to={to}
              stroke="#F4A261"
              strokeWidth={effectiveSelected && hl ? 1.8 : 1.2}
              strokeLinecap="round" strokeDasharray="8 4"
              opacity={hl ? 1 : 0.12}
              className="route-active"/>
          );
        })}

        {showPlanes && activeRoutes.map(r => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          const plane = planePosition(from, to, r, displayMinute);
          const hl    = routeIsHighlighted(r);
          return (
            <Marker
              key={`plane-${routeKey(r)}`}
              coordinates={plane.coordinates}
              onClick={(e) => { e.stopPropagation(); selectRoute(routeKey(r)); }}>
              <g transform={`rotate(${plane.angle})`}
                 className="route-plane"
                 opacity={hl ? 1 : 0.15}
                 style={{ cursor: "pointer" }}>
                {/* Fuselaje */}
                <path d="M 10 0 L -6 -1.5 L -8 0 L -6 1.5 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                <path d="M 2 -1 L -3 -8 L -6 -7 L -3 -1 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                <path d="M 2 1 L -3 8 L -6 7 L -3 1 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                <path d="M -5 -1 L -7 -4 L -9 -3.5 L -8 0 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                <path d="M -5 1 L -7 4 L -9 3.5 L -8 0 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
              </g>
            </Marker>
          );
        })}

        {/* ✅ key correcto: a.code, sin referencias a variables de otro scope */}
        {shownAirports.map(a => {
          const pct  = Math.min(1, (a.current || 0) / Math.max(1, a.capacity || 1));
          const fill = pct > 0.85 ? "#E76F51"
                     : pct > 0.6  ? "#F4A261"
                     : "#1C7293";
          const r    = 3 + Math.round(pct * 4);
          const hl   = airportIsHighlighted(a.code);
          const isSel = (filtering && externalHl.has(a.code))
            || (!filtering && effectiveSelected && effectiveSelected.kind === "airport"
                && effectiveSelected.code === a.code);
          return (
            <Marker key={a.code}
              coordinates={[a.lng, a.lat]}
              onClick={(e) => {
                e.stopPropagation();
                selectAirport(a.code);
                onAirportClick?.(a);
              }}>
              <circle r={isSel ? r + 1.5 : r}
                fill={fill}
                stroke={isSel ? "#2dd4bf" : "#fff"}
                strokeWidth={isSel ? 1.6 : 0.8}
                opacity={hl ? 1 : 0.25}
                style={{ cursor: "pointer" }}/>
              <text textAnchor="middle" y={-(r + 3)}
                opacity={hl ? 1 : 0.25}
                style={{
                  fontSize: Math.max(5, 7 / Math.sqrt(zoom)),
                  fill: isSel ? "#2dd4bf" : "#9DBDCC",
                  fontFamily: "sans-serif",
                  pointerEvents: "none",
                }}>
                {a.code}
              </text>
            </Marker>
          );
        })}
      </ComposableMap>
    </div>
  );
}
