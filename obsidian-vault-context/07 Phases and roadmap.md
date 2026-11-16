---
tags: [prometeo, roadmap]
updated: 2026-11-16
---
# Phases and roadmap

- [x] **F0 – Base**: monorepo, uv + Vite, Agent SDK answering through the subscription (no API key) ✅
- [x] **F1 – Text brain**: `brain.py`, `agent.md`, `projects.py`, WebSocket chat, create and resume projects ✅
- [x] **F2 – Voice pipeline**: VAD in the browser → whisper → streamed Claude → Kokoro per sentence, with barge-in ✅
- [x] **F3 – Galaxy UI**: 5 views, audio-reactive 3D reactor with 4 states, nebula and stars ✅
- [x] **F4 – Skills and deliverables**: 4 skills, tabbed panel, copy and download `.md` ✅
- [x] **F4.5 – PROMETEO rebrand + UI**: new name, cosmic buttons, comet cursor, cursor interaction and ES/EN interface switch ✅ → [[06 UI Midnight Galaxy]]
- [x] **F4.6 – Settings and navigation**: navigation bar with routes, **Voces** view (listen and choose), **Ajustes** view (voice, CPU/GPU, Whisper, Claude model and effort, language), deleting projects, per-machine settings in `settings.local.json` ✅ → [[10 Implementation decisions]]
- [x] **F4.7 – Two agents**: fast interviewer (Sonnet) + deep Architect (Opus) in the background, MCP connection suggestions, Architect model and effort settings ✅ → [[03 Agent (agent.md)]]
- [x] **F4.8 – Local models and turn mode**: LM Studio models for any slot, manual turn mode (TERMINAR), more accurate Whisper ✅ → [[10 Implementation decisions]]
- [x] **F4.9 – FAQ view**: questions from `agent/faqs.md` answered with pre-recorded audio (hand recording or cached Kokoro) ✅ → [[10 Implementation decisions]]
- [x] **F4.10 – Startup animation**: darkness → heart ignites from the centre → stars in a wave → UI, with synthesized epic sound ✅ → [[06 UI Midnight Galaxy]]
- [x] **F4.11 – Agent manager**: EJECUTAR launches Claude Code with the prompt typed in a terminal inside the UI, live states, Prometeo as orchestrator, validation and mandatory English task notes, light-speed jump (merged into `master`) ✅ → [[12 Agent manager]]
- [ ] **F5 – Customisable voice**: Chatterbox (cloning). Already done: choosing the voice from the UI and a "test voice" button

