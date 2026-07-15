# Frontend — Vite + React (`tasf-frontend/`)

## Flujo de estado

**TODO el estado del cliente nace en `hooks/useSimulation.js`** (instanciado una
sola vez en `App.jsx` y pasado por props a todas las páginas):

- Conexión **SSE** a `/api/simulation/events` con reconexión automática (3 s).
  Eventos: `state` (reemplaza el estado), `history` (backlog al conectar),
  `alerts` (lista compartida del servidor).
- `history`: acumulado cliente acotado a `MAX_HISTORY=300` (dedup por `evKey`).
- Acciones: `start/stop/pause/resume`, `addLot`, `cancelFlight`, `addFlight`,
  `addAirport`, `editAirport/editFlight`, `deleteAirport/deleteFlight`,
  `closeAirport`, `uploadData`, fetchers (`fetchShipmentPath(s)`,
  `fetchFlightLots`, `fetchLastBlockPlan`).

### Relojes (esquina inferior derecha del mapa, en Dashboard)

- `Hora sim.` = `state.clock` del backend.
- `Sim. transc.` = `simulatedNow − simStartMinute`; **`simStartMinute` es el
  mínimo `simulatedMinute` observado**, persistido en localStorage
  (`tasf.simStartMinute`) para sobrevivir a F5. ⚠ BUG conocido pendiente:
  ver [registro-de-cambios.md](registro-de-cambios.md).
- `Real transc.` = `realSeconds` (contador +1 s, congelado en pausa, persistido
  en `tasf.realSeconds`).
- Pausa = `state.message === "Pausado"` (no hay flag dedicado).

## Rutas (`App.jsx`)

| Ruta | Página | Nota |
|---|---|---|
| `/` `/periodo` `/colapso` | `Dashboard` (prop `mode`) | misma página, 3 modos |
| `/registro` | `RegisterLot` | ingesta/edición de datos (Día a Día) |
| `/monitoreo` | `LiveMonitor` | alertas compartidas |
| `/reportes` | `ReportView` | KPIs, gráfica (48 puntos máx), plan del último bloque |
| `/historial` | `HistoryView` | historial + planificados |

## Dashboard (`pages/Dashboard.jsx`)

- Paneles FLOTANTES sobre el mapa (`ALL_PANELS`: resumen, almacenes, vuelos,
  envíos, sla, cancelaciones) vía `FloatingPanel`; arrancan minimizados en
  columna izquierda. ⚠ No cambiar posición y tamaño a la vez (react-draggable
  + React 19 se rompe).
- Foco compartido: `focusCodes/pinnedCodes/selectedRouteKey/selectedShipment`
  filtran mapa Y paneles a la vez.
- Modales: `CollapseAlert` (colapso, mensaje multilínea del backend,
  `whitespace-pre-line`) y `SimulationEndAlert` (fin de período; se dispara con
  la transición running→false + mensaje EXACTO `"Simulación finalizada"`,
  guard `prevRunningRef` contra recargas).

## Paneles (`components/panels/`)

| Panel | Archivo | Nota |
|---|---|---|
| Vuelos | `FlightsCapacity.jsx` | lista activos (slice 80), planificados (60), historial (40), pestaña Carga por vuelo (`fetchFlightLots`) |
| Almacenes | `WarehouseCapacity.jsx` + `StorageMovements.jsx` + `StorageFilterBar.jsx` | filtro texto+semáforo compartido con el mapa |
| Envíos/SLA/Resumen | `SLAMonitor.jsx` | UNA componente con prop `view` |
| Cancelar vuelo | `FlightCancelPanel.jsx` | |

## Mapa (`components/map/WorldMap.jsx`)

- `react-simple-maps`, proyección Mercator, viewBox 800×600.
- **Animación**: `useSmoothMinute` interpola `simulatedMinute` con rAF y
  fps ADAPTATIVO (15 fps ≤100 aviones → 5 fps >600) — cada `setDisplay`
  re-renderiza el mapa completo, por eso el fps se limita.
- **Optimización 2026-07-15** (fix del "memory leak" del cliente): colecciones
  derivadas (`airportMap`, `shownAirports`, `semActive`, `visibleRoutes`,
  `activeRoutes`) memoizadas con `useMemo` (solo cambian con broadcast/filtros,
  no por frame); `planePositions` calcula el gran círculo UNA vez por
  avión/frame (compartido líneas+aviones); con >150 aviones (`manyPlanes`) se
  desactivan drop-shadow, animación de guiones y corredor invisible de clic.
- Límite de dibujo: modo "limited" = 50 aviones (botón "≤50 rutas"/"todas").
- Capas de aeropuertos/etiquetas memoizadas con handlers estables (`cbRef`).
- Semáforos: verde ≤60% < ámbar ≤85% < rojo; gris = vacío. Igual en paneles.

## Convención de la API

`API_BASE = import.meta.env.VITE_API_BASE || ""` (proxy de Vite en dev).
