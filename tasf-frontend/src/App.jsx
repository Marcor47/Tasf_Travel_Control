import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import Navbar        from "./components/layout/Navbar";
import StatusBar     from "./components/layout/StatusBar";
import Dashboard     from "./pages/Dashboard";
import RegisterLot   from "./pages/RegisterLot";
import LiveMonitor   from "./pages/LiveMonitor";
import ReportView    from "./pages/ReportView";
import { useSimulation } from "./hooks/useSimulation";
import { kpis }      from "./data/mockData";

function AppContent() {
  const { running, setRunning, clock } = useSimulation();
  const { pathname } = useLocation();

  const mode = pathname === "/colapso" ? "colapso"
             : pathname === "/periodo" ? "periodo"
             : "diadia";

  return (
    <div className="flex flex-col min-h-screen">
      <Navbar
        running={running}
        onToggle={() => setRunning(r => !r)}
        clock={clock}/>

      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route path="/"          element={<Dashboard mode="diadia"/>}/>
          <Route path="/periodo"   element={<Dashboard mode="periodo"/>}/>
          <Route path="/colapso"   element={<Dashboard mode="colapso"/>}/>
          <Route path="/registro"  element={<RegisterLot/>}/>
          <Route path="/monitoreo" element={<LiveMonitor/>}/>
          <Route path="/reportes"  element={<ReportView/>}/>
          <Route path="/historial" element={
            <div className="p-8 text-gray-400 text-center">
              Historial — próximamente
            </div>}/>
        </Routes>
      </main>

      <StatusBar
        saturation={kpis.saturationPercent}
        replanifications={kpis.replanifications}/>
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