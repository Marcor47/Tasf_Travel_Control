import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || ""; // || "http://localhost:8080";
const MAX_HISTORY = 300;

const evKey = e => `${e.minute}-${e.flightId}-${e.type}-${e.finalDestination}`;

// ── Formato de cable COMPACTO ────────────────────────────────────────────────
// Cada broadcast (~800 ms) lleva ~890 rutas en el aire y hasta 300 vuelos por
// salir. Serializados como objetos JSON, los NOMBRES de clave —repetidos en
// cada fila— eran ~2/3 del payload (~200 KB por tick, ~900 MB/hora de basura
// para el GC del navegador). El backend los envía ahora como ARRAYS
// POSICIONALES y se rehidratan aquí, UNA sola vez en el borde del SSE: los
// paneles siguen recibiendo objetos con las mismas propiedades de siempre.
//
// Se aceptan AMBOS formatos (array = backend nuevo, objeto = backend antiguo)
// para que el orden de despliegue front/back no pueda romper la pantalla.
// El orden de los campos debe coincidir con `wire()` en SimulationService.java.
const decodeRoute = r => (Array.isArray(r)
  ? { flightId: r[0], from: r[1], to: r[2], bags: r[3], capacity: r[4],
      status: r[5], departureMinute: r[6], arrivalMinute: r[7] }
  : r);

// Sin `departureClock`/`arrivalClock`: se derivan del minuto donde se pintan
// (ver utils/simClock.js).
const decodeUpcoming = u => (Array.isArray(u)
  ? { flightId: u[0], origin: u[1], destination: u[2],
      departureMinute: u[3], arrivalMinute: u[4],
      capacity: u[5], assigned: u[6] }
  : u);

function decodeState(data) {
  if (!data) return data;
  if (Array.isArray(data.routes))          data.routes          = data.routes.map(decodeRoute);
  if (Array.isArray(data.upcomingFlights)) data.upcomingFlights = data.upcomingFlights.map(decodeUpcoming);
  return data;
}

// Combina eventos en una lista "más nuevo primero", deduplicando y acotada a
// MAX_HISTORY. `incoming` puede venir más-nuevo-primero (backlog del servidor,
// evento SSE "history") o más-viejo-primero (los `emitted` de cada tick, en
// orden de minuto); `incomingNewestFirst` lo indica.
function mergeEvents(existing, incoming, incomingNewestFirst) {
  if (!incoming || incoming.length === 0) return existing;
  const inc  = incomingNewestFirst ? incoming : incoming.slice().reverse();
  const seen = new Set(existing.map(evKey));
  const fresh = inc.filter(e => !seen.has(evKey(e)));
  if (fresh.length === 0) return existing;
  return [...fresh, ...existing].slice(0, MAX_HISTORY);
}

// NOTA: la lista de paquetes por vuelo NO se reconstruye del historial del
// cliente (acotado a MAX_HISTORY) — la sirve el backend vía fetchFlightLots
// (plan vigente en pathByLot: incluye a bordo, por salir y volados).

const emptyState = {
  running: false,
  mode: "diadia",
  clock: "Dia --  00:00",
  block: 0,
  blockStart: "",
  blockEnd: "",
  airports: [],
  routes: [],
  events: [],
  collapsed: false,
  message: "Listo",
  kpis: {
    activeFlights: 0,
    saturationPercent: 0,
    occupancyPercent: 0,
    avgDeliveryDays: 0,
    replanifications: 0,
    deliveredOnTime: 0,
    atRisk: 0,
    outOfDeadline: 0,
    totalBags: 0,
    routedBags: 0,
  },
};

