import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || ""; // || "http://localhost:8080";
const MAX_HISTORY = 300;

const evKey = e => `${e.minute}-${e.flightId}-${e.type}-${e.finalDestination}`;

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
        const data = JSON.parse(event.data);
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
      .then(data => setState(prev => ({ ...prev, ...data })))
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
  const addLot = useCallback(async (origin, destination, quantity, client) => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/addLot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, quantity, client }),
      });
      if (!r.ok) return false;
      setState(await r.json());
      return true;
    } catch (e) {
      console.error("Error al registrar lote:", e);
      return false;
    }
  }, []);

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
      return true;
    } catch (e) {
      console.error(`Error en ${path}:`, e);
      return false;
    }
  }, []);

  const addFlight = useCallback(async (origin, destination, departureLocal, arrivalLocal, capacity) =>
    postJson("addFlight", { origin, destination, departureLocal, arrivalLocal, capacity }),
  [postJson]);

  const addAirport = useCallback(async (code, region, lat, lng, gmtHours, capacity) =>
    postJson("addAirport", { code, region, lat, lng, gmtHours, capacity }),
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

  // Tiempo real transcurrido: cuenta por incrementos de 1 s y se CONGELA durante
  // la pausa (no cuenta mientras la simulación está pausada).
  const [realSeconds, setRealSeconds] = useState(0);
  useEffect(() => {
    if (!state.running) { setRealSeconds(0); return; }  // reset al detener
    if (paused) return;                                  // congelar en pausa
    const id = setInterval(() => setRealSeconds(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [state.running, paused]);


  // Minuto de inicio de la simulación (autoritativo): el primer simulatedMinute
  // real que emite el backend. Se rastrea aquí, en el hook a nivel de App, que
  // NO se remonta al cambiar de pestaña — así el "tiempo simulado transcurrido"
  // no se descuadra al navegar entre modos.
  const [simStartMinute, setSimStartMinute] = useState(null);
  useEffect(() => {
    if (!state.running) {
      if (simStartMinute !== null) setSimStartMinute(null);
    } else if (state.simulatedMinute > 0) {
      setSimStartMinute(prev =>
        prev === null ? state.simulatedMinute
                      : Math.min(prev, state.simulatedMinute));
    }
  }, [state.running, state.simulatedMinute, simStartMinute]);


  return {
    ...state,
    history,
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
    alerts,
    realSeconds, // ← nuevo
  };
}