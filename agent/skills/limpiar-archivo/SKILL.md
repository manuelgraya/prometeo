---
name: limpiar-archivo
description: Revisa las versiones antiguas de prompts/ (prompt1, prompt2...), condensa en obsidian-vault/context.md las lecciones de las superadas o refutadas y deja una nota por cada una en obsidian-vault/historial/ para que se borren. Úsala cuando la tarea pida limpiar el archivo.
---
# Limpiar versiones antiguas del prompt

Cada carpeta `prompts/prompt<N>/` es una versión (prompt, plan, tareas, notas, conversación y brief). La de número más alto es la vigente. Con el tiempo se acumulan: condensa lo útil y deja que se borren las que ya no aportan nada.

## Pasos
1. Lee `obsidian-vault/context.md`, la versión vigente y, del más antiguo al más reciente, el `prompt.md` (y lo que haga falta) de cada versión anterior.
2. Clasifica cada versión anterior:
   - **Superada**: una posterior la sustituye y no tiene nada que no esté en ella.
   - **Refutada**: una decisión posterior la contradice.
   - **Con información única**: tiene algo que no está en ninguna otra parte y aún no está condensado. Esta **no se toca**.
3. **Antes de marcar nada**, condensa en `context.md`, sección «Lecciones», lo que siga siendo útil de las superadas y refutadas: qué se descartó y por qué. Con Edit, sin reescribir el archivo.
4. Por cada versión absorbida, escribe `obsidian-vault/historial/prompt<N>.md`:

```markdown
---
fecha: <AAAA-MM-DD de la limpieza>
motivo: <superada | refutada>
---
# prompt<N>
Qué pedía, en 1-3 líneas, y qué versión la sustituyó o la contradijo.
```

5. En `context.md`, sección «Versiones»: sustituye los enlaces de las versiones absorbidas por `[[historial/prompt<N>]]` y añade a «Hecho» `- <AAAA-MM-DD> — limpieza: N versiones condensadas en historial/`.

## Reglas
- Escribir `historial/prompt<N>.md` hace que el sistema borre `prompts/prompt<N>/` después: escríbelo solo cuando su información ya esté condensada.
- Nunca marques la versión vigente ni la inmediatamente anterior, ni una con información única sin condensar.
- Tú no borras archivos: lo hace el sistema.
- Si dudas sobre una versión, déjala como está.
