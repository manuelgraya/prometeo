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
First decide whether the target is a **coding agent** (Claude Code, Codex, Cursor...) working on software: the brief says the project is software, or the person wants code written. When in doubt, it isn't.

### For a coding agent: describe the result, not the steps
A coding agent reads the repository and plans its own implementation. A step-by-step task ties it to an approach nobody decided, and it will follow it even when the code shows a better way. Use these parts, as `###` headings inside the prompt:
1. **Objetivo**: what must work when it is done and for whom, in 2-4 sentences. Concrete names, figures and data from the conversation.
2. **Contexto**: what already exists (code, services, data) and where it lives. Only what the agent can't find out by reading the repository.
3. **Decidido**: the decisions the person took in the conversation (stack, libraries, data model, behaviour, look), each with its reason when there is one. The agent must not change these. Only what the person decided goes here: if the brief or the conversation leaves something open («WAHA o Baileys»), it is not decided, even if you or an earlier prompt recommended one option.
4. **A tu criterio**: what nobody decided. Say explicitly that the agent chooses here, and add any preference or risk the person mentioned. If you want to suggest an approach, put it here, labelled as a suggestion.
5. **Fuera de alcance**: what it must NOT do in this task.
6. **Cómo comprobar que está hecho**: concrete, runnable checks with the exact commands when they are known (`pytest`, `npm run build`, `curl ...`, opening a URL and seeing X). Each check says what result counts as passing. If the project has no tests yet, say which tests to write and how to run them. The agent must run them and report the output before saying it has finished. If a command isn't known yet, describe the observable result instead of inventing a command.

Don't write numbered implementation steps, file-by-file plans or code to paste, unless the person decided them. A phase order is fine only when it is a real dependency (B can't be checked without A). Don't impose a way of working either (creating a repository, commits, branches, where to save the work beyond the project's `code/` folder): that is the person's call, so include it only if they asked for it in the conversation.

### For any other target (an LLM, an image model, a person...)
1. **Role**: who the AI should be ("Eres un desarrollador senior de React...").
2. **Context**: the goal and the agreed constraints, with concrete data from the conversation.
3. **Task**: what it must produce, step by step if there are several parts.
4. **Constraints**: what it must NOT do (excluded scope), style and limits.
5. **Output format**: the exact expected structure.
6. **Done criteria**: how to tell the work is finished and correct.

### For both
- Length follows the task: a small change gets a short prompt, and a section with nothing to say is left out. If the brief or the person asks for a short prompt, that wins.
- Write it as an instruction to the target, not in the person's voice: «la persona pidió...», never «lo pedí yo».
- Be specific: use the real names, figures and decisions from the conversation. Don't paste the whole plan; include what the target needs to act. If the target AI is unknown, write it generically for an LLM.
- Things still `Pendiente` go into the prompt as explicit questions the target should ask or as clearly stated assumptions, never as invented facts.

Only if the project is **software** (the brief says so; when in doubt, it isn't), end the prompt with this section, as a recommendation and never as a requirement:

```markdown
### Contexto del proyecto (recomendado, opcional)
En la carpeta del proyecto hay un archivo de contexto vivo (`context.md` en la Vault de Obsidian del proyecto, `<nombre>/obsidian-vault/`), compatible con Obsidian. Léelo antes de empezar y, al terminar, anota en él las decisiones y los cambios relevantes con ediciones puntuales. Si no existe, continúa con normalidad.
```

If `prompt.md` already exists, update it instead of duplicating it.
