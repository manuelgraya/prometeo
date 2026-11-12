---
name: desglosar-tareas
description: Turns the plan into a prioritised task list with estimates (tareas.md). Use it whenever `tareas` is among the requested deliverables.
---
# Break down tasks

Write `tareas.md` in the current working directory, in Spanish:

```markdown
# Tareas — <título>

## Prioridad alta
- [ ] Tarea concreta y verificable — ~estimación (ej. 2h, 1d)
  - Criterio de hecho: ...

## Prioridad media
- [ ] ...

## Prioridad baja / más adelante
- [ ] ...
```

Rules:
- If `plan.md` exists, read it first and align the tasks with its phases (same names).
- Each task starts with a verb and fits in one work session (about one day at most). Split anything bigger.
- Order by dependencies: whatever unblocks other tasks comes first.
- Every high-priority task has a «Criterio de hecho» that can be checked.
- Estimates are approximate; use `~?` when there is no information.
- If `tareas.md` already exists, update it: keep tasks already ticked off.
