---
tags: [prometeo, agent]
updated: 2026-11-16
---
# Agent — `agent.md`

Prometeo is **two agents** that the user perceives as one. The user never hears about the Architect: Prometeo speaks in first person about everything (see [[10 Implementation decisions#One Prometeo to the user (2026-11-10)]]).

| Agent | File | Default model | What it does |
|---|---|---|---|
| **Interviewer** | `agent/agent.md` (+ `agent/mcp-catalog.md`) | Sonnet, effort `low` | Talks to the user: asks, gathers information, suggests MCP connections and hands off the deliverables. Writes no files |
| **Architect** | `agent/arquitecto.md` | Opus, effort `high` | In the background: reads the brief and `conversacion.md`, analyses in depth and writes the deliverables with the skills |

```mermaid
sequenceDiagram
    participant P as User
    participant E as Interviewer (Sonnet)
    participant B as Backend (Session)
    participant A as Architect (Opus)
    P->>E: "dame el plan y las tareas"
    E->>B: encargar_entregables(entregables, brief)
    B-->>E: "started" (immediately)
    E->>P: "Vale, lo preparo" and keeps talking
    B->>A: background task (brief.md + conversacion.md)
    A->>A: skills → plan.md, tareas.md
    A-->>B: summary sentence
    B->>P: artifacts + spoken notice (if nobody is talking)
```

This note mostly describes the interviewer: `agent.md` is its *system prompt* and its frontmatter feeds `/api/state`. The prompt itself is in Spanish.

| Field | Value |
|---|---|
| Name | **Prometeo** (changed in `agent.md`) |
| Role | Planning interviewer («Entrevistador de planificación») |
| Purpose | Turn a fuzzy idea into an actionable plan in as few turns as possible |
| Personality | Direct, calm, slightly futuristic, no filler or flattery |
| Manner | Informal "tú", restates in one sentence what it understood, respectfully challenges weak assumptions |

## Introduction on a new chat
A new project opens with a fixed greeting (`GREETINGS["nuevo"]` in `backend/app/main.py`, spoken via `say()` without going through Claude). Since 2026-11-15 it is just «Comencemos.», and since 2026-11-16 `agent.md` («Introduction») matches it: the interviewer has *not* introduced itself, and only explains who it is if asked.

## Resuming a project
The code reads `context.md` and tells the interviewer where the project was left, so it doesn't depend on the model choosing to open the file:
- `projects.resume_state(slug)`: unchecked items under «Pendiente», the last 3 entries of «Hecho», and the count of unchecked tasks in the current prompt's `tareas.md`.
- `brain._where_we_left()` adds that to the plan-mode session context («Where the project was left»).
- `projects.resume_greeting()` builds the spoken greeting from it, e.g. «Retomamos «Huerto»: queda elegir el riego y hay 2 tareas abiertas. ¿Seguimos por ahí?». A pending item longer than 90 characters is only counted, not read aloud. With no `context.md` it falls back to «Retomamos «{title}». ¿Por dónde seguimos?».

## 5-phase method
1. **Goal**: what is to be achieved and for whom.
2. **Context and constraints**: time, budget, technology, people.
3. **Scope**: what's in and what's out.
4. **Risks and decisions**: what can fail and what must be decided.
5. **Wrap-up**: ask which deliverables are wanted and hand them to the Architect with `encargar_entregables`.

## Good questions
- First, whatever **changes the plan most** (real deadline, for whom, what already exists, what failure looks like).
- Concrete questions with options over generic open ones.
- Don't ask what was already said or what can be assumed with a sensible default.

## MCP connections
The interviewer suggests MCP servers useful for the project (GitHub, Figma, Postgres, Linear…), **only from the catalog** `agent/mcp-catalog.md` so it never invents names, in one sentence and at most one per turn. The catalog is plain text (~4 KB, ~60 entries grouped by category): a selection of the claude.ai connector directory (1,000+ connectors, checked 2026-11-10) plus a few local MCP servers marked `(local)`. They are recommendations for **whoever executes the plan**; Prometeo plans and never loads or uses them (see [[10 Implementation decisions#Architect token usage (2026-11-10)]]). Suggestions go into the brief, and the Architect includes them in `plan.md` (section «Conexiones MCP recomendadas») and in `prompt.md`.

## Handoff to the Architect
- Own MCP tool `mcp__prometeo__encargar_entregables` with `entregables` (`prompt` · `plan` · `tareas` · `notas`) and `brief` (dense summary of what was gathered). Returns **immediately**.
- The backend saves the brief to `brief.md` (hidden in the panel) and launches the Architect as a separate `ClaudeSDKClient` (`run_architect` in `brain.py`).
- One handoff at a time per project; if one is already running, the interviewer says so.
- **Checks when the Architect finishes** (code, not instructions: a model can skip a sentence, a check can't). `projects.check_deliverables()` verifies that every requested file exists and isn't empty, that `context.md` exists, that `prompt.md` has a non-empty `## Prompt` section followed only by `## Cómo usarlo` (the Forja cuts at the first `## ` line, code blocks included), and that every link in `context.md` resolves (lines marked «(borrado)» are skipped). Failures go back to the Architect **in the same session** to fix, at most `ARCHITECT_FIX_ROUNDS = 2` times; after that they are logged as a warning.
- When done: `artifacts` event, and Prometeo announces it aloud if nobody is speaking. If a turn is in progress, the notice reaches the interviewer as a `[sistema: …]` note on the next message.

## Voice rules
- 1–3 sentences per turn and at most 2 questions.
- Never read code, long lists or document contents aloud.

## Security
- Interviewer: `Read`, `Glob` and `encargar_entregables`. Doesn't write.
- Architect: `Read`, `Write`, `Edit`, `Glob`, `Skill`. No Bash.
- Both with `cwd` in `projects/<slug>/` and a `PreToolUse` hook that blocks access outside that folder.
- The interviewer resumes its `session_id` from `meta.json`; the Architect starts a fresh session on every job and works from the files on disk (see [[10 Implementation decisions#Architect token usage (2026-11-10)]]).

Related: [[05 Skills]] · [[10 Implementation decisions]] · [[PROMETEO]]
