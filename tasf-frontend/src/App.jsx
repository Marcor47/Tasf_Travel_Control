import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Navbar        from "./components/layout/Navbar";
import StatusBar     from "./components/layout/StatusBar";
import Dashboard     from "./pages/Dashboard";
import RegisterLot   from "./pages/RegisterLot";
import LiveMonitor   from "./pages/LiveMonitor";
import ReportView    from "./pages/ReportView";
import { useSimulation } from "./hooks/useSimulation";

function AppContent() {
  const simulation = useSimulation();
  const { running, clock, kpis, start, stop } = simulation;
  const { pathname } = useLocation();

  const mode = pathname === "/colapso" ? "colapso"
             : pathname === "/periodo" ? "periodo"
             : "diadia";
  const handleToggle = () => running ? stop() : start(mode);

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar
        running={running}
        onToggle={handleToggle}
        clock={clock}/>

      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/"          element={<Dashboard mode="diadia" simulation={simulation}/>}/>
          <Route path="/periodo"   element={<Dashboard mode="periodo" simulation={simulation}/>}/>
          <Route path="/colapso"   element={<Dashboard mode="colapso" simulation={simulation}/>}/>
          <Route path="/registro"  element={<RegisterLot/>}/>
          <Route path="/monitoreo" element={<LiveMonitor simulation={simulation}/>}/>
          <Route path="/reportes"  element={<ReportView/>}/>
          <Route path="/historial" element={
            <div className="p-8 text-gray-400 text-center">
              Historial — próximamente
            </div>}/>
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
