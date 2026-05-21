import { useEffect, useRef } from "react";
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
      to   { stroke-dashoffset: 0;  }
    }
    .route-active {
      animation: dashMove 1.2s linear infinite;
    }
    .route-landed {
      animation: none;
      opacity: 0.25;
    }
  `;
  document.head.appendChild(style);
}

export default function WorldMap({ airports = [], routes = [], onAirportClick, running = false }) {
  useEffect(() => { injectAnimation(); }, []);

  const landedTimestamps = useRef({});
  const now = Date.now();

  // Solo mostrar rutas si la simulación está activa Y hay rutas reales del backend
  // Nunca usar mockRoutes — si no hay datos del backend, mapa vacío
  if (running && routes.length > 0) {
    routes.forEach(r => {
      const key = `${r.from}-${r.to}-${r.status}`;
      if (r.status === "landed" && !landedTimestamps.current[key]) {
        landedTimestamps.current[key] = Date.now();
      }
      if (r.status === "departed") {
        // limpiar landed previo de esta ruta
        const landedKey = `${r.from}-${r.to}-landed`;
        delete landedTimestamps.current[landedKey];
      }
    });
  }

  // Filtrar: quitar rutas landed hace más de 8 segundos
  const visibleRoutes = (!running || routes.length === 0) ? [] : routes.filter(r => {
    if (r.status === "landed") {
      const key = `${r.from}-${r.to}-landed`;
      const ts = landedTimestamps.current[key];
      return ts && (now - ts) < 8000;
    }
    return true;
  });

  // Solo mostrar aeropuertos del backend cuando hay datos reales
  const shownAirports = airports.length > 0 ? airports : [];

  const airportMap = Object.fromEntries(
    shownAirports.map(a => [a.code, [a.lng, a.lat]])
  );

  return (
    <div className="w-full h-full bg-[#031525] rounded border border-teal/20">
      <p className="text-teal text-[10px] font-bold uppercase p-2 tracking-wide">
        Monitoreo de Rutas y Posición GPS Real
      </p>
      <ComposableMap
        projection="geoMercator"
        projectionConfig={{ scale: 120, center: [20, 10] }}
        style={{ width:"100%", height:"calc(100% - 28px)" }}>

        <Geographies geography={GEO_URL}>
          {({ geographies }) =>
            geographies.map(geo => (
              <Geography key={geo.rsmKey} geography={geo}
                fill="#0a2540" stroke="#1C7293" strokeWidth={0.3}/>
            ))
          }
        </Geographies>

        {/* Rutas: solo si simulación activa */}
        {visibleRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          const isLanded = r.status === "landed";
          return (
            <Line key={`${r.from}-${r.to}-${i}`}
              from={from} to={to}
              stroke={isLanded ? "#2DD4BF" : "#F4A261"}
              strokeWidth={isLanded ? 0.8 : 1.4}
              strokeLinecap="round"
              strokeDasharray="8 4"
              className={isLanded ? "route-landed" : "route-active"}/>
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
                style={{ cursor:"pointer" }}/>
              <text textAnchor="middle" y={-8}
                style={{ fontSize:7, fill:"#9DBDCC",
                         fontFamily:"sans-serif", pointerEvents:"none" }}>
                {a.code}
              </text>
            </Marker>
          );
        })}
      </ComposableMap>
    </div>
  );
}
