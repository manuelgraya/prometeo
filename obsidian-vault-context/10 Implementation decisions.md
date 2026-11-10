---
tags: [prometeo, decisions]
date: 2026-11-09
updated: 2026-11-10
---
# Implementation decisions

Changes from the initial plan, decided while building and measuring:

| Topic | Initial plan | Implemented | Why |
|---|---|---|---|
| Claude model | Default (Opus) | **Sonnet 5.5, effort `low`** (`PROMETEO_MODEL`) | Opus took 4–30 s to the first word; Sonnet ~1 s. Critical in a voice conversation |
| VAD (voice detection) | Silero in the backend | **Silero in the browser** (`@ricky0123/vad-web`) | Instant barge-in; the backend receives complete utterances |
| TTS | Kokoro (PyTorch) | **kokoro-onnx** | No PyTorch, lighter on CPU |
| STT | whisper `small` | **whisper `base`** (`PROMETEO_WHISPER_MODEL`) | Same quality in tests: 1 s vs 3 s |
| Project title | Claude tool | **Haiku in parallel** | The tool delayed the first word |
| Skills | `.claude/skills` with a symlink | **`agent/` as a local SDK plugin** (`prometeo:crear-prompt`, …) | Keeps the `agent/skills/` layout without symlinks |

## Rebrand ORION → PROMETEO (2026-11-09)
| Topic | Decision | Why |
|---|---|---|
| Name in spoken text | «Prometeo» (not upper case) in `agent.md`, `definir-voz.md` and the greeting | Stops Kokoro spelling it out; the UI wordmark stays upper case |
| Identifiers | Plugin and MCP `prometeo` → `prometeo:<skill>`, `mcp__prometeo__*`; packages `prometeo-backend` / `prometeo-frontend` | Consistency with the new name |
| Environment variables | `PROMETEO_*`, with `ORION_*` as fallback (`config.env()`) | Don't break existing setups |
| Old projects | The parser accepts `**ORION**` and `**PROMETEO**`; they aren't rewritten | Previous transcripts still load |
| Message role in the frontend | `'orion'` → `'agent'` | Independent of the agent's name |
| Folders | Repo (`~/Work/orion`) and vault (`~/Documentos/ORION`) not renamed by code | Renamed by hand |
| i18n | UI only, no library; voice stays Spanish | STT, TTS and agent are tuned for Spanish |
| Cursor / buttons | Plain canvas + CSS, no animation libraries | Light on the Iris Xe, which already drives the 3D reactor |

Commits: `836cc8d` rebrand · `aa99c18` buttons, comet and interaction · `d82dc83` language switch. Prompt used: [[11 Prometeo rebrand prompt]].

## Local settings, voice catalog and GPU (2026-11-09)
Reason: on the first run on another computer **the voice setup didn't appear**. Cause: `agent/voice.md` was committed with `configured: true`.

| Topic | Before | Now | Why |
|---|---|---|---|
| Where the chosen voice lives | `agent/voice.md` (versioned) | `settings.local.json` at the root, in `.gitignore`. `voice.md` stays as the default with `configured: false` | Each machine does its own first-time setup and personal preferences aren't pushed |
| Model settings | Only `PROMETEO_MODEL`, `PROMETEO_EFFORT`, `PROMETEO_WHISPER_MODEL` env vars | **Ajustes** view + `PUT /api/settings`. Env vars remain the defaults | Change them without restarting or editing files |
| CPU / GPU | Everything on CPU | `tts_device` and `stt_device` (`cpu` · `cuda`) separately | The new machine has an RTX 4060 |
| Switching device | — | The model reloads in the background; the old one keeps serving until the new one is ready | No interruptions mid-conversation |
| If the GPU fails | — | Falls back to CPU and stores the reason (`runtime.*.error`), shown in Settings | Missing CUDA libraries must not break the voice |
| CUDA libraries | — | pip packages `nvidia-cublas-cu12` + `nvidia-cudnn-cu12` in the venv, loaded via `ctypes` (`_preload_cuda_libs`) | No system-wide CUDA install, no `LD_LIBRARY_PATH` tweaks |
| Kokoro on GPU | — | Own ONNX session (`Kokoro.from_session`) with `CUDAExecutionProvider` when available; `onnxruntime-gpu[cuda,cudnn]==1.31.1` installed **on top of** `onnxruntime` (same version), ONNX log level 3 to hide harmless Memcpy warnings | `kokoro-onnx` requires `onnxruntime` and `uv run` would reinstall it if removed, so both stay; re-run the install if `onnxruntime` is upgraded. Needs a CUDA 13 driver |
| Voices | 3 native | 3 native + 6 accented (it, pt, fr) | More timbres; labelled as accented |
| Navigation | Only wordmark → Inicio and the `#view=` shortcut | **Inicio · Proyectos · Voces · Ajustes** bar and `#/view[/slug]` routes with `pushState` | Browser back/forward buttons work |
| ES/EN switch | Next to the wordmark | In **Ajustes → Interfaz**, and in the header fixed **top right**, with the status shifted left of it (`5bf890e`, 2026-11-09) | Its slot by the wordmark went to navigation; top right keeps it reachable from every view without crowding the nav. Mobile layout stacks status and toasts below it |
| Deleting projects | Didn't exist | Trash button on each card, in-card confirmation and `DELETE /api/projects/{slug}` | No browser `confirm()`; `project_dir()` prevents escaping `projects/` |
| Model locks | — | One lock for STT, one for TTS | Loading Whisper doesn't block the voice |