export function useSimulation() {
  const [state, setState]               = useState(emptyState);
  const [alerts, setAlerts]             = useState([]);
  const [history, setHistory]           = useState([]);
  // Identidad de corrida: incrementa en cada start(). Señal limpia de "nueva
  // simulación" para que la UI (p. ej. la tabla de sesión de /operaciones)
  // descarte lo de la corrida anterior.
  const [runId, setRunId]               = useState(0);
  // Preparación de Día a Día (aeropuertos/vuelos/paquetes cargados sin iniciar).
  const [prepStatus, setPrepStatus]     = useState({ airports: 0, flights: 0, lots: 0, ready: false });
  const [availableDates, setAvailableDates] = useState([]);
  const [flights, setFlights]               = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedNumDays, setSelectedNumDays] = useState(5);
  // Minuto de inicio dentro del día seleccionado (0–1439). 0 = inicio del día.
  const [selectedStartMinute, setSelectedStartMinute] = useState(0);


  const sourceRef        = useRef(null);
  const reconnectTimer   = useRef(null);

  // Conectar SSE con reconexión automática
  const connectSSE = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    clearTimeout(reconnectTimer.current);

    const source = new EventSource(`${API_BASE}/api/simulation/events`);
    sourceRef.current = source;

    source.addEventListener("state", event => {
      try {
        const data = decodeState(JSON.parse(event.data));
        setState(data);
      } catch {
        // ignorar eventos malformados
      }
    });

    // Alertas compartidas por el servidor (registro de lotes, cancelaciones,
    // ediciones de red). Todos los clientes reciben la MISMA lista; al
    // conectar/reconectar el backend reenvía el historial completo de alertas.
    source.addEventListener("alerts", event => {
      try {
        const list = JSON.parse(event.data);
        setAlerts(list.map((a, i) => ({
          id: `${a.time}-${i}`,
          type: a.type,
          text: a.text,
          time: new Date(a.time),
        })));
      } catch {
        // ignorar
      }
    });

    // Backlog del historial (se envía SOLO al conectar/recargar). Reconstruye lo
    // ya ocurrido; luego cada tick añade únicamente los eventos nuevos. Así el
    // Historial sobrevive a recargas SIN reenviar el log completo en cada frame.
    source.addEventListener("history", event => {
      try {
        const backlog = JSON.parse(event.data); // más-nuevo-primero
        setHistory(h => mergeEvents(h, backlog, true));
      } catch {
        // ignorar
      }
    });

    source.onerror = () => {
      source.close();
      sourceRef.current = null;
      reconnectTimer.current = setTimeout(connectSSE, 3000);
    };
  }, []);

  // Inicialización: estado + fechas disponibles + SSE
  useEffect(() => {
    fetch(`${API_BASE}/api/simulation/state`)
      .then(r => (r.ok ? r.json() : emptyState))
      .then(data => setState(prev => ({ ...prev, ...decodeState(data) })))
      .catch(() => {});

    fetch(`${API_BASE}/api/simulation/availableDates`)
      .then(r => (r.ok ? r.json() : []))
      .then(dates => {
        setAvailableDates(dates);
        setSelectedDate(prev => prev || (dates.length > 0 ? dates[0] : ""));
      })
      .catch(() => {});

    fetch(`${API_BASE}/api/simulation/flights`)
      .then(r => (r.ok ? r.json() : []))
      .then(setFlights)
      .catch(() => {});

    connectSSE();

    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      clearTimeout(reconnectTimer.current);
    };
  }, [connectSSE]);

  // Acumular en el Historial los eventos NUEVOS de cada tick (state.events trae
  // solo los recién emitidos). El backlog inicial llega por el evento SSE
  // "history" al conectar; aquí solo añadimos lo nuevo, deduplicado y acotado.
  useEffect(() => {
    const evs = state.events;
    if (!evs || evs.length === 0) return;
    setHistory(h => mergeEvents(h, evs, false)); // emitted: más-viejo-primero
  }, [state.events]);

