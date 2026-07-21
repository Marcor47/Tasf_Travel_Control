import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Check, Luggage, X } from "lucide-react";
import { STATIC_AIRPORTS, AIRPORT_META, airportName, airportGmtHours } from "../data/staticAirports";

/**
 * Pantalla B — OPERACIONES / RECEPCIÓN DE MALETAS (rol operador, sin CRUD).
 *
 * La sede llega por URL: /operaciones?sede=SPIM. La sede fija el ORIGEN de todos
 * los envíos (no se elige por envío) y deriva el HUSO HORARIO local:
 *   hora local sede = hora real del sistema (UTC) + GMT(h) del aeropuerto.
 * El GMT(h) sale del staging del backend si la sede está cargada ahí (respeta lo
 * que cargó el preparador) y, si no, de la tabla del dataset (staticAirports).
 * NUNCA se usa el reloj/huso del navegador para la hora local (todos los
 * operadores se conectan desde Perú): solo se usa el INSTANTE real (epoch), que
 * es independiente del huso.
 *
 * Registro por panel  → POST /addLot (el backend guarda el instante en UTC).
 * Registro por TXT    → POST /uploadData(type="lots") con líneas normalizadas
 *   `id-aaaammdd-hh-mm-DEST-###-cliente` (fecha/hora = hora LOCAL de la sede;
 *   el backend la convierte a UTC con el GMT del origen). El parser acepta
 *   líneas CON id (7 campos) o SIN id (6 campos, se autogenera desde 10000001).
 */

const SEDES_ESCENARIO = ["SPIM", "SABE", "EKCH", "VIDP"];
const CLIENTE_DEFAULT = "0007729";
const ID_BASE = 10000001;
const API_BASE = import.meta.env.VITE_API_BASE || "";

const pad = (n, w = 2) => String(n).padStart(w, "0");

/** Date "virtual" en el huso de la sede: instante real desplazado gmt horas.
 *  Se lee SIEMPRE con getters UTC (getUTCHours, …). */
const nowAtSede = (gmtHours) => new Date(Date.now() + gmtHours * 3600e3);

const fmtFecha = (d) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
const fmtHora  = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
const fmtHM    = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const fmtAAAAMMDD = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const fmtGmt = (g) => `GMT${g >= 0 ? "+" : "−"}${Math.abs(g) % 1 === 0 ? Math.abs(g) : Math.abs(g).toFixed(1)}`;