## Measured latencies (Intel CPU, no GPU)
> [!info] With GPU (RTX 4060)
> Whisper `base` on GPU: ~0.03 s for a 4 s utterance (~0.34 s on that machine's CPU). Kokoro: ~0.14 s per sentence (~0.84 s on CPU).

| Step | Time |
|---|---|
| Greeting (fixed sentence) | ~1.5 s |
| STT whisper `base` (4 s utterance) | ~1 s |
| Prometeo's first word after a message | ~3.5–4 s |
| First word when asking for deliverables | ~4 s; the full file takes 20–40 s (before the two-agent split) |
| With two agents (RTX 4060, text) | First word 0.6–2.3 s; the handoff returns immediately; Opus `high` takes ~2 min for `plan.md` + `tareas.md` |

## Pending / ideas
- [x] Rename repo and vault · pushed to GitHub (public): https://github.com/manuelgraya/prometeo
- [ ] Check by ear how Kokoro pronounces «Prometeo»
- [ ] English voice (the EN switch only translates the interface)
- [ ] Update Figma: PROMETEO name, cosmic buttons, language switch
- [ ] Design views 04 · Conversación and 05 · Proyectos in Figma (already implemented in code)
- [x] Manual turn mode (TERMINAR button) as an alternative to hands-free
- [ ] Space bar as a shortcut for TERMINAR
- [ ] Measure local models (Qwen3.5 9B, Gemma 4 E4B) as interviewer: latency and tool use
- [ ] `exportar-a-obsidian` skill: copy the deliverables into this vault
- [ ] Final logo → [[09 Logo prompts]]
- [x] Kokoro on GPU via `onnxruntime-gpu` (~0.14 s vs ~0.84 s per sentence)
- [ ] Add the CUDA libraries and `onnxruntime-gpu` as an optional extra in `pyproject.toml` (currently installed by hand with `uv pip install`, see README)
- [ ] Design the Voces and Ajustes views in Figma
- [ ] Check by ear how the accented voices sound
- [x] Colour themes Original / Rosa in Ajustes → [[06 UI Midnight Galaxy]]
- [x] Whisper on GPU on Windows (CUDA DLLs) and cross-platform `prometeo` command → [[10 Implementation decisions]]
- [x] Single OS layer, tests, CI on Ubuntu + Windows, Windows installer and release v0.1.0 → [[10 Implementation decisions]]
- [ ] Test on a real Windows machine (or VM): installer one-liner, `claude login`, a spoken conversation with mic and speakers, deliverables written, Ctrl+C closes cleanly → [#3](https://github.com/manuelgraya/prometeo/issues/3)
- [ ] Optional API key mode (use `ANTHROPIC_API_KEY` when the user opts in; today it is always stripped) for friends who use PROMETEO → [#4](https://github.com/manuelgraya/prometeo/issues/4)
- [ ] Kokoro on GPU on Windows (`onnxruntime-gpu[cuda,cudnn]`), unverified → [#5](https://github.com/manuelgraya/prometeo/issues/5)
- [ ] Apply the theme before the JS loads (inline script in `index.html`) to avoid the Original flash on reload with Rosa
- [ ] Test the two agents by voice (so far only by text) and tune the Architect's spoken notice
- [ ] Consider switching the Architect's and skills' instructions to English (small token saving; templates and skill names stay Spanish) → [[10 Implementation decisions]]
- [ ] Agent manager on Windows: `claude` under ConPTY and the hooks' `curl` → [[12 Agent manager]]
- [ ] Measure the light-speed jump at 60 fps on real hardware
- [x] Merge `feature/gestor-agentes` into `master` (the branch no longer exists)
- [ ] Extend `agent/mcp-catalog.md` based on real projects
- [x] `/ws` checks Host and Origin like the agent WebSockets, and a malformed message no longer ends the session (2026-11-15) → [[01 Architecture]]
- [x] All projects in one Obsidian vault (`projects/` + `Proyectos.base`), shared `context.md` frontmatter, `context.md` → `prompts/` links fixed (2026-11-15) → [[05 Skills]]
- [x] `AGENTS.md` at the repo root: agents working on PROMETEO read this vault and update it in the same commit (2026-11-15)
- [ ] CI red on `master` since 2026-11-12: `scripts/smoke.py` expects a project in the `ready` message, but without a title it is created on the first message; and on Windows `test_version_nueva_copia_y_conserva_la_anterior` finds CRLF in a copied prompt
- [x] New-project greeting «Comencemos.» kept; `agent.md` «Introduction» changed to match (2026-11-16) → [[03 Agent (agent.md)]]
- [x] Code checks when the Architect finishes, fed back in the same session (2026-11-16) → [[03 Agent (agent.md)#Handoff to the Architect]]
- [x] Resuming a project: pending items from `context.md` in the interviewer's context and in the greeting (2026-11-16) → [[03 Agent (agent.md)#Resuming a project]]
- [x] `crear-prompt` for coding agents centred on the result, tested old vs new on 3 real conversations (2026-11-16) → [[10 Implementation decisions#Architect quality (2026-11-16)]]
- [ ] Parked: Forja validation based on running the prompt's done criteria (tests, build) instead of reading the diff → [[10 Implementation decisions#Architect quality (2026-11-16)]]
- [ ] An existing project's `prompt.md` has `## ` headings inside its «Prompt» section, so the Forja only passes the first lines: it gets fixed the next time the Architect writes that project, or by hand
- [x] Check the FAQ view in the browser, including the nav on mobile (2026-11-16)
- [x] UI scales with the window (rem + fluid root size), checked at 390×844, 1280×720, 1366×768, 1600×900, 1920×1080, 2560×1440 and 3840×2160; Forja header overlap and mobile layout fixed (2026-11-16) → [[10 Implementation decisions#Screen sizes and stopping vite (2026-11-16)]]
- [x] `prometeo run` no longer leaves vite on :5173 when the CLI is killed (2026-11-16)
- [x] README: what PROMETEO does and screenshots of its views in `docs/capturas/` (2026-11-16)
- [ ] Optionally record real answers in `agent/faqs-audio/` (e.g. with a cloned voice once F5 lands)
- [ ] Listen to the startup sound and tune it (volume `master.gain`, timeline `T`): checked visually and measured offline, not yet heard

Related: [[10 Implementation decisions]] · [[PROMETEO]]
