import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  ComposableMap, Geographies, Geography,
  Marker, Line
} from "react-simple-maps";
import { geoMercator } from "d3-geo";
import { Cog, Plane, X } from "lucide-react";
import { STATIC_AIRPORTS, airportName } from "../../data/staticAirports";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ── Lienzo de aviones y rutas ────────────────────────────────────────────────
// Los aviones y sus líneas se pintan en un <canvas> superpuesto, NO en el SVG.
// Cada avión eran ~6 nodos SVG (fuselaje + 2 alas + 2 estabilizadores) que React
// reconciliaba en cada frame: con "todas las rutas" (~890 vuelos) eso son ~10.000
// nodos recalculados 15 veces por segundo, y es lo que tumbaba la pestaña. En
// canvas es un único elemento y solo se dibujan primitivas.
//
// El SVG de react-simple-maps usa viewBox 800×600 (ComposableMap por defecto) sin
// preserveAspectRatio, o sea "xMidYMid meet". El lienzo replica ESA MISMA
// transformación para quedar alineado al píxel con países y aeropuertos.
const VB_W = 800, VB_H = 600;

/** Proyección idéntica a la que arma react-simple-maps por dentro. */
function makeProjection(zoom, center) {
  return geoMercator()
    .translate([VB_W / 2, VB_H / 2])
    .center(center)
    .scale(120 * zoom);
}

/**
 * viewBox → píxeles CSS del lienzo, según "meet": la caja 800×600 se escala por
 * k = min(W/800, H/600) y se centra en el contenedor.
 */
function viewBoxFit(w, h) {
  const k = Math.min(w / VB_W, h / VB_H);
  return { k, ox: (w - VB_W * k) / 2, oy: (h - VB_H * k) / 2 };
}

// Mismos trazos que usaba el <Marker> SVG, compilados una sola vez.
let PLANE_PATHS = null;
function planePaths() {
  if (!PLANE_PATHS) {
    PLANE_PATHS = [
      "M 10 0 L -6 -1.5 L -8 0 L -6 1.5 Z",   // fuselaje
      "M 2 -1 L -3 -8 L -6 -7 L -3 -1 Z",     // ala izq.
      "M 2 1 L -3 8 L -6 7 L -3 1 Z",         // ala der.
      "M -5 -1 L -7 -4 L -9 -3.5 L -8 0 Z",   // estabilizador izq.
      "M -5 1 L -7 4 L -9 3.5 L -8 0 Z",      // estabilizador der.
    ].map(d => new Path2D(d));
  }
  return PLANE_PATHS;
}

/** Distancia de un punto al segmento AB (para acertar el clic en una ruta). */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1,
    ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Radios de acierto (px CSS). El del avión es generoso porque el icono es chico;
// el de la línea replica el "corredor invisible" de 8 px que tenía el SVG.
const HIT_PLANE_PX = 11;
const HIT_LINE_PX  = 5;

