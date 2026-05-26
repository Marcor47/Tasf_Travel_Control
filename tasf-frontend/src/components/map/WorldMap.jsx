import { useEffect, useRef, useState } from "react";
import {
  ComposableMap, Geographies, Geography,
  Marker, Line
} from "react-simple-maps";
import { STATIC_AIRPORTS } from "../../data/staticAirports";

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
    @keyframes fadeOut {
      from { opacity: 0.3; }
      to   { opacity: 0; }
    }
    .route-active {
      animation: dashMove 1.4s linear infinite;
    }
    .route-fading {
      animation: fadeOut 5s forwards;
    }
  `;
  document.head.appendChild(style);
}

const LANDED_TTL_MS = 5000;

export default function WorldMap({
  airports = [], routes = [], onAirportClick,
  running = false, message = ""
}) {
  useEffect(() => { injectAnimation(); }, []);

  const landedRoutes    = useRef({});
  const [, setTick]     = useState(0);

  useEffect(() => {
    if (!running) {
      landedRoutes.current = {};
      return;
    }
    const id = setInterval(() => setTick(t => t + 1), 800);
    return () => clearInterval(id);
  }, [running]);

  const now = Date.now();

  // Procesar rutas del backend
  if (running && routes.length > 0) {
    routes.forEach(r => {
      const key = `${r.from}-${r.to}`;
      if (r.status === "just_landed") {
        if (!landedRoutes.current[key]) {
          landedRoutes.current[key] = { from: r.from, to: r.to, addedAt: now };
        }
      } else if (r.status === "departed") {
        delete landedRoutes.current[key];
      }
    });
  }

  // Limpiar expiradas
  Object.keys(landedRoutes.current).forEach(key => {
    if (now - landedRoutes.current[key].addedAt > LANDED_TTL_MS + 500) {
      delete landedRoutes.current[key];
    }
  });

  // Si no hay datos del backend aún, mostrar los aeropuertos estáticos
  // para que el mapa no quede vacío antes de iniciar la simulación
  const shownAirports = airports.length > 0 ? airports : STATIC_AIRPORTS;
  const airportMap    = Object.fromEntries(
    shownAirports.map(a => [a.code, [a.lng, a.lat]])
  );

  const activeRoutes = (!running || routes.length === 0) ? []
    : routes.filter(r => r.status === "departed");

  const fadingRoutes = Object.values(landedRoutes.current)
    .filter(r => (now - r.addedAt) < LANDED_TTL_MS);

  // ¿Está en fase de cálculo ALNS? (el mensaje lo indica)
  const isCalculating = running && message.startsWith("Planificando");

  return (
    <div className="w-full h-full bg-[#031525] rounded border border-teal/20 relative">
      <div className="flex items-center justify-between px-2 pt-2 pb-1">
        <p className="text-teal text-[10px] font-bold uppercase tracking-wide">
          Monitoreo de Rutas y Posición GPS Real
        </p>
        {/* Indicador de estado visible durante cálculo */}
        {isCalculating && (
          <span className="text-[10px] text-yellow-400 animate-pulse font-medium">
            ⚙ {message}
          </span>
        )}
        {running && !isCalculating && activeRoutes.length > 0 && (
          <span className="text-[10px] text-green-400">
            ✈ {activeRoutes.length} vuelos activos
          </span>
        )}
      </div>

      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 120, center: [20, 10] }}
        style={{ width: "100%", height: "calc(100% - 32px)" }}>

        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography key={geo.rsmKey} geography={geo}
                fill="#0a2540" stroke="#1C7293" strokeWidth={0.3} />
            ))
          }
        </Geographies>

        {/* Rutas recién aterrizadas — se desvanecen */}
        {fadingRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          return (
            <Line key={`fading-${r.from}-${r.to}-${i}`}
              from={from} to={to}
              stroke="#2DD4BF"
              strokeWidth={0.7}
              strokeLinecap="round"
              strokeDasharray="6 4"
              className="route-fading" />
          );
        })}

        {/* Rutas activas animadas */}
        {activeRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          return (
            <Line key={`active-${r.from}-${r.to}-${i}`}
              from={from} to={to}
              stroke="#F4A261"
              strokeWidth={1.2}
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
          const r    = 3 + Math.round(pct * 4);
          return (
            <Marker key={a.code}
              coordinates={[a.lng, a.lat]}
              onClick={() => onAirportClick?.(a)}>
              <circle r={r} fill={fill} stroke="#fff" strokeWidth={0.8}
                style={{ cursor: "pointer" }} />
              <text textAnchor="middle" y={-(r + 3)}
                style={{ fontSize: 7, fill: "#9DBDCC",
                         fontFamily: "sans-serif", pointerEvents: "none" }}>
                {a.code}
              </text>
            </Marker>
          );
        })}
      </ComposableMap>
    </div>
  );
}
