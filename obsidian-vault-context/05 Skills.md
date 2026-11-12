---
tags: [prometeo, skills]
updated: 2026-11-12
---
# Skills

Each skill is a folder `agent/skills/<name>/SKILL.md` in the Claude Agent SDK format (instructions in English since 2026-11-12; every file they write stays in Spanish, with the Spanish headings and frontmatter keys). Skills **write files** and are used only by the **Architect** (Opus, background). The interviewer no longer invokes them: it hands off deliverables with `encargar_entregables` → [[03 Agent (agent.md)]].

| Skill | Output | Content |
|---|---|---|
| `crear-prompt` | `prompt.md` | Optimised prompt for another AI: role, context, task, constraints, output format |
| `documentar-plan` | `plan.md` | Context, goals, scope, phases, risks, next step |
| `desglosar-tareas` | `tareas.md` | Prioritised checklist with estimates |
| `resumen-notas` | `notas.md` | Decisions made and open questions |
| `contexto-vivo` | `obsidian-vault/context.md` | Living project state (goal, current decisions and why, done, pending, lessons), with minimal frontmatter. «Versiones» lists every prompt folder as a new prompt or a revision of another; deleted ones are marked «(borrado)». Run on every handoff |

`limpiar-archivo` was removed on 2026-11-12: prompts are now deleted or marked done by hand in the project editor, and nothing in the code deletes versions anymore.

`plan.md` also includes a **Conexiones MCP recomendadas** (recommended MCP connections) section when the interviewer suggested any.

## Project layout
```
projects/<id>/
├── meta.json            project-wide (title, session); stays at the root
├── obsidian-vault/      the project's Obsidian vault (.obsidian/ created on project creation)
│   ├── context.md
│   └── tasks/
└── prompts/
    ├── prompt1/         prompt.md, plan.md, tareas.md, notas.md, conversacion.md, brief.md
    └── prompt2/         highest number = the folder the Architect writes in
```
- When a handoff includes `prompt` and the current version already has `prompt.md`, `projects.new_version()` copies it to `prompt<N+1>` before the Architect runs. The previous version stays untouched. This is deterministic and lives in code, not in the model. Other deliverables update in place in the current version.
- Projects with the old flat layout are migrated on first access (`projects._migrate`): root `*.md` files move to `prompts/prompt1/`.
- A handoff with `nuevo: true` is a different prompt, not a revision: `projects.new_prompt()` creates a clean `prompt<N+1>` with only `conversacion.md`, and the earlier prompts stay valid.
- No automatic cleanup: the person deletes prompts (`projects.delete_prompt`, never the last one nor one with an open agent) or marks them done (`prompts_done` in `meta.json`) from the project editor.
- `prompts/` is outside the vault, so `context.md` links to it with relative markdown links. Those read fine as plain markdown, but you can't click them in Obsidian.
- The local Obsidian MCP server is **optional** and never a requirement. Claude Code reads the markdown directly.

Future ideas: `diagrama-mermaid`, `estimar-coste`.

Related: [[03 Agent (agent.md)]]
