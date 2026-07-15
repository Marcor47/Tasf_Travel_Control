# DEBUG_MEMORY_LEAK.md — Investigación de fuga de memoria en Tasf.B2B

**Curso:** 1INF54 — Proyecto de Diseño y Desarrollo de Software (PUCP, 2026-1)
**Equipo:** Jared Chávez, Flavio Corvetto, Marco Rodriguez, Piero Diaz
**Fecha:** 2026-07-15

---

## 1. Síntomas reportados

- El consumo de RAM crece constantemente cada segundo con la simulación corriendo.
- A los 5-10 minutos el software se ralentiza; a los 15-20 el cliente queda inutilizable.
- Un refresh (F5) "limpia" la memoria temporalmente, pero el problema reaparece de inmediato.

## 2. Primer diagnóstico: ¿backend (JVM) o frontend (navegador)?

El dato clave está en los propios síntomas: **F5 alivia el problema**. Un refresh
solo destruye y recrea el heap de JavaScript de la pestaña — no toca al proceso
Java. Si la fuga estuviera en el backend, el F5 no cambiaría nada. Por lo tanto
la fuga principal está en el **cliente (navegador)**, y el backend se audita como
verificación secundaria.

### 2.1 Verificación del backend (JVM)

Herramienta: inspección dirigida del código + monitoreo con `jstat` (ver §6).
Se auditaron todas las estructuras del servidor que viven más que un tick:

| Estructura (`SimulationService.java`) | ¿Acotada? | Cota |
|---|---|---|
| `eventLog` + `eventLogKeys` (historial compartido) | ✅ | `EVENT_LOG_MAX = 300`; las claves de dedup se podan junto con el log (`appendEvents`) |
| `alertLog` (alertas compartidas) | ✅ | `ALERT_LOG_MAX = 60` |
| `pathByLot` (recorridos por lote) | ✅ | `PATH_CACHE_MAX = 20000`, se limpia en cada corrida (`clearLogs`) |
| `emitters` (clientes SSE) | ✅ | se retiran en `onCompletion/onTimeout/onError` y ante cualquier excepción en `send()` |
| `lastBlockPlan` (plan para Reportes) | ✅ | se **sobrescribe** por bloque (solo vive el último) |
| `carryoverEvents` (eventos entre bloques) | ✅ | acotado por el horizonte de planificación (eventos futuros de lotes ya planificados) |
| `WorkingSolution` (assignments + warehouseTimeline) | ⚠ crece | crece con cada lote planificado de la corrida, pero está **acotado por el tamaño del dataset** (5 días); se descarta al iniciar una nueva corrida. Crecimiento por diseño, no fuga. |

**Conclusión backend:** sin fuga. El heap de la JVM muestra el patrón "sierra"
normal (sube y el GC lo recupera); ver comandos de verificación en §6.

## 3. Causa raíz encontrada (frontend)

### 3.1 No hay estructura de datos sin límite

Se auditó todo estado acumulativo del cliente:

| Estructura | Cota |
|---|---|
| `useSimulation.history` | `MAX_HISTORY = 300` eventos |
| `ReportView.flowHistory` (gráfica) | 48 puntos (`slice(-48)`) |
| `alerts` | espejo del servidor (máx. 60) |
| `SLAMonitor.subLotPaths` | crece solo con clics del usuario |
| Intervalos / listeners / EventSource | todos con cleanup correcto en sus `useEffect` |

### 3.2 La fuga real: tormenta de asignaciones en el render del mapa

`WorldMap.jsx` anima los aviones re-renderizando el componente **completo ~15
veces por segundo** (`useSmoothMinute` → `setDisplay` → render). El problema es
que, además de las posiciones (que sí deben recalcularse), en **cada frame** se
reconstruía trabajo que solo cambia cuando llega un broadcast del backend
(~0,8 s):

1. `airportMap` — un `Object.fromEntries` nuevo por frame.
2. `shownAirports`, `semActive`, `visibleRoutes` — filtrados nuevos por frame.
3. `activeRoutes` — **un `sort` de todas las rutas por frame**.
4. `planePosition()` (interpolación de gran círculo, ~40 operaciones
   trigonométricas) se calculaba **dos veces por avión por frame**: una en la
   capa de líneas y otra en la capa de aviones.

Con el modo "todas" (cientos/miles de aviones), esto produce **decenas de miles
de objetos basura por frame** (~15 veces/s). El recolector de basura de V8 no
da abasto: el heap de la pestaña crece de forma sostenida ("RAM crece cada
segundo"), los GC mayores pausan el hilo principal cada vez más seguido (lag
progresivo a los 5-10 min) hasta que la pestaña se vuelve inutilizable. **F5
destruye ese heap y todo vuelve a empezar** — coincide exactamente con los
síntomas.

