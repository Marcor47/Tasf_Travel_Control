import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import Navbar        from "./components/layout/Navbar";
import StatusBar     from "./components/layout/StatusBar";
import Dashboard     from "./pages/Dashboard";
import RegisterLot   from "./pages/RegisterLot";
import LiveMonitor   from "./pages/LiveMonitor";
import ReportView    from "./pages/ReportView";
import HistoryView   from "./pages/HistoryView";
import { useSimulation } from "./hooks/useSimulation";

function AppContent() {
  const simulation              = useSimulation();
  const { running, clock, kpis, start, stop } = simulation;
  const { pathname }            = useLocation();
  const navigate                = useNavigate();

  // Punto 4: modo sincronizado con el path actual
  const modeFromPath = pathname === "/colapso" ? "colapso"
                     : pathname === "/periodo"  ? "periodo"
                     : "diadia";

  // Si la simulación está corriendo en un modo distinto al path actual,
  // detenerla automáticamente al cambiar de ruta
  useEffect(() => {
    if (running && simulation?.mode && simulation.mode !== modeFromPath) {
      stop();
    }
  }, [modeFromPath]);

  const handleToggle = () => {
    if (running) {
      stop();
    } else {
      // Navegar al path del modo antes de iniciar
      const targetPath = modeFromPath === "colapso" ? "/colapso"
                       : modeFromPath === "periodo"  ? "/periodo"
                       : "/";
      navigate(targetPath);
      start(modeFromPath);
    }
  };

  const handleModeClick = (mode) => {
    // Al hacer click en Día-a-Día / Período / Colapso en el navbar,
    // detener simulación actual si estaba corriendo en otro modo
    if (running && simulation?.mode !== mode) {
      stop();
    }
    navigate(mode === "colapso" ? "/colapso"
           : mode === "periodo" ? "/periodo"
           : "/");
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar
        running={running}
        onToggle={handleToggle}
        onModeClick={handleModeClick}
        clock={clock}
        mode={modeFromPath}/>

      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/"
            element={
              <Dashboard
                mode="diadia"
                simulation={simulation}
                onStop={stop}/>
            }/>
          <Route path="/periodo"
            element={
              <Dashboard
                mode="periodo"
                simulation={simulation}
                onStop={stop}/>
            }/>
          <Route path="/colapso"
            element={
              <Dashboard
                mode="colapso"
                simulation={simulation}
                onStop={stop}/>
            }/>
          <Route path="/registro"   element={<RegisterLot/>}/>
          <Route path="/monitoreo"  element={<LiveMonitor  simulation={simulation}/>}/>
          <Route path="/reportes"   element={<ReportView   simulation={simulation}/>}/>
          <Route path="/historial"
            element={
              <HistoryView
                events={simulation?.events ?? []}
                running={simulation?.running ?? false}/>
            }/>
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
