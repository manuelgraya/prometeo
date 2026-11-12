---
name: crear-prompt
description: Writes prompt.md, an optimised prompt for another AI (Claude, GPT, Midjourney, Claude Code...) built from the plan agreed in the conversation. Use it whenever `prompt` is among the requested deliverables.
---
# Create prompt

Write `prompt.md` in the current working directory. The file is in Spanish, and so is the prompt unless the person asked for another language.

## File structure
Keep these headings exactly. The Forja extracts the `## Prompt` section and pastes it into a coding agent, so nothing the agent needs may live outside it. Inside the prompt, use `###` or deeper headings only: a `## ` line ends the section and everything after it is cut off.

```markdown
# Prompt — <título del proyecto>

> Destino: <IA o herramienta para la que es el prompt>

## Prompt
<el prompt completo, listo para copiar y pegar>

## Cómo usarlo
<1-3 líneas: dónde pegarlo, qué ajustar>
```

## How to write the prompt
1. **Role**: who the AI should be ("Eres un desarrollador senior de React...").
2. **Context**: the goal and the agreed constraints, with concrete data from the conversation.
3. **Task**: what it must produce, step by step if there are several parts.
4. **Constraints**: what it must NOT do (excluded scope), style and limits.
5. **Output format**: the exact expected structure.
6. **Done criteria**: how to tell the work is finished and correct (checks, tests, acceptance criteria). This is essential for coding agents.

Be specific: use the real names, figures and decisions from the conversation. Don't paste the whole plan; include what the target needs to act. If the target AI is unknown, write it generically for an LLM. Things still `Pendiente` go into the prompt as explicit questions the target should ask or as clearly stated assumptions, never as invented facts.

Only if the project is **software** (the brief says so; when in doubt, it isn't), end the prompt with this section, as a recommendation and never as a requirement:

```markdown
### Contexto del proyecto (recomendado, opcional)
En la carpeta del proyecto hay un archivo de contexto vivo (`context.md` en la Vault de Obsidian del proyecto, `<nombre>/obsidian-vault/`), compatible con Obsidian. Léelo antes de empezar y, al terminar, anota en él las decisiones y los cambios relevantes con ediciones puntuales. Si no existe, continúa con normalidad.
```

If `prompt.md` already exists, update it instead of duplicating it.
