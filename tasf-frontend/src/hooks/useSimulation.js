import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || ""; // || "http://localhost:8080";
const MAX_HISTORY = 300;

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
  const [history, setHistory]           = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [flights, setFlights]               = useState([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedNumDays, setSelectedNumDays] = useState(5);
  // Minuto de inicio dentro del día seleccionado (0–1439). 0 = inicio del día.
  const [selectedStartMinute, setSelectedStartMinute] = useState(0);


  const prevEventsRef    = useRef([]);
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

  // Acumular historial de eventos
  useEffect(() => {
    const events = state.events;
    if (!events || events.length === 0) return;

    const prev   = prevEventsRef.current;
    const newEvs = events.filter(e =>
      !prev.some(p =>
        p.minute           === e.minute           &&
        p.flightId         === e.flightId         &&
        p.type             === e.type             &&
        p.finalDestination === e.finalDestination
      )
    );
    if (newEvs.length === 0) return;
    prevEventsRef.current = events;

    setHistory(h => {
      const combined = [...newEvs.slice().reverse(), ...h];
      const seen = new Set();
      return combined
        .filter(e => {
          const k = `${e.minute}-${e.flightId}-${e.type}-${e.finalDestination}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        })
        .slice(0, MAX_HISTORY);
    });
  }, [state.events]);

const start = useCallback(async (mode, startDate, numDays, startMinute = 0) => {
  try {
    setHistory([]);
    prevEventsRef.current = [];
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
  const [alerts, setAlerts] = useState([]);
  const pushAlert = useCallback((type, text) => {
    setAlerts(a => [
      { id: Date.now() + Math.random(), type, text, time: new Date() },
      ...a,
    ].slice(0, 50));
  }, []);

  const cancelFlight = useCallback(async (flightId, info = {}) => {
    try {
      const response = await fetch(`${API_BASE}/api/simulation/cancelFlight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flightId }),
      });
      if (response.ok) {
        setState(await response.json());
        const ruta = (info.from && info.to) ? ` ${info.from}→${info.to}` : "";
        pushAlert("cancel",
          `Vuelo ${flightId}${ruta} cancelado — ${info.bags || 0} maletas a replanificar`);
      }
    } catch (e) {
      console.error("Error al cancelar vuelo:", e);
    }
  }, [pushAlert]);

  // Alta de lote (registro). Devuelve true si se agregó; registra una alerta.
  const addLot = useCallback(async (origin, destination, quantity, client) => {
    try {
      const r = await fetch(`${API_BASE}/api/simulation/addLot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, quantity }),
      });
      if (!r.ok) return false;
      setState(await r.json());
      pushAlert("register",
        `${quantity} maletas ${origin}→${destination} registradas${client ? ` · ${client}` : ""}`);
      return true;
    } catch (e) {
      console.error("Error al registrar lote:", e);
      return false;
    }
  }, [pushAlert]);

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

  const addFlight = useCallback(async (origin, destination, departureLocal, arrivalLocal, capacity) => {
    const ok = await postJson("addFlight", { origin, destination, departureLocal, arrivalLocal, capacity });
    if (ok) pushAlert("register",
      `Vuelo ${origin}→${destination} ${departureLocal} agregado (cap ${capacity})`);
    return ok;
  }, [postJson, pushAlert]);

  const addAirport = useCallback(async (code, region, lat, lng, gmtHours, capacity) => {
    const ok = await postJson("addAirport", { code, region, lat, lng, gmtHours, capacity });
    if (ok) pushAlert("register", `Aeropuerto ${code} agregado (cap ${capacity})`);
    return ok;
  }, [postJson, pushAlert]);

  const closeAirport = useCallback(async (code) => {
    const ok = await postJson("closeAirport", { code });
    if (ok) pushAlert("cancel", `Aeropuerto ${code} cerrado`);
    return ok;
  }, [postJson, pushAlert]);

  const uploadData = useCallback(async (type, content, origin) => {
    const ok = await postJson("uploadData", { type, content, origin });
    const label = type === "planes" ? "vuelos" : type === "airports" ? "aeropuertos" : "lotes";
    if (ok) pushAlert("register", `Archivo de ${label} cargado`);
    return ok;
  }, [postJson, pushAlert]);



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
    alerts,
    realSeconds, // ← nuevo
  };
}