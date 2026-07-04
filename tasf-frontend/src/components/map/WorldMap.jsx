import { useEffect, useRef, useState, useMemo } from "react";
import {
  ComposableMap, Geographies, Geography,
  Marker, Line
} from "react-simple-maps";
import { STATIC_AIRPORTS, airportName } from "../../data/staticAirports";

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
    .route-plane  { filter: drop-shadow(0 0 3px rgba(0,0,0,0.7)); }
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
function useSmoothMinute(targetMinute, running, realtime = false) {
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
    const diff = targetMinute - r.curVal;
    const dt   = now - r.curT;
    const inst = dt > 0 ? diff / dt : 0;

    // Modo TIEMPO REAL (Día a Día): el backend emite el minuto ENTERO y solo
    // cambia una vez por minuto, así que la velocidad estimada por muestras
    // colapsa a ~0 entre saltos (aviones a tirones). Aquí la velocidad es
    // CONOCIDA: 1 minuto simulado por minuto real. Fijarla y extrapolar.
    if (realtime) {
      if (diff < 0 || r.curT === 0) { r.disp = targetMinute; }
      r.curVal = targetMinute;
      r.curT   = now;
      r.rate   = 1 / 60000;             // min simulados por ms real
      return;
    }

    // Reset (sin extrapolar) si: la simulación retrocede (nueva corrida),
    // es la primera muestra real (curT aún no establecido), o el salto
    // implica una velocidad absurda (ej. salto inicial de 0 al minuto
    // real de arranque del dataset).
    const MAX_REASONABLE_RATE = 0.05; // ~50 min simulados por segundo, generoso
    if (diff < 0 || r.curT === 0 || Math.abs(inst) > MAX_REASONABLE_RATE) {
      r.curVal = targetMinute; r.curT = now; r.rate = 0; r.disp = targetMinute;
      return;
    }

    r.rate = r.rate > 0 ? r.rate * 0.65 + inst * 0.35 : inst;
    r.curVal = targetMinute;
    r.curT   = now;
  }, [targetMinute, realtime]);

  // Bucle de animación: lee siempre del ref, así NO se reinicia con cada
  // muestra (reiniciar rAF cada 800 ms provocaba microcortes).
  useEffect(() => {
    if (!running) return;
    // Extrapolar hasta ~2 intervalos de broadcast antes de detenerse: evita
    // congelamientos si un broadcast llega con retraso (la cadencia es ~800 ms).
    // En tiempo real el "broadcast útil" es 1/min → permitir extrapolar más.
    const NOMINAL_MS = realtime ? 90000 : 1500;
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
  }, [running, realtime]);

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

// Vista inicial del mapa: encuadre de la RED COMPLETA del dataset —
// Copenhague (55.6°N) pegado al borde superior, Santiago/Montevideo (~-34.8°S)
// al inferior, Lima ↔ Delhi a los lados. Como el SVG usa un viewBox escalado
// (preserveAspectRatio "meet"), este zoom llena el ALTO del contenedor de
// forma prácticamente independiente de su tamaño/aspecto:
//   zoom ≈ altoViewBox / (escalaBase · spanMercator) = 600 / (120 · 1.94) ≈ 2.55
// El centro vertical es el punto medio Mercator del rango (≈16°N), no la media
// aritmética de latitudes.
const DEFAULT_CENTER = [0, 16];
const DEFAULT_ZOOM   = 2.55;

// Semáforo de ocupación: verde casi vacío, ámbar a media carga, rojo casi lleno.
function loadColor(pct) {
  return pct > 0.85 ? "#ef4444" : pct > 0.6 ? "#f59e0b" : "#22c55e";
}

// Color del almacén/aeropuerto: GRIS si está vacío (0 maletas), si no semáforo.
function airportColor(current, capacity) {
  if ((current || 0) === 0) return "#9ca3af";   // gris = vacío
  return loadColor(Math.min(1, current / Math.max(1, capacity || 1)));
}

// Categoría de semáforo de un almacén (para filtrar): empty/green/amber/red.
function airportSemCat(current, capacity) {
  if ((current || 0) === 0) return "empty";
  const pct = current / Math.max(1, capacity || 1);
  return pct > 0.85 ? "red" : pct > 0.6 ? "amber" : "green";
}

