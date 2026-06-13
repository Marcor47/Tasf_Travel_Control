import { useEffect, useRef, useState } from "react";
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

function planePosition(from, to, route, simulatedMinute) {
  const dep      = route.departureMinute ?? simulatedMinute;
  const arr      = route.arrivalMinute   ?? dep + 1;
  const progress = clamp01((simulatedMinute - dep) / Math.max(1, arr - dep));

  const rad = Math.PI / 180;

  // 1. Interpolación de Gran Círculo (Slerp) para seguir la curva exacta de la línea
  const lat1 = from[1] * rad;
  const lon1 = from[0] * rad;
  const lat2 = to[1] * rad;
  const lon2 = to[0] * rad;

  const dLon = lon2 - lon1;
  const dLat = lat2 - lat1;

  // Fórmula de Haversine para la distancia angular
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

  // 2. Cálculo del ángulo visual proyectando un punto microscópicamente adelantado
  const progNext = Math.min(1, progress + 0.001);
  const An = Math.sin((1 - progNext) * c) / Math.sin(c);
  const Bn = Math.sin(progNext * c) / Math.sin(c);
  const xn = An * Math.cos(lat1) * Math.cos(lon1) + Bn * Math.cos(lat2) * Math.cos(lon2);
  const yn = An * Math.cos(lat1) * Math.sin(lon1) + Bn * Math.cos(lat2) * Math.sin(lon2);
  const zn = An * Math.sin(lat1) + Bn * Math.sin(lat2);
  
  const latNext = Math.atan2(zn, Math.sqrt(xn * xn + yn * yn)) / rad;
  const lngNext = Math.atan2(yn, xn) / rad;

  // Proyectar a Mercator para que el avión apunte perfectamente en la pantalla plana
  const mY1 = Math.log(Math.tan(Math.PI / 4 + lat * rad / 2));
  const mY2 = Math.log(Math.tan(Math.PI / 4 + latNext * rad / 2));
  const dx  = (lngNext - lng) * rad;
  const dy  = -(mY2 - mY1);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return { coordinates: [lng, lat], angle };
}

export default function WorldMap({
  airports = [],
  routes = [],
  onAirportClick,
  running = false,
  message = "",
  simulatedMinute = 0,
  activeFlightsCount = 0, // ← nuevo
}) {
  useEffect(() => { injectAnimation(); }, []);

  const [showLines,  setShowLines]  = useState(true);
  const [showPlanes, setShowPlanes] = useState(true);
  const [lineMode,   setLineMode]   = useState("limited");
  const [zoom,       setZoom]       = useState(1);
  const [center,     setCenter]     = useState([20, 10]);
  const [dragging,   setDragging]   = useState(false);

  const dragStart    = useRef(null);
  const mapRef       = useRef(null);
  const [, setTick]  = useState(0);

  const allActive = (!running || routes.length === 0)
    ? []
    : routes.filter(r =>
        r.status === "departed" &&
        r.departureMinute != null &&
        r.departureMinute <= simulatedMinute &&
        (r.arrivalMinute == null || simulatedMinute < r.arrivalMinute)
      ).filter((r, idx, arr) =>
        // deduplicar por flightId para que el límite de 40 sea exacto
        arr.findIndex(x => (x.flightId || `${x.from}-${x.to}`) === (r.flightId || `${r.from}-${r.to}`)) === idx
      );

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick(t => t + 1), 800);
    return () => clearInterval(id);
  }, [running]);

  // Añadir después del useEffect del tick:
  useEffect(() => {
    if (!running) setLineMode("limited");
  }, [running]);

  // Zoom con rueda — passive: false para poder hacer preventDefault
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
    dragStart.current = { x: e.clientX, y: e.clientY, center: [...center] };
  };

  const handleMouseMove = (e) => {
    if (!dragging || !dragStart.current) return;
    const dx = (e.clientX - dragStart.current.x) / (zoom * 2);
    const dy = (e.clientY - dragStart.current.y) / (zoom * 2);
    setCenter([
      dragStart.current.center[0] - dx,
      dragStart.current.center[1] + dy,
    ]);
  };

  const handleMouseUp = () => {
    setDragging(false);
    dragStart.current = null;
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
      <div className="flex items-center justify-between px-2 pt-2 pb-1 gap-2">
        <p className="text-teal text-[10px] font-bold uppercase tracking-wide flex-shrink-0">
          Monitoreo de Rutas y Posición GPS Real
        </p>

        <div className="flex items-center gap-2 flex-1 justify-center">
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
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {zoom > 1 && (
            <button
              onClick={() => { setZoom(1); setCenter([20, 10]); }}
              className="text-[10px] px-2 py-0.5 rounded transition font-medium
                         bg-gray-900/70 text-gray-400 border border-white/10
                         hover:text-white mr-1">
              ↺ Reset
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
                style={{
                  default: { outline: "none" },
                  hover:   { outline: "none" },
                  pressed: { outline: "none" },
                }}/>
            ))
          }
        </Geographies>

        {showLines && activeRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          return (
            <Line key={`active-${r.from}-${r.to}-${i}`}
              from={from} to={to}
              stroke="#F4A261" strokeWidth={1.2}
              strokeLinecap="round" strokeDasharray="8 4"
              className="route-active"/>
          );
        })}

        {showPlanes && activeRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          const plane = planePosition(from, to, r, simulatedMinute);
          return (
            <Marker
              key={`plane-${r.flightId || `${r.from}-${r.to}`}-${i}`}
              coordinates={plane.coordinates}>
              <g transform={`rotate(${plane.angle})`} className="route-plane">
                {/* Fuselaje */}
                <path d="M 10 0 L -6 -1.5 L -8 0 L -6 1.5 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                {/* Ala izquierda */}
                <path d="M 2 -1 L -3 -8 L -6 -7 L -3 -1 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                {/* Ala derecha */}
                <path d="M 2 1 L -3 8 L -6 7 L -3 1 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                {/* Cola izquierda */}
                <path d="M -5 -1 L -7 -4 L -9 -3.5 L -8 0 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
                {/* Cola derecha */}
                <path d="M -5 1 L -7 4 L -9 3.5 L -8 0 Z"
                      fill="#F4A261" stroke="#F4A261" strokeWidth={0.4}/>
              </g>
            </Marker>
          );
        })}

        {shownAirports.map(a => {
          const pct  = Math.min(1, (a.current || 0) / Math.max(1, a.capacity || 1));
          const fill = pct > 0.85 ? "#E76F51"
                     : pct > 0.6  ? "#F4A261"
                     : "#1C7293";
          const r    = 3 + Math.round(pct * 4);
          return (
            <Marker key={a.code}
              coordinates={[a.lng, a.lat]}
              onClick={() => onAirportClick?.(a)}>
              <circle r={r} fill={fill} stroke="#fff" strokeWidth={0.8}
                style={{ cursor: "pointer" }}/>
              <text textAnchor="middle" y={-(r + 3)}
                style={{
                  fontSize: Math.max(5, 7 / Math.sqrt(zoom)),
                  fill: "#9DBDCC",
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