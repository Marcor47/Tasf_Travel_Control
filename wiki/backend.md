# Backend — Spring Boot (`tasf/`)

Casi toda la lógica vive en **`api/SimulationService.java`** (~2400 líneas).
Buscar por NOMBRE DE MÉTODO, no por número de línea (se desplazan con cada cambio).

## Modos de simulación

| Modo | Método | Descripción |
|---|---|---|
| `diadia` | `runRealtimeDiaDia()` | Pizarra en blanco: usa lo cargado en `staged*` (no el dataset), reloj REAL UTC (1 min sim = 1 min real). Termina al acabar el día o por colapso. |
| `periodo` | `runSimulation()` | 5 días del dataset por bloques de `BLOCK_HOURS=3` h; cada bloque se anima en `BLOCK_REAL_SECONDS=45` s reales (~30 min los 5 días). |
| `colapso` | `runSimulation()` | Igual que periodo pero `daysToLoad=0` (hasta el final del dataset) y con detección SLA activa — corre "hasta el colapso". |

## El bucle de bloques (`runSimulation`)

1. Carga contexto (aeropuertos, vuelos) y calcula ventana de días desde `startDate`.
2. Por bloque: `submitBlockWork` precalcula el SIGUIENTE bloque en background
   (executor `lookahead`) mientras el actual se anima.
3. Bucle interno de animación (tick cada `BROADCAST_INTERVAL_MS=800` ms):
   - avanza `simulatedNow` interpolando tiempo real → simulado,
   - drena colas de mutación (`pendingCancellations/Additions/FlightAdds/AirportAdds/AirportCloses`),
   - emite eventos (`departed`/`landed`) cuyo minuto llegó,
   - construye `AirportState`/`Kpis`/`UpcomingFlight` y **evalúa colapso**,
   - `broadcast(state)` a todos los clientes SSE.
4. Al detectar colapso: `break` INMEDIATO (irreversible, ver abajo).
5. Carryover entre bloques: aviones en el aire + TODOS los eventos futuros.
6. Al terminar: `running=false` + mensaje `"Simulación finalizada"` (señal exacta
   que usa el frontend para el modal de fin de período).

## Detección de colapso (fix 2026-07-15)

- **`buildCollapseDetail(airports, solution, visibleLots, context, simulatedNow, checkSla)`**
  — punto ÚNICO de detección. Devuelve mensaje multilínea con causa raíz o `null`.
  Prioridad: **A** almacén excedido (todos los modos) → **B** capacidad de vuelo
  excedida vía `WorkingSolution.overloadedFlights()` (todos los modos) → **C** SLA
  incumplible (solo `checkSla=true`, modo colapso).
- El colapso es **IRREVERSIBLE**: el bucle emite el estado con `collapsed=true` y
  hace `break` en el mismo tick (antes seguía hasta fin de bloque y podía
  "revivir"). `nextFuture.cancel(true)` libera el bloque precalculado.
- El bucle diadia usa el mismo helper (sin causa C).

## Planner (`planner/`)

| Paquete | Clases | Rol |
|---|---|---|
| `core` | `PlanningContext` | aeropuertos + vuelos + config; mutable en caliente (addFlight/closeAirport) |
| | `WorkingSolution` | asignaciones lote→plan, `residualCapacity` por vuelo, `warehouseTimeline` (TreeMap de deltas por aeropuerto). `canAssign`/`assign`/`remove`. `overloadedFlights()` = residuales negativos |
| | `RouteEvaluator` | enumera rutas candidatas por lote; calcula tardiness/score |
| | `ScenarioConfig` | pesos/penalidades (defaultWeek4) |
| `alns` | `ALNSPlanner` | metaheurística por bloque (budget `ALNS_TIME_BUDGET_SEC=25` s) |
| `model` | `Airport, FlightInstance, BaggageLot, RoutePlan, RouteSegment` | ⚠ campos `*Hours` están en MINUTOS (ver convenciones) |
| `repository` | `AirportRepository, FlightRepository, ShipmentRepository` | carga del dataset `data/` |

## SSE y estado compartido

- `subscribe()` → eventos SSE: `state` (cada tick), `history` (backlog al
  conectar), `alerts` (lista completa al cambiar).
- Acotados: `eventLog` (`EVENT_LOG_MAX=300`, claves dedup podadas juntas),
  `alertLog` (60), `pathByLot` (20000, limpiado por corrida con `clearLogs`).
- Emitters muertos se retiran en `send()`/callbacks — sin fugas (auditado 2026-07-15,
  ver `DEBUG_MEMORY_LEAK.md`).
- `state` es un campo `volatile` que PERSISTE entre corridas (los records
  `SimulationState.with*` lo clonan).

## Endpoints (`SimulationController`, base `/api/simulation`)

- Ciclo: `POST start|stop|pause|resume`, `GET state|events (SSE)`
- Datos: `GET availableDates|flights|prepStatus|lastBlockPlan|shipmentPath|shipmentPaths|flightLots`
- Mutación en caliente: `POST cancelFlight|addLot|addFlight|addAirport|closeAirport|editAirport|editFlight|deleteAirport|deleteFlight|uploadData|evaluateLot|resetPrep`
- `GET /health` en `HealthController`.

## Constantes de velocidad (único punto de ajuste)

`BLOCK_HOURS=3`, `BLOCK_REAL_SECONDS=45` (periodo/colapso),
`DIADIA_BLOCK_SECONDS=113`, `BROADCAST_INTERVAL_MS=800`,
`ALNS_TIME_BUDGET_SEC=25`, sub-lotes: `MAX_BAGS_PER_SUBLOT=150`, `SUBLOT_MIN_CHUNK=25`.
