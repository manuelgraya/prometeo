---
tags: [prometeo, roadmap]
updated: 2026-11-10
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
- [ ] Test on a real Windows machine (or VM): installer one-liner, `claude login`, a spoken conversation with mic and speakers, deliverables written, Ctrl+C closes cleanly
- [ ] Optional API key mode (use `ANTHROPIC_API_KEY` when the user opts in; today it is always stripped) for friends who use PROMETEO
- [ ] Kokoro on GPU on Windows (`onnxruntime-gpu[cuda,cudnn]`), unverified
- [ ] Apply the theme before the JS loads (inline script in `index.html`) to avoid the Original flash on reload with Rosa
- [ ] Test the two agents by voice (so far only by text) and tune the Architect's spoken notice
- [ ] Consider switching the Architect's and skills' instructions to English (small token saving; templates and skill names stay Spanish) → [[10 Implementation decisions]]
- [ ] Extend `agent/mcp-catalog.md` based on real projects
- [ ] Check the FAQ view in the browser (not visually reviewed yet), especially the 5-item nav on mobile
- [ ] Optionally record real answers in `agent/faqs-audio/` (e.g. with a cloned voice once F5 lands)
- [ ] Listen to the startup sound and tune it (volume `master.gain`, timeline `T`): checked visually and measured offline, not yet heard

Related: [[10 Implementation decisions]] · [[PROMETEO]]
