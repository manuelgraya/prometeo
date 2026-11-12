---
name: documentar-plan
description: Writes plan.md, the plan document (context, goals, scope, constraints, phases, risks, decisions and next step), from the conversation. Use it whenever `plan` is among the requested deliverables.
---
# Document the plan

Write `plan.md` in the current working directory, in Spanish, with this structure (keep the headings):

```markdown
# <Título del proyecto>

## Contexto
Por qué existe este proyecto y qué problema resuelve (2-4 frases).

## Objetivos
- Objetivo medible 1
- ...

## Alcance
**Incluye:** ...
**No incluye (por ahora):** ...

## Restricciones
Plazo, presupuesto, tecnología, personas.

## Fases
### Fase 1 — <nombre>
Qué se hace y qué se entrega.
...

## Riesgos y mitigación
| Riesgo | Impacto | Mitigación |
|---|---|---|

## Decisiones tomadas
- ...

## Siguiente paso
La acción concreta más pequeña para empezar mañana.
```

Rules:
- Use only information from the conversation. If something important is missing, mark it as `**Pendiente:** ...` instead of inventing it.
- Goals should be measurable. If the person gave no measure, propose one marked as `Recomendación:`.
- Each phase ends with something tangible delivered, so progress can be checked.
- If `plan.md` already exists, update it.