Measured on the RTX 4060: Whisper `base`, 4 s of audio: **~0.03 s on GPU** vs **~0.34 s on CPU**. Kokoro, one ~12-word sentence: **~0.14 s on GPU** vs **~0.84 s on CPU**.

## Two agents: interviewer + Architect (2026-11-09)
Reason: with a single agent you had to choose between **speaking fast** (Sonnet) and **plan depth** (Opus).

| Topic | Before | Now | Why |
|---|---|---|---|
| Agents | One: Sonnet converses and writes deliverables | **Interviewer** (Sonnet `low`) converses; **Architect** (Opus `high`) writes deliverables | Fast voice and deeply thought-out deliverables |
| How work is handed off | The agent invoked the skill inside its turn | MCP tool `encargar_entregables` returns immediately; the backend launches `run_architect` as a separate task | An SDK subagent (`agents=`) would block the voice turn for 1–2 min and barge-in would cancel it |
| Architect context | — | `brief.md` (interviewer's summary) + full `conversacion.md`, which wins on conflicts | The brief is quick to read; the transcript keeps details from getting lost |
| Sessions | `session_id` | Interviewer resumes `session_id`; the Architect starts a **fresh session per job** (see [[#Architect token usage (2026-11-10)]]) | Resuming the Architect was the main source of subscription usage |
| "Done" notice | — | `architect` + `artifacts` events; spoken notice via `say()` only if nobody is talking; otherwise a `[sistema: …]` note on the next message | `say()` bumps the turn and would cut the audio of a turn in progress |
| MCP connections | — | The interviewer suggests servers from `agent/mcp-catalog.md`; the Architect includes them in `plan.md` and `prompt.md` | Useful recommendations without the fast model inventing names |
| Settings | `claude_model`, `effort` | Plus `architect_model` (`sonnet` · `opus`) and `architect_effort` (`medium`…`max`); env vars `PROMETEO_ARCHITECT_MODEL`, `PROMETEO_ARCHITECT_EFFORT` | The old keys still mean the interviewer: saved settings don't break |
| Prompt and skill language | Spanish | **Kept in Spanish** | English saves ~15–30 % tokens, but the prompts are short and cached, the subscription is used (limits, not money), and translating risks English answers that Kokoro would read; the frontend uses the skill names |

Tested against a test backend on `:8799` over WebSocket (text): see latencies in [[07 Phases and roadmap]]. Interrupting during a handoff doesn't stop the Architect.

## Architect token usage (2026-11-10)
Measured: one project with 4 small re-handoffs (e-mail domain, filter word…) used ~1.17M Opus cache-write tokens in ~20 active minutes, ~45 % of a session's limit. Each re-handoff resumed the Architect session, so its context grew with every previous full rewrite (160k → 244k → 327k input tokens per call), the cache missed on every job, and Opus rewrote the whole `prompt.md` (~9k output tokens) each time.

| Topic | Before | Now | Why |
|---|---|---|---|
| Architect session | `resume=architect_session_id` | **Fresh session per job**; `architect_session_id` is no longer written | Everything it needs is on disk (`brief.md`, `conversacion.md`, existing deliverables); a fresh run costs a fraction and caches well inside the job |
| Updating deliverables | Rewrote the file with Write | The task lists which deliverables already exist and asks for targeted `Edit`s; `arquitecto.md` rule 5 says the same | Less output and no lost details |
| Brief | Written to `brief.md` and also sent in the task, and the Architect was told to read `brief.md` | Sent in the task only; `brief.md` is still saved for reference | Avoids reading it twice |
| claude.ai connectors | The CLI injected the account's claude.ai connectors (Figma, OpenArt, Drive, Claude Docs, Google Docs: 86 tools + instructions, ~200 KB) into every session after the first call, even with `setting_sources=[]` | `local.prepare()` always passes `ENABLE_CLAUDEAI_MCP_SERVERS=false` in the per-session `env` (`NO_CLAUDEAI_MCP`) | They were ~70k of the Architect's ~76k per job and ~70k of the interviewer's first call, and arriving mid-session they changed the prompt and broke the cache (only ~3.6k reused). Haiku test: 2nd call went from 13.9k written / 1.3k read to 87 written / 2k read |
| Handoff while a job runs | Refused («ya está trabajando») and the interviewer re-handed later | Queued in `_pending` (`main.py`): deliverables merged, latest brief wins, runs right after the current job; only the last job is announced | Bursts of corrections become one extra job instead of several |

Related: [[03 Agent (agent.md)]]

## Linux and Windows (2026-11-10)
The backend was already portable (UTF-8 file I/O, `pathlib`, timestamped slugs that can't hit Windows reserved names). Two things blocked Windows:

| Topic | Before | Now | Why |
|---|---|---|---|
| Whisper on GPU | `_preload_cuda_libs()` only loaded `nvidia/*/lib/*.so` | On Windows it adds every `nvidia/*/bin` with `os.add_dll_directory` and to `PATH` (PR #2, `0b65d0c`) | The pip `nvidia-*` packages put DLLs in `bin/`; ctranslate2 failed with `cublas64_12.dll is not found` and fell back to CPU. Tested on Windows 11 + RTX 3050, `large-v3-turbo`: ~0.7 s per sentence |
| `prometeo` command | bash script (`ss`, `xdg-open`, `ln -s`, `trap`, `curl`, `sed`) | `bin/prometeo.py`, stdlib only, launched by `bin/prometeo` (bash) and `bin/prometeo.cmd` with `uv run --script`; `run.cmd` next to `run.sh` (`8a9d632`) | One implementation for every OS instead of bash + PowerShell copies that drift; uv is already required and brings its own Python |
| Stopping `run` | `trap kill` on the backend | Backend in its own session/process group, killed as a tree (`os.killpg` on POSIX, `taskkill /T /F` on Windows); vite stays in the terminal's group on Linux (reads its keys, gets Ctrl+C); a second Ctrl+C is ignored during shutdown; if the backend dies, `run` warns, stops vite and exits 1 | `terminate()` only kills `uv`/`npm` and leaves uvicorn/vite holding the ports; on Windows `Popen.wait()` blocks Ctrl+C, so it polls with `sleep` |
| Output encoding | — | CLI reconfigures stdout to UTF-8; children get `PYTHONUTF8=1` | The Windows console is cp1252: ✓ ▸ ✗ and Spanish accents would crash |
| `install` | Symlink in `~/.local/bin` | Same on Linux; on Windows a one-line `prometeo.cmd` in `%USERPROFILE%\.local\bin` (where uv installs itself, so it is usually on `PATH`) | Symlinks on Windows need admin or Developer Mode |
| Line endings | — | `.gitattributes`: LF for `bin/prometeo`, `*.sh`, `*.py`; CRLF for `*.cmd` | A Windows clone with `autocrlf` would break the bash launcher, and `.cmd` needs CRLF |

Other replacements: `ss` → socket connect to 127.0.0.1 and ::1, `xdg-open` → `webbrowser`, `curl` → `urllib` (still `.part` + rename), version read with `tomllib`, Claude session looked up under `CLAUDE_CONFIG_DIR` or `~/.claude`. Tested on Linux only (every subcommand, Ctrl+C cleanup, backend crash); **not yet run on a real Windows machine**.

## One Prometeo to the user (2026-11-10)
The two-agent split stays in the backend, but the user only ever meets **Prometeo**: talking about «el Arquitecto» took personality away from it.

| Where | Change |
|---|---|
| `agent/agent.md` | The interviewer never mentions another agent, model or «Arquitecto», even if asked how it works; always first person («lo preparo», «ya lo tienes»). `[sistema: …]` notes are described as its own background work |
| `agent/arquitecto.md` | The final spoken sentence is written in first person as Prometeo, never naming the Architect |
| `agent/faqs.md` | «¿Cómo funcionas?» no longer says «somos dos» (its Kokoro audio regenerates because the text hash changes) |
| Tool texts (`brain.py`, `main.py`) | Handoff description, queue and error messages no longer name the Architect, so the interviewer can't repeat it |
| UI (`i18n.ts`) | Chat labels: «Preparando entregables», «Prometeo está elaborando los entregables…», «Prometeo no pudo terminar los entregables». Settings: «Modelo para conversar», «Modelo para los entregables», «Esfuerzo en los entregables» (same keys, EN too) |

Internally (code, `arquitecto.md`, this vault) the name «Architect» is kept.

## Home buttons and comet cursor (2026-11-09)

| Topic | Before | Now | Why |
|---|---|---|---|
| Home labels | Fixed **START** and **OPEN PJ.** in both languages | Translated via `t('start')` and `t('openProject')`: **EMPEZAR / START** and **ABRIR PROYECTO / OPEN PROJECT** | Consistent with the ES/EN switch; «OPEN PJ.» was unclear. Spanish uses EMPEZAR so it doesn't repeat COMENZAR from first-time setup |
| Comet pull | 12 % shift towards the button centre, uncapped | Same 12 %, **capped at 4 px** (`MAX_PULL` in `ui/CometCursor.tsx`) | On wide project cards the comet was drawn ~40–50 px left of the real pointer: the trash button was hard to hit and the comet jumped on arrival |

> [!tip] Lesson
> With the native cursor hidden (`cursor: none`), any visual offset of the drawn cursor must be small and bounded; otherwise what you see and where you click stop matching.

## Local models, turn mode and better transcription (2026-11-09)

| Topic | Before | Now | Why |
|---|---|---|---|
| Model providers | Claude only (subscription) | Each of the three model slots (`claude_model` = interviewer, `architect_model`, `title_model`) accepts `haiku`/`sonnet`/`opus` **or** `local:<LM Studio id>` | Run fully offline / without spending subscription limits |
| How local models plug in | — | LM Studio serves an **Anthropic-compatible API** on `localhost:1234`; `local.prepare()` passes `ANTHROPIC_BASE_URL` etc. through the SDK's per-session `env` (never `os.environ`) | Same Claude Agent SDK code path for both; Claude sessions in the same process stay on Claude |
| Background "haiku" calls | — | `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` point at the local model; non-essential traffic disabled | Claude Code's side calls would otherwise hit a model LM Studio doesn't have |
| Context length | — | `local_context` (8K…64K, default 32K); the model is unloaded/reloaded if LM Studio auto-loaded it with less | LM Studio's auto-load uses 8K, too small for the system prompt + skills |
| Resuming sessions | `resume=session_id` | Only if `session_backend` / `architect_backend` in `meta.json` matches the current provider; otherwise the agent is told to re-read `conversacion.md` | Local reasoning blocks have no valid Claude signature and vice versa |
| Model list | — | `GET /api/local-models` (LLMs only, ~1.5 s timeout); **LOCAL** option in Ajustes → Cerebro | Pick any model downloaded in LM Studio (`~/.lmstudio/models`) |
| Turn mode | VAD always decides when you've finished | `auto` (VAD) or `manual`: chunks are buffered and sent joined (0.2 s gaps) when you press **TERMINAR**; stored in `localStorage` (`prometeo.turnMode`) | Long thinking pauses no longer cut you off |
| Whisper accuracy | `beam_size=1`, no prompt | `beam_size` 5 on GPU / 3 on CPU, Spanish `initial_prompt` with project vocabulary; `large-v3-turbo` added (multilingual models only) | Better Spanish and technical words; the prompt echo on noise is filtered |

> [!warning] VRAM
> Every distinct local model takes its own GPU memory. With 8 GB (RTX 4060), use the **same** local model for all slots, and remember Whisper and Kokoro also live on the GPU.

## FAQ view with pre-recorded answers (2026-11-09)
Reason: the user wanted a window of frequently asked questions («¿Quién eres?» → «Soy Prometeo…») that Prometeo answers with pre-recorded audio.

| Topic | Decision | Why |
|---|---|---|
| Where the questions live | `agent/faqs.md`: each `## question` followed by its answer; ids are slugs of the question (`¿Quién eres?` → `quien-eres`), duplicates get `-2` | Editable by hand like the other `agent/` files, no code changes to add a question |
| Audio source | A hand recording in `agent/faqs-audio/<id>.wav\|mp3\|ogg\|m4a\|webm` wins; otherwise Kokoro generates it **once** and it is cached on disk in `backend/cache/faqs/` (git-ignored) | "Pre-recorded" without forcing the user to record anything; instant after the first play (~1.5 s first time, ~7 ms cached on the RTX 4060) |
| Cache key | sha1 of answer text + voice + speed in the file name; older files for that id are deleted when regenerating | Changing the voice in Voces/Ajustes or editing the answer re-records automatically |
| Safety | The id is looked up in the parsed list (404 otherwise), never used to build a path; written to a temp file and renamed, with a per-id lock | No path traversal; two concurrent first plays can't serve a half-written WAV |
| Generation timing | Lazy, on first click; no pre-generation at startup | Pre-generating would compete for the TTS lock with the first sentence of a conversation |
| Playback | `playAudio(url)` in `api.ts` (shared player, so the reactor pulses); `playSample` and `playFaq` are wrappers. The view opens no mic or WebSocket | Same feel as voice samples, no Claude involved |
| Language | Questions and answers stay in Spanish also with the EN interface | Voice and TTS are Spanish only |
| Content | 9 answers, 1–3 sentences each, «Prometeo» in normal case | "What's said is short" rule; upper case makes Kokoro spell it out |

Commit: `8261a3a` FAQ view.

## Startup animation (2026-11-10)
| Topic | Decision | Why |
|---|---|---|
| Sound source | Synthesized with Web Audio (drone, riser, impact, heartbeat thumps, fifths chord, pings) | No asset files or licensing; timing is exact and in sync with the visuals |
| Autoplay | Check `ctx.state` after 150 ms; dim gate text if blocked; silent intro if the gesture doesn't unlock audio | `resume()` without a gesture hangs instead of rejecting; the visuals must never depend on audio |
| When it plays | Every full load, only on the home/start views | sessionStorage "once per tab" would look broken when reloading to see it; deep links start the mic |
| Reveal technique | Darkness plane parented to the reactor with a growing hole, instead of fading each material | Follows the reactor's offset/scale per view and gives a "light from the centre" front for free |
| Heartbeat | Beat phase measured from the ignition | Visual double beat and sound thumps coincide |

Details in [[06 UI Midnight Galaxy]]. Commit: `b44fc4d` startup animation.

## Vault language (2026-11-09)
This vault was switched from Spanish to English (notes, file names, frontmatter fields) at the user's request: it is context for Claude, and English is what Claude reads best. The app, its prompts and skills stay in Spanish.

## Details that improve the feel of the conversation
- Claude's text is split into sentences and each sentence becomes speech as soon as it's complete. The first sentence is cut at a comma to start sooner.
- Before a tool call the pending sentence is flushed; if a skill or `encargar_entregables` starts with no prior text, Prometeo says «Vale, me pongo con ello».
- While Prometeo speaks, the VAD threshold rises so it doesn't interrupt itself. **Headphones** are still better.
- Typical whisper hallucinations on noise are filtered («Gracias», «amara.org»).
- Claude's writes are confined to `projects/<slug>/` via a `PreToolUse` hook.
- Claude Code user settings aren't loaded (`setting_sources=[]`), so the user's `~/.claude/CLAUDE.md` doesn't affect Prometeo.

Related: [[01 Architecture]] · [[07 Phases and roadmap]]
