---
tags: [prometeo, agents, claude-code]
created: 2026-11-11
updated: 2026-11-11
status: working-on-linux
branch: feature/gestor-agentes
---
# Agent manager

> [!abstract] Summary
> A view in **Agentes** (`#/agentes`) where Prometeo runs the prompts it designed. Each agent is a real **Claude Code** session in a terminal inside the UI. Prometeo appears as the **orchestrator**: it launches agents, briefly validates their work and makes sure every task ends with an English note in the project's vault. Text only, no voice.

## User flow
1. In a conversation, open the `prompt.md` tab. Optionally set **Repositorio** (the code folder the agent works in; empty = the project folder). Press **▶ EJECUTAR**.
2. **Light-speed jump** (1.8 s): the UI turns out to the left, the stars stretch into streaks, the manager comes in from the right.
3. The terminal shows Claude Code. On a new folder it asks whether you trust it: **the default option is "No, exit"**, so pick "Yes" with the arrows (a hint says so).
4. Once Claude Code is ready, the initial text appears **pasted but not sent** (`[Pasted text #1 +N lines]`). The user presses Enter.
5. Work with the agent in its terminal. When it is done: **MARCAR TERMINADO** → Prometeo validates → **PEDIR CORRECCIONES** (unlimited) or **DAR VISTO BUENO** → the agent documents the task → **CERRAR**.

## Agent N = prompt version N
- An agent is tied to `projects/<slug>/prompts/prompt<N>/` (see [[05 Skills]] for how versions are created). Pressing EJECUTAR again on the same version **resumes** the same agent; it never creates a second one.
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
> It means "waiting for the user", never "task done". Done is marked by the user (MARCAR TERMINADO).

### Task cycle
`trabajando → validando → revision → (corregir → trabajando …) → documentando → cerrado` via `POST /api/agents/{slug}/{version}/phase {action}` (409 when not allowed).
- **Validation** (`brain.validate_work`, the conversation model, no tools): the `prompt.md` body plus evidence. Evidence = `git diff` since `base_commit` (HEAD when the agent was first launched), commits, status and small new files. If the folder is not a git repo, or it is inside `projects/` (which lives inside the PROMETEO repo), it lists the files touched since the agent started instead, skipping `prompts/` and `obsidian-vault/`. The answer starts with `VEREDICTO: OK|REVISAR` plus up to 6 bullets.
- **Corregir** pastes the validation notes into the terminal (not sent). **Aprobar** pastes the order to document in English in `obsidian-vault/tasks/YYYY-MM-DD-agent-N-<slug>.md` and link it from `tasks/index.md`.
- **Cerrar** only works when that note exists (`*agent-N-*.md`, written after the approval). Documenting is mandatory: the user can only add to or adjust the text.
- A version with an agent that is not `cerrado` is never purged by the archive cleanup.

### API
- `GET /api/agents/token` (local Host only) · `GET /api/agents` · `POST|DELETE /api/agents/{slug}/{version}` (`version` can be `actual`; body `{prompt, cols, rows}`) · `POST …/phase` · `POST …/hooks` · `PUT /api/projects/{slug}/repo`.
- `WS /ws/agents?token=` → `agents` (list), `log_all`/`log` (Prometeo log). `WS /ws/agents/{slug}/{version}?token=` → binary output, `hello`/`state`/`exit`/`prompted`/`pasted`; client sends `{type:"input",data}` / `{type:"resize",cols,rows}`.

> [!danger] Security: it launches processes on this machine
> Host header must be local (DNS rebinding), Origin must be the PROMETEO UI (`localhost`/`127.0.0.1` on the backend or Vite port), and every call carries a token that changes on each backend start. No CORS, so other sites can't read the token. The settings files that hold it are `chmod 600` and gitignored (`backend/cache/`).

## Frontend
- `ui/Agentes.tsx`: agent list + terminal (`@xterm/xterm` + `@xterm/addon-fit`, transparent background, theme colours), PARAR/RETOMAR, hints (trust dialog, prompt typed, stopped). The terminal mounts when the jump ends.
- `ui/Orquestador.tsx`: **constellation** (Prometeo's core in the centre, agents in orbit, one beam each: fast dashes when writing code, flowing when thinking, still when waiting, dim when stopped; click a node to open it), **Prometeo log** («Agente 1 ha terminado. Validando su trabajo…»), and the **task cycle bar** with the validation card.
- `warp.ts` + `Warp` in `scene/Scene.tsx`: 1,100 line segments flying at the camera inside the existing Canvas (one WebGL context), camera yaw so the sky drifts left with the UI. The `.layer` gets `warp-out` / `warp-in` CSS animations. `prefers-reduced-motion` → instant switch.

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

## Pending
- Windows: the pty layer runs in CI (`TerminalReal` test), but launching `claude` under ConPTY and the hooks' `curl … || exit 0` are untested.
- 60 fps of the jump not measured on real hardware (the automated Chrome is capped at ~40 fps; the jump cost ~3 fps there).
- No limit on concurrent agents (the user's choice for now).

Commits: `246bbd2` registry and vault tasks · `dd90741` terminals in the backend · `35c23cf` 204 hooks, double click · `903bd22` EJECUTAR and manager view · `54b4c21` orchestrator, validation, mandatory docs · `b2fa39e` light-speed jump · `f77ec93` PermissionRequest, unsent prompt.

Related: [[01 Architecture]] · [[02 Repo structure]] · [[05 Skills]] · [[06 UI Midnight Galaxy]] · [[10 Implementation decisions]]