function injectAnimation() {
  if (document.getElementById("route-anim-style")) return;
  const style = document.createElement("style");
  style.id = "route-anim-style";
  style.textContent = `
    @keyframes dashMove {
      from { stroke-dashoffset: 24; }
      to   { stroke-dashoffset: 0; }
    }
    /* Solo para los tramos del envío seleccionado: los aviones y sus rutas se
       animan ahora en el lienzo (lineDashOffset), sin CSS. */
    .route-active { animation: dashMove 1.4s linear infinite; }
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

  // El minuto YA NO es estado de React. Antes un setState a 15 fps re-renderizaba
  // el mapa COMPLETO (países + aviones + líneas) para mover los aviones; ahora
  // los aviones se pintan en un <canvas> que llama a este getter una vez por
  // frame, así que la animación NO provoca ni un solo render de React.
  const live = useRef({ running, realtime, targetMinute });
  useEffect(() => {
    live.current = { running, realtime, targetMinute };
  });   // sin deps: apunta a la versión fresca tras CADA render

  return useCallback(() => {
    const { running: run, realtime: rt, targetMinute: tm } = live.current;
    if (!run) return tm;
    // Extrapolar hasta ~2 intervalos de broadcast antes de detenerse: evita
    // congelamientos si un broadcast llega con retraso (la cadencia es ~800 ms).
    // En tiempo real el "broadcast útil" es 1/min → permitir extrapolar más.
    const NOMINAL_MS = rt ? 90000 : 1500;
    const r = s.current;
    const elapsed = Math.min(performance.now() - r.curT, NOMINAL_MS);
    let est = r.curVal + r.rate * elapsed;
    if (est < r.disp) est = r.disp;   // monotónico: nunca retrocede (sin tirones)
    r.disp = est;
    return est;
  }, []);
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
// al inferior, Lima ↔ Delhi a los lados. El centro vertical es el punto medio
// MERCATOR del rango (≈16°N), no la media aritmética de latitudes.
const DEFAULT_CENTER = [0, 16];
const DEFAULT_ZOOM   = 2.55;   // respaldo mientras no se ha medido el contenedor

// Encuadre REACTIVO: el SVG usa viewBox 800×600 con preserveAspectRatio "meet",
// así que la escala real en pantalla es (120·zoom)·k con k = min(W/800, H'/600).
// Un zoom constante solo llenaba pantallas con el mismo aspecto; aquí se
// despeja el zoom para llenar CUALQUIER contenedor sin recortar la red:
//   rango a encuadrar (radianes Mercator, con margen para etiquetas):
const FIT_Y_RAD  = 1.94;   // lat ~57°N … -36°S (ajustado: etiquetas pegadas a los bordes)
const FIT_X_RAD  = 2.95;   // lng ≈ −84° … 84° (margen extra: el TEXTO de las
                           // etiquetas sobresale del punto del aeropuerto)
const MAP_HEADER = 34;     // alto de la cabecera del mapa (px)
function computeFitZoom(w, h) {
  const hh = h - MAP_HEADER;
  if (!w || hh <= 0) return DEFAULT_ZOOM;
  const k    = Math.min(w / 800, hh / 600);          // escala del viewBox (meet)
  const sEff = Math.min(hh / FIT_Y_RAD, w / FIT_X_RAD); // px/radián que caben
  return Math.max(1, Math.round((sEff / (120 * k)) * 100) / 100);
}

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
  // zoom/arrastre luego y «Reiniciar» vuelve a este encuadre. El encuadre se
  // recalcula con el TAMAÑO REAL del contenedor (laptops, monitores, resize).
  const [fitZoom,    setFitZoom]    = useState(DEFAULT_ZOOM);
  const [zoom,       setZoom]       = useState(DEFAULT_ZOOM);
  const [center,     setCenter]     = useState(DEFAULT_CENTER);
  const [dragging,   setDragging]   = useState(false);

  const dragStart    = useRef(null);
  const dragMoved    = useRef(false);
  const mapRef       = useRef(null);

  // Medir el contenedor al montar y en cada resize. Si el usuario NO ha tocado
  // el zoom (sigue en el encuadre), la vista se reajusta sola; si ya hizo zoom
  // manual, solo se actualiza el valor al que vuelve «Reiniciar».
  const lastFitRef = useRef(DEFAULT_ZOOM);
  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const apply = () => {
      const z = computeFitZoom(el.clientWidth, el.clientHeight);
      // Capturar el encuadre ANTERIOR antes de mutar el ref: el updater
      // funcional se ejecuta después, y debe comparar contra el valor viejo.
      const prevFit = lastFitRef.current;
      lastFitRef.current = z;
      setFitZoom(z);
      setZoom(prev => (prev === prevFit ? z : prev));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Minuto continuo y suavizado para mover los aviones sin saltos.
  // En pausa congelamos la interpolación (los aviones quedan quietos).
  const paused     = message === "Pausado";
  const getMinute  = useSmoothMinute(simulatedMinute, running && !paused, realtime);

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

  // Posiciones dibujadas en el último frame, en px del CONTENEDOR. El lienzo no
  // tiene eventos por elemento (es un solo nodo), así que los clics y el hover
  // se resuelven contra esta lista. La rellena el bucle de dibujo.
  const hits = useRef([]);

  // Qué hay bajo el cursor ("plane" | "line" | null). Es estado porque decide el
  // cursor; se actualiza SOLO cuando cambia, no en cada mousemove.
  const [hoverKind, setHoverKind] = useState(null);

  /**
   * Vuelo bajo el cursor: primero el avión, si no la línea de su ruta (replica
   * el orden del SVG, donde el avión se pintaba encima del corredor de clic).
   */
  const hitTest = (clientX, clientY) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left, y = clientY - rect.top;
    let best = null, bestD = HIT_PLANE_PX * HIT_PLANE_PX;
    for (const h of hits.current) {
      if (!h.plane) continue;
      const dx = x - h.px, dy = y - h.py, d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = h; }
    }
    if (best) return { hit: best, kind: "plane" };
    for (const h of hits.current) {
      if (!h.line) continue;
      if (distToSegment(x, y, h.ax, h.ay, h.bx, h.by) < HIT_LINE_PX) {
        return { hit: h, kind: "line" };
      }
    }
    return null;
  };

  const handleMouseMove = (e) => {
    if (dragging && dragStart.current) {
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
      return;
    }
    // Hover sobre un avión → mismo tooltip que antes daba el <Marker> SVG.
    const r = hitTest(e.clientX, e.clientY);
    if (r?.kind === "plane") showPlaneTip(e, r.hit.route);
    else if (tip) hideTip();
    if ((r?.kind ?? null) !== hoverKind) setHoverKind(r?.kind ?? null);
  };

  const handleMouseUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  // Clic sobre el lienzo: si cae en un avión o en su ruta, la selecciona. Los
  // aeropuertos siguen en SVG con sus propios eventos (el lienzo va con
  // pointer-events:none), así que este handler nunca les roba el clic.
  const handleMapClick = (e) => {
    if (dragMoved.current) return;
    const r = hitTest(e.clientX, e.clientY);
    if (r) { e.stopPropagation(); clickRoute(r.hit.key); }
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
  //
  // MEMOIZADO: este componente se re-renderiza ~15 veces por segundo por la
  // animación, y sin memo se reconstruían el objeto y un array [lng,lat] por
  // aeropuerto en CADA frame. Las coordenadas solo cambian si se edita/añade un
  // aeropuerto, así que basta con recalcular cuando cambia la lista.
  const airportMap = useMemo(
    () => Object.fromEntries(allAirports.map(a => [a.code, [a.lng, a.lat]])),
    [allAirports]);
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
    ? semActive.slice(0, 50)
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
  const selRoute = useMemo(
    () => (activeRouteKey
      ? allActive.find(r => routeKey(r) === activeRouteKey) ?? null
      : null),
    [allActive, activeRouteKey]);
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

  // ── Handlers ESTABLES (identidad fija) para las capas memoizadas ──────────
  // El mapa se re-renderiza ~15 veces/s por la animación; los handlers de
  // arriba se recrean en cada render y romperían los useMemo de abajo. El ref
  // apunta siempre a la versión fresca; el callback expuesto nunca cambia.
  const cbRef = useRef({});
  useEffect(() => {
    cbRef.current = { handleBackgroundClick, clickAirport };
  });   // sin deps: apunta a la versión fresca tras CADA render
  const stableBgClick      = useCallback((e) => cbRef.current.handleBackgroundClick?.(e), []);
  const stableClickAirport = useCallback((c) => cbRef.current.clickAirport?.(c), []);

  // ── Lienzo: dibujo de rutas y aviones ─────────────────────────────────────
  // El bucle de rAF arranca UNA vez y lee siempre de este ref, así nunca se
  // reinicia y no necesita dependencias. Todo lo que cambia por broadcast o por
  // acción del usuario (rutas, zoom, filtros, resaltado) entra por aquí.
  const frame = useRef({ activeRoutes: [] });
  useEffect(() => {
    frame.current = {
      activeRoutes, airportMap, showLines, showPlanes, hasFocus,
      routeIsHighlighted, zoom, center, shipmentMode, getMinute,
    };
  });   // sin deps: apunta a la versión fresca tras CADA render

  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box    = mapRef.current;
    if (!canvas || !box) return;
    const ctx = canvas.getContext("2d");
    const paths = planePaths();

    // 30 fps: el dibujo ya no re-renderiza React, así que sale mucho más barato
    // que los ~15 fps de antes (que reconciliaban todo el árbol SVG).
    const MIN_FRAME_MS = 33;
    let raf, last = 0, cssW = 0, cssH = 0;

    const draw = (now) => {
      raf = requestAnimationFrame(draw);
      if (now - last < MIN_FRAME_MS) return;
      last = now;

      const f = frame.current;
      // Tamaño del lienzo = zona del mapa (contenedor menos la cabecera).
      const w = box.clientWidth, h = box.clientHeight - MAP_HEADER;
      if (w <= 0 || h <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      if (w !== cssW || h !== cssH) {
        cssW = w; cssH = h;
        canvas.width  = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.width  = `${w}px`;
        canvas.style.height = `${h}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      hits.current = [];
      if (f.activeRoutes.length === 0 || f.shipmentMode) return;

      const { k, ox, oy } = viewBoxFit(w, h);
      const proj    = makeProjection(f.zoom, f.center);
      const minute  = f.getMinute();
      // viewBox → px del lienzo. (Para el hit-test se le suma MAP_HEADER en y,
      // porque los eventos del ratón llegan en px del CONTENEDOR.)
      const toPx = ll => { const p = proj(ll); return p && [ox + p[0] * k, oy + p[1] * k]; };

      // Guiones en marcha: equivale a la animación CSS `dashMove` (24 → 0 en 1,4 s)
      // que llevaban las líneas del SVG.
      const dashOffset = (24 - (now % 1400) / 1400 * 24) * k;

      for (const r of f.activeRoutes) {
        const from = f.airportMap[r.from];
        const to   = f.airportMap[r.to];
        if (!from || !to) continue;

        const pos = planePosition(from, to, r, minute);
        const a   = toPx(pos.coordinates);   // avión (inicio de la línea restante)
        const b   = toPx(to);                // destino
        const org = toPx(from);              // origen (para el corredor de clic)
        if (!a || !b || !org) continue;

        const hl  = f.routeIsHighlighted(r);
        const col = flightColor(r.bags, r.capacity || 0);
        const key = routeKey(r);

        // La línea visible nace en la POSICIÓN ACTUAL del avión: el tramo ya
        // recorrido se "borra" y solo queda el camino restante.
        if (f.showLines) {
          ctx.save();
          ctx.globalAlpha = hl ? 0.85 : 0.10;
          ctx.strokeStyle = col;
          ctx.lineWidth   = (f.hasFocus && hl ? 1.0 : 0.6) * k;
          ctx.lineCap     = "round";
          ctx.setLineDash([8 * k, 4 * k]);
          ctx.lineDashOffset = dashOffset;
          ctx.beginPath();
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(b[0], b[1]);
          ctx.stroke();
          ctx.restore();
        }

        if (f.showPlanes) {
          ctx.save();
          ctx.globalAlpha = hl ? 1 : 0.15;
          ctx.translate(a[0], a[1]);
          ctx.rotate(pos.angle * Math.PI / 180);
          ctx.scale(0.75 * k, 0.75 * k);
          ctx.fillStyle   = col;
          ctx.strokeStyle = col;
          ctx.lineWidth   = 0.4;
          for (const p of paths) { ctx.fill(p); ctx.stroke(p); }
          ctx.restore();
        }

        // Zona sensible: el avión, y el corredor de la ruta COMPLETA (origen →
        // destino), igual que la <Line> transparente de 8 px que había en SVG.
        hits.current.push({
          key, route: r,
          plane: f.showPlanes, px: a[0], py: a[1] + MAP_HEADER,
          line:  f.showLines,
          ax: org[0], ay: org[1] + MAP_HEADER,
          bx: b[0],   by: b[1]   + MAP_HEADER,
        });
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={mapRef}
      className="w-full h-full bg-[#031525] rounded border border-teal/20 relative select-none"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { handleMouseUp(); hideTip(); }}
      onClick={handleMapClick}
      style={{ cursor: dragging ? "grabbing"
                     : hoverKind ? "pointer"
                     : zoom > 1 ? "grab" : "default" }}>

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between px-2 pt-2 pb-1 gap-2">
        <p className="text-teal text-[10px] font-bold uppercase tracking-wide flex-shrink-0">
          Monitoreo de Rutas y Posición GPS Real
        </p>

        <div className="flex items-center gap-2 flex-1 justify-center min-w-0">
          {isCalculating && (
            <span className="text-[10px] text-yellow-400 animate-pulse inline-flex items-center gap-1">
              <Cog size={11} className="shrink-0"/> {message}
            </span>
          )}
          {running && !isCalculating && (
            <span className="text-[10px] text-gray-400">
              <Plane size={11} className="inline -mt-0.5 mr-0.5"/>
              {" "}<span className="text-white font-bold">{activeFlightsCount}</span> vuelos activos
              {flightSem !== "all" && (
                <span className="ml-1 text-teal">
                  · filtro {{ green: "verde", amber: "ámbar", red: "rojo", empty: "vacío" }[flightSem]}
                  {" "}({semActive.length})
                </span>
              )}
              {(showLines || showPlanes) && lineMode === "limited"
                && (flightSem === "all" ? activeFlightsCount : semActive.length) > 50 && (
                <span className="text-gray-600 ml-1">(mostrando 50 en mapa)</span>
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
                           text-gray-400 hover:text-white transition inline-flex items-center gap-0.5">
                <X size={10} className="shrink-0"/> Limpiar
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {(zoom !== fitZoom || center[0] !== DEFAULT_CENTER[0]
              || center[1] !== DEFAULT_CENTER[1]) && (
            <button
              onClick={() => { setZoom(fitZoom); setCenter(DEFAULT_CENTER); }}
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
                      {lineMode === "limited" ? `≤50 rutas` : `todas (${semActive.length})`}
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

        {/* Países: capa MEMOIZADA (se construye UNA vez). Antes se
            reconciliaban ~180 paths complejos en cada frame de animación —
            la mayor carga de CPU/GC del cliente. */}
        {useMemo(() => (
        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography
                key={geo.rsmKey}
                geography={geo}
                fill="#0a2540"
                stroke="#1C7293"
                strokeWidth={0.3}
                onClick={stableBgClick}
                style={{
                  default: { outline: "none" },
                  hover:   { outline: "none" },
                  pressed: { outline: "none" },
                }}/>
            ))
          }
        </Geographies>
        ), [stableBgClick])}

        {/* Rutas y aviones ya NO van aquí: se pintan en el <canvas> superpuesto
            (ver el bucle de dibujo arriba). En SVG eran ~6 nodos por avión que
            React reconciliaba en cada frame. */}

        {/* Aeropuertos/almacenes + etiquetas: capas MEMOIZADAS — solo se
            reconstruyen cuando cambian los datos (broadcast ~0,8 s), el foco o
            el zoom; NO en cada frame de animación (~15/s). Las etiquetas van en
            pasada separada para que ningún icono tape el nombre de otro. */}
        {useMemo(() => shownAirports.map(a => {
          const pct   = Math.min(1, (a.current || 0) / Math.max(1, a.capacity || 1));
          const col   = airportColor(a.current, a.capacity);   // gris si vacío
          const hl    = airportIsHighlighted(a.code);
          const isSel = focus.has(a.code);
          // Medio tamaño del cajón. Se agrandó (4.5→6.5 / 5.5→8) porque el
          // icono se veía muy pequeño y no se distinguía; el escalado es
          // uniforme (scale) así que el aspect ratio 32×32 se conserva.
          const s     = isSel ? 8 : 6.5;
          return (
            <Marker key={a.code}
              coordinates={[a.lng, a.lat]}
              onClick={(e) => {
                e.stopPropagation();
                stableClickAirport(a.code);
              }}>
              <title>
                {airportName(a.code)} ({a.code}) — almacén{" "}
                {(a.current || 0).toLocaleString()}/{(a.capacity || 0).toLocaleString()}
                {a.capacity ? ` (${Math.round(pct * 100)}%)` : ""}
              </title>
              {/* Icono de bodega (warehouse-box.svg, viewBox 32×32) escalado al
                  tamaño del marcador y pintado con el semáforo de ocupación. */}
              <g opacity={hl ? 1 : 0.25} style={{ cursor: "pointer" }}
                 transform={`scale(${(2 * s) / 32}) translate(-16,-16)`}>
                {/* Área de clic (el icono tiene huecos) + aro de selección */}
                <rect width={32} height={32} fill="transparent" stroke="none"/>
                {isSel && (
                  <rect x={-2.5} y={-2.5} width={37} height={37} rx={4}
                        fill="none" stroke="#2dd4bf" strokeWidth={2}/>
                )}
                <path d="m30.02 9.523-13.332-8a1.33 1.33 0 0 0-1.372 0l-13.336 8a1.33 1.33 0 0 0-.597 1.5c.16.579.683.977 1.285.977v18.668h2.664V12h21.336v18.668h2.664V12a1.33 1.33 0 0 0 1.285-.977 1.33 1.33 0 0 0-.597-1.5Zm0 0"
                      fill={col} stroke="#0b1f33" strokeWidth={0.8}/>
                <path d="M12 13.332v8h8v-8h-2.668V16h-2.664v-2.668ZM12 25.332H9.332v-2.664H6.668v8h8v-8H12ZM22.668 25.332H20v-2.664h-2.668v8h8v-8h-2.664Zm0 0"
                      fill={col} stroke="#0b1f33" strokeWidth={0.8}/>
              </g>
            </Marker>
          );
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }), [shownAirports, focus, selRoute, allActive, stableClickAirport])}

        {useMemo(() => shownAirports.map(a => {
          const hl    = airportIsHighlighted(a.code);
          const isSel = focus.has(a.code);
          const s     = isSel ? 8 : 6.5;   // debe coincidir con la capa de iconos
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }), [shownAirports, focus, selRoute, allActive, zoom])}

        {/* ── Recorrido del envío seleccionado ───────────────────────────────
            shipmentPath = ARRAY de rutas [{lotId, label, legs}], UNA por
            sub-lote si el paquete fue dividido. Cada ruta se dibuja con un
            pequeño desplazamiento vertical y su etiqueta (-1, -2, …) para que
            las divisiones no se mezclen y se vea que comparten destino final.
            Por tramo: color = carga de su vuelo; estilo por estado:
              · completado (done)  → punteado tenue + ·
              · actual    (current)→ sólido animado + »
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
                          : leg.status === "done"    ? 1.4 : 2;
              const op    = leg.status === "done" ? 0.5 : 1;
              const icon  = leg.status === "current" ? "»"
                          : leg.status === "upcoming" ? "›" : "·";
              // Color por tramo: los tramos AÚN NO recorridos ("resto del
              // trayecto") van en celeste claro bien visible — antes tomaban el
              // gris de carga y apenas se distinguían del mapa.
              const legCol = leg.status === "upcoming"
                          ? "#7dd3fc"
                          : (leg.color || "#94a3b8");
              const mid   = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
              return (
                <g key={`leg-${pi}-${i}`}>
                  <Line from={from} to={to}
                        stroke={legCol}
                        strokeWidth={width} strokeLinecap="round"
                        strokeDasharray={dash} opacity={op}
                        className={leg.status === "current" ? "route-active" : undefined}/>
                  <Marker coordinates={mid}>
                    <text textAnchor="middle" dy={-2}
                      style={{ fontSize: Math.max(5, 8 / Math.sqrt(zoom)),
                               fill: legCol,
                               fontFamily: "sans-serif", fontWeight: "bold" }}>
                      {icon}{shipmentPath.length > 1 && i === 0 ? ` ${p.label}` : ""}
                    </text>
                  </Marker>
                  <Marker coordinates={to}>
                    <circle r={leg.finalDestination ? 3 : 2.4}
                      fill={leg.finalDestination ? "#22c55e" : "#f59e0b"}
                      stroke="#fff" strokeWidth={0.5}/>
                    {/* TRANSBORDO: se rotula en CADA sub-lote (son aeropuertos
                        intermedios distintos, p. ej. cada división transborda en
                        otra ciudad). DESTINO FINAL: una sola vez (los sub-lotes
                        comparten el punto de llegada, así no se solapa la etiqueta). */}
                    {(leg.finalDestination ? pi === 0 : true) && (
                      <text textAnchor="middle" y={leg.finalDestination ? -5 : (5 + pi * 5)}
                        style={{ fontSize: Math.max(4, 6 / Math.sqrt(zoom)),
                                 fill: leg.finalDestination ? "#22c55e" : "#f59e0b",
                                 fontFamily: "sans-serif" }}>
                        {leg.finalDestination
                          ? "destino final"
                          : `⇄ transbordo${shipmentPath.length > 1 ? " " + p.label : ""}`}
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

      {/* Lienzo de rutas y aviones, superpuesto a la zona del mapa (bajo la
          cabecera). Va con pointer-events:none a propósito: así los aeropuertos
          del SVG conservan sus propios clics y el hit-test de los aviones lo
          hacen los handlers del contenedor. */}
      <canvas
        ref={canvasRef}
        className="absolute left-0 pointer-events-none"
        style={{ top: MAP_HEADER, zIndex: 10 }}/>

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
              <p className="font-mono font-bold text-sm flex items-center gap-1" style={{ color: semC }}>
                <Plane size={13} className="shrink-0"/> {tip.flightId}
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