export default function Operaciones({ simulation }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sede = (params.get("sede") || "").trim().toUpperCase();

  const prep       = simulation?.prepStatus ?? { airports: 0, flights: 0, lots: 0, airportList: [] };
  const running    = simulation?.running ?? false;
  const simMode    = simulation?.mode ?? "diadia";
  const liveDiadia = running && simMode === "diadia";

  // Huso de la sede: staging del backend → tabla del dataset. null = desconocida.
  const gmt = airportGmtHours(sede, prep.airportList);
  const sedeValida = /^[A-Z0-9]{3,4}$/.test(sede) && gmt !== null;

  // ── Red disponible para registrar (staging, o la red viva en Día a Día) ────
  const networkCodes = liveDiadia
    ? (simulation?.airports ?? []).map(a => a.code)
    : (prep.airportList ?? []).map(a => a.code);

  const sedeEnRed   = networkCodes.includes(sede);
  const hayVuelos   = liveDiadia
    ? ((simulation?.upcomingFlights?.length ?? 0) + (simulation?.routes?.length ?? 0)) > 0
    : prep.flights > 0;
  const otraSimEnCurso = running && simMode !== "diadia";
  const puedeRegistrar = sedeValida && sedeEnRed && hayVuelos && !otraSimEnCurso;

  const destinos = networkCodes.filter(c => c !== sede).sort();

  // ── Reloj local de la sede (tick 1 s) ───────────────────────────────────
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const localDate = gmt !== null ? new Date(ahora.getTime() + gmt * 3600e3) : null;

  // ── Estado del formulario y de la sesión ───────────────────────────────
  const [destino,  setDestino]  = useState("");
  const [cantidad, setCantidad] = useState("");
  const [cliente,  setCliente]  = useState(CLIENTE_DEFAULT);
  const [enviando, setEnviando] = useState(false);

  // Evaluación de viabilidad (SLA, ruta, capacidad de almacenes) — la misma
  // verificación que tenía /registro cuando aún registraba envíos. No bloquea
  // el registro: es una consulta previa que el operador puede hacer u omitir.
  const [report,     setReport]     = useState(null);
  const [evaluating, setEvaluating] = useState(false);

  const puedeEvaluar = Boolean(destino) && destino !== sede && Number(cantidad) > 0;

  const evaluar = async () => {
    if (!puedeEvaluar || evaluating) return;
    setEvaluating(true);
    try {
      const r = await fetch(`${API_BASE}/api/simulation/evaluateLot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: sede, destination: destino, quantity: Number(cantidad) }),
      });
      setReport(r.ok ? await r.json() : null);
    } catch {
      setReport(null);
    } finally {
      setEvaluating(false);
    }
  };

  // Tabla de la sesión: parte VACÍA (sin data histórica ni proyectada).
  const [envios, setEnvios] = useState([]);
  const idSeq = useRef(ID_BASE);
  const nextId = () => String(idSeq.current++);

  // Al INICIAR una nueva simulación (runId cambia), vaciar la tabla: si no,
  // seguían viéndose los envíos de la corrida anterior.
  const runId = simulation?.runId ?? 0;
  useEffect(() => { setEnvios([]); setReport(null); }, [runId]);

  // Feedback visual grande (acompaña el "decir en voz alta" de la prueba).
  const [flash, setFlash] = useState(null); // { ok, text }
  const flashTimer = useRef(null);
  const showFlash = (ok, text) => {
    clearTimeout(flashTimer.current);
    setFlash({ ok, text });
    flashTimer.current = setTimeout(() => setFlash(null), 3500);
  };
  useEffect(() => () => clearTimeout(flashTimer.current), []);

  const destinoRef = useRef(null);

  const formValido = destino && destino !== sede
    && Number(cantidad) > 0 && cliente.trim() !== "";

  const registrar = async () => {
    if (!formValido || !puedeRegistrar || enviando) return;
    setEnviando(true);
    try {
      const qty = Number(cantidad);
      const ok = await simulation?.addLot?.(sede, destino, qty, cliente.trim());
      if (ok) {
        const d = nowAtSede(gmt);
        setEnvios(prev => [{
          id: nextId(), fecha: fmtAAAAMMDD(d), hora: fmtHM(d),
          destino, cantidad: qty, cliente: cliente.trim(), via: "panel",
        }, ...prev]);
        showFlash(true, `ENVÍO REGISTRADO — ${qty} maleta${qty === 1 ? "" : "s"} → ${destino} (${airportName(destino)}) · cliente ${cliente.trim()} · ${fmtHM(d)} hora local`);
        setDestino(""); setCantidad(""); setReport(null);
        destinoRef.current?.focus();
      } else {
        showFlash(false, "No se pudo registrar el envío. Verifica la red cargada.");
      }
    } catch {
      showFlash(false, "Error de conexión con el servidor.");
    } finally {
      setEnviando(false);
    }
  };

  // ── Carga por TXT (formato del profesor) ─────────────────────────────────
  // Parser INDEPENDIENTE del de carga masiva de /registro (vuelos/aeropuertos).
  const [txtResumen, setTxtResumen] = useState(null); // { ok, errores: [..] }

  const procesarTxt = useCallback(async (file) => {
    if (!file || !puedeRegistrar) return;
    const content = await file.text();
    const filas = [];
    const errores = [];
    const lineas = content.split(/\r?\n/);

    lineas.forEach((raw, i) => {
      const line = raw.trim();
      if (!line) return;
      const p = line.split("-").map(s => s.trim());
      // 7 campos: id-aaaammdd-hh-mm-dest-###-cliente · 6 campos: sin id
      let id, fecha, hh, mm, dest, qty, cli;
      if (p.length === 7)      [id, fecha, hh, mm, dest, qty, cli] = p;
      else if (p.length === 6) { id = null; [fecha, hh, mm, dest, qty, cli] = p; }
      else { errores.push(`L${i + 1}: se esperaban 6 o 7 campos separados por "-"`); return; }

      const h = Number(hh), m = Number(mm), q = Number(qty.replace(/\D/g, ""));
      dest = dest.toUpperCase();
      if (!/^\d{8}$/.test(fecha))        { errores.push(`L${i + 1}: fecha "${fecha}" no es aaaammdd`); return; }
      if (!(h >= 0 && h <= 23) || !(m >= 0 && m <= 59)) { errores.push(`L${i + 1}: hora "${hh}-${mm}" inválida`); return; }
      if (dest === sede)                 { errores.push(`L${i + 1}: destino igual a la sede (${sede})`); return; }
      if (!networkCodes.includes(dest))  { errores.push(`L${i + 1}: destino "${dest}" no está en la red cargada`); return; }
      if (!(q > 0))                      { errores.push(`L${i + 1}: cantidad "${qty}" inválida`); return; }
      // Ids del archivo: avanzar el correlativo local por encima del mayor id
      // numérico visto, para que los autogenerados no colisionen con ellos.
      if (id && /^\d+$/.test(id)) {
        idSeq.current = Math.max(idSeq.current, Number(id) + 1);
      }
      filas.push({
        id: id || nextId(), fecha, hh: pad(h), mm: pad(m),
        dest, qty: q, cli: cli || CLIENTE_DEFAULT,
      });
    });

    let cargadas = 0;
    if (filas.length > 0) {
      // Normalizado al formato que parsea el backend (fecha/hora = local sede;
      // el backend convierte a UTC restando el GMT del origen).
      const normalizado = filas
        .map(f => `${f.id}-${f.fecha}-${f.hh}-${f.mm}-${f.dest}-${pad(f.qty, 3)}-${f.cli}`)
        .join("\n");
      const ok = await simulation?.uploadData?.("lots", normalizado, sede);
      if (ok) {
        cargadas = filas.length;
        setEnvios(prev => [
          ...filas.map(f => ({
            id: f.id, fecha: f.fecha, hora: `${f.hh}:${f.mm}`,
            destino: f.dest, cantidad: f.qty, cliente: f.cli, via: "txt",
          })).reverse(),
          ...prev,
        ]);
      } else {
        errores.push("El servidor rechazó la carga (¿red sin preparar?)");
      }
    }
    setTxtResumen({ cargadas, errores });
    showFlash(errores.length === 0 && cargadas > 0,
      cargadas > 0
        ? `ARCHIVO CARGADO — ${cargadas} envío${cargadas === 1 ? "" : "s"} registrados${errores.length ? ` · ${errores.length} línea(s) con error` : ""}`
        : "No se registró ningún envío del archivo.");
  }, [puedeRegistrar, sede, networkCodes, simulation]);

  const onDrop = (e) => {
    e.preventDefault();
    procesarTxt(e.dataTransfer?.files?.[0]);
  };

  const totalMaletas = envios.reduce((s, e) => s + e.cantidad, 0);

  // ── Sede ausente o inválida: selector de sede / estado controlado ─────────
  if (!sedeValida) {
    // Sedes elegibles: los 30 del dataset + cualquier aeropuerto del staging
    // (códigos únicos, ordenados).
    const elegibles = [...new Set([
      ...STATIC_AIRPORTS.map(a => a.code),
      ...(prep.airportList ?? []).map(a => a.code),
    ])].sort();
    return (
      <div className="h-full overflow-y-auto flex items-center justify-center p-6 bg-[#020e1c]">
        <div className="bg-[#031525] border border-teal/20 rounded-lg p-8 max-w-lg w-full text-center">
          <Luggage size={40} className="mx-auto mb-3 text-teal"/>
          <h1 className="text-teal font-bold text-lg mb-2">OPERACIONES — RECEPCIÓN DE MALETAS</h1>
          {sede ? (
            <p className="text-gray-300 text-sm mb-1">
              La sede <b className="font-mono text-red-400">{sede}</b> no es válida o no tiene huso conocido.
            </p>
          ) : (
            <p className="text-gray-300 text-sm mb-1">
              Selecciona la sede (aeropuerto) de esta estación de recepción.
            </p>
          )}
          <p className="text-gray-500 text-xs mb-5">
            La sede fija el origen de todos los envíos y su huso horario. También puedes
            entrar directo con <span className="font-mono text-teal">/operaciones?sede=CÓDIGO</span>.
          </p>
          <p className="text-gray-500 text-[10px] uppercase mb-2">Sedes del escenario</p>
          <div className="flex flex-wrap justify-center gap-2 mb-5">
            {SEDES_ESCENARIO.map(c => (
              <Link key={c} to={`/operaciones?sede=${c}`}
                className="px-3 py-1.5 rounded bg-teal/15 border border-teal/40 text-teal
                           font-mono text-xs hover:bg-teal/30 transition">
                {c} · {airportName(c)}
              </Link>
            ))}
          </div>
          <p className="text-gray-500 text-[10px] uppercase mb-2">Otra sede de la red</p>
          <select value="" onChange={e => e.target.value && navigate(`/operaciones?sede=${e.target.value}`)}
            className="w-full max-w-xs bg-[#021020] border border-white/10 rounded px-2 py-2
                       text-xs text-gray-300 focus:outline-none focus:border-teal">
            <option value="">Seleccionar aeropuerto…</option>
            {elegibles.map(c => (
              <option key={c} value={c}>{c} — {airportName(c)}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  const meta = AIRPORT_META[sede];

  return (
    <div className="h-full overflow-y-auto bg-[#020e1c] text-gray-300">
      {/* ── Feedback grande de registro ── */}
      <div aria-live="polite">
        {flash && (
          <div className={`px-4 py-3 text-sm font-bold tracking-wide border-b
            flex items-center gap-2
            ${flash.ok ? "bg-green-900/40 border-green-500/40 text-green-300"
                       : "bg-red-900/40 border-red-500/40 text-red-300"}`}>
            {flash.ok ? <Check size={16} className="shrink-0"/> : <X size={16} className="shrink-0"/>}
            <span>{flash.text}</span>
          </div>
        )}
      </div>

      <main className="p-4 max-w-5xl mx-auto">
        {/* ── Info de la sede: origen fijo + reloj local (antes iba en una
            cabecera propia; ahora la cabecera es el Navbar global) ── */}
        <section className="bg-[#031525] border border-teal/20 rounded px-4 py-3 mb-4
                            flex flex-wrap items-center gap-x-6 gap-y-2">
          <div>
            <p className="text-[10px] text-gray-500 uppercase">Operaciones · Recepción de maletas</p>
            <h1 className="text-teal font-bold text-lg leading-tight">
              <span className="font-mono">{sede}</span>
              {" — "}{airportName(sede)}{meta?.country ? ` · ${meta.country}` : ""}
            </h1>
          </div>
          <span className="px-2 py-1 rounded bg-teal/15 border border-teal/40 text-teal text-[10px] uppercase"
                title="El origen lo fija la sede de esta estación; no se selecciona por envío">
            Origen fijo de esta sede
          </span>
          <div className="ml-auto text-right">
            <p className="text-[10px] text-gray-500 uppercase">
              Hora local de la sede ({fmtGmt(gmt)})
            </p>
            <p className="font-mono text-xl text-white leading-tight" data-testid="reloj-sede">
              {localDate ? `${fmtFecha(localDate)}  ${fmtHora(localDate)}` : "--"}
            </p>
          </div>
        </section>

        {/* Avisos de red no preparada */}
        {otraSimEnCurso && (
          <div className="mb-4 px-3 py-2 rounded border border-yellow-600/50 bg-yellow-900/15 text-yellow-300 text-xs">
            Hay una simulación <b>{simMode}</b> en curso: la recepción de producción está
            deshabilitada hasta que termine.
          </div>
        )}
        {!otraSimEnCurso && (!sedeEnRed || !hayVuelos) && (
          <div className="mb-4 px-3 py-2 rounded border border-yellow-600/50 bg-yellow-900/15 text-yellow-300 text-xs">
            La red aún no está preparada{!sedeEnRed ? <>: falta cargar el aeropuerto <b className="font-mono">{sede}</b></> : ""}
            {!hayVuelos ? (!sedeEnRed ? " y los vuelos" : ": faltan los vuelos") : ""}.
            Pídele al preparador que cargue aeropuertos y planes de vuelo del día.
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          {/* ── Registro por panel ── */}
          <section className="lg:col-span-2 bg-[#031525] border border-teal/20 rounded p-4">
            <p className="text-teal text-xs font-bold uppercase mb-3">Registrar envío</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <div>
                <label className="text-gray-500 text-[10px] uppercase block mb-1" htmlFor="op-dest">
                  Destino
                </label>
                <select id="op-dest" ref={destinoRef} value={destino}
                  onChange={e => { setDestino(e.target.value); setReport(null); }}
                  disabled={!puedeRegistrar}
                  className="w-full bg-[#021020] border border-white/10 rounded px-2 py-2
                             text-sm text-gray-200 focus:outline-none focus:border-teal
                             disabled:opacity-40">
                  <option value="">Seleccionar…</option>
                  {destinos.map(c => (
                    <option key={c} value={c}>{c} — {airportName(c)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-500 text-[10px] uppercase block mb-1" htmlFor="op-qty">
                  Cantidad de maletas
                </label>
                <input id="op-qty" type="number" min="1" value={cantidad}
                  onChange={e => { setCantidad(e.target.value); setReport(null); }}
                  onKeyDown={e => { if (e.key === "Enter") registrar(); }}
                  disabled={!puedeRegistrar}
                  placeholder="180"
                  className="w-full bg-[#021020] border border-white/10 rounded px-2 py-2
                             text-sm text-gray-200 focus:outline-none focus:border-teal
                             disabled:opacity-40"/>
              </div>
              <div>
                <label className="text-gray-500 text-[10px] uppercase block mb-1" htmlFor="op-cli">
                  Cliente
                </label>
                <input id="op-cli" value={cliente}
                  onChange={e => setCliente(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") registrar(); }}
                  disabled={!puedeRegistrar}
                  className="w-full bg-[#021020] border border-white/10 rounded px-2 py-2
                             text-sm text-gray-200 font-mono focus:outline-none focus:border-teal
                             disabled:opacity-40"/>
              </div>
            </div>
            <p className="text-gray-600 text-[10px] mb-3">
              Origen: <b className="text-teal font-mono">{sede}</b> (fijo) · Fecha y hora: se toman
              del sistema y se registran en el huso de la sede ({fmtGmt(gmt)}).
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={evaluar}
                disabled={!puedeEvaluar || !puedeRegistrar || evaluating}
                title="Verifica capacidad de almacenes, SLA y ruta antes de registrar (opcional)"
                className="w-full sm:w-auto px-6 bg-[#021020] border border-teal/40 hover:border-teal
                           text-teal text-sm py-2.5 rounded font-medium tracking-wide transition
                           disabled:opacity-40 disabled:cursor-not-allowed">
                {evaluating ? "Evaluando…" : "Evaluar viabilidad"}
              </button>
              <button onClick={registrar}
                disabled={!formValido || !puedeRegistrar || enviando}
                className="w-full sm:w-auto px-8 bg-teal hover:bg-teal/80 text-white text-sm py-2.5
                           rounded font-bold tracking-wide transition
                           disabled:opacity-40 disabled:cursor-not-allowed">
                {enviando ? "Registrando…" : "Registrar envío »"}
              </button>
            </div>

            {/* ── Resultado de la evaluación de viabilidad ── */}
            {report && (
              <div className="mt-4 pt-3 border-t border-white/5">
                <div className={`flex gap-2 mb-3 rounded p-2 ${
                  report.feasible ? "bg-green-900/20" : "bg-red-900/20"}`}>
                  {report.feasible
                    ? <Check size={14} className="text-green-400 shrink-0 mt-0.5"/>
                    : <X size={14} className="text-red-400 shrink-0 mt-0.5"/>}
                  <div>
                    <p className="text-gray-200 text-xs font-medium">
                      {report.feasible ? "Envío viable" : "Envío no viable"}
                    </p>
                    <p className="text-gray-500 text-[10px] mt-0.5">{report.reason}</p>
                  </div>
                </div>

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

                <div className="grid grid-cols-2 gap-2 mt-3">
                  {[
                    ["Almacén Origen",  report.originStoragePct],
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

                {report.feasible && report.path?.length > 0 && (
                  <>
                    <p className="text-teal text-[10px] font-bold uppercase mt-4 mb-2">
                      Ruta planeada
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
              </div>
            )}
          </section>

          {/* ── Carga por TXT ── */}
          <section className="bg-[#031525] border border-teal/20 rounded p-4">
            <p className="text-teal text-xs font-bold uppercase mb-2">Cargar envíos por TXT</p>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded p-4 text-center text-xs transition
                ${puedeRegistrar ? "border-teal/30 text-gray-500 hover:border-teal/60"
                                 : "border-white/10 text-gray-700"}`}>
              Arrastra aquí el archivo de envíos<br/>
              <span className="font-mono text-[10px]">id-aaaammdd-hh-mm-dest-###-cliente</span>
              <div className="mt-2">
                <label className={`inline-block px-3 py-1 rounded text-[10px] border transition
                  ${puedeRegistrar
                    ? "bg-[#021020] border-teal/40 text-teal cursor-pointer hover:bg-teal/10"
                    : "bg-[#021020] border-white/10 text-gray-600"}`}>
                  o elegir archivo…
                  <input type="file" accept=".txt" className="hidden" disabled={!puedeRegistrar}
                    onChange={e => { procesarTxt(e.target.files?.[0]); e.target.value = ""; }}/>
                </label>
              </div>
            </div>
            <p className="text-gray-600 text-[10px] mt-2">
              La fecha/hora del archivo se interpreta como hora local de <b className="font-mono">{sede}</b>.
              El id puede omitirse (se autogenera).
            </p>
            {txtResumen && (
              <div className="mt-2 text-[10px]">
                <p className={txtResumen.cargadas > 0 ? "text-green-400" : "text-red-400"}>
                  {txtResumen.cargadas} envío(s) cargados · {txtResumen.errores.length} error(es)
                </p>
                {txtResumen.errores.length > 0 && (
                  <ul className="text-red-400/80 mt-1 max-h-20 overflow-y-auto list-disc pl-4">
                    {txtResumen.errores.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>

        {/* ── Tabla de envíos de la sesión (parte vacía) ── */}
        <section className="bg-[#031525] border border-teal/20 rounded">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
            <p className="text-teal text-xs font-bold uppercase">Envíos registrados en esta sesión</p>
            <p className="text-gray-500 text-[10px]">
              {envios.length} envío(s) · {totalMaletas} maleta(s)
            </p>
          </div>
          {envios.length === 0 ? (
            <p className="text-gray-600 text-xs text-center py-8">
              Sin envíos registrados aún. La lista parte vacía en cada sesión.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-[10px] uppercase border-b border-white/5">
                    <th className="text-left  px-4 py-2">ID envío</th>
                    <th className="text-left  px-2 py-2">Fecha (local)</th>
                    <th className="text-left  px-2 py-2">Hora (local)</th>
                    <th className="text-left  px-2 py-2">Origen</th>
                    <th className="text-left  px-2 py-2">Destino</th>
                    <th className="text-right px-2 py-2">Maletas</th>
                    <th className="text-left  px-2 py-2">Cliente</th>
                    <th className="text-left  px-4 py-2">Vía</th>
                  </tr>
                </thead>
                <tbody>
                  {envios.map((e, i) => (
                    <tr key={`${e.id}-${i}`}
                        className={`border-b border-white/5 ${i === 0 ? "bg-teal/5" : ""}`}>
                      <td className="px-4 py-1.5 font-mono">{e.id}</td>
                      <td className="px-2 py-1.5 font-mono">{e.fecha}</td>
                      <td className="px-2 py-1.5 font-mono">{e.hora}</td>
                      <td className="px-2 py-1.5 font-mono text-teal">{sede}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono">{e.destino}</span>
                        <span className="text-gray-500"> — {airportName(e.destino)}</span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{e.cantidad}</td>
                      <td className="px-2 py-1.5 font-mono">{e.cliente}</td>
                      <td className="px-4 py-1.5 text-gray-500">{e.via === "txt" ? "TXT" : "Panel"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
