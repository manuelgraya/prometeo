---
name: contexto-vivo
description: Crea o actualiza obsidian-vault/context.md, el estado vivo del proyecto (objetivo, decisiones y su porqué, hecho, pendiente, lecciones), enlazado con las versiones del prompt. Úsala al final de cada encargo, en cualquier tipo de proyecto.
---
# Contexto vivo

`context.md` está en la Vault de Obsidian del proyecto (`obsidian-vault/context.md`; la ruta exacta va en el contexto de la sesión) y resume **el estado actual** del proyecto. Lo lee y lo actualiza también Claude Code u otro proceso automático, sin ayuda de nadie, así que mantén la estructura estable y que se lea bien como markdown normal.

Estructura del proyecto:
```
obsidian-vault/   context.md y subcarpetas (historial/)
prompts/          prompt1/, prompt2/...: cada una con prompt.md, plan.md, tareas.md, notas.md,
                  conversacion.md y brief.md. La de número más alto es la vigente.
```

## Estructura de context.md (si no existe)
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

## Reglas
- `tipo`: el del brief. Si no lo dice, `software` solo si implica escribir o modificar código (app, web, API, script, automatización, repositorio) o el prompt va para un agente de programación; si dudas, `otro`.
- Si `context.md` ya existe, edítalo con Edit: cambia `actualizado` y `version`, añade lo nuevo y corrige lo que ya no sea cierto. Nunca borres secciones ni historial de «Hecho» o «Lecciones».
- Una decisión que se sustituye no se borra sin más: pasa a «Lecciones» con el porqué del cambio.
- Si la tarea dice que hay una versión nueva, añádela en «Versiones».
- Los enlaces a `prompts/` son enlaces markdown relativos (están fuera de la Vault); los de dentro de la Vault pueden ser wikilinks (`[[historial/prompt1]]`).
- Sé fiel a la conversación: lo que no se sepa, `**Pendiente:** ...`.
- Breve: es un resumen, no una copia de los entregables.
