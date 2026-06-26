// Barra de filtro compartida del panel de Almacenes: búsqueda por texto
// (código/país/región) + semáforo de ocupación. Vive en el Dashboard, por
// encima del conmutador Capacidad/Movimientos, de modo que el MISMO filtro
// afecta a ambas sub-vistas (capacidad y movimientos) y al mapa.
const SEM_CHIPS = [
  { key: "all",   label: "Todos", dot: "bg-gray-400" },
  { key: "green", label: "",      dot: "bg-green-500" },
  { key: "amber", label: "",      dot: "bg-yellow-500" },
  { key: "red",   label: "",      dot: "bg-red-500" },
  { key: "empty", label: "Vacío", dot: "bg-gray-500" },
];

export default function StorageFilterBar({
  filter = "", onFilterChange, sem = "all", onSemChange,
}) {
  return (
    <div className="mb-2">
      <div className="relative mb-1.5">
        <input
          value={filter}
          onChange={e => onFilterChange?.(e.target.value)}
          placeholder="Filtrar por código, país o región…"
          className="w-full bg-[#021020] border border-white/10 rounded
                     px-2 py-1 pr-6 text-[11px] text-gray-300
                     focus:outline-none focus:border-teal"
        />
        {filter.trim() && (
          <button
            onClick={() => onFilterChange?.("")}
            title="Limpiar filtro"
            className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500
                       hover:text-white text-xs px-1">
            ✕
          </button>
        )}
      </div>
      <div className="flex gap-1">
        {SEM_CHIPS.map(c => (
          <button key={c.key} onClick={() => onSemChange?.(c.key)}
            title={c.key}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition border
              ${sem === c.key ? "border-teal/60 bg-teal/10 text-gray-200"
                              : "border-white/10 text-gray-400 hover:text-white"}`}>
            <span className={`w-2 h-2 rounded-full ${c.dot}`}/>{c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
