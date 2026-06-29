import { useState, useEffect, useMemo, useRef } from "react";
import SLAMonitor        from "../components/panels/SLAMonitor";
import WarehouseCapacity from "../components/panels/WarehouseCapacity";
import FlightsCapacity   from "../components/panels/FlightsCapacity";
import StorageMovements  from "../components/panels/StorageMovements";
import StorageFilterBar  from "../components/panels/StorageFilterBar";
import WorldMap          from "../components/map/WorldMap";
import CollapseAlert     from "../components/modals/CollapseAlert";
import FlightCancelPanel from "../components/panels/FlightCancelPanel";
import FloatingPanel     from "../components/panels/FloatingPanel";
import DateTimePicker    from "../components/panels/DateTimePicker";


// Pestañas del panel de Información (también las que pueden flotar).
const INFO_TABS = [
  ["almacenes", "Almacenes"], ["vuelos", "Vuelos"],
  ["envios", "Envíos"], ["sla", "SLA"],
];

// Identidad de una ruta (igual que en WorldMap): por flightId, o por
// origen-destino-salida si no lo trae.
const routeKey = r => r.flightId || `${r.from}-${r.to}-${r.departureMinute ?? 0}`;
import { STATIC_AIRPORTS, airportMatches } from "../data/staticAirports";
import { getWarehouseColor } from "../hooks/useStatusColor";

// Categoría de semáforo de un almacén (igual que WarehouseCapacity).
function whSemOf(a) {
  const cur = a.current || 0;
  if (cur === 0) return "empty";
  return getWarehouseColor(Math.round(cur / Math.max(1, a.capacity) * 100));
}

// Color de semáforo de un vuelo por su carga (idéntico al del mapa): gris si va
// vacío, si no verde/ámbar/rojo. Sirve para pintar cada tramo de un envío con el
// MISMO color que su vuelo tiene en el mapa.
function flightTrafficColor(bags, capacity) {
  if ((bags || 0) === 0) return "#9ca3af";
  const pct = capacity > 0 ? bags / capacity : 0;
  return pct > 0.85 ? "#ef4444" : pct > 0.6 ? "#f59e0b" : "#22c55e";
}

const MODE_CONFIG = {
  diadia:  { selector: "Día a simular",  suffix: "(1 día — tiempo real)" },
  periodo: { selector: "Día de inicio",  suffix: "(5 días)"              },
  colapso: { selector: "Día de inicio",  suffix: "(hasta colapso)"       },
};

// Formatea segundos totales → "Xd Hh Mm Ss" o "Hh Mm Ss"
function formatRealTime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,"0")}h ${String(m).padStart(2,"0")}m`;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

// Formatea minutos simulados → "Xd HH:MM" o "HH:MM"
function formatSimTime(totalMinutes) {
  if (!totalMinutes || totalMinutes <= 0) return "00:00";
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  if (d > 0) return `${d}d ${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
  return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
}

