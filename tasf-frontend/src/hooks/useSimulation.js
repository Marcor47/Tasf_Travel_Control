import { useCallback, useEffect, useState } from "react";

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

  useEffect(() => {
    fetch(`${API_BASE}/api/simulation/state`)
      .then(r => (r.ok ? r.json() : emptyState))
      .then(data => setState(prev => ({ ...prev, ...data })))
      .catch(() => {});

    const source = new EventSource(`${API_BASE}/api/simulation/events`);
    source.addEventListener("state", event => {
      try {
        setState(JSON.parse(event.data));
      } catch {
        // Ignore malformed keep-alive or partial events.
      }
    });
    return () => source.close();
  }, []);

  const start = useCallback(async mode => {
    const response = await fetch(`${API_BASE}/api/simulation/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, blockSeconds: 120 }),
    });
    if (response.ok) setState(await response.json());
  }, []);

  const stop = useCallback(async () => {
    const response = await fetch(`${API_BASE}/api/simulation/stop`, {
      method: "POST",
    });
    if (response.ok) setState(await response.json());
  }, []);

  return { ...state, start, stop };
}
