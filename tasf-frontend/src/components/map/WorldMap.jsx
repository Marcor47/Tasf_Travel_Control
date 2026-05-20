import { useEffect, useRef } from "react";
import {
  ComposableMap, Geographies, Geography,
  Marker, Line
} from "react-simple-maps";
import { airports as mockAirports, routes as mockRoutes } from "../../data/mockData";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// Inyecta la animación CSS una sola vez en el documento
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
      opacity: 0.3;
    }
  `;
  document.head.appendChild(style);
}

export default function WorldMap({ airports = [], routes = [], onAirportClick }) {
  useEffect(() => { injectAnimation(); }, []);

  const shownAirports = airports.length ? airports : mockAirports;

  // Solo mostrar rutas activas (departed pero NO landed aún)
  // El backend envía routes con status "departed" o "landed"
  // Filtramos: mostramos departed, y landed solo 30 segundos (usamos ref para timestamp)
  const landedTimestamps = useRef({});

  // Marcar cuándo cada ruta aterrizó para desvanecerla gradualmente
  const rawRoutes = routes.length ? routes : mockRoutes;
  rawRoutes.forEach(r => {
    const key = `${r.from}-${r.to}`;
    if (r.status === "landed" && !landedTimestamps.current[key]) {
      landedTimestamps.current[key] = Date.now();
    }
    if (r.status === "departed") {
      delete landedTimestamps.current[key];
    }
  });

  // Filtrar: quitar rutas landed hace más de 8 segundos
  const now = Date.now();
  const visibleRoutes = rawRoutes.filter(r => {
    const key = `${r.from}-${r.to}`;
    if (r.status === "landed") {
      const ts = landedTimestamps.current[key];
      return ts && (now - ts) < 8000;
    }
    return true;
  });

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

        {/* Rutas animadas */}
        {visibleRoutes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          const isLanded  = r.status === "landed";
          const color     = isLanded ? "#2DD4BF" : "#F4A261";
          const cssClass  = isLanded ? "route-landed" : "route-active";
          return (
            <Line key={`${r.from}-${r.to}-${i}`}
              from={from} to={to}
              stroke={color}
              strokeWidth={isLanded ? 0.8 : 1.4}
              strokeLinecap="round"
              strokeDasharray="8 4"
              className={cssClass}/>
          );
        })}

        {/* Aeropuertos */}
        {shownAirports.map(a => {
          const pct = Math.min(1, (a.current || 0) / Math.max(1, a.capacity || 1));
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
                style={{ cursor: "pointer" }}/>
              <text textAnchor="middle" y={-8}
                style={{ fontSize:7, fill:"#9DBDCC", fontFamily:"sans-serif",
                         pointerEvents:"none" }}>
                {a.code}
              </text>
            </Marker>
          );
        })}
      </ComposableMap>
    </div>
  );
}
