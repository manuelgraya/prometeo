---
tags: [prometeo, skills]
updated: 2026-11-11
---
# Skills

Each skill is a folder `agent/skills/<name>/SKILL.md` in the Claude Agent SDK format (contents in Spanish). Skills **write files** and are used only by the **Architect** (Opus, background). The interviewer no longer invokes them: it hands off deliverables with `encargar_entregables` → [[03 Agent (agent.md)]].

| Skill | Output | Content |
|---|---|---|
| `crear-prompt` | `prompt.md` | Optimised prompt for another AI: role, context, task, constraints, output format |
| `documentar-plan` | `plan.md` | Context, goals, scope, phases, risks, next step |
| `desglosar-tareas` | `tareas.md` | Prioritised checklist with estimates |
| `resumen-notas` | `notas.md` | Decisions made and open questions |
| `contexto-vivo` | `obsidian-vault/context.md` | Living project state (goal, current decisions and why, done, pending, lessons), with minimal frontmatter. Run on every handoff |
| `limpiar-archivo` | `obsidian-vault/historial/prompt<N>.md` | Condenses superseded/refuted prompt versions into `context.md` and leaves one note per absorbed version |

`plan.md` also includes a **Conexiones MCP recomendadas** (recommended MCP connections) section when the interviewer suggested any.

## Project layout
```
projects/<id>/
├── meta.json            project-wide (title, session); stays at the root
├── obsidian-vault/      the project's Obsidian vault (.obsidian/ created on project creation)
│   ├── context.md
│   └── historial/
└── prompts/
    ├── prompt1/         prompt.md, plan.md, tareas.md, notas.md, conversacion.md, brief.md
    └── prompt2/         highest number = current version
```
- When a handoff includes `prompt` and the current version already has `prompt.md`, `projects.new_version()` copies it to `prompt<N+1>` before the Architect runs. The previous version stays untouched. This is deterministic and lives in code, not in the model. Other deliverables update in place in the current version.
- Projects with the old flat layout are migrated on first access (`projects._migrate`): root `*.md` files move to `prompts/prompt1/`.
- Cleanup: with `CLEANUP_THRESHOLD` (5) or more versions, the task asks the Architect to run `limpiar-archivo`. The Architect can't delete files, so after a successful run `projects.purge_absorbed()` deletes every non-current `prompts/prompt<N>/` that has a note in `obsidian-vault/historial/prompt<N>.md`.
- `prompts/` is outside the vault, so `context.md` links to it with relative markdown links. Those read fine as plain markdown, but you can't click them in Obsidian.
- The local Obsidian MCP server is **optional** and never a requirement. Claude Code reads the markdown directly.

Future ideas: `diagrama-mermaid`, `estimar-coste`.

Related: [[03 Agent (agent.md)]]
