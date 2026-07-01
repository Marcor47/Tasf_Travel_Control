import { useState, useEffect } from "react";
import { STATIC_AIRPORTS, AIRPORT_META, airportName } from "../data/staticAirports";

const API_BASE = import.meta.env.VITE_API_BASE || "";

const CONTINENT_RANGES = {
  "Europa":            { lat: [35, 71],    lng: [-25, 60],   gmt: [-1, 4]   },
  "América del Norte": { lat: [5, 83],     lng: [-170, -50], gmt: [-10, -3] },
  "América del Sur":   { lat: [-56, 13],   lng: [-82, -34],  gmt: [-5, -2]  },
  "Asia":              { lat: [-10, 77],   lng: [25, 180],   gmt: [2, 12]   },
  "África":            { lat: [-35, 37],   lng: [-18, 52],   gmt: [-1, 4]   },
  "Oceanía":           { lat: [-47, 0],    lng: [110, 180],  gmt: [8, 12]   },
};

const findRangeForRegion = (region) => {
  const key = Object.keys(CONTINENT_RANGES).find(
    c => c.toLowerCase() === region.trim().toLowerCase()
  );
  return key ? CONTINENT_RANGES[key] : null;
};

export default function RegisterLot({ simulation }) {
  const running = simulation?.running ?? false;
  const mode    = simulation?.mode ?? "diadia";
  const prep    = simulation?.prepStatus ?? { airports: 0, flights: 0, lots: 0, ready: false };

  // Día a Día = pizarra en blanco: se cargan datos ANTES de iniciar (staging) y
  // también en caliente mientras corre. La ingesta no aplica a periodo/colapso
  // en curso (esos usan el dataset).
  const canIngest  = true;
  const canAirport = canIngest;                                   // aeropuertos: base
  const canFlight  = canIngest && prep.airports > 0;              // vuelos: requieren aeropuertos
  const canAdd     = canIngest && prep.airports > 0 && prep.flights > 0; // paquetes: requieren ambos

  // Aeropuertos para los selectores: datos en vivo si hay, si no los del dataset
  const airports = (simulation?.airports?.length
    ? simulation.airports
    : STATIC_AIRPORTS
  ).slice().sort((a, b) => a.code.localeCompare(b.code));

  const [form, setForm] = useState({
    origin: "", destination: "", client: "", quantity: 150,
  });
  const [report,     setReport]     = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [adding,     setAdding]     = useState(false);
  const [status,     setStatus]     = useState(null); // "added" | "error" | null


const [editAirportCode, setEditAirportCode] = useState("");
const [editAirportCap,  setEditAirportCap]  = useState("");
const [editFlightId,    setEditFlightId]    = useState("");
const [editFlightCap,   setEditFlightCap]   = useState("");
const [editFlightDep,   setEditFlightDep]   = useState("");
const [editFlightArr,   setEditFlightArr]   = useState("");

const [flightSearch, setFlightSearch]   = useState("");
const [flightSortBy, setFlightSortBy]   = useState("salida"); // "salida" | "alfabetico"
const [flightListSnapshot, setFlightListSnapshot] = useState([]);

const [editMsg, setEditMsg] = useState(null);
const flashEdit = (text) => { setEditMsg(text); setTimeout(() => setEditMsg(null), 4000); };

// Lista de vuelos editables: combina planificados (upcomingFlights) y en
// el aire (routes), que SÍ incluyen altas en caliente (IDs U1, U2…).
// simulation.flights es el dataset estático y NO refleja vuelos agregados.
// Construye la lista completa de vuelos editables con hora de salida (minuto
// absoluto y reloj) para poder ordenar y mostrar. Combina planificados
// (upcomingFlights) y en el aire (routes) — sí reflejan altas en caliente
// (IDs U1, U2…) — y de respaldo el dataset estático (simulation.flights).
const buildEditableFlights = () => {
  const map = new Map();
  for (const u of (simulation?.upcomingFlights ?? [])) {
    map.set(u.flightId, {
      id: u.flightId, origin: u.origin, destination: u.destination,
      departureMinute: u.departureMinute ?? 0,
      departureClock: (u.departureClock || "").split("  ")[1] || u.departureClock || "",
    });
  }
  for (const r of (simulation?.routes ?? [])) {
    if (!map.has(r.flightId)) {
      map.set(r.flightId, {
        id: r.flightId, origin: r.from, destination: r.to,
        departureMinute: r.departureMinute ?? 0,
        departureClock: "(en vuelo)",
      });
    }
  }
  for (const f of (simulation?.flights ?? [])) {
    if (!map.has(f.id)) {
      map.set(f.id, {
        id: f.id, origin: f.origin, destination: f.destination,
        departureMinute: 0, departureClock: f.departureClock || "",
      });
    }
  }
  return [...map.values()];
};

const hasData = (simulation?.upcomingFlights?.length ?? 0) > 0
             || (simulation?.routes?.length ?? 0) > 0
             || (simulation?.flights?.length ?? 0) > 0;

useEffect(() => {
  if (hasData && flightListSnapshot.length === 0) {
    setFlightListSnapshot(buildEditableFlights());
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [hasData]);

const refreshFlightList = () => setFlightListSnapshot(buildEditableFlights());

// Filtro + orden sobre el snapshot (no sobre datos en vivo)
const editableFlights = (() => {
  const q = flightSearch.trim().toLowerCase();
  let list = !q ? flightListSnapshot : flightListSnapshot.filter(f =>
    f.id.toLowerCase().includes(q) ||
    f.origin.toLowerCase().includes(q) ||
    f.destination.toLowerCase().includes(q) ||
    airportName(f.origin).toLowerCase().includes(q) ||
    airportName(f.destination).toLowerCase().includes(q));

  list = [...list];
  if (flightSortBy === "salida") {
    list.sort((a, b) => (a.departureMinute ?? 0) - (b.departureMinute ?? 0));
  } else {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }
  return list;
})();


  // Edición de la red: vuelos / aeropuertos / carga de archivos
  const [flightForm, setFlightForm] = useState({
    origin: "", destination: "", departureLocal: "08:00", arrivalLocal: "09:00", capacity: 300,
  });
  const [airportForm, setAirportForm] = useState({
    code: "", region: "Europa", lat: 0, lng: 0, gmtHours: 0, capacity: 400,
  });

  const [dropType,  setDropType]  = useState("planes");
  const [netMsg,    setNetMsg]    = useState(null);

  const handle = e => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
    setReport(null);
    setStatus(null);
  };

  const hf = e => setFlightForm(f => ({ ...f, [e.target.name]: e.target.value }));
  const ha = e => setAirportForm(f => ({ ...f, [e.target.name]: e.target.value }));

  const flash = (text) => { setNetMsg(text); setTimeout(() => setNetMsg(null), 4000); };

  const submitFlight = async () => {
    const ok = await simulation?.addFlight(
      flightForm.origin, flightForm.destination,
      flightForm.departureLocal, flightForm.arrivalLocal, Number(flightForm.capacity) || 0);
    flash(ok ? "✓ Vuelo agregado" : "✕ No se pudo agregar el vuelo (¿simulación en curso?)");
  };
  const submitAirport = async () => {
    const ok = await simulation?.addAirport(
      airportForm.code, airportForm.region,
      Number(airportForm.lat) || 0, Number(airportForm.lng) || 0,
      Number(airportForm.gmtHours) || 0, Number(airportForm.capacity) || 0);
    flash(ok ? "✓ Aeropuerto agregado" : "✕ No se pudo agregar el aeropuerto");
  };


  // Drag-drop de archivo txt (el usuario elige el tipo). Aeropuertos en UTF-16
  // (formato del dataset), vuelos y lotes en UTF-8.
  const onDropFile = async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    const enc = dropType === "airports" ? "UTF-16" : "UTF-8";
    const content = await file.text().catch(async () => {
      // file.text() asume UTF-8; para UTF-16 leemos con FileReader
      return await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsText(file, enc);
      });
    });
    let body = content;
    if (dropType === "airports") {
      body = await new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsText(file, "UTF-16");
      });
    }
    // Para lotes, el origen va en el nombre _envios_XXXX_
    const m = /_envios_([A-Za-z0-9]+)_/.exec(file.name);
    const origin = m ? m[1].toUpperCase() : "";
    const ok = await simulation?.uploadData(dropType, body, origin);
    flash(ok ? `✓ Archivo de ${dropType} cargado` : "✕ No se pudo cargar el archivo");
  };

  const payload = () => ({
    origin: form.origin,
    destination: form.destination,
    quantity: Number(form.quantity) || 0,
  });

  const evaluate = async () => {
    if (!form.origin || !form.destination) return;
    setEvaluating(true); setStatus(null);
    try {
      const r = await fetch(`${API_BASE}/api/simulation/evaluateLot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload()),
      });
      setReport(r.ok ? await r.json() : null);
    } catch {
      setReport(null);
    } finally {
      setEvaluating(false);
    }
  };

  const addLot = async () => {
    setAdding(true);
    try {
      // Pasa por el hook para que quede registrada la alerta en Monitoreo.
      const ok = simulation?.addLot
        ? await simulation.addLot(form.origin, form.destination,
                                  Number(form.quantity) || 0, form.client)
        : false;
      setStatus(ok ? "added" : "error");
    } catch {
      setStatus("error");
    } finally {
      setAdding(false);
    }
  };

const formValid = form.origin && form.destination
  && form.origin !== form.destination && Number(form.quantity) > 0;

const rangeHint = findRangeForRegion(airportForm.region);

const airportFormValid = airportForm.code.trim() !== ""
  && airportForm.region.trim() !== ""
  && airportForm.lat !== "" && !isNaN(Number(airportForm.lat))
  && Number(airportForm.lat) >= -90 && Number(airportForm.lat) <= 90
  && airportForm.lng !== "" && !isNaN(Number(airportForm.lng))
  && Number(airportForm.lng) >= -180 && Number(airportForm.lng) <= 180
  && airportForm.gmtHours !== "" && !isNaN(Number(airportForm.gmtHours))
  && Number(airportForm.gmtHours) >= -12 && Number(airportForm.gmtHours) <= 14
  && Number(airportForm.capacity) > 0;

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <h2 className="text-teal font-bold text-lg mb-1">REGISTRO DE ENVÍOS</h2>
      <p className="text-gray-500 text-xs mb-3">
        Día a Día parte de una <b className="text-gray-300">pizarra en blanco</b>: carga primero
        <b className="text-gray-300"> aeropuertos</b>, luego <b className="text-gray-300">vuelos</b> y
        al menos un <b className="text-gray-300">paquete</b>. El botón <b>INICIAR</b> se habilita
        cuando hay los tres. Puedes seguir cargando con la simulación en curso.
      </p>

      {/* Estado de preparación (compartido por todas las instancias) */}
      <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
        {[
          ["Aeropuertos", prep.airports],
          ["Vuelos",      prep.flights],
          ["Paquetes",    prep.lots],
        ].map(([label, n]) => (
          <span key={label}
            className={`px-2 py-1 rounded border ${n > 0
              ? "border-green-600/50 bg-green-900/15 text-green-300"
              : "border-red-700/50 bg-red-900/15 text-red-300"}`}>
            {label}: <b>{n}</b>
          </span>
        ))}
        <span className={prep.ready ? "text-green-400" : "text-yellow-400"}>
          {prep.ready ? "✓ Listo para iniciar" : "Faltan datos para iniciar"}
        </span>
        {(prep.airports || prep.flights || prep.lots) ? (
          <button onClick={() => simulation?.resetPrep?.()}
            disabled={running}
            title={running ? "No se puede vaciar con la simulación en curso" : "Vaciar preparación"}
            className="ml-auto px-2 py-1 rounded bg-[#021020] border border-white/10 text-gray-400
                       hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed">
            Vaciar preparación
          </button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Formulario ──────────────────────────────────────────────────── */}
        <div className="bg-[#031525] border border-teal/20 rounded p-4">
          <p className="text-teal text-xs font-bold uppercase mb-3">Agregar Envío</p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            {[
              ["origin",      "Aeropuerto Origen"],
              ["destination", "Aeropuerto Destino"],
            ].map(([name, label]) => (
              <div key={name}>
                <label className="text-gray-500 text-[10px] uppercase block mb-1">{label}</label>
                <select name={name} value={form[name]} onChange={handle}
                  className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1.5
                             text-xs text-gray-300 focus:outline-none focus:border-teal">
                  <option value="">Seleccionar</option>
                  {airports.map(a => (
                    <option key={a.code} value={a.code}>
                      {a.code} — {airportName(a.code)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="mb-3">
            <label className="text-gray-500 text-[10px] uppercase block mb-1">
              Nombre / Identificador de Cliente
            </label>
            <input name="client" value={form.client} onChange={handle}
              placeholder="Logística Global S.A."
              className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1.5
                         text-xs text-gray-300 focus:outline-none focus:border-teal"/>
          </div>

          <div className="mb-4 w-1/2">
            <label className="text-gray-500 text-[10px] uppercase block mb-1">
              Cantidad de Maletas
            </label>
            <input name="quantity" type="number" min="1" value={form.quantity} onChange={handle}
              className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1.5
                         text-xs text-gray-300 focus:outline-none focus:border-teal"/>
          </div>

          <div className="flex gap-2">
            <button
              onClick={evaluate}
              disabled={!formValid || evaluating}
              className="flex-1 bg-[#021020] border border-teal/40 hover:border-teal text-teal
                         text-sm py-2 rounded font-medium tracking-wide transition
                         disabled:opacity-40 disabled:cursor-not-allowed">
              {evaluating ? "Evaluando…" : "Evaluar Viabilidad"}
            </button>
            <button
              onClick={addLot}
              disabled={!canAdd || !report?.feasible || adding}
              title={!canAdd ? "Carga primero aeropuertos y vuelos"
                             : !report?.feasible ? "Evalúa una ruta viable primero" : ""}
              className="flex-1 bg-teal hover:bg-teal/80 text-white text-sm py-2 rounded
                         font-medium tracking-wide transition
                         disabled:opacity-40 disabled:cursor-not-allowed">
              {adding ? "Agregando…" : "Agregar Lote »"}
            </button>
          </div>

          {status === "added" && (
            <p className="text-green-400 text-xs mt-3">
              ● Paquete registrado{running ? " (entra en la simulación en curso)" : " (en preparación)"}.
              Se registró con la hora del sistema convertida a la hora local del origen.
            </p>
          )}
          {status === "error" && (
            <p className="text-red-400 text-xs mt-3">
              No se pudo registrar. Verifica que haya aeropuertos y vuelos cargados.
            </p>
          )}
        </div>

        {/* ── Panel de validación ─────────────────────────────────────────── */}
        <div className="bg-[#031525] border border-teal/20 rounded p-4">
          <p className="text-teal text-xs font-bold uppercase mb-3">Panel de Validación</p>

          {!report ? (
            <p className="text-gray-600 text-xs py-6 text-center">
              Completa origen, destino y cantidad y pulsa «Evaluar Viabilidad».
            </p>
          ) : (
            <>
              {/* Veredicto */}
              <div className={`flex gap-2 mb-3 rounded p-2 ${
                report.feasible ? "bg-green-900/20" : "bg-red-900/20"}`}>
                <span className={`font-bold text-sm ${
                  report.feasible ? "text-green-400" : "text-red-400"}`}>
                  {report.feasible ? "✓" : "✕"}
                </span>
                <div>
                  <p className="text-gray-200 text-xs font-medium">
                    {report.feasible ? "Lote viable" : "Lote no viable"}
                  </p>
                  <p className="text-gray-500 text-[10px] mt-0.5">{report.reason}</p>
                </div>
              </div>

              {/* Detalles */}
              {[
                ["Plazo de entrega (SLA)",
                  `${report.sameContinent ? "Mismo continente" : "Distinto continente"} · ${report.slaHours} h`],
                report.feasible && ["Tiempo estimado de ruta",
                  `${report.etaHours.toFixed(1)} h (~${(report.etaHours / 24).toFixed(2)} días)`],
                report.feasible && ["Transbordos",
                  report.transfers === 0 ? "Directo" : `${report.transfers}`],
              ].filter(Boolean).map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs mb-1.5">
                  <span className="text-gray-500">{k}</span>
                  <span className="text-gray-300 font-medium">{v}</span>
                </div>
              ))}

              {/* Almacenes */}
              <div className="grid grid-cols-2 gap-2 mt-3">
                {[
                  ["Almacén Origen", report.originStoragePct],
                  ["Almacén Destino", report.destStoragePct],
                ].map(([label, pct]) => {
                  const color = pct > 85 ? "text-red-400" : pct > 60 ? "text-yellow-400" : "text-green-400";
                  const bar   = pct > 85 ? "bg-red-500"  : pct > 60 ? "bg-yellow-500"  : "bg-green-500";
                  return (
                    <div key={label}>
                      <p className="text-gray-500 text-[10px]">{label}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`font-bold text-xs ${color}`}>{pct}%</span>
                        <div className="flex-1 bg-white/10 rounded-full h-1">
                          <div className={`${bar} h-1 rounded-full`}
                               style={{ width: `${Math.min(100, pct)}%` }}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Ruta planeada */}
              {report.feasible && report.path?.length > 0 && (
                <>
                  <p className="text-teal text-[10px] font-bold uppercase mt-4 mb-2">
                    Ruta Planeada
                  </p>
                  <div className="flex flex-wrap items-center gap-1 text-xs">
                    {report.path.map((code, i) => (
                      <span key={`${code}-${i}`} className="flex items-center gap-1">
                        <span className="px-2 py-0.5 rounded bg-teal/15 text-teal font-mono">
                          {code}
                        </span>
                        {i < report.path.length - 1 && (
                          <span className="text-gray-600">→</span>
                        )}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Edición de la red (vuelos / aeropuertos / carga de archivos) ───── */}
      <h2 className="text-teal font-bold text-lg mt-6 mb-1">REGISTRO DE ALMACENES Y VUELOS</h2>
      <p className="text-gray-500 text-xs mb-3">
        Agrega vuelos y aeropuertos, cierra aeropuertos o carga archivos txt
        (mismo formato del dataset) sobre la simulación en curso.
        {netMsg && <span className="text-teal ml-2">{netMsg}</span>}
      </p>

      

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">





{/* Almacenes: agregar / cerrar */}
<div className="bg-[#031525] border border-teal/20 rounded p-3">
  <p className="text-teal text-xs font-bold uppercase mb-2">Agregar Almacén</p>
  <div className="grid grid-cols-2 gap-2 mb-1">
    <label className="text-gray-500 text-[10px]">
      Código ICAO
      <input name="code" value={airportForm.code} onChange={ha} placeholder="Ej: LIMM"
        title="Código ICAO/IATA único del aeropuerto"
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300 uppercase mt-0.5"/>
    </label>
    <label className="text-gray-500 text-[10px]">
      Región / Continente
      <input name="region" value={airportForm.region} onChange={ha} placeholder="Ej: Europa"
        list="continent-options"
        title="Continente del aeropuerto (usado para reglas de SLA)"
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300 mt-0.5"/>
      <datalist id="continent-options">
        {Object.keys(CONTINENT_RANGES).map(c => <option key={c} value={c} />)}
      </datalist>
    </label>
    <label className="text-gray-500 text-[10px]">
      Latitud
      <input name="lat" type="number" step="0.0001" value={airportForm.lat} onChange={ha}
        placeholder={rangeHint ? `${rangeHint.lat[0]} a ${rangeHint.lat[1]}` : "-90 a 90"}
        title="Latitud en grados decimales (-90 a 90)"
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300 mt-0.5"/>
    </label>
    <label className="text-gray-500 text-[10px]">
      Longitud
      <input name="lng" type="number" step="0.0001" value={airportForm.lng} onChange={ha}
        placeholder={rangeHint ? `${rangeHint.lng[0]} a ${rangeHint.lng[1]}` : "-180 a 180"}
        title="Longitud en grados decimales (-180 a 180)"
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300 mt-0.5"/>
    </label>
    <label className="text-gray-500 text-[10px]">
      GMT (h)
      <input name="gmtHours" type="number" step="0.5" value={airportForm.gmtHours} onChange={ha}
        placeholder={rangeHint ? `${rangeHint.gmt[0]} a ${rangeHint.gmt[1]}` : "-12 a 14"}
        title="Desplazamiento horario respecto a GMT, ej: -5 para Lima"
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300 mt-0.5"/>
    </label>
    <label className="text-gray-500 text-[10px]">
      Capacidad
      <input name="capacity" type="number" min="1" value={airportForm.capacity} onChange={ha}
        placeholder="Ej: 400"
        title="Capacidad máxima de almacenamiento del aeropuerto"
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300 mt-0.5"/>
    </label>
  </div>

  {rangeHint && (
    <p className="text-gray-600 text-[10px] mb-2">
      Rango sugerido para <span className="text-teal">{airportForm.region}</span>:
      lat [{rangeHint.lat[0]}, {rangeHint.lat[1]}] · lng [{rangeHint.lng[0]}, {rangeHint.lng[1]}] · GMT [{rangeHint.gmt[0]}, {rangeHint.gmt[1]}]
    </p>
  )}

  <button onClick={submitAirport} disabled={!canAirport || !airportFormValid}
    title={!canAirport ? "No disponible en este momento" : !airportFormValid ? "Revisa los campos: hay valores fuera de rango o vacíos" : ""}
    className="w-full bg-teal hover:bg-teal/80 text-white text-xs py-1.5 rounded transition mb-2
               disabled:opacity-40 disabled:cursor-not-allowed">
    Agregar Aeropuerto
  </button>
</div>





        {/* Agregar vuelo */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-2">Agregar Vuelo</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {[["origin", "Origen"], ["destination", "Destino"]].map(([n, l]) => (
              <select key={n} name={n} value={flightForm[n]} onChange={hf}
                className="bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300">
                <option value="">{l}</option>
                {airports.map(a => <option key={a.code} value={a.code}>{a.code} — {airportName(a.code)}</option>)}
              </select>
            ))}
            <label className="text-gray-500 text-[10px]">Salida (local)
              <input name="departureLocal" type="time" value={flightForm.departureLocal} onChange={hf}
                className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300"/>
            </label>
            <label className="text-gray-500 text-[10px]">Llegada (local)
              <input name="arrivalLocal" type="time" value={flightForm.arrivalLocal} onChange={hf}
                className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300"/>
            </label>
            <label className="text-gray-500 text-[10px] col-span-2">Capacidad
              <input name="capacity" type="number" min="1" value={flightForm.capacity} onChange={hf}
                className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300"/>
            </label>
          </div>
          <button onClick={submitFlight} disabled={!canFlight}
            title={!canFlight ? "Carga aeropuertos primero" : ""}
            className="w-full bg-teal hover:bg-teal/80 text-white text-xs py-1.5 rounded transition
                       disabled:opacity-40 disabled:cursor-not-allowed">
            Agregar Vuelo
          </button>
        </div>



        {/* Carga de archivo (drag & drop) */}
        <div className="bg-[#031525] border border-teal/20 rounded p-3">
          <p className="text-teal text-xs font-bold uppercase mb-2">Cargar Masiva por Archivo (txt)</p>
          <div className="flex gap-1 mb-2">
            {[["planes", "Vuelos"], ["airports", "Aeropuertos"], ["lots", "Lotes"]].map(([k, l]) => (
              <button key={k} onClick={() => setDropType(k)}
                className={`flex-1 text-[10px] px-2 py-1 rounded transition
                  ${dropType === k ? "bg-teal text-white" : "bg-[#021020] text-gray-400 border border-white/10"}`}>
                {l}
              </button>
            ))}
          </div>
          <div
            onDragOver={e => e.preventDefault()}
            onDrop={onDropFile}
            className="border-2 border-dashed border-teal/30 rounded p-6 text-center
                       text-gray-500 text-xs hover:border-teal/60 transition">
            Arrastra aquí un archivo de <span className="text-teal">{
              dropType === "planes" ? "vuelos" : dropType === "airports" ? "aeropuertos" : "lotes"
            }</span><br/>
            (mismo formato del dataset)
          </div>
          <p className="text-gray-600 text-[10px] mt-2">
            Lotes: el origen se toma del nombre del archivo (_envios_XXXX_).
            {!canIngest && <span className="text-yellow-400"> Disponible en Día a Día (preparación o en curso).</span>}
          </p>
        </div>
      </div>



<h2 className="text-teal font-bold text-lg mt-6 mb-1">EDITAR ALMACENES Y VUELOS</h2>
<p className="text-gray-500 text-xs mb-3">
  Modifica atributos de almacenes y vuelos ya existentes en la simulación actual
  (no afecta los archivos del dataset).
  {editMsg && <span className="text-teal ml-2">{editMsg}</span>}
</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

<div className="bg-[#031525] border border-teal/20 rounded p-3">
  <p className="text-teal text-xs font-bold uppercase mb-2">Editar / Eliminar Almacén</p>
  <select value={editAirportCode} onChange={e => setEditAirportCode(e.target.value)}
    className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1.5 text-xs text-gray-300 mb-2">
    <option value="">Seleccionar aeropuerto…</option>
    {airports.map(a => {
      const country = AIRPORT_META[a.code]?.country;
      return (
        <option key={a.code} value={a.code}>
          {a.code} — {airportName(a.code)}{country ? ` (${country})` : ""}
        </option>
      );
    })}
  </select>
  <label className="text-gray-500 text-[10px]">Nueva capacidad
    <input type="number" min="1" value={editAirportCap}
      onChange={e => setEditAirportCap(e.target.value)}
      className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300"/>
  </label>
  <div className="flex gap-2 mt-2">
    <button onClick={async () => {
        const ok = await simulation?.editAirport?.(editAirportCode, Number(editAirportCap) || 0);
        flashEdit(ok ? "✓ Almacén actualizado" : "✕ No se pudo actualizar");
      }}
      disabled={!editAirportCode || !editAirportCap}
      className="flex-1 bg-teal hover:bg-teal/80 text-white text-xs py-1.5 rounded transition
                 disabled:opacity-40 disabled:cursor-not-allowed">
      Guardar Cambios
    </button>
    <button onClick={async () => {
        if (!editAirportCode) return;
        if (!window.confirm(`¿Eliminar el almacén ${editAirportCode}? Esta acción no se puede deshacer.`)) return;
        const ok = await simulation?.deleteAirport?.(editAirportCode);
        flashEdit(ok ? "✓ Almacén eliminado" : "✕ No se pudo eliminar");
        if (ok) setEditAirportCode("");
      }}
      disabled={!editAirportCode}
      className="bg-red-800/60 hover:bg-red-700 text-red-200 text-xs px-3 py-1.5 rounded transition
                 disabled:opacity-40 disabled:cursor-not-allowed">
      Eliminar
    </button>
  </div>
</div>

                <div className="bg-[#031525] border border-teal/20 rounded p-3">
  <div className="flex items-center justify-between mb-2">
    <p className="text-teal text-xs font-bold uppercase">Editar / Eliminar Vuelo</p>
    <button onClick={refreshFlightList}
      title="Actualizar lista de vuelos"
      className="text-[10px] px-2 py-0.5 rounded bg-[#021020] border border-white/10
                 text-gray-400 hover:text-teal transition">
      ↻ Actualizar
    </button>
  </div>

  {/* Buscador */}
  <input
    value={flightSearch}
    onChange={e => setFlightSearch(e.target.value)}
    placeholder="Buscar por ID, origen o destino…"
    className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1.5
               text-xs text-gray-300 mb-2 focus:outline-none focus:border-teal"
  />

  {/* Orden */}
  <div className="flex gap-1 mb-2">
    {[["salida", "Hora de salida"], ["alfabetico", "A-Z"]].map(([k, l]) => (
      <button key={k} onClick={() => setFlightSortBy(k)}
        className={`text-[10px] px-2 py-0.5 rounded transition border
          ${flightSortBy === k
            ? "bg-teal/20 text-teal border-teal/40"
            : "bg-[#021020] text-gray-500 border-white/10 hover:text-white"}`}>
        {l}
      </button>
    ))}
  </div>

  {/* Lista estática con scroll — no se reordena sola mientras corre la simulación */}
  <div className="max-h-40 overflow-y-auto border border-white/10 rounded mb-2">
    {editableFlights.length === 0 ? (
      <p className="text-gray-600 text-[10px] text-center py-3">Sin resultados</p>
    ) : (
      editableFlights.map(f => (
        <button key={f.id} type="button"
          onClick={() => setEditFlightId(f.id)}
          className={`w-full text-left px-2 py-1 text-[10px] border-b border-white/5
            flex items-center justify-between transition
            ${editFlightId === f.id ? "bg-teal/15 text-teal" : "text-gray-300 hover:bg-white/5"}`}>
          <span className="truncate">
            <span className="font-mono font-bold">{f.id}</span>
            {" · "}{airportName(f.origin)}→{airportName(f.destination)}
          </span>
          <span className="text-gray-500 font-mono ml-2 shrink-0">{f.departureClock}</span>
        </button>
      ))
    )}
  </div>

  {editFlightId && (
    <p className="text-gray-500 text-[10px] mb-2">
      Seleccionado: <span className="text-teal font-mono">{editFlightId}</span>
    </p>
  )}

  <div className="grid grid-cols-3 gap-2 mb-2">
    <label className="text-gray-500 text-[10px]">Capacidad
      <input type="number" min="1" value={editFlightCap}
        onChange={e => setEditFlightCap(e.target.value)}
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300"/>
    </label>
    <label className="text-gray-500 text-[10px]">Salida
      <input type="time" value={editFlightDep}
        onChange={e => setEditFlightDep(e.target.value)}
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300"/>
    </label>
    <label className="text-gray-500 text-[10px]">Llegada
      <input type="time" value={editFlightArr}
        onChange={e => setEditFlightArr(e.target.value)}
        className="w-full bg-[#021020] border border-white/10 rounded px-2 py-1 text-xs text-gray-300"/>
    </label>
  </div>

  <div className="flex gap-2">
    <button onClick={async () => {
        const ok = await simulation?.editFlight?.(editFlightId, {
          capacity: editFlightCap ? Number(editFlightCap) : undefined,
          departureLocal: editFlightDep || undefined,
          arrivalLocal: editFlightArr || undefined,
        });
        flashEdit(ok ? "✓ Vuelo actualizado" : "✕ No se pudo actualizar");
      }}
      disabled={!editFlightId}
      className="flex-1 bg-teal hover:bg-teal/80 text-white text-xs py-1.5 rounded transition
                 disabled:opacity-40 disabled:cursor-not-allowed">
      Guardar Cambios
    </button>
    <button onClick={async () => {
        if (!editFlightId) return;
        if (!window.confirm(`¿Eliminar el vuelo ${editFlightId}? Esta acción no se puede deshacer.`)) return;
        const ok = await simulation?.deleteFlight?.(editFlightId);
        flashEdit(ok ? "✓ Vuelo eliminado" : "✕ No se pudo eliminar");
        if (ok) { setEditFlightId(""); refreshFlightList(); }
      }}
      disabled={!editFlightId}
      className="bg-red-800/60 hover:bg-red-700 text-red-200 text-xs px-3 py-1.5 rounded transition
                 disabled:opacity-40 disabled:cursor-not-allowed">
      Eliminar
    </button>
  </div>
</div>
              </div>


    </div>
  );
}
