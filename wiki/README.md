# Wiki interna — Tasf.B2B

> **Uso:** referencia local del repositorio (ignorada por git). Leer al inicio de
> cada sesión de trabajo con Claude Code para mapear dónde vive cada cosa antes
> de tocar código. Mantener actualizada al hacer cambios estructurales.

**Proyecto:** sistema de gestión de traslado de equipajes extraviados con
planificación de rutas (ALNS) y visualización en tiempo real.
**Curso:** 1INF54 — Proyecto de Diseño y Desarrollo de Software, PUCP 2026-1.
**Equipo:** Jared Chávez, Flavio Corvetto, Marco Rodriguez, Piero Diaz.

## Páginas

| Página | Contenido |
|---|---|
| [backend.md](backend.md) | Spring Boot: SimulationService (el corazón), planner ALNS, endpoints, SSE, modos de simulación, detección de colapso |
| [frontend.md](frontend.md) | React/Vite: páginas, paneles, hook useSimulation, mapa (WorldMap), relojes, modales |
| [convenciones-y-trampas.md](convenciones-y-trampas.md) | Semántica de tiempos y almacén, unidades engañosas, trampas del repo al editar |
| [registro-de-cambios.md](registro-de-cambios.md) | Bitácora de cambios por sesión y **problemas conocidos pendientes** |

## Estructura del repo

```
Tasf_Travel_Control/
├── ComandosEjecución.txt      # cómo levantar backend y frontend
├── DEBUG_MEMORY_LEAK.md       # investigación de memoria (2026-07-15)
├── wiki/                      # esta wiki (gitignored)
├── tasf/                      # BACKEND Spring Boot (Maven)
│   ├── src/main/java/com/tasf/
│   │   ├── api/               # SimulationService (~2400 líneas), SimulationController, Health
│   │   └── planner/           # alns/ core/ model/ repository/
│   ├── data/envios/           # dataset de envíos por aeropuerto (desde 2026-01-02)
│   └── *.csv, simulacion_diaria.txt   # SALIDAS de experimentos (se regeneran, no tocar)
└── tasf-frontend/             # FRONTEND Vite + React (Tailwind)
    └── src/
        ├── pages/             # Dashboard, RegisterLot, LiveMonitor, ReportView, HistoryView
        ├── components/        # map/WorldMap, panels/*, modals/*, layout/*
        ├── hooks/useSimulation.js   # TODO el estado del cliente (SSE + fetch)
        └── data/staticAirports.js
```

## Levantar el proyecto

```bash
# Backend (tasf/)
./mvnw clean compile
./mvnw spring-boot:run        # → http://localhost:8080

# Frontend (tasf-frontend/, otra terminal)
npm install --legacy-peer-deps
npm run dev                   # → http://localhost:5173
npm run build                 # validación (chunk >500 kB es warning preexistente)
```
