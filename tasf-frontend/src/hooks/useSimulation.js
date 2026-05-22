import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";

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
  const [state, setState] = useState(emptyState);
  const sourceRef = useRef(null);
  const reconnectTimer = useRef(null);

  // Función para conectar SSE con reconexión automática
  const connectSSE = useCallback(() => {
    // Cerrar conexión previa si existe
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
      // Reconectar en 3 segundos si el SSE se corta
      reconnectTimer.current = setTimeout(() => {
        connectSSE();
      }, 3000);
    };
  }, []);

  useEffect(() => {
    // Cargar estado inicial
    fetch(`${API_BASE}/api/simulation/state`)
      .then(r => (r.ok ? r.json() : emptyState))
      .then(data => setState(prev => ({ ...prev, ...data })))
      .catch(() => {});

    // Conectar SSE
    connectSSE();

    return () => {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
      clearTimeout(reconnectTimer.current);
    };
  }, [connectSSE]);

  const start = useCallback(async mode => {
    try {
      const response = await fetch(`${API_BASE}/api/simulation/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, blockSeconds: 25 }),
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

  return { ...state, start, stop };
}
