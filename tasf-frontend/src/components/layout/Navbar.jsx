import { useNavigate, useLocation } from "react-router-dom";
import { User, Clock, BarChart2, Bell, Settings, Play, Pause } from "lucide-react";

const modes = [
  { label: "Dia-a-Dia", path: "/" },
  { label: "Periodo", path: "/periodo" },
  { label: "Colapso", path: "/colapso" },
];

const menu = [
  { label: "Registro", path: "/registro", icon: <User size={14}/> },
  { label: "Historial", path: "/historial", icon: <Clock size={14}/> },
  { label: "Reportes", path: "/reportes", icon: <BarChart2 size={14}/> },
  { label: "Monitoreo", path: "/monitoreo", icon: <Bell size={14}/> },
];

export default function Navbar({ running, onToggle, clock }) {
  const nav = useNavigate();
  const { pathname } = useLocation();

  return (
    <nav className="flex items-center justify-between px-4 py-2
                    bg-[#010f1e] border-b border-teal/30 text-sm">
      <span className="font-bold text-teal tracking-widest text-xs">
        TASFTRAVELCONTROL
      </span>

      <div className="flex gap-1">
        <span className="text-gray-500 mr-2">Modo: </span>
        {modes.map(m => (
          <button key={m.path}
            onClick={() => nav(m.path)}
            className={`px-3 py-1 rounded text-xs font-medium transition
              ${pathname === m.path
                ? "bg-teal text-white"
                : "text-gray-400 hover:text-white"}`}>
            {m.label}
          </button>
        ))}
      </div>

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

      <div className="flex items-center gap-3">
        <span className="text-gray-400 text-xs">{clock}</span>
        <button onClick={onToggle}
          className="bg-teal hover:bg-teal/80 text-white text-xs
                     px-3 py-1 rounded flex items-center gap-1">
          {running ? <><Pause size={12}/> PAUSE</> : <><Play size={12}/> START</>}
        </button>
        <Settings size={16} className="text-gray-500 cursor-pointer hover:text-white"/>
      </div>
    </nav>
  );
}