const start = useCallback(async (mode, startDate, numDays, startMinute = 0) => {
  try {
    setHistory([]);
    // Corrida nueva: los relojes persistidos son de la anterior.
    localStorage.removeItem("tasf.realSeconds");
    localStorage.removeItem("tasf.simStartMinute");
    setState(prev => ({ ...prev, clock: "Dia --  00:00" }));
    // La velocidad de la simulación la controla el backend (BLOCK_REAL_SECONDS);
    // aquí solo enviamos qué simular y desde cuándo.
    const response = await fetch(`${API_BASE}/api/simulation/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        startDate:        startDate || null,
        numDays:          numDays   || null,
        startMinuteOfDay: startMinute || 0,
      }),
    });
    if (response.ok) {
      const data = await response.json();
      setState(data);
      setRunId(n => n + 1);   // nueva corrida → señal de reset para la UI
    }
  } catch (e) {
    console.error("Error al iniciar simulación:", e);
  }
}, []);

  const stop = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/simulation/stop`, {
        method: "POST",
      });
      if (response.ok) {
        const data = await response.json();
        setState(data);
      }
    } catch (e) {
      console.error("Error al detener simulación:", e);
    }
  }, []);

  const pause = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/pause`, { method: "POST" });
      if (r.ok) setState(await r.json());
    } catch (e) {
      console.error("Error al pausar simulación:", e);
    }
  }, []);

  const resume = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/resume`, { method: "POST" });
      if (r.ok) setState(await r.json());
    } catch (e) {
      console.error("Error al reanudar simulación:", e);
    }
  }, []);

  // ── Alertas (registro de lotes y cancelaciones) para la pestaña Monitoreo ──
  // Nota: las alertas las genera el SERVIDOR y se reciben por el evento SSE
  // "alerts" (ver connectSSE). Así son compartidas entre todos los clientes y
  // persisten al recargar. Aquí solo disparamos la acción; el backend emite la
  // alerta correspondiente a todos.
  const cancelFlight = useCallback(async (flightId, info = {}) => {
    void info; // compatibilidad de firma (la alerta la arma el backend)
    try {
      const response = await fetch(`${API_BASE}/api/simulation/cancelFlight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flightId }),
      });
      if (response.ok) setState(await response.json());
    } catch (e) {
      console.error("Error al cancelar vuelo:", e);
    }
  }, []);

  // Alta de lote (registro). Devuelve true si se agregó. `client` viaja al
  // backend para identificar quién registró en la alerta compartida.
  // Estado de preparación de Día a Día. Se refresca al cargar y tras cada ingesta.
  const refreshPrep = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/prepStatus`);
      if (r.ok) setPrepStatus(await r.json());
    } catch { /* backend antiguo sin endpoint: ignorar */ }
  }, []);

  const resetPrep = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/api/simulation/resetPrep`, { method: "POST" });
    } catch { /* ignore */ }
    refreshPrep();
  }, [refreshPrep]);

  const addLot = useCallback(async (origin, destination, quantity, client) => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/addLot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // clientEpochMs = reloj del sistema del usuario → el backend lo convierte
        // a la hora local del aeropuerto de origen (GMT-0 interno).
        body: JSON.stringify({ origin, destination, quantity, client, clientEpochMs: Date.now() }),
      });
      if (!r.ok) return false;
      setState(await r.json());
      refreshPrep();
      return true;
    } catch (e) {
      console.error("Error al registrar lote:", e);
      return false;
    }
  }, [refreshPrep]);

  // Recorrido completo (todos los tramos) de un envío. Devuelve { lotId, legs }
  // con cada tramo y su estado (done/current/upcoming).
  const fetchShipmentPath = useCallback(async (lotId) => {
    if (!lotId) return { lotId, legs: [] };
    try {
      const r = await fetch(
        `${API_BASE}/api/simulation/shipmentPath?lotId=${encodeURIComponent(lotId)}`);
      if (!r.ok) return { lotId, legs: [] };
      return await r.json();
    } catch {
      return { lotId, legs: [] };
    }
  }, []);

  // Recorridos del lote COMPLETO: una ruta por sub-lote (divisiones separadas).
  const fetchShipmentPaths = useCallback(async (lotId) => {
    if (!lotId) return [];
    try {
      const r = await fetch(
        `${API_BASE}/api/simulation/shipmentPaths?lotId=${encodeURIComponent(lotId)}`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];   // blindaje: siempre array
    } catch {
      return [];
    }
  }, []);

  // Paquetes (lotes) asignados a un vuelo, con su cantidad de maletas y estado
  // del tramo (current = a bordo, upcoming = por salir, done = ya voló).
  // Fuente: plan vigente del backend (pathByLot) — NO depende del historial
  // acotado del cliente. (Se perdió en un conflicto de stash: si Carga se queda
  // en "Cargando…" sin peticiones de red, es que esta función no llega al panel.)
  const fetchFlightLots = useCallback(async (flightId) => {
    if (!flightId) return [];
    try {
      const r = await fetch(
        `${API_BASE}/api/simulation/flightLots?flightId=${encodeURIComponent(flightId)}`);
      if (!r.ok) return [];
      return await r.json();
    } catch {
      return [];
    }
  }, []);

  // Envíos PLANIFICADOS (con ruta, aún sin despegar) — no están en el historial
  // de eventos, así que la tarjeta de Envíos los pide aparte para listarlos.
  // TODOS los vuelos vivos (para el panel de cancelaciones: buscar por ciudad/
  // código sin el límite de 120 min). Cada uno trae su horario y el tag hoy/mañana.
  const fetchScheduledFlights = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/scheduledFlights`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }, []);

  // Busca envíos en el PLAN COMPLETO del backend (no solo el subconjunto que ya
  // tiene el cliente): para encontrar un código exacto en Período aunque no esté
  // entre los planificados enviados por defecto.
  const fetchSearchLots = useCallback(async (q) => {
    if (!q || !q.trim()) return [];
    try {
      const r = await fetch(`${API_BASE}/api/simulation/searchLots?q=${encodeURIComponent(q.trim())}`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }, []);

  const fetchPlannedLots = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/plannedLots`);
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data) ? data : [];   // blindaje: siempre array
    } catch {
      return [];
    }
  }, []);

  // Plan de ruteo del último bloque planificado (Reportes).
  const fetchLastBlockPlan = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/lastBlockPlan`);
      if (!r.ok) return null;
      const p = await r.json();
      return p && p.block > 0 ? p : null;
    } catch {
      return null;
    }
  }, []);

  // ── Edición de la red en caliente ─────────────────────────────────────────
  const postJson = useCallback(async (path, body) => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) return false;
      setState(await r.json());
      refreshPrep();           // las ingestas cambian la preparación de Día a Día
      return true;
    } catch (e) {
      console.error(`Error en ${path}:`, e);
      return false;
    }
  }, [refreshPrep]);

  const addFlight = useCallback(async (origin, destination, departureLocal, arrivalLocal, capacity) =>
    postJson("addFlight", { origin, destination, departureLocal, arrivalLocal, capacity }),
  [postJson]);

  const addAirport = useCallback(async (code, region, lat, lng, gmtHours, capacity) =>
    postJson("addAirport", { code, region, lat, lng, gmtHours, capacity }),
  [postJson]);




