import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import Navbar        from "./components/layout/Navbar";
import StatusBar     from "./components/layout/StatusBar";
import Dashboard     from "./pages/Dashboard";
import RegisterLot   from "./pages/RegisterLot";
import LiveMonitor   from "./pages/LiveMonitor";
import ReportView    from "./pages/ReportView";
import HistoryView   from "./pages/HistoryView";
import { useSimulation } from "./hooks/useSimulation";

function AppContent() {
  const simulation = useSimulation();
  const {
    running, clock, kpis,
    start, stop, pause, resume, paused, history,
    availableDates, selectedDate, setSelectedDate,
    selectedNumDays, setSelectedNumDays,
    selectedStartMinute, setSelectedStartMinute,
    cancelFlight,
    realSeconds, // ← nuevo
  } = simulation;

  const { pathname } = useLocation();
  const navigate     = useNavigate();

  const modeFromPath = pathname === "/colapso" ? "colapso"
                     : pathname === "/periodo"  ? "periodo"
                     : "diadia";

  // Nota: cambiar de pestaña de modo NO detiene la simulación en curso.
  // Solo navega; la simulación (única en el backend) sigue corriendo y el
  // control de la barra superior se bloquea en las pestañas de otro modo.

  const handleToggle = () => {
    // Si hay una simulación corriendo en otro modo, no se permite controlarla
    // desde esta pestaña (no se corren dos a la vez).
    if (running && simulation?.mode && simulation.mode !== modeFromPath) {
      return;
    }
    if (running) {
      // Pausar / reanudar — NO reinicia la simulación.
      if (paused) resume(); else pause();
    } else {
      const targetPath = modeFromPath === "colapso" ? "/colapso"
                      : modeFromPath === "periodo"  ? "/periodo"
                      : "/";
      navigate(targetPath);
      start(modeFromPath, selectedDate, selectedNumDays, selectedStartMinute);
    }
  };

  const handleModeClick = (mode) => {
    // No detener la simulación al navegar entre pestañas
    navigate(mode === "colapso" ? "/colapso"
          : mode === "periodo" ? "/periodo"
          : "/");
  };

  const dashboardProps = {
    simulation,
    onStop: stop,
    availableDates,
    selectedDate,
    onDateChange: setSelectedDate,
    selectedNumDays,
    onNumDaysChange: setSelectedNumDays,
    selectedStartMinute,
    onStartMinuteChange: setSelectedStartMinute,
    cancelFlight,
    realSeconds, // ← nuevo
  };

  return (
    <div className="flex flex-col min-h-screen">
    <Navbar
      running={running}
      onToggle={handleToggle}
      onModeClick={handleModeClick}
      clock={clock}
      mode={modeFromPath}
      simulationMode={simulation?.mode}   // ← modo real de la sim activa
      paused={paused}
      onStop={stop}
      message={simulation?.message ?? ""}/>
      
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/"         element={<Dashboard mode="diadia"   {...dashboardProps}/>}/>
          <Route path="/periodo"  element={<Dashboard mode="periodo"  {...dashboardProps}/>}/>
          <Route path="/colapso"  element={<Dashboard mode="colapso"  {...dashboardProps}/>}/>
          <Route path="/registro"  element={<RegisterLot simulation={simulation}/>}/>
          <Route path="/monitoreo" element={<LiveMonitor  simulation={simulation}/>}/>
          <Route path="/reportes"  element={<ReportView   simulation={simulation}/>}/>
          <Route path="/historial" element={<HistoryView  history={history} upcoming={simulation?.upcomingFlights ?? []} running={running}/>}/>
        </Routes>
      </main>

      <StatusBar
        saturation={kpis?.saturationPercent ?? 0}
        replanifications={kpis?.replanifications ?? 0}/>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppContent/>
    </BrowserRouter>
  );
}