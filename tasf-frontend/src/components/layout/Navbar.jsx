import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { User, Clock, BarChart2, Bell, Settings, Play, Pause } from "lucide-react";

const modeMap = {
  "diadia":  { label:"Dia-a-Dia", path:"/"        },
  "periodo": { label:"Periodo",   path:"/periodo" },
  "colapso": { label:"Colapso",   path:"/colapso" },
};

const menu = [
  { label:"Registro",  path:"/registro",  icon:<User size={14}/>     },
  { label:"Historial", path:"/historial", icon:<Clock size={14}/>    },
  { label:"Reportes",  path:"/reportes",  icon:<BarChart2 size={14}/> },
  { label:"Monitoreo", path:"/monitoreo", icon:<Bell size={14}/>     },
];

export default function Navbar({ running, onToggle, onModeClick, clock, mode, simulationMode, message }) {
  const nav          = useNavigate();
  const { pathname } = useLocation();

  // Segundos locales — solo activos en diadia
  const [seconds, setSeconds] = useState(0);
  const prevClock = useRef(clock);

  // Resetear segundos cada vez que el backend avanza un minuto
  useEffect(() => {
    if (prevClock.current !== clock) {
      prevClock.current = clock;
      setSeconds(0);
    }
  }, [clock]);

  // Tick cada segundo — solo cuando diadia está corriendo Y el reloj es real
  useEffect(() => {
    const clockIsReal   = clock && !clock.startsWith("Dia --");
    const isAnimating   = !message.startsWith("Planificando")
                      && !message.startsWith("Cargando");
    if (mode !== "diadia" || !running || !clockIsReal || !isAnimating) {
      setSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setSeconds(s => (s + 1) % 60);
    }, 1000);
    return () => clearInterval(interval);
  }, [mode, running, clock, message]);

  const clockDisplay = mode === "diadia"
    ? `${clock}:${String(seconds).padStart(2, "0")}`
    : clock;

  // ¿Hay una simulación corriendo en un modo distinto al de la pestaña actual?
  // En ese caso el control no debe permitir detenerla ni iniciar otra: solo
  // informa que sigue en curso y que hay que ir a esa pestaña para controlarla.
  const runningElsewhere = running && simulationMode && simulationMode !== mode;
  const otherModeLabel   = runningElsewhere
    ? (modeMap[simulationMode]?.label ?? simulationMode)
    : "";

  return (
    <nav className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 sm:px-4 py-2
                    bg-[#010f1e] border-b border-teal/30 text-sm">
      {/* Logo */}
      <span className="font-bold text-teal tracking-widest text-xs">
        TASFTRAVELCONTROL
      </span>

      {/* Modos */}
      <div className="flex gap-1 items-center">
        <span className="text-gray-500 mr-2 text-xs">Modo:</span>
        {Object.entries(modeMap).map(([key, m]) => {
          const isActive      = pathname === m.path;
          const isRunningHere = running && (simulationMode ?? mode) === key;
          return (
            <button key={key}
              onClick={() => onModeClick ? onModeClick(key) : nav(m.path)}
              className={`px-3 py-1 rounded text-xs font-medium transition relative
                ${isActive ? "bg-teal text-white" : "text-gray-400 hover:text-white"}`}>
              {m.label}
              {isRunningHere && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2
                                 bg-green-400 rounded-full animate-pulse"/>
              )}
            </button>
          );
        })}
      </div>

      {/* Menú secundario */}
      <div className="flex gap-4 text-gray-400">
        {menu.map(m => (
          <button key={m.path}
            onClick={() => nav(m.path)}
            className={`flex items-center gap-1 hover:text-white transition text-xs
                        ${pathname === m.path ? "text-teal" : ""}`}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Reloj + Start/Pause */}
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-xs font-mono">{clockDisplay}</span>
        {runningElsewhere ? (
          <span
            title={`Hay una simulación en curso en modo ${otherModeLabel}. Cámbiate a esa pestaña para pausarla.`}
            className="text-yellow-400 text-xs px-3 py-1 rounded flex items-center gap-1
                       border border-yellow-700/50 bg-yellow-900/20 whitespace-nowrap cursor-default">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"/>
            {otherModeLabel} en curso
          </span>
        ) : (
          <button onClick={onToggle}
            className={`text-white text-xs px-3 py-1 rounded flex items-center gap-1
                        transition ${running
                          ? "bg-red-700 hover:bg-red-600"
                          : "bg-teal hover:bg-teal/80"}`}>
            {running ? <><Pause size={12}/> PAUSAR</> : <><Play size={12}/> INICIAR</>}
          </button>
        )}
        <Settings size={16}
          className="text-gray-500 cursor-pointer hover:text-white transition"/>
      </div>
    </nav>
  );
}