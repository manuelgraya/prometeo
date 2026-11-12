---
tags: [prometeo, agents, claude-code]
created: 2026-11-11
updated: 2026-11-12
status: working-on-linux
branch: feature/gestor-agentes
agent: claude-code
prompt: projects/20261111-001021-proyecto-sin-titulo-2 (prompt.md, plan.md, tareas.md, notas.md)
date: 2026-11-11
repo: ~/Work/prometeo
---
# Agent manager (the Forja)

## Summary
> [!abstract] Summary
> A per-project view (`#/agentes/<slug>[/<version>]`) called **FORJA** in the top nav (the forge Prometheus stole fire from; it opens the last project seen there), also reached from **Proyectos → AGENTES · n** or by EJECUTAR, where Prometeo runs the prompts it designed and free tasks. Each agent is a real **Claude Code** session in a terminal inside the UI. Prometeo appears as the **orchestrator**: it launches agents, briefly validates their work and asks every task to end with an English note in the project's vault. Text only, no voice.

## Forja redesign (2026-11-12)
Built from the user's hand sketch: left column = back arrow (top-left), Prometeo's constellation, **AGENTES [+]** list, **Registro**; right = terminal panel.
- **Agent names**: every agent has a per-project number `n` (unique, `max + 1`, stored in `agentes.json`) and a star name `STARS[n-1]` (Orión, Centauri, Sol, Vega, Sirio… 20, then «Orión II»). Names appear in the list, the orbit nodes (initial + label), the log and the agent's initial text («Eres Centauri, el agente 2…»). Task notes still use `agent-<n>` in the file name.
- **(+) button**: offers «EJECUTAR prompt<N>» when the current version has a `prompt.md` and no agent yet, and always a **free agent** (`libre<K>`) with an optional task. A free agent without a task takes its first `UserPromptSubmit` text as the task (that is what validation checks).
- **No agent header**: the list marks the agent shown with «EN PANTALLA». The panel header is **Proyecto: <title> ▾** (open its conversation, switch project, or «Todos los proyectos») and **Uso de Claude** (5 h / 7 d bars + this agent's context %).
- **Usage**: the per-agent settings add a `statusLine` command that POSTs Claude Code's status JSON to `/api/agents/{slug}/{id}/status` and prints nothing. `rate_limits` only appears **after the first API response** of a session; the last value is kept in `backend/cache/usage.json` and pushed as `{type:"usage"}` on `/ws/agents`. A window whose `resets_at` has passed shows «—».
- **Terminal colours**: the settings set `"theme": "dark-ansi"` (verified on 2.1.322: 0 truecolor sequences, only ANSI), so the xterm palette in `theme.ts` (`terminal`) paints Claude Code too. Original = Tokyo Night from the user's foot terminal (cursor in Prometeo cyan); Rosa = a pink/violet variant. The background is `--term-bg` on the container; switching theme repaints the open terminal.
- **FINALIZAR instead of PARAR**: the stop/resume header button is gone. `terminar` is labelled FINALIZAR; **CERRAR TAREA** (after the note exists) also stops the process. REABRIR relaunches it. A non-closed agent that died (backend restart) shows a hint with **RETOMAR**; it is never relaunched automatically (that could spawn many `claude` after a restart).
- **cwd**: `<name>/` of the project (see [[02 Repo structure]]), or `meta.repo`. Files outside it are passed with `--add-dir` (the prompt version folder; vault and `code/` when using an external repo). Sessions are resumed only if the transcript exists under the encoded cwd (`~/.claude/projects/<cwd with non-alphanumerics → ->/`); if the cwd changed, a new session id is used and the initial text is pasted again.
- **Validation git**: `_own_repo()` uses `git rev-parse --show-toplevel` and rejects PROMETEO's own repo, so a `<name>/` turned into a repo inside `projects/` is diffed normally. Without a base commit (no commits yet, or `git init` after launch) it diffs against the empty tree. The vault is excluded from the diff.

## Forja ↔ conversation (2026-11-12)
- Agents live in the backend (`agentes._agents`), not in the view: leaving the Forja only unsubscribes the terminal WS; they stop only on PARAR/DELETE or backend shutdown (`stop_all`). The terminal history replays on return.
- **HABLAR CON PROMETEO** in the Forja header opens the project's conversation (resumed session). There, a `forgechip` («● N trabajando · VER LA FORJA», from `useAgents`) warps back to the Forja.
- Prometeo knows the agents: `agentes.project_summary(slug)` (name, phase, state, verdict, note, last orchestrator log lines) goes into the plan-mode session context, and the read-only tool `mcp__prometeo__estado_agentes` returns it live. Prometeo cannot control agents from the conversation.
- In the conversation, **LLEVAR A LA FORJA** (next to the floating mic) appears whenever `prompt.md` exists, whatever tab is open; the deliverables panel only reads/copies/downloads.

## Architecture
```
Browser (React + R3F)                    Local backend (FastAPI, 127.0.0.1:8765)
┌────────────────────────────┐   WS     ┌────────────────────────────────────────┐
│ Conversación · prompt.md   │◄───────► │ agentes.py — one agent per prompt<N>   │
│   └ ▶ EJECUTAR (warp jump) │          │  ├ plataforma.Terminal (pty / ConPTY)   │
│ #/agentes                  │  REST    │  │    └ claude --settings … --session-id│
│  ├ constellation + log     │◄───────► │  ├ output history (reconnect)          │
│  ├ xterm.js terminal       │          │  ├ agentes.json · validation (git diff)│
│  └ task cycle bar          │          │  └ POST …/hooks  ◄──────────┐          │
└────────────────────────────┘          └─────────────────────────────┼──────────┘
                                          Claude Code hooks (curl + token)
```

## User flow
1. In a conversation, open the `prompt.md` tab. Optionally set **Repositorio** (the code folder the agent works in; empty = the project folder). Press **▶ EJECUTAR**.
2. **Light-speed jump** (2.7 s): the UI fades towards the camera; in the dark, Prometeo sits centred with a spiky aura while star streaks fan out from it; the streaks slow down and Prometeo glides to the top-left, into the centre of the agent constellation; then the agent list rises in and the terminal slides in from the right.
3. The terminal shows Claude Code. On a new folder it asks whether you trust it: **the default option is "No, exit"**, so pick "Yes" with the arrows (a hint says so).
4. Once Claude Code is ready, the initial text appears **pasted but not sent** (`[Pasted text #1 +N lines]`). The user presses Enter.
5. Work with the agent in its terminal. When it is done: **FINALIZAR** → Prometeo validates → **PEDIR CORRECCIONES** (unlimited) or **DAR VISTO BUENO** → the agent documents the task → **CERRAR TAREA** (ends the process).

## Prompt agents
- A prompt agent (`prompt<N>`) is tied to `projects/<slug>/prompts/prompt<N>/` (see [[05 Skills]] for how versions are created). Pressing EJECUTAR again on the same version **resumes** the same agent; it never creates a second one.
- The initial text (Spanish, built by `agentes.initial_text`): read the vault first (`context.md`, `tasks/index.md`), then `prompt.md` and `notas.md`/`plan.md`/`tareas.md` of that version (absolute paths), the closing rules, the English note template, and then the `## Prompt` section of `prompt.md` (the «Cómo usarlo» part is for the person, not the agent).
- It is pasted as **bracketed paste** (`ESC[200~ … ESC[201~`), so newlines don't submit it, and never followed by `\r`. It is written once; if it was never sent (no saved transcript), relaunching writes it again.

## Backend (`backend/app/agentes.py`)
| Piece | How |
|---|---|
| Terminal | `plataforma.Terminal`: stdlib `pty` on Linux (own session, pty as controlling tty); ConPTY via `pywinpty` on Windows (Windows-only dependency, imported lazily). A reader thread feeds the asyncio loop |
| Process | `claude --settings <cache/agentes/<slug>-<version>.json> --session-id <uuid>`, or `--resume <uuid>` when a transcript exists. Cwd = `meta.json` `repo`, else the project folder. Never `--dangerously-skip-permissions` |
| States | From **Claude Code hooks**, not by parsing the terminal. The per-agent settings file makes every hook `curl` the backend (`POST /api/agents/{slug}/{version}/hooks`, token header). The endpoint answers **204 empty**: hook stdout of `SessionStart`/`UserPromptSubmit` ends up in the agent's context |
| History | Last 2 MB of output in memory, replayed on reconnect (`hello` resets xterm). Lost on backend restart; the conversation itself is resumed with `--resume` |
| Registry | `projects/<slug>/agentes.json`: version, session_id, phase, cwd, prompted, base_commit, validation, approved_at, note |
| Shutdown | Backend shutdown stops every agent (SIGHUP, then SIGKILL) |

Hook → state:

| Hook | State |
|---|---|
| `UserPromptSubmit`, `PostToolUse`, `PreToolUse` (other tools) | pensando |
| `PreToolUse` with `Edit`/`Write`/`MultiEdit`/`NotebookEdit` | escribiendo código |
| `PermissionRequest`, `Notification`, `Stop` | esperando respuesta |
| `SessionStart` | esperando (also the "ready" signal to paste the initial text) |
| `SessionEnd`, process exits | parado |

> [!warning] `Stop` fires every turn
> It means "waiting for the user", never "task done". Done is marked by the user (FINALIZAR).

### Task cycle
`trabajando → validando → revision → (corregir → trabajando …) → documentando → cerrado` via `POST /api/agents/{slug}/{version}/phase {action}` (409 when not allowed).
- **Validation** (`brain.validate_work`, the conversation model, no tools): the `prompt.md` body plus evidence. Evidence = `git diff` since `base_commit` (HEAD when the agent was first launched), commits, status and small new files. If the folder is not a git repo, or it is inside `projects/` (which lives inside the PROMETEO repo), it lists the files touched since the agent started instead, skipping `prompts/` and `obsidian-vault/`. The answer starts with `VEREDICTO: OK|REVISAR` plus up to 6 bullets.
- **Corregir** pastes the validation notes into the terminal (not sent). **Aprobar** pastes the order to document in English in `obsidian-vault/tasks/YYYY-MM-DD-agent-N-<slug>.md` and link it from `tasks/index.md`.
- **Cerrar** works after the approval whether or not the note exists (`*agent-N-*.md`, written after the approval): the agent is always asked to document, but the user can close without waiting. If there is a note it is linked in the log; otherwise it says it closed without one.
- A version with an agent that is not `cerrado` is never purged by the archive cleanup.

### API
- `GET /api/agents/token` (local Host only) · `GET /api/agents` · `POST /api/agents/{slug}/nuevo {task}` (free agent) · `POST …/status` (status line) · `POST|DELETE /api/agents/{slug}/{version}` (`version` can be `actual`; body `{prompt, cols, rows}`) · `POST …/phase` · `POST …/hooks` · `PUT /api/projects/{slug}/repo`.
- `WS /ws/agents?token=` → `agents` (list), `log_all`/`log` (Prometeo log), `usage`. `WS /ws/agents/{slug}/{version}?token=` → binary output, `hello`/`state`/`exit`/`prompted`/`pasted`; client sends `{type:"input",data}` / `{type:"resize",cols,rows}`.

> [!danger] Security: it launches processes on this machine
> Host header must be local (DNS rebinding), Origin must be the PROMETEO UI (`localhost`/`127.0.0.1` on the backend or Vite port), and every call carries a token that changes on each backend start. No CORS, so other sites can't read the token. The settings files that hold it are `chmod 600` and gitignored (`backend/cache/`).

## Frontend
- `ui/Agentes.tsx`: back button, agent list with (+) and «EN PANTALLA», `ProjectPicker`, `UsageBox`, terminal (`@xterm/xterm` + `@xterm/addon-fit`, theme ANSI palette), hints (trust dialog, prompt typed, stopped + RETOMAR). The terminal mounts when the jump ends. Ctrl+Backspace/Delete/←/→ are translated to readline word keys (Ctrl+W, Alt+D/B/F).
- `ui/Orquestador.tsx`: **constellation** (Prometeo's core in the centre, agents in orbit, one beam each: fast dashes when writing code, flowing when thinking, still when waiting, dim when stopped; click a node to open it), **Prometeo log** («Agente 1 ha terminado. Validando su trabajo…»), and the **task cycle bar** with the validation card.
- `warp.ts` + `Warp` in `scene/Scene.tsx`: 1,100 line segments flying at the camera inside the existing Canvas (one WebGL context); seen head-on they radiate from the reactor (no camera yaw since 2026-11-11). Timeline `out 0.45 → swap 0.9 → relocate 1.6 → enter 2.0 → end 2.7`. `startWarp({swap, layer, hold})`: `hold` makes App override the reactor (centre, `despertar`, `thinking`); releasing it lets the reactor lerp to where the manager put it. `.layer` classes `warp-out` / `warp-hidden` / `warp-in` (list and terminal animate separately). `prefers-reduced-motion` → instant switch. Clicking FORJA in the nav (from another view) plays the same jump.
- The 3D reactor **is** the constellation's core: `Constelacion` measures its SVG and reports a `CoreSpot` (screen x, y, ring radius); `Gestor` turns it into `offsetX/offsetY/scale` with `reactorAt()`. The `.orq` block has no panel or blur so the reactor shows through; beams start at the ring edge. Its `.orq` animation is opacity-only so the measurement is never taken mid-transform.

## Changes
- New: `backend/app/agentes.py`, `backend/tests/test_agentes.py`, `frontend/src/agents.ts`, `frontend/src/warp.ts`, `frontend/src/ui/Agentes.tsx`, `frontend/src/ui/Orquestador.tsx`.
- Changed: `plataforma.py` (`Terminal`), `main.py` (agent REST/WS, repo endpoint), `brain.py` (`validate_work`), `projects.py` (agents registry, `tasks_dir`, `workdir`, `set_repo`, purge keeps busy versions), `App.tsx` (route, nav, EJECUTAR, warp), `scene/Scene.tsx` (warp streaks), `i18n.ts`, `index.css`, `session.ts`, `pyproject.toml` (`pywinpty` on Windows), `package.json` (`@xterm/xterm`, `@xterm/addon-fit`).

## Files touched
See the list above and [[02 Repo structure]].

## Decisions
See the table in [[10 Implementation decisions]] (Agent manager, 2026-11-11).

## Run and test
```bash
git switch feature/gestor-agentes
prometeo run                                   # backend :8765 + frontend :5173
cd backend && uv run python -m unittest discover -s tests   # 57 tests, incl. test_agentes.py
```
Tested end to end on Linux, with a separate backend/Vite on other ports and temporary projects. Covered: EJECUTAR → trust dialog → pasted prompt not sent → live states → validation → correction/approval → English note → close; reload restores the terminal; two agents at once; a 274-line prompt; an old flat project migrated on launch; backend restart (agents listed as stopped, resume works, an unsent prompt is written again).

> [!note] Gotchas found while building
> - A backend started from inside another Claude Code inherits `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, etc.: the agent then doesn't save its transcript ("Transcript saving is off") and `--resume` fails. `agentes._SESSION_MARKERS` strips them.
> - `SessionStart` only fires after the trust dialog is accepted.
> - Long pastes show as `[Pasted text #1 +N lines]`: the full text can't be reviewed in the terminal before pressing Enter (it is in the `prompt.md` tab).

## Open issues / Follow-ups
- Windows: the pty layer runs in CI (`TerminalReal` test), but launching `claude` under ConPTY and the hooks' `curl … || exit 0` are untested.
- 60 fps of the jump not measured on real hardware (the automated Chrome is capped at ~40 fps; the jump cost ~3 fps there).
- No limit on concurrent agents (the user's choice for now).

Commits: `8054408` registry and vault tasks · `c352e50` terminals in the backend · `cd85349` 204 hooks, double click · `f527cbe` EJECUTAR and manager view · `bcddd0b` orchestrator, validation, mandatory docs · `c1ba886` light-speed jump · `5ba5806` PermissionRequest, unsent prompt.

Related: [[01 Architecture]] · [[02 Repo structure]] · [[05 Skills]] · [[06 UI Midnight Galaxy]] · [[10 Implementation decisions]]
