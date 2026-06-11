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
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedNumDays, setSelectedNumDays] = useState(5);


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
        if (dates.length > 0) setSelectedDate(dates[0]);
      })
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

const start = useCallback(async (mode, startDate, numDays) => {
  try {
    setHistory([]);
    prevEventsRef.current = [];
    setState(prev => ({ ...prev, clock: "Dia --  00:00" })); // ← línea nueva
    const blockSeconds = mode === "diadia" ? 3600 : 30;
    const response = await fetch(`${API_BASE}/api/simulation/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        blockSeconds,
        startDate: startDate || null,
        numDays:   numDays   || null,
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

  const cancelFlight = useCallback(async (flightId) => {
    try {
      const response = await fetch(`${API_BASE}/api/simulation/cancelFlight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flightId }),
      });
      if (response.ok) {
        const data = await response.json();
        setState(data);
      }
    } catch (e) {
      console.error("Error al cancelar vuelo:", e);
    }
  }, []);

  return {
    ...state,
    history,
    availableDates,
    selectedDate,
    setSelectedDate,
    selectedNumDays,
    setSelectedNumDays,
    start,
    stop,
    cancelFlight, // ← nuevo
  };
}