# Frontend de PROMETEO

React + Vite + react-three-fiber. Se arranca con `prometeo` (o `npm run dev`) y se compila con `prometeo build`.

| Ruta | Qué hay |
|---|---|
| `src/App.tsx` | Raíz: escena 3D, intro, navegación y la vista activa |
| `src/routes.ts` | Vistas y su ruta en el hash (`#/inicio`, `#/conversacion/<slug>`…) |
| `src/views/` | Una pantalla por archivo (o un grupo pequeño): `Bienvenida`, `Sesiones` (definir voz y conversación), `Paginas` (proyectos, voces, FAQ), `Ajustes`, `Gestor` (se carga bajo demanda: trae xterm.js) |
| `src/ui/` | Piezas compartidas: `Chat` (estado, subtítulo, transcripción, entrada), `Artifacts`, `controls` (Segmented, Row, Toast), el gestor de agentes (`Agentes`, `Orquestador`, `AgentControls`) y los efectos (`CometCursor`, `Intro`, `cosmic`) |
| `src/hooks.ts` | `useToast` y `usePlayback` (un audio a la vez) |
| `src/session.ts` | WebSocket de la sesión de voz/texto con el backend |
| `src/api.ts`, `src/agents.ts` | REST del backend y del gestor de agentes (este, con token) |
| `src/scene/`, `src/audio/` | Reactor 3D y audio (micrófono con Silero VAD, reproductor) |
| `src/i18n.ts`, `src/theme.ts` | Textos ES/EN de la interfaz y temas de color |

`npm run lint` (oxlint) y `npm run build` (incluye `tsc -b`) son los mismos pasos que la CI.
