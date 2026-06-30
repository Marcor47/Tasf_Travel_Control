import { Rnd } from "react-rnd";

const TITLE_H = 26;   // alto de la barra de título (también el alto al minimizar)

/**
 * Ventana flotante sobre el mapa para una pestaña de información.
 *
 * - Arrastrable por la barra de título (clase `fp-drag`); los botones la
 *   cancelan (`fp-btn`) para no mover la ventana al pulsarlos.
 * - Redimensionable salvo cuando está minimizada o maximizada.
 * - minimizar → se reduce a una barra horizontal con solo el título.
 * - maximizar → ocupa el área del mapa; el mismo botón restaura.
 * - cerrar    → la devuelve a las pestañas (lo gestiona el padre).
 *
 * El padre controla posición/tamaño/modo (estado de sesión en el Dashboard).
 */
export default function FloatingPanel({
  title, x = 40, y = 40, w = 300, h = 360, mode = "normal", z = 30,
  onFocus, onTitleClick, onDrag, onResize, onMin, onMax, onClose, children,
}) {
  const minimized = mode === "min";
  const maximized = mode === "max";

  return (
    <Rnd
      size={{ width: minimized ? 168 : w, height: minimized ? TITLE_H : h }}
      position={{ x, y }}
      bounds="#dash-map-zone"
      dragHandleClassName="fp-drag"
      cancel=".fp-btn"
      enableResizing={!minimized}
      minWidth={220}
      minHeight={TITLE_H}
      style={{ zIndex: z }}
      onDragStart={() => onFocus?.()}
      onResizeStart={() => onFocus?.()}
      onDragStop={(e, d) => onDrag?.(d.x, d.y)}
      onResizeStop={(e, dir, ref, delta, pos) =>
        onResize?.(ref.offsetWidth, ref.offsetHeight, pos.x, pos.y)}>

      <div onMouseDown={() => onFocus?.()}
           className="flex flex-col h-full bg-[#031525] border border-teal/30 rounded
                      shadow-xl shadow-black/40 overflow-hidden">
        {/* Barra de título (zona de arrastre) */}
        <div className="fp-drag flex items-center justify-between gap-1 px-2
                        bg-[#021020] border-b border-teal/20 cursor-move select-none"
             style={{ height: TITLE_H }}>
          <span onClick={onTitleClick}
                className="text-teal text-[10px] font-bold uppercase truncate cursor-pointer flex-1">
            {title}
          </span>
          <span className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={onMin}
              className="fp-btn w-4 h-4 flex items-center justify-center rounded
                         text-gray-400 hover:text-white hover:bg-white/10 text-[11px] leading-none"
              title={minimized ? "Restaurar" : "Minimizar"}>▁</button>
            <button onClick={onMax}
              className="fp-btn w-4 h-4 flex items-center justify-center rounded
                         text-gray-400 hover:text-white hover:bg-white/10 text-[10px] leading-none"
              title={maximized ? "Restaurar" : "Maximizar"}>{maximized ? "❐" : "□"}</button>
            <button onClick={onClose}
              className="fp-btn w-4 h-4 flex items-center justify-center rounded
                         text-gray-400 hover:text-white hover:bg-red-700/70 text-[11px] leading-none"
              title="Cerrar (minimizar a la izquierda)">✕</button>
          </span>
        </div>

        {/* Contenido (oculto al minimizar) */}
        {!minimized && (
          <div className="flex-1 overflow-y-auto p-2">{children}</div>
        )}
      </div>
    </Rnd>
  );
}
