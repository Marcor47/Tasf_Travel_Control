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

export default function Navbar({ running, onToggle, onModeClick, clock, mode }) {
  const nav          = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="flex items-center justify-between px-4 py-2
                    bg-[#010f1e] border-b border-teal/30 text-sm">
      {/* Logo */}
      <span className="font-bold text-teal tracking-widest text-xs">
        TASFTRAVELCONTROL
      </span>

      {/* Modos — Punto 4: llama onModeClick para sincronizar */}
      <div className="flex gap-1 items-center">
        <span className="text-gray-500 mr-2 text-xs">Modo:</span>
        {Object.entries(modeMap).map(([key, m]) => {
          const isActive = pathname === m.path;
          const isRunningHere = running && mode === key;
          return (
            <button key={key}
              onClick={() => onModeClick ? onModeClick(key) : nav(m.path)}
              className={`px-3 py-1 rounded text-xs font-medium transition
                relative
                ${isActive
                  ? "bg-teal text-white"
                  : "text-gray-400 hover:text-white"}`}>
              {m.label}
              {/* Punto verde si la simulación está activa en este modo */}
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
            className={`flex items-center gap-1 hover:text-white
                        transition text-xs
                        ${pathname === m.path ? "text-teal" : ""}`}>
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Reloj + Start/Pause */}
      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-xs font-mono">{clock}</span>
        <button onClick={onToggle}
          className={`text-white text-xs px-3 py-1 rounded
                      flex items-center gap-1 transition
                      ${running
                        ? "bg-red-700 hover:bg-red-600"
                        : "bg-teal hover:bg-teal/80"}`}>
          {running
            ? <><Pause size={12}/> PAUSE</>
            : <><Play  size={12}/> START</>}
        </button>
        <Settings size={16}
          className="text-gray-500 cursor-pointer hover:text-white transition"/>
      </div>
    </nav>
  );
}