// Color de un vuelo: GRIS si va vacío (programado sin maletas), si no semáforo.
const EMPTY_FLIGHT = "#9ca3af";
function flightColor(bags, capacity) {
  if ((bags || 0) === 0) return EMPTY_FLIGHT;
  return loadColor(capacity > 0 ? bags / capacity : 0);
}

// Categoría de semáforo de un vuelo (para filtrar por carga): vacío/verde/ámbar/rojo.
function flightSemCat(bags, capacity) {
  if ((bags || 0) === 0) return "empty";
  const pct = capacity > 0 ? bags / capacity : 0;
  return pct > 0.85 ? "red" : pct > 0.6 ? "amber" : "green";
}

export default function WorldMap({
  airports = [],
  routes = [],
  onAirportClick,        // (code) => void — clic en un aeropuerto (enfoca)
  onRouteClick,          // (key)  => void — clic en una ruta/vuelo (resalta)
  onClearSelection,      // () => void — limpiar el foco
  running = false,
  message = "",
  simulatedMinute = 0,
  activeFlightsCount = 0,
  highlightCodes = [],   // aeropuertos en foco (de clic o filtro) — controlado por el padre
  selectedRouteKey = null, // ruta resaltada — controlada por el padre (mapa o panel)
  shipmentPath = null,   // [{ lotId, label, legs:[{from,to,flightId,finalDestination,status,color}] }] — rutas del envío (una por sub-lote)
  flightSem = "all",     // filtro de semáforo de carga: solo dibuja aviones de ese color
  whSem = "all",         // filtro de semáforo de almacenes: solo dibuja almacenes de ese color
  realtime = false,      // Día a Día: el reloj simulado ES el reloj real (1 min sim = 1 min real)
}) {
  useEffect(() => { injectAnimation(); }, []);

  const [showLines,  setShowLines]  = useState(true);
  const [showPlanes, setShowPlanes] = useState(true);
  const [lineMode,   setLineMode]   = useState("limited");
  // Vista inicial enmarcada en la red completa; el usuario puede hacer
  // zoom/arrastre luego y «Reiniciar» vuelve a este encuadre.
  const [zoom,       setZoom]       = useState(DEFAULT_ZOOM);
  const [center,     setCenter]     = useState(DEFAULT_CENTER);
  const [dragging,   setDragging]   = useState(false);

  const dragStart    = useRef(null);
  const dragMoved    = useRef(false);
  const mapRef       = useRef(null);

  // Minuto continuo y suavizado para mover los aviones sin saltos.
  // En pausa congelamos la interpolación (los aviones quedan quietos).
  const paused        = message === "Pausado";
  const displayMinute = useSmoothMinute(simulatedMinute, running && !paused, realtime);

  // ── Tooltip propio de aviones (el <title> nativo no admite estilos) ────────
  // { x, y (px relativos al contenedor), flightId, from, to, bags, cap }
  const [tip, setTip] = useState(null);
  const showPlaneTip = (e, r) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      maxX: rect.width - 190,             // tope para no salirse del contenedor
      flightId: r.flightId || "—", from: r.from, to: r.to,
      bags: r.bags || 0, cap: r.capacity || 0,
    });
  };
  const hideTip = () => setTip(null);

  // Rutas en el aire según el backend (departed y aún no aterrizadas). El
  // conjunto SOLO cambia cuando llega un broadcast (no cada frame); la POSICIÓN
  // de cada avión sí se recalcula cada frame con displayMinute. Así el avión
  // recorre toda la línea y desaparece justo cuando el backend lo aterriza
  // (displayMinute ≈ simulatedMinute en ese momento), sin cortes a mitad.
  const allActive = useMemo(() => {
    if (!running || routes.length === 0) return [];
    const seen = new Set();
    return routes
      .filter(r => r.status === "departed")
      .filter(r => {
        const k = routeKey(r);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
  }, [running, routes]);

  // La ruta resaltada la controla el padre (selectedRouteKey): puede venir de un
  // clic en el mapa o en el panel de Vuelos. Si ya aterrizó/desapareció de las
  // rutas activas, se ignora (derivado).
  const activeRouteKey = useMemo(() => {
    if (selectedRouteKey && allActive.some(r => routeKey(r) === selectedRouteKey)) {
      return selectedRouteKey;
    }
    return null;
  }, [selectedRouteKey, allActive]);

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

  // Click en el fondo del mapa (sin arrastrar) limpia toda la selección
  const handleBackgroundClick = () => {
    if (!dragMoved.current) {
      onClearSelection?.();
    }
  };

  const allAirports = airports.length > 0 ? airports : STATIC_AIRPORTS;
  // airportMap usa TODOS los aeropuertos (las rutas necesitan sus coordenadas
  // aunque el almacén esté filtrado del mapa).
  const airportMap  = Object.fromEntries(
    allAirports.map(a => [a.code, [a.lng, a.lat]])
  );
  // Almacenes a DIBUJAR: filtrados por el semáforo del panel de Almacenes
  // (igual que los aviones con su semáforo): si pides verde, solo verdes; etc.
  const shownAirports = whSem === "all"
    ? allAirports
    : allAirports.filter(a => airportSemCat(a.current, a.capacity) === whSem);

  // Filtro por semáforo de carga (del panel de Vuelos): solo dibuja aviones cuyo
  // color de carga coincide con el seleccionado (vacío/verde/ámbar/rojo).
  let semActive = flightSem === "all"
    ? allActive
    : allActive.filter(r => flightSemCat(r.bags, r.capacity || 0) === flightSem);

  // Si el semáforo de ALMACENES oculta aeropuertos, ocultar también las líneas/
  // aviones que tocan un almacén oculto (antes quedaban líneas "hacia la nada").
  if (whSem !== "all") {
    const drawn = new Set(shownAirports.map(a => a.code));
    semActive = semActive.filter(r => drawn.has(r.from) && drawn.has(r.to));
  }

  const visibleRoutes = lineMode === "limited"
    ? semActive.slice(0, 40)
    : semActive;

  // Modo "envío seleccionado": cuando se elige un paquete, OCULTAMOS las demás
  // rutas/aviones para que solo se vea su recorrido (con transbordos).
  const shipmentMode = Array.isArray(shipmentPath) && shipmentPath.length > 0;

  // Orden de PINTADO: los aviones CARGADOS se dibujan al final (encima). Evita
  // que un vuelo duplicado vacío (gris) en la misma coordenada tape al cargado
  // (causa del "avión vacío" con datos toy que duplican horarios).
  const activeRoutes = (showLines || showPlanes) && !shipmentMode
    ? [...visibleRoutes].sort((a, b) => (a.bags || 0) - (b.bags || 0))
    : [];

  const isCalculating = running && message.startsWith("Planificando");

  // ── Lógica de resaltado ──────────────────────────────────────────────────
  // Foco de aeropuertos: viene del padre (clic en mapa/almacenes o filtro).
  const focus    = useMemo(() => new Set(highlightCodes), [highlightCodes]);
  const selRoute = activeRouteKey
    ? allActive.find(r => routeKey(r) === activeRouteKey)
    : null;
  const hasFocus = focus.size > 0 || !!selRoute;

  const routeIsHighlighted = (r) => {
    if (selRoute) return routeKey(r) === activeRouteKey;
    if (focus.size > 0) return focus.has(r.from) || focus.has(r.to);
    return true;
  };

  const airportIsHighlighted = (code) => {
    if (selRoute) return selRoute.from === code || selRoute.to === code;
    if (focus.size === 0) return true;
    if (focus.has(code)) return true;
    // vecinos: aeropuertos conectados por una ruta activa a uno enfocado
    return allActive.some(r =>
      (focus.has(r.from) && r.to === code) || (focus.has(r.to) && r.from === code));
  };

  // Clic en una ruta (línea o avión): el padre alterna el resaltado y limpia
  // cualquier foco de aeropuerto.
  const clickRoute = (key) => {
    onRouteClick?.(key);
  };

  // Clic en un aeropuerto: lo gestiona el padre (también limpia la ruta).
  const clickAirport = (code) => {
    onAirportClick?.(code);
  };

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
              {flightSem !== "all" && (
                <span className="ml-1 text-teal">
                  · filtro {{ green: "verde", amber: "ámbar", red: "rojo", empty: "vacío" }[flightSem]}
                  {" "}({semActive.length})
                </span>
              )}
              {(showLines || showPlanes) && lineMode === "limited"
                && (flightSem === "all" ? activeFlightsCount : semActive.length) > 40 && (
                <span className="text-gray-600 ml-1">(mostrando 40 en mapa)</span>
              )}
            </span>
          )}
          {hasFocus && (
            <span className="text-[10px] text-teal flex items-center gap-1">
              ◉ {selRoute
                  ? `${selRoute.from}→${selRoute.to}`
                  : `${focus.size} aeropuerto${focus.size === 1 ? "" : "s"}`}
              <button
                onClick={() => onClearSelection?.()}
                className="ml-1 px-1.5 py-0.5 rounded bg-gray-900/70 border border-white/10
                           text-gray-400 hover:text-white transition">
                ✕ Limpiar
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {(zoom !== DEFAULT_ZOOM || center[0] !== DEFAULT_CENTER[0]
              || center[1] !== DEFAULT_CENTER[1]) && (
            <button
              onClick={() => { setZoom(DEFAULT_ZOOM); setCenter(DEFAULT_CENTER); }}
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
                      {lineMode === "limited" ? `≤40 rutas` : `todas (${semActive.length})`}
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
          const hl  = routeIsHighlighted(r);
          const key = routeKey(r);
          const cap = r.capacity || 0;
          const col = flightColor(r.bags, cap);
          // La línea visible nace en la POSICIÓN ACTUAL del avión: el tramo ya
          // recorrido se "borra" y solo queda el camino restante. Es gratis:
          // el SVG ya se repinta cada frame (displayMinute) y la posición es la
          // misma que usa la capa de aviones.
          const plane = planePosition(from, to, r, displayMinute);
          return (
            <g key={`active-${key}`}>
              {/* Corredor invisible de RUTA COMPLETA para que siga siendo fácil
                  de clicar aunque la línea visible se acorte */}
              <Line
                from={from} to={to}
                stroke="transparent" strokeWidth={8}
                style={{ cursor: "pointer" }}
                onClick={(e) => { e.stopPropagation(); clickRoute(key); }}/>
              <Line
                from={plane.coordinates} to={to}
                stroke={col}
                strokeWidth={hasFocus && hl ? 1.2 : 0.8}
                strokeLinecap="round" strokeDasharray="8 4"
                opacity={hl ? 1 : 0.12}
                style={{ pointerEvents: "none" }}
                className="route-active"/>
            </g>
          );
        })}

        {showPlanes && activeRoutes.map(r => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          const plane = planePosition(from, to, r, displayMinute);
          const hl    = routeIsHighlighted(r);
          const cap   = r.capacity || 0;
          const col   = flightColor(r.bags, cap);   // gris si vacío, si no semáforo
          return (
            <Marker
              key={`plane-${routeKey(r)}`}
              coordinates={plane.coordinates}
              onClick={(e) => { e.stopPropagation(); clickRoute(routeKey(r)); }}
              onMouseMove={(e) => showPlaneTip(e, r)}
              onMouseLeave={hideTip}>
              {/* Icono reducido (scale) — tooltip propio estilizado, no <title> */}
              <g transform={`rotate(${plane.angle}) scale(0.75)`}
                 className="route-plane"
                 opacity={hl ? 1 : 0.15}
                 style={{ cursor: "pointer" }}>
                {/* Fuselaje */}
                <path d="M 10 0 L -6 -1.5 L -8 0 L -6 1.5 Z"
                      fill={col} stroke={col} strokeWidth={0.4}/>
                <path d="M 2 -1 L -3 -8 L -6 -7 L -3 -1 Z"
                      fill={col} stroke={col} strokeWidth={0.4}/>
                <path d="M 2 1 L -3 8 L -6 7 L -3 1 Z"
                      fill={col} stroke={col} strokeWidth={0.4}/>
                <path d="M -5 -1 L -7 -4 L -9 -3.5 L -8 0 Z"
                      fill={col} stroke={col} strokeWidth={0.4}/>
                <path d="M -5 1 L -7 4 L -9 3.5 L -8 0 Z"
                      fill={col} stroke={col} strokeWidth={0.4}/>
              </g>
            </Marker>
          );
        })}

        {/* Aeropuertos/almacenes: icono tipo bodega (cajón con techo y puerta)
            coloreado con el semáforo de ocupación; verde casi vacío → rojo lleno. */}
        {shownAirports.map(a => {
          const pct   = Math.min(1, (a.current || 0) / Math.max(1, a.capacity || 1));
          const col   = airportColor(a.current, a.capacity);   // gris si vacío
          const hl    = airportIsHighlighted(a.code);
          const isSel = focus.has(a.code);
          const s     = isSel ? 5.5 : 4.5;          // medio tamaño del cajón
          return (
            <Marker key={a.code}
              coordinates={[a.lng, a.lat]}
              onClick={(e) => {
                e.stopPropagation();
                clickAirport(a.code);
              }}>
              <title>
                {airportName(a.code)} ({a.code}) — almacén{" "}
                {(a.current || 0).toLocaleString()}/{(a.capacity || 0).toLocaleString()}
                {a.capacity ? ` (${Math.round(pct * 100)}%)` : ""}
              </title>
              <g opacity={hl ? 1 : 0.25} style={{ cursor: "pointer" }}>
                {/* techo */}
                <polygon points={`${-s},${-s * 0.2} 0,${-s} ${s},${-s * 0.2}`}
                         fill={col} stroke={isSel ? "#2dd4bf" : "#0b1f33"}
                         strokeWidth={isSel ? 0.9 : 0.5}/>
                {/* cuerpo de la bodega */}
                <rect x={-s} y={-s * 0.2} width={2 * s} height={s * 1.2} rx={0.6}
                      fill={col} stroke={isSel ? "#2dd4bf" : "#0b1f33"}
                      strokeWidth={isSel ? 0.9 : 0.5}/>
                {/* puerta */}
                <rect x={-s * 0.4} y={s * 0.3} width={s * 0.8} height={s * 0.7}
                      fill="#0b1f33" opacity={0.55}/>
              </g>
            </Marker>
          );
        })}

        {/* Etiquetas de aeropuertos en PASADA SEPARADA (después de todos los
            iconos): así ningún icono tapa el nombre de otro aeropuerto. */}
        {shownAirports.map(a => {
          const hl    = airportIsHighlighted(a.code);
          const isSel = focus.has(a.code);
          const s     = isSel ? 5.5 : 4.5;
          return (
            <Marker key={`lbl-${a.code}`} coordinates={[a.lng, a.lat]}>
              <text textAnchor="middle" y={-(s + 4)}
                opacity={hl ? 1 : 0.25}
                style={{
                  fontSize: Math.max(9, 13 / Math.sqrt(zoom)),
                  fontWeight: 600,
                  fill: isSel ? "#2dd4bf" : "#cfe3ee",
                  stroke: "#021020",
                  strokeWidth: 0.6,
                  paintOrder: "stroke",
                  fontFamily: "sans-serif",
                  pointerEvents: "none",
                }}>
                {airportName(a.code)}
              </text>
            </Marker>
          );
        })}

        {/* ── Recorrido del envío seleccionado ───────────────────────────────
            shipmentPath = ARRAY de rutas [{lotId, label, legs}], UNA por
            sub-lote si el paquete fue dividido. Cada ruta se dibuja con un
            pequeño desplazamiento vertical y su etiqueta (-1, -2, …) para que
            las divisiones no se mezclen y se vea que comparten destino final.
            Por tramo: color = carga de su vuelo; estilo por estado:
              · completado (done)  → punteado tenue + ✓
              · actual    (current)→ sólido animado + ✈
              · próximo   (upcoming)→ a trazos + ›
            Destino de cada tramo: verde = destino final; ámbar ⇄ = transbordo. */}
        {shipmentMode && shipmentPath.map((p, pi) => {
          const off = shipmentPath.length > 1 ? (pi - (shipmentPath.length - 1) / 2) * 2.4 : 0;
          return (
          <g key={`sp-${p.lotId ?? pi}`} style={{ pointerEvents: "none" }}
             transform={`translate(0, ${off})`}>
            {p.legs.map((leg, i) => {
              const from = airportMap[leg.from];
              const to   = airportMap[leg.to];
              if (!from || !to) return null;
              const dash  = leg.status === "done" ? "1 3"
                          : leg.status === "upcoming" ? "6 4" : undefined;
              const width = leg.status === "current" ? 2.6
                          : leg.status === "done"    ? 1.4 : 1.8;
              const op    = leg.status === "done" ? 0.45
                          : leg.status === "upcoming" ? 0.85 : 1;
              const icon  = leg.status === "current" ? "✈"
                          : leg.status === "upcoming" ? "›" : "✓";
              const mid   = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
              return (
                <g key={`leg-${pi}-${i}`}>
                  <Line from={from} to={to}
                        stroke={leg.color || "#6b7280"}
                        strokeWidth={width} strokeLinecap="round"
                        strokeDasharray={dash} opacity={op}
                        className={leg.status === "current" ? "route-active" : undefined}/>
                  <Marker coordinates={mid}>
                    <text textAnchor="middle" dy={-2}
                      style={{ fontSize: Math.max(5, 8 / Math.sqrt(zoom)),
                               fill: leg.color || "#6b7280",
                               fontFamily: "sans-serif", fontWeight: "bold" }}>
                      {icon}{shipmentPath.length > 1 && i === 0 ? ` ${p.label}` : ""}
                    </text>
                  </Marker>
                  <Marker coordinates={to}>
                    <circle r={leg.finalDestination ? 3 : 2.4}
                      fill={leg.finalDestination ? "#22c55e" : "#f59e0b"}
                      stroke="#fff" strokeWidth={0.5}/>
                    {/* la etiqueta del destino solo en la primera ruta (comparten punto) */}
                    {pi === 0 && (
                      <text textAnchor="middle" y={-5}
                        style={{ fontSize: Math.max(4, 6 / Math.sqrt(zoom)),
                                 fill: leg.finalDestination ? "#22c55e" : "#f59e0b",
                                 fontFamily: "sans-serif" }}>
                        {leg.finalDestination ? "destino final" : "⇄ transbordo"}
                      </text>
                    )}
                  </Marker>
                </g>
              );
            })}
            {/* origen del recorrido */}
            {p.legs[0] && airportMap[p.legs[0].from] && (
              <Marker coordinates={airportMap[p.legs[0].from]}>
                <circle r={2.6} fill="#fff" stroke="#0b1f33" strokeWidth={0.6}/>
              </Marker>
            )}
          </g>
          );
        })}
      </ComposableMap>

      {/* Tooltip de avión: recuadro estilizado con el código del vuelo (F###),
          tramo y carga con color de semáforo. Reemplaza al <title> nativo. */}
      {tip && (() => {
        const pct  = tip.cap > 0 ? Math.round((tip.bags / tip.cap) * 100) : 0;
        const semC = tip.bags === 0 ? "#9ca3af"
                   : pct >= 85 ? "#ef4444" : pct >= 60 ? "#f59e0b" : "#22c55e";
        return (
          <div className="absolute z-50 pointer-events-none"
               style={{ left: Math.min(tip.x + 14, tip.maxX), top: tip.y + 12 }}>
            <div className="bg-[#021020]/95 border-2 rounded-lg px-3 py-2 shadow-xl shadow-black/60"
                 style={{ borderColor: semC, minWidth: 170 }}>
              <p className="font-mono font-bold text-sm" style={{ color: semC }}>
                ✈ {tip.flightId}
              </p>
              <p className="text-gray-200 text-xs">
                {airportName(tip.from)} → {airportName(tip.to)}
                <span className="text-gray-500 ml-1">({tip.from}→{tip.to})</span>
              </p>
              <p className="text-xs mt-0.5">
                <span style={{ color: semC }} className="font-bold">
                  {tip.bags.toLocaleString()}/{tip.cap.toLocaleString()}
                </span>
                <span className="text-gray-400"> maletas{tip.cap > 0 ? ` · ${pct}%` : ""}</span>
                {tip.bags === 0 && <span className="text-gray-500 ml-1">(vacío)</span>}
              </p>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
