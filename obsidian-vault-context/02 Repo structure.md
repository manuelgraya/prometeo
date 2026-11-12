---
tags: [prometeo, repo]
updated: 2026-11-12
---
# Repository structure

Path: `~/Work/prometeo`

```
prometeo/
├── agent/                      # local Agent SDK plugin, named "prometeo"
│   ├── .claude-plugin/plugin.json
│   ├── agent.md                # INTERVIEWER: name, role, personality, method, questions, MCP, handoff
│   ├── arquitecto.md           # ARCHITECT: analyses what was gathered and writes the deliverables (Opus)
│   ├── mcp-catalog.md          # MCP servers the interviewer may recommend
│   ├── faqs.md                 # FAQ view: «## question» + answer, spoken with pre-recorded audio
│   ├── faqs-audio/             # optional hand-recorded answers, <id>.wav|mp3|ogg|m4a|webm (not created by default)
│   ├── voice.md                # DEFAULT voice (engine, voice, speed, language); configured: false
│   ├── modes/definir-voz.md    # first-time voice setup conversation
│   └── skills/                 # each skill = folder with SKILL.md → prometeo:<skill>
│       ├── crear-prompt/ · documentar-plan/ · desglosar-tareas/ · resumen-notas/ · contexto-vivo/
├── projects/                   # gitignored (PROMETEO_PROJECTS_DIR points elsewhere, for tests)
│   └── <YYYYMMDD-HHMMSS>-<name>/   # PROMETEO's side: never renamed (sessions are keyed by path)
│       ├── meta.json           # title, name (inner folder), dates, session_id + session_backend, repo (external code folder; null = <name>/)
│       ├── agentes.json        # Forja agents: version (prompt<N>|libre<K>), n, task, session_id, phase, validation, note
│       ├── prompts/prompt<N>/  # one folder per prompt version (old flat projects migrate to prompt1 when opened)
│       │   ├── brief.md        # latest brief from interviewer to Architect (hidden in the panel)
│       │   ├── conversacion.md # «**Tú** (hh:mm): …» / «**PROMETEO** (hh:mm): …»
│       │   └── plan.md · prompt.md · notas.md · tareas.md
│       └── <name>/             # THE USER'S PROJECT: can become a git repo with nothing of PROMETEO inside; default agent cwd
│           ├── code/           # the code
│           └── obsidian-vault/ # the project's own Obsidian vault (.obsidian/ included)
│               ├── context.md  # living context (skill contexto-vivo)
│               └── tasks/      # one English note per task done by an agent + index.md → [[12 Agent manager]]
├── backend/                    # Python 3.12, uv, FastAPI — app project (`[tool.uv] package = false`, no installable package)
│   ├── models/                 # kokoro-v1.0.onnx + voices-v1.0.bin (not versioned)
│   ├── cache/faqs/             # Kokoro-generated FAQ answers, <id>-<hash>.wav (not versioned)
│   ├── cache/agentes/          # per-agent --settings files: hooks, status line, theme dark-ansi (carry the token; not versioned)
│   ├── cache/usage.json        # last known Claude subscription usage (5 h / 7 d), from the agents' status line
│   └── app/
│       ├── main.py             # REST (/api/state, /api/settings, /api/voice, /api/voices/{id}/sample, DELETE /api/projects/{slug}, PUT /api/projects/{slug}/repo, /api/faqs, /api/faqs/{id}/audio, /api/agents…) + WebSockets /ws, /ws/agents, /ws/agents/{slug}/{version}; model reloading
│       ├── brain.py            # Claude Agent SDK: Brain (interviewer: streaming, resume, cancellation, MCP "prometeo" with encargar_entregables) + run_architect + validate_work (agent manager)
│       ├── speech.py           # faster-whisper (STT) + kokoro-onnx (TTS) on CPU/GPU (CUDA libs via plataforma.py), VOICES catalog, SAMPLE_TEXT
│       ├── config.py           # paths, env() with PROMETEO_* (fallback ORION_*), agent.md / arquitecto.md / mcp-catalog.md / voice.md / faqs.md (`load_faqs`), settings.local.json
│       ├── local.py            # LM Studio: list models, load with context, per-session env for local models
│       ├── agentes.py          # the Forja: Claude Code in a pty per agent (prompt<N> or libre<K>), star names, hooks → states, status line → usage, task cycle → [[12 Agent manager]]
│       ├── plataforma.py       # the only OS-aware module, stdlib only (also imported by bin/prometeo.py): processes/signals, console, launcher, install hints, CUDA libs, MIME types, Terminal (pty / ConPTY)
│       └── projects.py         # CRUD for projects/ (including delete), <name>/ layout + migration, prompt versions, vault, code_dir, agentes.json, repo
├── frontend/                   # Vite + React + TypeScript — package prometeo-frontend
│   └── src/
│       ├── App.tsx             # root: scene, intro, Nav, LangSwitch, ViewBoundary and the active view (Gestor lazy-loaded)
│       ├── routes.ts           # View union, AgentRef, parseHash / hashOf (#/… routes; manager is #/agentes/<slug>[/<version>])
│       ├── hooks.ts            # useToast (self-clearing toast) · usePlayback (one audio at a time)
│       ├── views/              # one screen per file: Bienvenida (Comenzar, Inicio) · Sesiones (DefinirVoz, Conversacion) · Paginas (Proyectos, Voces, Faqs) · Ajustes · Gestor · common.ts (SetReactor, pageReactor, reactorAt: screen point → reactor props)
│       ├── agents.ts           # agent manager client: agentKey, token, REST, useAgents() (list + Prometeo log over /ws/agents)
│       ├── warp.ts             # light-speed jump clock (EJECUTAR): warpSpeed() read by the scene; UI phases out → hidden → in; holds the reactor centred
│       ├── api.ts              # typed REST calls (incl. projects()) + playSample / playFaq, stopSample (one-off audio through the shared player)
│       ├── session.ts          # WebSocket, messages, reactor energy, microphone; audioPlayer() / unlockAudio() (shared player)
│       ├── intro.ts            # startup animation clock: timeline T, introState() read by the scene every frame
│       ├── i18n.ts             # ES/EN interface strings
│       ├── theme.ts            # colour themes (Original · Rosa): 3D scene and cursor palettes, useTheme / theme()
│       ├── index.css           # tokens per theme (html[data-theme]) and styles (cosmic buttons, cursor, navigation, pages, voices, settings)
│       ├── scene/Scene.tsx     # reactor + galaxy (react-three-fiber) + intro darkness mask + warp streaks
│       ├── audio/              # mic (VAD) · player · levels · introSound (synthesized intro sound)
│       └── ui/
│           ├── Agentes.tsx       # the Forja: back, list with (+), project picker, Claude usage, xterm.js terminal (theme palette)
│           ├── AgentControls.tsx # RunButton (LLEVAR A LA FORJA / EJECUTAR) and RepoField, used by the conversation (no xterm)
│           ├── Artifacts.tsx     # deliverables panel: PROYECTO dropdown (switches conversation; RepoField in its footer), .md tabs, copy/download icons, full-screen reader
│           ├── ProjectPicker.tsx # «PROYECTO Título ▾» project dropdown shared by the Forja and the conversation (no xterm)
│           ├── Chat.tsx          # SessionStatus · Caption · InputBar (AUTO|TURNOS switch, send, floating neon mic, action slot) · Transcript
│           ├── icons.tsx         # stroke SVG icons (currentColor): mic, send, copy, download, expand, chat, forge…
│           ├── controls.tsx      # Segmented · Row · Toast
│           ├── Orquestador.tsx   # constellation (Prometeo + named agents in orbit), Prometeo log, task cycle bar
│           ├── CosmicButton.tsx  # main cosmic button
│           ├── Intro.tsx         # startup animation orchestration + «TOCA PARA DESPERTAR» gate
│           ├── CometCursor.tsx   # comet cursor (canvas)
│           └── cosmic.ts         # cursor ↔ buttons interaction + cursorBus
├── settings.local.json         # this machine's settings (not versioned)
├── bin/
│   ├── prometeo.py             # CLI, stdlib only, run with `uv run --script`: run (default) · update · models · build · doctor · install · uninstall · path
│   ├── prometeo                # bash launcher (Linux/macOS) → prometeo.py; install symlinks it into ~/.local/bin
│   └── prometeo.cmd            # Windows launcher → prometeo.py; install writes a prometeo.cmd into %USERPROFILE%\.local\bin
├── run.sh · run.cmd            # compatibility shims → prometeo run (backend :8765 + frontend :5173; Vite accepts PROMETEO_BACKEND)
├── install.ps1                 # Windows installer (irm … | iex): uv if missing, latest release into %LOCALAPPDATA%\Prometeo, keeps user data; ASCII only
├── scripts/
│   ├── smoke.py                # smoke test: starts PROMETEO, fakes the mic over the WebSocket, checks files, MIME types and clean shutdown
│   └── empaquetar.py           # builds prometeo-windows.zip: git-tracked files (no vault, no .github) + frontend/dist + release.json
├── .github/workflows/          # ci.yml (Ubuntu + Windows) · release.yml (tag v* → release) · instalador.yml (README one-liner on Windows)
├── release.json                # only inside the release zip (gitignored): makes `prometeo run` serve dist from the backend on one port
├── .gitattributes              # fixed line endings: LF for bash/py, CRLF for .cmd/.ps1
└── README.md
```

Related: [[03 Agent (agent.md)]] · [[04 Voice (voice.md)]] · [[05 Skills]] · [[06 UI Midnight Galaxy]]
