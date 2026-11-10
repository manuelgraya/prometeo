---
tags: [prometeo, repo]
updated: 2026-11-10
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
│       ├── crear-prompt/ · documentar-plan/ · desglosar-tareas/ · resumen-notas/
├── projects/
│   └── <date-slug>/
│       ├── meta.json           # title, dates, session_id + session_backend (older projects may still have architect_session_id, unused)
│       ├── brief.md            # latest brief from interviewer to Architect (hidden in the panel)
│       ├── conversacion.md     # «**Tú** (hh:mm): …» / «**PROMETEO** (hh:mm): …»
│       └── plan.md · prompt.md · notas.md · tareas.md
├── backend/                    # Python 3.12, uv, FastAPI — package prometeo-backend
│   ├── models/                 # kokoro-v1.0.onnx + voices-v1.0.bin (not versioned)
│   ├── cache/faqs/             # Kokoro-generated FAQ answers, <id>-<hash>.wav (not versioned)
│   └── app/
│       ├── main.py             # REST (/api/state, /api/settings, /api/voice, /api/voices/{id}/sample, DELETE /api/projects/{slug}, /api/faqs, /api/faqs/{id}/audio) + WebSocket /ws; model reloading
│       ├── brain.py            # Claude Agent SDK: Brain (interviewer: streaming, resume, cancellation, MCP "prometeo" with encargar_entregables) + run_architect
│       ├── speech.py           # faster-whisper (STT) + kokoro-onnx (TTS) on CPU/GPU (CUDA libs via plataforma.py), VOICES catalog, SAMPLE_TEXT
│       ├── config.py           # paths, env() with PROMETEO_* (fallback ORION_*), agent.md / arquitecto.md / mcp-catalog.md / voice.md / faqs.md (`load_faqs`), settings.local.json
│       ├── local.py            # LM Studio: list models, load with context, per-session env for local models
│       ├── plataforma.py       # the only OS-aware module, stdlib only (also imported by bin/prometeo.py): processes/signals, console, launcher, install hints, CUDA libs, MIME types
│       └── projects.py         # CRUD for projects/ (including delete)
├── frontend/                   # Vite + React + TypeScript — package prometeo-frontend
│   └── src/
│       ├── App.tsx             # #/… routes, Nav and views: Comenzar · DefinirVoz · Inicio · Proyectos · Voces · Ajustes · Faqs · Conversación
│       ├── api.ts              # typed REST calls + playAudio → playSample / playFaq, stopSample (one-off audio through the shared player)
│       ├── session.ts          # WebSocket, messages, reactor energy, microphone; audioPlayer() / unlockAudio() (shared player)
│       ├── intro.ts            # startup animation clock: timeline T, introState() read by the scene every frame
│       ├── i18n.ts             # ES/EN interface strings
│       ├── theme.ts            # colour themes (Original · Rosa): 3D scene and cursor palettes, useTheme / theme()
│       ├── index.css           # tokens per theme (html[data-theme]) and styles (cosmic buttons, cursor, navigation, pages, voices, settings)
│       ├── scene/Scene.tsx     # reactor + galaxy (react-three-fiber) + intro darkness mask
│       ├── audio/              # mic (VAD) · player · levels · introSound (synthesized intro sound)
│       └── ui/
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
