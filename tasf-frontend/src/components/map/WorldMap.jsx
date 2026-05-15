import {
  ComposableMap, Geographies, Geography,
  Marker, Line
} from "react-simple-maps";
import { airports, routes } from "../../data/mockData";

const GEO_URL =
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

const airportMap = Object.fromEntries(
  airports.map(a => [a.code, [a.lng, a.lat]])
);

export default function WorldMap({ onAirportClick }) {
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

        {/* Rutas */}
        {routes.map((r, i) => {
          const from = airportMap[r.from];
          const to   = airportMap[r.to];
          if (!from || !to) return null;
          return (
            <Line key={i}
              from={from} to={to}
              stroke="#F4A261" strokeWidth={1.2}
              strokeLinecap="round"
              strokeDasharray="4 3"/>
          );
        })}

        {/* Aeropuertos */}
        {airports.map(a => (
          <Marker key={a.code}
            coordinates={[a.lng, a.lat]}
            onClick={() => onAirportClick?.(a)}>
            <circle r={4} fill="#1C7293" stroke="#fff" strokeWidth={0.8}/>
            <text textAnchor="middle" y={-7}
              style={{ fontSize:7, fill:"#9DBDCC", fontFamily:"sans-serif" }}>
              {a.code}
            </text>
          </Marker>
        ))}
      </ComposableMap>
    </div>
  );
}