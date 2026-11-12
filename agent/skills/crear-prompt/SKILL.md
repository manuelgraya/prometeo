---
name: crear-prompt
description: Genera un prompt optimizado para otra IA (Claude, GPT, Midjourney, Claude Code...) a partir del plan acordado en la conversación y lo guarda en prompt.md. Úsala cuando la persona pida "dame el prompt", "crea un prompt" o elija el prompt como entregable.
---
# Crear prompt

Escribe `prompt.md` en el directorio de trabajo actual.

## Estructura del archivo
```markdown
# Prompt — <título del proyecto>

> Destino: <IA o herramienta para la que es el prompt>

## Prompt
<el prompt completo, listo para copiar y pegar>

## Cómo usarlo
<1-3 líneas: dónde pegarlo, qué ajustar>
```

## Cómo escribir el prompt
1. **Rol**: quién debe ser la IA (ej. "Eres un desarrollador senior de React...").
2. **Contexto**: el objetivo y las restricciones acordadas, con datos concretos de la conversación.
3. **Tarea**: qué debe producir, paso a paso si hay varias partes.
4. **Restricciones**: lo que NO debe hacer (alcance excluido), estilo, límites.
5. **Formato de salida**: estructura exacta esperada.

Sé específico: usa los nombres, cifras y decisiones reales de la conversación. Si no se sabe a qué IA va dirigido, escríbelo genérico para un LLM.

Solo si el proyecto es de **software** (lo dice el brief; si dudas, no), termina el prompt con esta sección, como recomendación y nunca como requisito:

```markdown
### Contexto del proyecto (recomendado, opcional)
En la carpeta del proyecto hay un archivo de contexto vivo (`context.md` en la Vault de Obsidian del proyecto, `<nombre>/obsidian-vault/`), compatible con Obsidian. Léelo antes de empezar y, al terminar, anota en él las decisiones y los cambios relevantes con ediciones puntuales. Si no existe, continúa con normalidad.
```
Si ya existe `prompt.md`, actualízalo en vez de duplicarlo.

Después, en la respuesta hablada, di solo en una frase que el prompt está listo.