// Editar almacén: capacidad y/o ubicación (lat/lng). Segunda firma compatible:
// editAirport(code, capacity) sigue funcionando; editAirport(code, {capacity,
// lat, lng}) permite editar la ubicación.
const editAirport = useCallback(async (code, arg) => {
  const body = (arg !== null && typeof arg === "object")
    ? { code, ...arg }
    : { code, capacity: arg };
  return postJson("editAirport", body);
}, [postJson]);

// Editar UT: capacidad/horas (siempre) y origen/destino (solo en preparación —
// el backend ignora el cambio de tramo con la simulación en curso).
const editFlight = useCallback(async (flightId, { capacity, departureLocal, arrivalLocal, origin, destination }) =>
  postJson("editFlight", { flightId, capacity, departureLocal, arrivalLocal, origin, destination }),
[postJson]);


const deleteAirport = useCallback(async (code) =>
  postJson("deleteAirport", { code }),
[postJson]);

const deleteFlight = useCallback(async (flightId) =>
  postJson("deleteFlight", { flightId }),
[postJson]);


  const closeAirport = useCallback(async (code) =>
    postJson("closeAirport", { code }),
  [postJson]);

  const uploadData = useCallback(async (type, content, origin) =>
    postJson("uploadData", { type, content, origin }),
  [postJson]);



  // Pausa: el backend marca el estado con message="Pausado" mientras congela
  // el reloj simulado.
  const paused = state.message === "Pausado";

  // Los relojes sobreviven a RECARGAS de página: se persisten en localStorage
  // y se restauran al montar. `gotServerState` evita que el estado inicial
  // (running=false, antes del primer SSE) borre lo persistido; solo un
  // "no corre" CONFIRMADO por el servidor resetea.
  const CLOCK_RS  = "tasf.realSeconds";
  const CLOCK_SSM = "tasf.simStartMinute";
  const gotServerState = useRef(false);
  useEffect(() => {
    if (state !== emptyState) gotServerState.current = true;
  }, [state]);

  // Tiempo real transcurrido: cuenta por incrementos de 1 s y se CONGELA durante
  // la pausa. Se persiste en cada tick (el conteo por incrementos respeta las
  // pausas, cosa que un epoch de inicio no haría).
  const [realSeconds, setRealSeconds] = useState(() =>
    Number(localStorage.getItem(CLOCK_RS)) || 0);
  useEffect(() => {
    if (!state.running) {
      if (!gotServerState.current) return;            // aún sin estado real
      setRealSeconds(0);                              // reset al detener
      localStorage.removeItem(CLOCK_RS);
      return;
    }
    if (paused) return;                               // congelar en pausa
    const id = setInterval(() => setRealSeconds(s => {
      const next = s + 1;
      localStorage.setItem(CLOCK_RS, String(next));
      return next;
    }), 1000);
    return () => clearInterval(id);
  }, [state.running, paused]);

  // Minuto de inicio de la simulación (autoritativo): el primer simulatedMinute
  // real que emite el backend. Persistido para que "sim transcurrido" no vuelva
  // a 0 al recargar. Guarda anti-corrida-nueva: si el minuto actual es MENOR que
  // el inicio guardado, la sim se reinició desde antes → se adopta el actual.
  const [simStartMinute, setSimStartMinute] = useState(() => {
    const v = Number(localStorage.getItem(CLOCK_SSM));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  useEffect(() => {
    if (!state.running) {
      if (!gotServerState.current) return;
      if (simStartMinute !== null) setSimStartMinute(null);
      localStorage.removeItem(CLOCK_SSM);
    } else if (state.simulatedMinute > 0) {
      setSimStartMinute(prev => {
        const next = prev === null ? state.simulatedMinute
                                   : Math.min(prev, state.simulatedMinute);
        localStorage.setItem(CLOCK_SSM, String(next));
        return next;
      });
    }
  }, [state.running, state.simulatedMinute, simStartMinute]);


  // Refresca la preparación al cargar; mientras NO corre, sondea cada 4 s para
  // reflejar lo que cargan otras instancias.
  useEffect(() => {
    refreshPrep();
    if (state.running) return;
    const id = setInterval(refreshPrep, 4000);
    return () => clearInterval(id);
  }, [state.running, refreshPrep]);

return {
  ...state,
  history,
  runId,
  prepStatus,
  resetPrep,
  simStartMinute,
  availableDates,
  flights,
  selectedDate,
  setSelectedDate,
  selectedNumDays,
  setSelectedNumDays,
  selectedStartMinute,
  setSelectedStartMinute,
  start,
  stop,
  pause,
  resume,
  paused,
  cancelFlight,
  addLot,
  addFlight,
  addAirport,
  closeAirport,
  uploadData,
  fetchShipmentPath,
  fetchShipmentPaths,
  fetchFlightLots,
  fetchPlannedLots,
  fetchScheduledFlights,
  fetchSearchLots,
  fetchLastBlockPlan,
  alerts,
  realSeconds,
  editAirport, editFlight,
  deleteAirport, deleteFlight,   // ← agregar esta línea
};
}