import { useEffect, useRef, useState } from "react";
import {
  ComposableMap, Geographies, Geography,
  Marker, Line
} from "react-simple-maps";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

function injectAnimation() {
  if (document.getElementById("route-anim-style")) return;
  const style = document.createElement("style");
  style.id = "route-anim-style";
  style.textContent = `
    @keyframes dashMove {
      from { stroke-dashoffset: 24; }
      to   { stroke-dashoffset: 0; }
    }
    .route-active {
      animation: dashMove 1.2s linear infinite;
    }
    .route-fading {
      animation: none;
      opacity: 0.2;
      transition: opacity 1s;
    }
  `;
  document.head.appendChild(style);
}

// Cuánto tiempo (ms real) se muestra una ruta landed antes de borrarse
const LANDED_TTL_MS = 5000;

export default function WorldMap({ airports = [], routes = [], onAirportClick, running = false }) {
  useEffect(() => { injectAnimation(); }, []);

  // landedRoutes: mapa de key -> { from, to, bags, addedAt }
  // Se gestiona localmente en el frontend con timestamp real
  const landedRoutes = useRef({});

  // Tick cada 500ms para re-render y limpiar rutas expiradas
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!running) {
      landedRoutes.current = {};
      return;
    }
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [running]);

  const now = Date.now();

  // Procesar rutas entrantes del backend
  if (running && routes.length > 0) {
    routes.forEach(r => {
      const key = `${r.from}-${r.to}`;
      if (r.status === "just_landed") {
        // Solo registrar si no está ya registrado (no reiniciar el timer)
        if (!landedRoutes.current[key]) {
          landedRoutes.current[key] = {
            from: r.from, to: r.to, bags: r.bags,
            addedAt: now
          };
        }
      } else if (r.status === "departed") {
        // Si este vuelo volvió a salir, limpiar su landed anterior
        delete landedRoutes.current[key];
      }
    });
  }

  // Limpiar rutas landed expiradas
  Object.keys(landedRoutes.current).forEach(key => {
    if (now - landedRoutes.current[key].addedAt > LANDED_TTL_MS) {
      delete landedRoutes.current[key];
    }
  });

  const shownAirports = airports.length > 0 ? airports : [];
  const airportMap = Object.fromEntries(
    shownAirports.map(a => [a.code, [a.lng, a.lat]])
  );

  // Rutas activas (departed) del backend
  const activeRoutes = (!running || routes.length === 0) ? [] :
    routes.filter(r => r.status === "departed");

  // Rutas landed locales (aún dentro del TTL)
  const fadingRoutes = Object.values(landedRoutes.current);

  return (
    <div className="w-full h-full bg-[#031525] rounded border border-teal/20">
      <p className="text-teal text-[10px] font-bold uppercase p-2 tracking-wide">
        Monitoreo de Rutas y Posición GPS Real
      </p>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 120, center: [20, 10] }}
        style={{ width: "100%", height: "calc(100% - 28px)" }}>

        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography key={geo.rsmKey} geography={geo}
                fill="#0a2540" stroke="#1C7293" strokeWidth={0.3} />
            ))
          }
        </Geographies>

        {/* Rutas que acaban de aterrizar — desvanecidas */}
        {fadingRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          return (
            <Line key={`fading-${r.from}-${r.to}-${i}`}
              from={from} to={to}
              stroke="#2DD4BF"
              strokeWidth={0.8}
              strokeLinecap="round"
              strokeDasharray="8 4"
              className="route-fading" />
          );
        })}

        {/* Rutas activas — animadas */}
        {activeRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          return (
            <Line key={`active-${r.from}-${r.to}-${i}`}
              from={from} to={to}
              stroke="#F4A261"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeDasharray="8 4"
              className="route-active" />
          );
        })}

        {/* Aeropuertos */}
        {shownAirports.map(a => {
          const pct  = Math.min(1, (a.current || 0) / Math.max(1, a.capacity || 1));
          const fill = pct > 0.85 ? "#E76F51"
                     : pct > 0.6  ? "#F4A261"
                     : "#1C7293";
          return (
            <Marker key={a.code}
              coordinates={[a.lng, a.lat]}
              onClick={() => onAirportClick?.(a)}>
              <circle
                r={4 + Math.round(pct * 4)}
                fill={fill}
                stroke="#fff"
                strokeWidth={0.8}
                style={{ cursor: "pointer" }} />
              <text textAnchor="middle" y={-8}
                style={{
                  fontSize: 7, fill: "#9DBDCC",
                  fontFamily: "sans-serif", pointerEvents: "none"
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
