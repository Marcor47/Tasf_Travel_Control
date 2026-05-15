import { useState, useEffect, useRef } from "react";

export function useSimulation() {
  const [running, setRunning]   = useState(false);
  const [elapsed, setElapsed]   = useState(0); // segundos
  const intervalRef             = useRef(null);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setElapsed(e => e + 1);
      }, 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [running]);

  const hours = Math.floor(elapsed / 3600);
  const mins  = Math.floor((elapsed % 3600) / 60);
  const clock = `Día ${Math.floor(hours/24)+1}  ${String(hours%24).padStart(2,"0")}:${String(mins).padStart(2,"0")}`;

  return { running, setRunning, clock };
}