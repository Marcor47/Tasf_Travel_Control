export function getSLAColor(hoursLeft) {
  if (hoursLeft > 48) return "ok";
  if (hoursLeft > 24) return "alert";
  return "critical";
}

export function getWarehouseColor(pct) {
  if (pct < 60) return "green";
  if (pct < 85) return "amber";
  return "red";
}

export const statusLabel = {
  ok:       { text:"OK",       bg:"bg-green-600",  dot:"bg-green-400"  },
  alert:    { text:"Alerta",   bg:"bg-yellow-600", dot:"bg-yellow-400" },
  critical: { text:"Crítico",  bg:"bg-red-700",    dot:"bg-red-500"    },
  transit:  { text:"En Tráns.",bg:"bg-blue-700",   dot:"bg-blue-400"   },
  risk:     { text:"En Riesgo",bg:"bg-orange-700", dot:"bg-orange-400" },
};