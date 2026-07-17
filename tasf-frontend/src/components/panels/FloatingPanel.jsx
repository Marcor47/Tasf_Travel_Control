import { useEffect, useRef, useState } from "react";
import { Rnd } from "react-rnd";
import { Maximize2, Minimize2, Plane, X } from "lucide-react";

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
  accent = "teal",   // "teal" (informativo) | "red" (CTA importante, ej. Cancelar Vuelo)
  onFocus, onTitleClick, onDrag, onResize, onMin, onMax, onClose, children,
}) {
  const minimized = mode === "min";
  const maximized = mode === "max";
  // CTA rojo: bordeado que llama la atención sin relleno sólido (combina con el mapa).
  const red = accent === "red";

  // ── Posición LOCAL durante el arrastre ────────────────────────────────────
  // Con la simulación corriendo, el Dashboard se re-renderiza cada ~0,8 s
  // (broadcasts) y cada 1 s (reloj). Si Rnd usa la posición controlada del
  // padre, cada re-render a mitad de arrastre re-impone la posición VIEJA y la
  // ventana se queda detrás del mouse. Solución: durante el drag se sigue al
  // mouse con estado local (onDrag) y se ignoran las props; al soltar se
  // sincroniza con el padre (onDragStop → updateWin).
  const [pos,  setPos]  = useState({ x, y });
  const [size, setSize] = useState({ w, h });
  const draggingRef     = useRef(false);
  const resizingRef     = useRef(false);
  useEffect(() => {
    if (!draggingRef.current && !resizingRef.current) setPos({ x, y });
  }, [x, y]);
  useEffect(() => {
    if (!resizingRef.current) setSize({ w, h });
  }, [w, h]);

  return (
    <Rnd
      size={{ width: minimized ? 168 : size.w, height: minimized ? TITLE_H : size.h }}
      position={pos}
      bounds="#dash-map-zone"
      dragHandleClassName="fp-drag"
      cancel=".fp-btn"
      enableResizing={!minimized}
      minWidth={220}
      minHeight={TITLE_H}
      style={{ zIndex: z }}
      onDragStart={() => { draggingRef.current = true; onFocus?.(); }}
      onDrag={(e, d) => setPos({ x: d.x, y: d.y })}
      onDragStop={(e, d) => {
        draggingRef.current = false;
        setPos({ x: d.x, y: d.y });
        onDrag?.(d.x, d.y);
      }}
      onResizeStart={() => { resizingRef.current = true; onFocus?.(); }}
      onResize={(e, dir, ref, delta, p) => {
        setSize({ w: ref.offsetWidth, h: ref.offsetHeight });
        setPos({ x: p.x, y: p.y });   // redimensionar desde arriba/izquierda también mueve
      }}
      onResizeStop={(e, dir, ref, delta, p) => {
        resizingRef.current = false;
        setSize({ w: ref.offsetWidth, h: ref.offsetHeight });
        setPos({ x: p.x, y: p.y });
        onResize?.(ref.offsetWidth, ref.offsetHeight, p.x, p.y);
      }}>

      <div onMouseDown={() => onFocus?.()}
           className={`flex flex-col h-full bg-[#031525] border rounded
                      shadow-xl shadow-black/40 overflow-hidden
                      ${red ? "border-red-700/70" : "border-teal/30"}`}>
        {/* Barra de título (zona de arrastre) */}
        <div className={`fp-drag flex items-center justify-between gap-1 px-2
                        bg-[#021020] border-b cursor-move select-none
                        ${red ? "border-red-800/50" : "border-teal/20"}`}
             style={{ height: TITLE_H }}>
          <span onClick={onTitleClick}
                className={`text-[10px] font-bold uppercase truncate cursor-pointer flex-1
                           ${red ? "text-red-400" : "text-teal"}`}>
            {red && <Plane size={10} className="inline -mt-0.5 mr-1"/>}{title}
          </span>
          <span className="flex items-center gap-0.5 flex-shrink-0">
            <button onClick={onMin}
              className="fp-btn w-4 h-4 flex items-center justify-center rounded
                         text-gray-400 hover:text-white hover:bg-white/10 text-[11px] leading-none"
              title={minimized ? "Restaurar" : "Minimizar"}>▁</button>
            <button onClick={onMax}
              className="fp-btn w-4 h-4 flex items-center justify-center rounded
                         text-gray-400 hover:text-white hover:bg-white/10 text-[10px] leading-none"
              title={maximized ? "Restaurar" : "Maximizar"}>{maximized ? <Minimize2 size={9}/> : <Maximize2 size={9}/>}</button>
            <button onClick={onClose}
              className="fp-btn w-4 h-4 flex items-center justify-center rounded
                         text-gray-400 hover:text-white hover:bg-red-700/70 text-[11px] leading-none"
              title="Cerrar (minimizar a la izquierda)"><X size={11}/></button>
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
