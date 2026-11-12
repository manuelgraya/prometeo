---
name: contexto-vivo
description: Creates or updates obsidian-vault/context.md, the project's live state (goal, decisions and why, done, pending, lessons), linked to the project's prompts. Use it at the end of every request, for every type of project.
---
# Live context

`context.md` lives in the project's Obsidian vault (`<name>/obsidian-vault/context.md`; the exact path is in the session context) and summarises **the current state** of the project. Claude Code and other automated processes also read and update it on their own, so keep the structure stable and make sure it reads well as plain markdown. Write it in Spanish and keep the frontmatter keys and section names below exactly as they are: existing projects already use them.

Project layout:
```
<name>/                  the project itself (what may become a repo)
  code/                  the code
  obsidian-vault/        context.md and tasks/ (one note per task finished by a Forja agent)
prompts/                 prompt1/, prompt2/...: each one holds prompt.md, plan.md, tareas.md, notas.md,
                         conversacion.md and brief.md.
```

## How the prompt folders relate
A project can hold several prompts, so a folder is not always a newer version of the one before it:
- **Revision**: the task says it is a new version copied from an earlier folder. It replaces that prompt.
- **New prompt**: the task says it is a NEW prompt. It is something else to build and coexists with the earlier ones, which are still valid.
- Your working directory is the folder you are writing now. The person can mark prompts as done or delete them by hand, so earlier folders may be gone. Check what exists in `prompts/` with Glob before touching «Versiones».

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
- [prompt1](../prompts/prompt1/prompt.md) — <título del prompt> · <nuevo prompt | revisión de prompt<M>: qué cambia, en una línea>
```

## Rules
- `version`: the folder you are writing in now (your working directory).
- `tipo`: take it from the brief. If the brief doesn't say, use `software` only if the project involves writing or changing code (app, website, API, script, automation, repository) or the prompt is for a coding agent; when in doubt, `otro`.
- If `context.md` already exists, edit it with Edit:
  - update `actualizado` and `version`;
  - add what is new and correct whatever is no longer true;
  - never delete sections, and never remove entries from «Hecho» or «Lecciones».
  - Coding agents may have written to it since the last update (in «Hecho», «Pendiente» or the vault's `tasks/` notes). Treat what they wrote as fact and don't undo it.
- A decision that gets replaced is not simply deleted: move it to «Lecciones» with the reason for the change.
- Add your working folder to «Versiones» if it isn't there yet, saying whether it is a new prompt or a revision (and of which one).
- A prompt that has been revised stays in «Versiones» as history; don't delete its line. If a linked folder no longer exists (the person deleted it), keep the line and append « (borrado)» instead of removing it.
- «Objetivo» and «Decisiones vigentes» cover the whole project. When there are several prompts, say which prompt a decision belongs to if it doesn't apply to all of them.
- Links to `prompts/` are relative markdown links, because that folder is outside the vault. Links inside the vault may be wikilinks (`[[tasks/index]]`).
- Be faithful to the conversation. Whatever isn't known goes in as `**Pendiente:** ...`.
- Keep it short: it is a summary, not a copy of the deliverables.
