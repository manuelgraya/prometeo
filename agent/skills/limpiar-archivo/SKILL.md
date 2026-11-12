---
name: limpiar-archivo
description: Reviews the old versions in prompts/ (prompt1, prompt2...), condenses the lessons from superseded or refuted ones into obsidian-vault/context.md, and leaves one note per version in obsidian-vault/historial/ so the system deletes them. Use it when the task asks you to clean up the archive.
---

> The vault is at `<name>/obsidian-vault/` (exact path in the session context); below it is shortened to `obsidian-vault/`.

# Clean up old prompt versions

Each `prompts/prompt<N>/` folder is one version (prompt, plan, tasks, notes, conversation and brief). The highest number is the current one. Versions pile up over time: condense what is useful and let the ones that add nothing be deleted. Write everything in Spanish and keep the section names of `context.md` as they are.

## Steps
1. Read `obsidian-vault/context.md` and the current version. Then, from oldest to newest, read each earlier version's `prompt.md` (and whatever else you need).
2. Classify each earlier version:
   - **Superseded**: a later version replaces it and it has nothing that isn't in that later one.
   - **Refuted**: a later decision contradicts it.
   - **Has unique information**: it holds something that isn't anywhere else and hasn't been condensed yet. **Leave it alone.**
3. **Before marking anything**, condense into the «Lecciones» section of `context.md` whatever is still useful from the superseded and refuted versions: what was discarded and why. Use Edit; don't rewrite the file.
4. For each absorbed version, write `obsidian-vault/historial/prompt<N>.md`:

```markdown
---
fecha: <AAAA-MM-DD de la limpieza>
motivo: <superada | refutada>
---
# prompt<N>
Qué pedía, en 1-3 líneas, y qué versión la sustituyó o la contradijo.
```

5. In `context.md`, update two sections:
   - «Versiones»: replace the links of the absorbed versions with `[[historial/prompt<N>]]`.
   - «Hecho»: add `- <AAAA-MM-DD> — limpieza: N versiones condensadas en historial/`.

## Rules
- Writing `historial/prompt<N>.md` makes the system delete `prompts/prompt<N>/` afterwards. Only write it once its information is already condensed.
- Never mark these versions:
  - the current version;
  - the one right before it;
  - a version with unique information that hasn't been condensed.
- You don't delete files; the system does.
- If you're unsure about a version, leave it as it is.
