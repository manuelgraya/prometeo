---
name: contexto-vivo
description: Creates or updates obsidian-vault/context.md, the project's live state (goal, decisions and why, done, pending, lessons), linked to the prompt versions. Use it at the end of every request, for every type of project.
---
# Live context

`context.md` lives in the project's Obsidian vault (`<name>/obsidian-vault/context.md`; the exact path is in the session context) and summarises **the current state** of the project. Claude Code and other automated processes also read and update it on their own, so keep the structure stable and make sure it reads well as plain markdown. Write it in Spanish and keep the frontmatter keys and section names below exactly as they are: existing projects already use them.

Project layout:
```
<name>/                  the project itself (what may become a repo)
  code/                  the code
  obsidian-vault/        context.md and subfolders (historial/, tasks/)
prompts/                 prompt1/, prompt2/...: each one holds prompt.md, plan.md, tareas.md, notas.md,
                         conversacion.md and brief.md. The highest number is the current version.
```

## Structure of context.md (if it doesn't exist)
```markdown
---
actualizado: <AAAA-MM-DD>
estado: <planificando | en curso | terminado | en pausa>
tipo: <software | otro>
version: <prompt<N> vigente>
---
# Contexto — <título del proyecto>

> Estado vivo del proyecto. Se actualiza con ediciones puntuales: añade o corrige lo que cambie, no lo reescribas entero.

## Objetivo
1-3 frases: qué se quiere conseguir y para quién.

## Decisiones vigentes
- <decisión> — porque <motivo>

## Hecho
- <AAAA-MM-DD> — <qué se hizo>

## Pendiente
- [ ] ...

## Lecciones
- <qué se descartó o se aprendió, y por qué>

## Versiones
- [prompt1](../prompts/prompt1/prompt.md) — <qué cambió respecto a la anterior, en una línea>
```

## Rules
- `tipo`: take it from the brief. If the brief doesn't say, use `software` only if the project involves writing or changing code (app, website, API, script, automation, repository) or the prompt is for a coding agent; when in doubt, `otro`.
- If `context.md` already exists, edit it with Edit:
  - update `actualizado` and `version`;
  - add what is new and correct whatever is no longer true;
  - never delete sections, and never remove entries from «Hecho» or «Lecciones».
  - Coding agents may have written to it since the last update (in «Hecho», «Pendiente» or the vault's `tasks/` notes). Treat what they wrote as fact and don't undo it.
- A decision that gets replaced is not simply deleted: move it to «Lecciones» with the reason for the change.
- If the task says there is a new version, add it to «Versiones».
- Links to `prompts/` are relative markdown links, because that folder is outside the vault. Links inside the vault may be wikilinks (`[[historial/prompt1]]`).
- Be faithful to the conversation. Whatever isn't known goes in as `**Pendiente:** ...`.
- Keep it short: it is a summary, not a copy of the deliverables.