export default function Dashboard({
  mode, simulation, onStop,
  availableDates = [], selectedDate = "", onDateChange,
  selectedStartMinute = 0, onStartMinuteChange,
  cancelFlight,
  realSeconds = 0, // ← nuevo, viene del hook vía App
}) {
  // La fecha/hora de inicio (modos periodo/colapso) la gestiona el calendario
  // DateTimePicker vía onDateChange / onStartMinuteChange.
  const [showCollapse, setShowCollapse] = useState(false);
  // Filtro del panel de almacenes (texto: código/país/región)
  const [storageFilter, setStorageFilter] = useState("");
  // Filtro por semáforo de ocupación de almacenes (all/green/amber/red/empty).
  // Vive aquí (no en la tarjeta) para que también resalte en el mapa.
  const [whSemFilter, setWhSemFilter] = useState("all");
  // Filtro por semáforo de CARGA de vuelos (all/green/amber/red/empty). Vive
  // aquí para filtrar también los aviones mostrados en el mapa.
  const [flightSemFilter, setFlightSemFilter] = useState("all");
  // Aeropuerto enfocado por clic (mapa o tarjeta de almacenes)
  const [selectedAirport, setSelectedAirport] = useState(null);
  // Ruta (vuelo) resaltada por clic en el panel de Vuelos o en el mapa.
  const [selectedRouteKey, setSelectedRouteKey] = useState(null);
  // Foco manual de aeropuertos (vuelo planificado o envío): cuando se fija,
  // tiene prioridad sobre filtros de texto/semáforo.
  const [pinnedCodes, setPinnedCodes] = useState(null);
  // Envío (maleta) seleccionado: identidad para resaltar la fila.
  const [selectedShipment, setSelectedShipment] = useState(null);
  // Recorrido completo del envío seleccionado (todos los tramos, con color y
  // estado) a dibujar en el mapa.
  const [selectedShipmentPath, setSelectedShipmentPath] = useState(null);
  // Búsqueda del panel de Envíos (maletas/paquetes): se eleva aquí para
  // reflejarla también en el mapa y en los paneles de Vuelos y Almacenes.
  const [bagSearch, setBagSearch] = useState("");
  // Paneles laterales colapsables — al inicio ambos cerrados para ver el mapa
  const [leftOpen,  setLeftOpen]  = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  // Barra de configuración (fecha/hora) — cerrada al inicio
  const [configOpen, setConfigOpen] = useState(false);
  // Panel de información derecho: pestaña activa + sub-vista de almacenes
  const [infoTab, setInfoTab] = useState("almacenes"); // almacenes/vuelos/envios/sla
  const [whSub,   setWhSub]   = useState("capacidad");  // capacidad/movimientos

  // ── Ventanas flotantes (una por pestaña de Información) ───────────────────
  // floatWins[key] = { x, y, w, h, mode:"normal"|"min"|"max", restore? }.
  // Estado de sesión: se pierde al recargar (no se persiste).
  const [floatWins, setFloatWins] = useState({});
  const [winZ,      setWinZ]      = useState({});   // key -> z-index
  const zCounter        = useRef(30);
  const mapContainerRef = useRef(null);

  const focusWin = (key) => {
    zCounter.current += 1;
    setWinZ(z => ({ ...z, [key]: zCounter.current }));
  };
  const focusRestore = (key) => {           // traer al frente y restaurar si está minimizada
    focusWin(key);
    setFloatWins(w => (w[key]?.mode === "min"
      ? { ...w, [key]: { ...w[key], mode: "normal" } } : w));
  };
  const popOut = (key) => {                  // sacar una pestaña a ventana flotante
    setFloatWins(w => {
      if (w[key]) return w;                  // ya flota
      const n = Object.keys(w).length;
      return { ...w, [key]: { x: 36 + n * 26, y: 44 + n * 26, w: 300, h: 360, mode: "normal" } };
    });
    focusWin(key);
    // Si era la pestaña activa acoplada, mostrar otra que siga acoplada.
    setInfoTab(prev => prev !== key ? prev
      : (INFO_TABS.map(d => d[0]).find(k => k !== key && !floatWins[k]) || prev));
  };
  const dockWin = (key) => {                 // devolver a las pestañas
    setFloatWins(w => { const c = { ...w }; delete c[key]; return c; });
    setInfoTab(key);
  };
  const updateWin   = (key, p) => setFloatWins(w => w[key] ? { ...w, [key]: { ...w[key], ...p } } : w);
  const minimizeWin = (key) => setFloatWins(w => {
    const win = w[key]; if (!win) return w;
    return { ...w, [key]: { ...win, mode: win.mode === "min" ? "normal" : "min" } };
  });
  const maximizeWin = (key) => setFloatWins(w => {
    const win = w[key]; if (!win) return w;
    if (win.mode === "max") return { ...w, [key]: { ...win, ...win.restore, mode: "normal" } };
    // Maximizar SIN mover la ventana: mantenemos su posición actual y solo
    // crecemos el tamaño hasta llenar el espacio restante del mapa. (Cambiar
    // posición y tamaño a la vez de forma externa rompe react-draggable bajo
    // React 19; cambiar solo el tamaño es seguro.)
    const r  = mapContainerRef.current?.getBoundingClientRect();
    const mw = (r ? r.width  : 600) - win.x - 6;
    const mh = (r ? r.height : 400) - win.y - 6;
    return { ...w, [key]: {
      ...win, mode: "max",
      restore: { w: win.w, h: win.h },
      w: Math.max(240, mw), h: Math.max(120, mh),
    } };
  });


  const kpis         = simulation?.kpis ?? {};
  const prep         = simulation?.prepStatus;
  const running      = simulation?.running ?? false;
  const simulatedNow = simulation?.simulatedMinute ?? 0;
  const cfg          = MODE_CONFIG[mode] ?? MODE_CONFIG.diadia;
  // Hora simulada actual (lo que "marca el reloj dentro de la simulación")
  const simClock     = simulation?.clock ?? "--:--";

  // Reloj de pared: hora real actual, avanza cada segundo mientras corre
  const [realNow, setRealNow] = useState(() => new Date());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setRealNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Códigos de aeropuerto que coinciden con el filtro de almacenes — se usan
  // para resaltar tanto en el panel como en el mapa. Usa la misma fuente que
  // el mapa (datos en vivo si existen, si no los estáticos del dataset).
  // Foco de aeropuertos: un clic (un aeropuerto) tiene prioridad; si no hay,
  // se usa el filtro de texto del panel de almacenes (región). Estos códigos
  // resaltan en el mapa Y filtran las tarjetas laterales.
  const liveAirports = simulation?.airports;

  // Aeropuertos implicados por la búsqueda de maletas/paquetes (panel Envíos):
  // los orígenes/destinos de los eventos del historial que coinciden con el
  // término. Sirven para reflejar la búsqueda en el mapa y los demás paneles.
  const bagFocusCodes = useMemo(() => {
    const q = bagSearch.trim().toLowerCase();
    if (!q) return null;
    const codes = new Set();
    for (const e of (simulation?.history ?? [])) {
      const pkg = `pkg-${e.from || ""}${e.to || ""}-${e.minute ?? ""}`.toLowerCase();
      if ((e.lotId || "").toLowerCase().includes(q) ||
          (e.flightId || "").toLowerCase().includes(q) ||
          (e.from || "").toLowerCase().includes(q) ||
          (e.to   || "").toLowerCase().includes(q) ||
          pkg.includes(q)) {
        if (e.from) codes.add(e.from);
        if (e.to)   codes.add(e.to);
      }
    }
    return [...codes];
  }, [bagSearch, simulation?.history]);

  // Aeropuertos en foco (resaltan en el mapa Y filtran las tarjetas). Prioridad:
  // 1) foco fijado (vuelo planificado/envío), 2) clic en un aeropuerto,
  // 3) búsqueda de maletas (panel Envíos), 4) filtro de texto + semáforo.
  const focusCodes = useMemo(() => {
    if (pinnedCodes) return pinnedCodes;
    if (selectedAirport) return [selectedAirport];
    if (bagSearch.trim()) return bagFocusCodes || [];
    if (!storageFilter.trim() && whSemFilter === "all") return [];
    const src = (liveAirports && liveAirports.length) ? liveAirports : STATIC_AIRPORTS;
    return src
      .filter(a => storageFilter.trim() ? airportMatches(a, storageFilter) : true)
      .filter(a => whSemFilter === "all" ? true : whSemOf(a) === whSemFilter)
      .map(a => a.code);
  }, [pinnedCodes, selectedAirport, bagSearch, bagFocusCodes, storageFilter, whSemFilter, liveAirports]);

  // Limpia los focos "de ruta/envío" (los que compiten con un foco de aeropuerto).
  const clearRouteFoci = () => {
    setSelectedRouteKey(null);
    setPinnedCodes(null);
    setSelectedShipment(null);
    setSelectedShipmentPath(null);
    setBagSearch("");
  };

  // Búsqueda de maletas (panel Envíos): descarta el resto de focos para no
  // confundir; el término dirige el foco (mapa + paneles) vía bagFocusCodes.
  const handleBagSearch = (v) => {
    setStorageFilter(""); setWhSemFilter("all"); setSelectedAirport(null);
    setSelectedRouteKey(null); setPinnedCodes(null);
    setSelectedShipment(null); setSelectedShipmentPath(null);
    setBagSearch(v);
  };

  // Filtros de almacén (texto/semáforo) — combinables entre sí; descartan
  // cualquier foco de clic/ruta/envío para no confundir.
  const handleFilterChange = (v) => { setStorageFilter(v); setSelectedAirport(null); clearRouteFoci(); };
  const handleSemChange    = (s) => { setWhSemFilter(s);   setSelectedAirport(null); clearRouteFoci(); };

  const handleAirportClick = (code) => {
    setStorageFilter(""); setWhSemFilter("all"); clearRouteFoci();
    setSelectedAirport(prev => (prev === code ? null : code));
  };

  // Clic en un vuelo del panel: si está en el aire, resalta su ruta en el mapa;
  // si es planificado (aún sin despegar, sin línea dibujada), enfoca sus dos
  // aeropuertos.
  const handleFlightClick = (f) => {
    setStorageFilter(""); setWhSemFilter("all"); setSelectedAirport(null); setBagSearch("");
    setSelectedShipment(null); setSelectedShipmentPath(null);
    if (f.active) {
      // Vuelo en el aire: resaltar su ruta Y enfocar origen/destino (los paneles
      // se centran en este vuelo: almacén = origen+destino, vuelos = solo este,
      // envíos = solo sus maletas).
      const off = selectedRouteKey === f.key;
      setSelectedRouteKey(off ? null : f.key);
      setPinnedCodes(off ? null : [f.from, f.to]);
    } else {
      setSelectedRouteKey(null);
      setPinnedCodes(prev =>
        (prev && prev[0] === f.from && prev[1] === f.to) ? null : [f.from, f.to]);
    }
  };

  // Color de cada tramo según su vuelo (mismo semáforo que el mapa): tramos ya
  // completados van en gris; los activos/futuros toman el color de carga de su
  // vuelo (rutas activas o planificadas).
  const legColor = (leg) => {
    if (leg.status === "done") return "#6b7280";
    const routes   = simulation?.routes ?? [];
    const upcoming = simulation?.upcomingFlights ?? [];
    const r = routes.find(x => x.flightId === leg.flightId && x.status === "departed");
    if (r) return flightTrafficColor(r.bags, r.capacity);
    const u = upcoming.find(x => x.flightId === leg.flightId);
    if (u) return flightTrafficColor(u.assigned, u.capacity);
    return "#6b7280";
  };

  // Clic en un envío/maleta: pide al backend TODOS sus tramos y los dibuja en el
  // mapa (cada uno con el color de su vuelo) distinguiendo completado/actual/
  // próximo. Enfoca todos los aeropuertos del recorrido.
  const handleShipmentClick = async (bag) => {
    if (!bag?.from || !bag?.to) return;
    const pkgId = bag.pkgId || bag.lotId;
    if (selectedShipment && selectedShipment.bagId === pkgId) {
      setSelectedShipment(null); setSelectedShipmentPath(null); setPinnedCodes(null);
      return;
    }
    setStorageFilter(""); setWhSemFilter("all"); setSelectedAirport(null); setBagSearch("");
    setSelectedRouteKey(null);
    setSelectedShipment({
      from: bag.from, to: bag.to, minute: bag.minute, bagId: pkgId,
    });

    let legs = [];
    if (bag.lotId) {
      const path = await simulation?.fetchShipmentPath?.(bag.lotId);
      legs = path?.legs ?? [];
    }
    if (!legs.length) {
      // Respaldo (sin lotId o lote ya fuera de caché): solo el tramo clicado.
      legs = [{
        flightId: bag.flightId, from: bag.from, to: bag.to,
        finalDestination: !!bag.finalDestination, status: "current",
      }];
    }
    const colored = legs.map(l => ({ ...l, color: legColor(l) }));
    setSelectedShipmentPath(colored);
    setPinnedCodes(Array.from(new Set(colored.flatMap(l => [l.from, l.to]))));
  };

  // Clic en una ruta del mapa: idéntico a clicar un vuelo activo — resalta la
  // ruta y enfoca los paneles en ese vuelo (origen/destino + sus maletas).
  const handleRouteClick = (key) => {
    setStorageFilter(""); setWhSemFilter("all"); setSelectedAirport(null); setBagSearch("");
    setSelectedShipment(null); setSelectedShipmentPath(null);
    const off = selectedRouteKey === key;
    const r   = (simulation?.routes ?? []).find(x => routeKey(x) === key);
    setSelectedRouteKey(off ? null : key);
    setPinnedCodes(off || !r ? null : [r.from, r.to]);
  };

  // Vuelo enfocado (al seleccionar una ruta): su flightId, para que los paneles
  // de Vuelos y Envíos muestren SOLO ese vuelo / sus maletas.
  const selectedRouteObj = useMemo(() => {
    if (!selectedRouteKey) return null;
    return (simulation?.routes ?? []).find(x => routeKey(x) === selectedRouteKey) || null;
  }, [selectedRouteKey, simulation?.routes]);
  const focusFlightId = selectedRouteObj?.flightId ?? null;

  const clearFocus = () => {
    setStorageFilter(""); setWhSemFilter("all"); setSelectedAirport(null);
    clearRouteFoci();
  };




  // Tiempo simulado transcurrido = minuto actual − minuto de inicio.
  // El minuto de inicio es autoritativo y viene del hook (sobrevive a los
  // cambios de pestaña), así que el contador siempre cuadra con el reloj y el
  // bloque del backend.
  const simStartMinute    = simulation?.simStartMinute ?? null;
  const simElapsedMinutes = (running && simStartMinute != null)
    ? Math.max(0, simulatedNow - simStartMinute)
    : 0;

  useEffect(() => {
    if (simulation?.collapsed) setShowCollapse(true);
  }, [simulation?.collapsed]);

  useEffect(() => {
    if (running && !simulation?.collapsed) setShowCollapse(false);
  }, [running, simulation?.collapsed]);

  // Cuerpo de una pestaña de Información. Se reutiliza tal cual en el panel
  // acoplado y dentro de cada ventana flotante (mismo contenido y filtros).
  const infoBody = (key) => {
    switch (key) {
      case "almacenes":
        return (
          <>
            {/* Filtro compartido: afecta a Capacidad Y Movimientos (y al mapa). */}
            <StorageFilterBar
              filter={storageFilter} onFilterChange={handleFilterChange}
              sem={whSemFilter} onSemChange={handleSemChange}/>
            <div className="flex gap-1 mb-2">
              {[["capacidad", "Capacidad"], ["movimientos", "Movimientos"]].map(([k, l]) => (
                <button key={k} onClick={() => setWhSub(k)}
                  className={`flex-1 text-[10px] px-1 py-0.5 rounded transition
                    ${whSub === k ? "bg-teal/20 text-teal border border-teal/40"
                                  : "bg-[#021020] text-gray-500 border border-white/10"}`}>
                  {l}
                </button>
              ))}
            </div>
            {whSub === "capacidad" ? (
              <WarehouseCapacity
                airports={simulation?.airports ?? []}
                kpis={kpis}
                filter={storageFilter}
                sem={whSemFilter}
                focusCodes={focusCodes}
                selectedCode={selectedAirport}
                onAirportClick={handleAirportClick}/>
            ) : (
              <StorageMovements
                history={simulation?.history ?? []}
                upcoming={simulation?.upcomingFlights ?? []}
                focusCodes={focusCodes}
                airports={simulation?.airports ?? []}/>
            )}
          </>
        );
      case "vuelos":
        return (
          <FlightsCapacity
            routes={simulation?.routes ?? []}
            upcoming={simulation?.upcomingFlights ?? []}
            focusCodes={focusCodes}
            focusFlightId={focusFlightId}
            sem={flightSemFilter}
            onSemChange={setFlightSemFilter}
            selectedRouteKey={selectedRouteKey}
            pinnedCodes={pinnedCodes}
            onFlightClick={handleFlightClick}
            running={running}/>
        );
      case "envios":
        return (
          <SLAMonitor
            kpis={kpis} events={simulation?.history ?? []}
            running={running} simulatedNow={simulatedNow}
            focusCodes={focusCodes} focusFlightId={focusFlightId} view="envios"
            selectedShipment={selectedShipment}
            onShipmentClick={handleShipmentClick}
            searchText={bagSearch} onSearchChange={handleBagSearch}/>
        );
      case "sla":
        return (
          <SLAMonitor
            kpis={kpis} events={simulation?.history ?? []}
            running={running} simulatedNow={simulatedNow}
            focusCodes={focusCodes} focusFlightId={focusFlightId} view="sla"/>
        );
      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col gap-2 p-2 h-[calc(100vh-72px)]
                    overflow-y-auto md:overflow-hidden">

      {/* ── Paneles principales ───────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-2 flex-1 min-h-0">

        {/* Panel izquierdo — Resumen (contadores + KPIs) */}
        <SidePanel title="Resumen" side="left"
                   open={leftOpen} onToggle={() => setLeftOpen(o => !o)}
                   widthClass="md:w-56">
          <SLAMonitor
            kpis={kpis}
            events={simulation?.history ?? []}
            running={running}
            simulatedNow={simulatedNow}
            focusCodes={focusCodes}
            focusFlightId={focusFlightId}
            view="resumen"
          />
        </SidePanel>

        {/* Mapa central */}
        <div ref={mapContainerRef} id="dash-map-zone"
             className="flex-1 relative min-h-[320px] md:min-h-0">
        <WorldMap
          airports={simulation?.airports ?? []}
          routes={simulation?.routes ?? []}
          running={running}
          message={simulation?.message ?? ""}
          simulatedMinute={simulatedNow}
          activeFlightsCount={kpis?.activeFlights ?? 0}
          highlightCodes={focusCodes}
          selectedRouteKey={selectedRouteKey}
          shipmentPath={selectedShipmentPath}
          flightSem={flightSemFilter}
          onAirportClick={handleAirportClick}
          onRouteClick={handleRouteClick}
          onClearSelection={clearFocus}/>

          {/* ── Configuración: ventana flotante colapsable sobre el mapa ───── */}
          <div className="absolute left-2 top-11 z-20 bg-[#031525]/95 border border-teal/20
                          rounded px-2 py-1.5 max-w-[calc(100%-1rem)]
                          flex flex-wrap items-center gap-x-3 gap-y-1">
            <button onClick={() => setConfigOpen(o => !o)}
              className="text-teal text-xs font-bold uppercase flex items-center gap-1
                         hover:text-white transition">
              <span>{configOpen ? "▾" : "▸"}</span> Configuración
            </button>

            {/* Día a Día = pizarra en blanco en tiempo real: SIN selector de
                fecha; muestra el estado de preparación (datos cargados). */}
            {mode === "diadia" ? (
              !configOpen ? (
                <span className="text-gray-500 text-xs truncate">
                  Tiempo real ·{" "}
                  <span className={prep?.ready ? "text-green-400" : "text-yellow-400"}>
                    {prep?.airports ?? 0} aerop · {prep?.flights ?? 0} vuelos · {prep?.lots ?? 0} paq.
                  </span>
                </span>
              ) : (
                <>
                  <span className="text-teal text-xs font-bold uppercase whitespace-nowrap">
                    Tiempo real (hora del sistema)
                  </span>
                  <span className="text-gray-400 text-xs">
                    Cargados:{" "}
                    <b className={prep?.airports ? "text-green-400" : "text-red-400"}>{prep?.airports ?? 0}</b> aerop ·{" "}
                    <b className={prep?.flights ? "text-green-400" : "text-red-400"}>{prep?.flights ?? 0}</b> vuelos ·{" "}
                    <b className={prep?.lots ? "text-green-400" : "text-red-400"}>{prep?.lots ?? 0}</b> paq.
                  </span>
                  {!running && (
                    <>
                      <span className={`text-[10px] ${prep?.ready ? "text-green-400" : "text-yellow-400"}`}>
                        {prep?.ready ? "✓ Listo para iniciar" : "Cargue datos en Registro »"}
                      </span>
                      {(prep?.airports || prep?.flights || prep?.lots) ? (
                        <button onClick={() => simulation?.resetPrep?.()}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-900/70 border border-white/10
                                     text-gray-400 hover:text-white transition">
                          Vaciar
                        </button>
                      ) : null}
                    </>
                  )}
                </>
              )
               ) : (
              <>
                {!configOpen && (
                  <span className="text-gray-500 text-xs truncate">
                    {cfg.selector}: <span className="text-gray-300">{selectedDate || "—"}</span> {cfg.suffix}
                  </span>
                )}

                {configOpen && (
                  <>
                    <span className="text-teal text-xs font-bold uppercase whitespace-nowrap">
                      {cfg.selector}
                    </span>

                    <DateTimePicker
                      selectedDate={selectedDate}
                      availableDates={availableDates}
                      onDateChange={onDateChange}
                      selectedStartMinute={selectedStartMinute}
                      onStartMinuteChange={onStartMinuteChange}
                      disabled={running}
                    />

                    {cfg.suffix && (
                      <span className="text-gray-500 text-xs">{cfg.suffix}</span>
                    )}
                  </>
                )}
              </>
            )}
          </div>

          {showCollapse && (
            <CollapseAlert
              onClose={() => setShowCollapse(false)}
              onStop={onStop}
              message={simulation?.message}
              kpis={kpis}/>
          )}

          {(mode === "diadia" || mode === "periodo") && simulation?.running && (
            <FlightCancelPanel
              flights={simulation?.upcomingFlights ?? []}
              onCancel={cancelFlight}
            />
          )}

          <div className="absolute left-3 bottom-3 bg-[#021020]/90
                          border border-teal/20 rounded p-2 text-xs
                          text-gray-300 max-w-md">
            <p className="text-teal font-bold uppercase">
              Bloque {simulation?.block ?? 0}
            </p>
            <p>{simulation?.blockStart || "---"} - {simulation?.blockEnd || "---"}</p>
            <p>{simulation?.message}</p>
          </div>

          {/* ── Relojes flotantes (esquina inferior derecha) ──────────────── */}
          {running && (
            <div className="absolute right-3 bottom-3 bg-[#021020]/90 border border-teal/20
                            rounded px-2 py-1 z-10 flex flex-wrap items-center gap-x-3 gap-y-0.5
                            max-w-[calc(100%-1.5rem)] justify-end">
              {[
                ["Hora sim.",    simClock,                            "text-teal"],
                ["Sim. transc.", formatSimTime(simElapsedMinutes),   "text-teal"],
                ["Hora real",    realNow.toLocaleTimeString("es-ES"), "text-white"],
                ["Real transc.", formatRealTime(realSeconds),        "text-white"],
              ].map(([label, value, color]) => (
                <div key={label} className="text-center">
                  <p className="text-gray-500 text-[8px] uppercase leading-none">{label}</p>
                  <p className={`text-[11px] font-mono font-bold leading-tight ${color}`}>{value}</p>
                </div>
              ))}
              {simulation?.message === "Pausado"
                ? <span className="text-amber-400 text-[10px]">❚❚ Pausado</span>
                : <span className="text-green-400 text-[10px] animate-pulse">● En curso</span>}
            </div>
          )}

          {/* ── Ventanas flotantes (pestañas sacadas del panel) ─────────────── */}
          {INFO_TABS.map(([k, l]) => floatWins[k] && (
            <FloatingPanel
              key={k} title={l}
              x={floatWins[k].x} y={floatWins[k].y}
              w={floatWins[k].w} h={floatWins[k].h}
              mode={floatWins[k].mode} z={winZ[k] ?? 30}
              onFocus={() => focusWin(k)}
              onDrag={(x, y) => updateWin(k, { x, y })}
              onResize={(w, h, x, y) => updateWin(k, { w, h, x, y })}
              onMin={() => minimizeWin(k)}
              onMax={() => maximizeWin(k)}
              onClose={() => dockWin(k)}>
              {infoBody(k)}
            </FloatingPanel>
          ))}
        </div>

        {/* Panel derecho — Información en pestañas (Almacenes/Vuelos/Envíos/SLA) */}
        <SidePanel title="Información" side="right"
                   open={rightOpen} onToggle={() => setRightOpen(o => !o)}
                   widthClass="md:w-72">
          <div className="flex gap-1 mb-2 sticky top-0 z-10 items-stretch">
            <div className="flex gap-1 flex-1">
              {INFO_TABS.map(([k, l]) => {
                const floating = !!floatWins[k];
                return (
                  <button key={k}
                    onClick={() => floating ? focusRestore(k) : setInfoTab(k)}
                    title={floating ? "En ventana flotante — clic para enfocarla" : l}
                    className={`flex-1 text-[10px] px-1 py-1 rounded transition font-medium
                      flex items-center justify-center gap-0.5
                      ${floating ? "bg-[#021020] text-teal border border-teal/40 border-dashed"
                        : infoTab === k ? "bg-teal text-white"
                        : "bg-[#021020] text-gray-400 border border-white/10 hover:text-white"}`}>
                    {l}{floating && <span className="text-[8px]">⧉</span>}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => popOut(infoTab)}
              disabled={!!floatWins[infoTab]}
              title="Abrir la pestaña activa como ventana flotante"
              className="px-1.5 rounded text-[11px] bg-[#021020] text-gray-400
                         border border-white/10 hover:text-teal hover:border-teal/40
                         disabled:opacity-30 disabled:cursor-not-allowed transition">
              ⧉
            </button>
          </div>

          {floatWins[infoTab] ? (
            <div className="text-center text-gray-500 text-[11px] py-6 px-3">
              <p className="mb-2">«{INFO_TABS.find(t => t[0] === infoTab)?.[1]}» está en una ventana flotante.</p>
              <button onClick={() => focusRestore(infoTab)}
                className="px-2 py-1 rounded bg-teal/15 text-teal border border-teal/40
                           hover:bg-teal/25 transition text-[10px]">
                Enfocar ventana
              </button>
              <button onClick={() => dockWin(infoTab)}
                className="ml-1 px-2 py-1 rounded bg-[#021020] text-gray-400 border border-white/10
                           hover:text-white transition text-[10px]">
                Devolver aquí
              </button>
            </div>
          ) : (
            infoBody(infoTab)
          )}
        </SidePanel>
      </div>
    </div>
  );
}

/**
 * Panel lateral colapsable y responsivo.
 * - Escritorio: abierto ocupa su ancho (md:w-72/64); colapsado se reduce a
 *   una franja vertical con el título girado.
 * - Móvil: ocupa todo el ancho y se apila; colapsado deja solo una barra de
 *   cabecera para expandirlo.
 */
function SidePanel({ title, side, open, onToggle, widthClass, children }) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        title={`Mostrar ${title}`}
        className={`flex-shrink-0 w-full md:w-7 bg-[#031525] border border-teal/20 rounded
                    flex md:flex-col items-center justify-between md:justify-start
                    px-2 py-1 md:py-2 gap-1 hover:border-teal/50 transition`}>
        <span className="text-gray-400 text-[10px] uppercase tracking-wide
                         md:[writing-mode:vertical-rl]">
          {title}
        </span>
        <span className="text-teal text-xs">
          {side === "left" ? "▸" : "◂"}
        </span>
      </button>
    );
  }
  return (
    <div className={`${widthClass} w-full flex-shrink-0 overflow-y-auto
                     max-h-[45vh] md:max-h-none`}>
      <div className="flex items-center justify-between mb-1 px-0.5">
        <span className="text-gray-500 text-[10px] uppercase tracking-wide">{title}</span>
        <button onClick={onToggle} title={`Ocultar ${title}`}
          className="text-gray-500 hover:text-white text-xs px-1">
          {side === "left" ? "◂" : "▸"}
        </button>
      </div>
      {children}
    </div>
  );
}