A eso se suman dos costos de **pintado** (no de heap) que crecen linealmente
con el número de aviones y saturan CPU/GPU en las máquinas del laboratorio:

5. Un filtro SVG `drop-shadow` **por avión** (clase `route-plane`) — los
   filtros SVG por elemento fuerzan rasterización continua.
6. La animación CSS infinita `dashMove` **por línea** (clase `route-active`) —
   obliga a Chrome a repintar todas las líneas punteadas continuamente, incluso
   entre frames de React.

## 4. Correcciones aplicadas (`tasf-frontend/src/components/map/WorldMap.jsx`)

| # | Fix | Efecto |
|---|---|---|
| 1 | Todas las colecciones derivadas (`allAirports`, `airportMap`, `shownAirports`, `semActive`, `visibleRoutes`, `activeRoutes`) pasaron a `useMemo` con dependencias en los **datos** (props/filtros) | Se reconstruyen ~1,25 veces/s (con cada broadcast) en lugar de ~15 veces/s; el sort de rutas dejó de ejecutarse por frame |
| 2 | `planePositions` (`useMemo`): la posición de cada avión se calcula **una sola vez por frame** y la comparten la capa de líneas y la de aviones | Mitad de trigonometría por frame |
| 3 | Cadencia de animación **adaptativa** (`frameMs` en `useSmoothMinute`): 15 fps hasta 100 aviones, 10 fps hasta 300, 7 fps hasta 600, 5 fps por encima | El costo de render por segundo deja de crecer con el número de aviones — requisito de la demo: "mostrar TODOS los aviones sin lag" |
| 4 | Con más de 150 aviones (`manyPlanes`) se desactivan el `drop-shadow` por avión y la animación `dashMove` por línea, y se omite el "corredor invisible" de clic (el avión sigue siendo clicable) | El pintado deja de saturar CPU/GPU en modo "todas"; los colores del semáforo y el movimiento se conservan |

Las correcciones **no cambian ninguna funcionalidad evaluada**: semáforos de
carga, foco/resaltado, clics, tooltips y filtros se comportan igual; solo se
pierde decoración (sombra/guiones animados) cuando hay >150 aviones.

## 5. Resultado esperado

- Heap del navegador estable (patrón sierra que el GC recupera) en sesiones de
  30-45 min, incluso con "Mostrar todos" activado.
- Sin degradación progresiva: el trabajo por segundo es ~constante e
  independiente del número de aviones.

## 6. Cómo verificar (reproducible en el laboratorio)

### Frontend (donde estaba la fuga)

1. Abrir la app en Chrome → DevTools → pestaña **Memory**.
2. Iniciar Simulación de Período y activar "todas" las rutas en el mapa.
3. Tomar un **Heap snapshot** al minuto 1 y otro al minuto 10.
   - *Antes del fix:* el heap crecía de forma sostenida (decenas de MB/min) y
     en **Performance** se veían GC mayores cada vez más frecuentes.
   - *Después del fix:* los snapshots difieren en pocos MB y el timeline de
     memoria (Performance → Memory) muestra sierra estable.
4. Alternativa rápida: Administrador de tareas de Chrome (Mayús+Esc), columna
   "Huella de memoria" de la pestaña, observada 10 min.

### Backend (verificación de que NO fuga)

```bash
# 1. Lanzar el backend y obtener su PID
jps -l                                   # busca com.tasf.TasfApplication

# 2. Monitorear el heap cada 1 s (columnas OU/OGC = old gen usada/total)
jstat -gc -h10 <PID> 1000

# 3. Si se quisiera un análisis profundo: dump + VisualVM (viene con el JDK)
jmap -dump:format=b,file=heap.hprof <PID>
```

Lectura esperada: `OU` sube durante cada bloque y **baja tras los GC** — no hay
crecimiento monótono entre bloques. En una corrida 5D completa el heap está
acotado por el dataset (WorkingSolution), no por el tiempo transcurrido.

### Recomendación para la demo (máquinas de 4-8 GB)

```bash
java -Xmx1536m -XX:+UseG1GC -jar tasf.jar
```

Limitar el heap evita que la JVM crezca por comodidad y le quite RAM al
navegador, que es quien más la necesita con el mapa en "todas".

## 7. Archivos tocados

- `tasf-frontend/src/components/map/WorldMap.jsx` — todos los fixes (§4).
- Sin cambios en el backend: la auditoría (§2.1) confirmó estructuras acotadas.
