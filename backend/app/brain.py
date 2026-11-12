"""Cerebro de PROMETEO: Claude Agent SDK usando la suscripción de Claude Code (sin API key)
o un modelo local de LM Studio (ver local.py)."""
from __future__ import annotations

import asyncio
import contextlib
import os
from collections.abc import AsyncIterator, Callable
from datetime import date
from pathlib import Path
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKClient,
    HookMatcher,
    ResultMessage,
    StreamEvent,
    ToolUseBlock,
    create_sdk_mcp_server,
    tool,
)

from . import agentes, local, projects
from .config import (AGENT_DIR, agent_prompt, architect_prompt, clamp_speed, load_settings, mcp_catalog, mode_prompt,
                     save_voice)
from .speech import VOICES

# Nunca usar una API key aunque exista en el entorno: queremos la suscripción.
os.environ.pop("ANTHROPIC_API_KEY", None)

FILE_TOOLS = ["Read", "Write", "Edit", "Glob"]
READ_TOOLS = ["Read", "Glob"]
DELIVERABLES = ("prompt", "plan", "tareas", "notas")
HANDOFF_TOOL = "mcp__prometeo__encargar_entregables"
AGENTS_TOOL = "mcp__prometeo__estado_agentes"
CLEANUP_THRESHOLD = 5  # versiones del prompt a partir de los cuales se condensan y limpian
PROMETEO_SKILLS = sorted(f"prometeo:{d.name}" for d in (AGENT_DIR / "skills").iterdir() if (d / "SKILL.md").exists())


def _path_guard(root: Path):
    root = root.resolve()

    async def guard(input_data: dict, tool_use_id: str | None, context: Any) -> dict:
        ti = input_data.get("tool_input", {}) or {}
        raw = ti.get("file_path") or ti.get("path")
        if not raw:
            return {}
        p = Path(raw)
        p = (p if p.is_absolute() else root / p).resolve()
        if p == root or p.is_relative_to(root):
            return {}
        return {"hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": f"Solo puedes acceder a la carpeta del proyecto ({root}).",
        }}

    return guard


def _resumable(meta: dict, id_key: str, backend_key: str, backend: str) -> str | None:
    """Solo se reanuda una sesión con el mismo proveedor que la creó (las antiguas, sin
    marca, son de Claude): el historial de un modelo local no es válido para Claude y viceversa."""
    sid = meta.get(id_key)
    return sid if sid and meta.get(backend_key, "claude") == backend else None


def _tool_event(b: ToolUseBlock) -> dict:
    return {"type": "tool", "name": b.name,
            "file": Path(b.input.get("file_path", "")).name or None,
            "skill": b.input.get("skill") or b.input.get("command")}


class Brain:
    """El entrevistador: la conversación rápida con la persona.
    mode = 'plan' (proyecto) | 'voz' (definir voz).
    En modo plan no escribe entregables: los encarga al Arquitecto con on_handoff."""

    def __init__(self, mode: str, slug: str | None = None,
                 on_event: Callable[[dict], Any] | None = None,
                 on_handoff: Callable[[list[str], str], Any] | None = None) -> None:
        self.mode = mode
        self.slug = slug
        self.on_event = on_event or (lambda e: None)
        self.on_handoff = on_handoff
        self.client: ClaudeSDKClient | None = None
        self._dirty = False
        self.notes: list[str] = []  # avisos del Arquitecto para el próximo mensaje
        self._model: dict = {}  # model (+ env si es local), resuelto en start()
        self._backend = "claude"

    def _options(self) -> ClaudeAgentOptions:
        # Sonnet + effort bajo: ~1 s hasta la primera palabra (Opus tarda 4-30 s, demasiado para voz).
        st = load_settings()
        common = dict(setting_sources=[], include_partial_messages=True, effort=st["effort"], **self._model)

        if self.mode == "voz":
            catalog = "; ".join(f"{k} = {v['desc'].lower()}" + (f", acento {v['accent']}" if v["accent"] else ", nativa")
                                for k, v in VOICES.items())

            @tool("set_voice", f"Cambia la voz de PROMETEO en vivo. speed: 0.8-1.3. Voces: {catalog}",
                  {"voice": str, "speed": float})
            async def set_voice(args: dict) -> dict:
                v = args.get("voice") if args.get("voice") in VOICES else None
                cfg = save_voice(voice=v, speed=clamp_speed(args.get("speed") or 1.0))
                await self.on_event({"type": "voice", "voice": cfg})
                return {"content": [{"type": "text", "text": f"Voz actual: {cfg['voice']} a velocidad {cfg['speed']}"}]}

            @tool("finish_voice_setup", "Guarda la voz elegida y termina la configuración inicial.", {})
            async def finish(args: dict) -> dict:
                cfg = save_voice(configured=True)
                await self.on_event({"type": "voice_setup_done", "voice": cfg})
                return {"content": [{"type": "text", "text": "Configuración de voz guardada."}]}

            server = create_sdk_mcp_server("prometeo", tools=[set_voice, finish])
            return ClaudeAgentOptions(
                system_prompt=agent_prompt() + "\n\n" + mode_prompt("definir-voz"),
                mcp_servers={"prometeo": server}, tools=[],
                allowed_tools=["mcp__prometeo__set_voice", "mcp__prometeo__finish_voice_setup"],
                cwd=str(AGENT_DIR), max_turns=6, **common,
            )

        # --- modo plan ---
        pdir = projects.project_dir(self.slug)
        meta = projects.get_meta(self.slug)

        guard = _path_guard(pdir)
        resume = _resumable(meta, "session_id", "session_backend", self._backend)
        ctx = (f"\n\n# Contexto de la sesión\n- Fecha: {date.today():%d/%m/%Y}\n"
               f"- Proyecto: «{meta['title']}». Carpeta de trabajo: {pdir}\n"
               f"- Solo puedes leer archivos dentro de esa carpeta.\n"
               f"- La conversación y los entregables vigentes están en la carpeta más reciente de "
               f"{projects.PROMPTS_DIR}/ (ahora {projects.current(self.slug).name}); el contexto vivo, en "
               f"{projects.vault(self.slug) / 'context.md'}. El código del proyecto va en {projects.code_dir(self.slug)}.")
        ctx += ("\n- Agentes de la Forja (Claude Code ejecutando los prompts de este proyecto). Siguen trabajando "
                "aunque la persona esté aquí hablando contigo; tú no los controlas desde la conversación, solo puedes "
                "contar cómo van con la herramienta estado_agentes (consúltala si te preguntan por ellos: este "
                "resumen es del inicio de la sesión). Lo que quieran cambiar de un agente se hace en la Forja.\n"
                + "\n".join("  " + ln for ln in agentes.project_summary(self.slug).splitlines()))
        if meta.get("session_id") and not resume:
            ctx += "\n- Se ha cambiado de modelo y no tienes la conversación anterior: léela en conversacion.md antes de responder."

        @tool("encargar_entregables",
              "Elabora los entregables en segundo plano con un modelo más profundo (para la persona, lo haces tú). "
              "Vuelve al instante; los archivos aparecen cuando termina.",
              {"type": "object", "properties": {
                  "entregables": {"type": "array", "items": {"type": "string", "enum": list(DELIVERABLES)},
                                  "description": "Qué entregables escribir"},
                  "brief": {"type": "string", "description": "Resumen denso y fiel de todo lo recabado"},
              }, "required": ["entregables", "brief"]})
        async def encargar(args: dict) -> dict:
            items = [e for e in (args.get("entregables") or []) if e in DELIVERABLES]
            if not items:
                msg = "Indica al menos un entregable: prompt, plan, tareas o notas."
            elif self.on_handoff is None:
                msg = "Ahora mismo no se pueden preparar los entregables."
            else:
                msg = await self.on_handoff(items, str(args.get("brief") or ""))
            return {"content": [{"type": "text", "text": msg}]}

        @tool("estado_agentes", "Cómo van ahora los agentes de la Forja de este proyecto (fase, estado, validación, nota).", {})
        async def estado(args: dict) -> dict:
            return {"content": [{"type": "text", "text": agentes.project_summary(self.slug)}]}

        server = create_sdk_mcp_server("prometeo", tools=[encargar, estado])
        return ClaudeAgentOptions(
            system_prompt=agent_prompt() + "\n\n" + mcp_catalog() + ctx,
            mcp_servers={"prometeo": server},
            tools=READ_TOOLS, allowed_tools=[*READ_TOOLS, HANDOFF_TOOL, AGENTS_TOOL],
            cwd=str(pdir), resume=resume,
            hooks={"PreToolUse": [HookMatcher(matcher="Read|Glob", hooks=[guard])]},
            max_turns=10, **common,
        )

    async def start(self) -> None:
        model = load_settings()["claude_model"]
        self._model = await local.prepare(model)
        self._backend = local.backend_key(model)
        self.client = ClaudeSDKClient(options=self._options())
        await self.client.connect()

    async def ask(self, text: str) -> AsyncIterator[dict]:
        """Envía un mensaje y produce eventos: delta, tool, done."""
        assert self.client
        if self._dirty:
            # Tras una interrupción quedan mensajes del turno cancelado: los descartamos.
            try:
                async with asyncio.timeout(15):
                    async for _ in self.client.receive_response():
                        pass
            except TimeoutError:
                pass
            self._dirty = False
        if self.notes:
            text = "".join(f"[sistema: {n}]\n" for n in self.notes) + text
            self.notes.clear()
        await self.client.query(text)
        said_any = False
        async for msg in self.client.receive_response():
            if isinstance(msg, StreamEvent):
                ev = msg.event
                if ev.get("type") == "content_block_start" and ev.get("content_block", {}).get("type") == "text" and said_any:
                    yield {"type": "delta", "text": " "}
                elif ev.get("type") == "content_block_delta" and ev["delta"].get("type") == "text_delta":
                    said_any = True
                    yield {"type": "delta", "text": ev["delta"]["text"]}
            elif isinstance(msg, AssistantMessage):
                for b in msg.content:
                    if isinstance(b, ToolUseBlock):
                        yield _tool_event(b)
            elif isinstance(msg, ResultMessage):
                if self.mode == "plan" and msg.session_id:
                    projects.update_meta(self.slug, session_id=msg.session_id, session_backend=self._backend)
                yield {"type": "done", "error": msg.is_error, "session_id": msg.session_id}

    async def interrupt(self) -> None:
        if self.client:
            self._dirty = True
            with contextlib.suppress(Exception):
                await self.client.interrupt()

    async def close(self) -> None:
        if self.client:
            with contextlib.suppress(Exception):
                await self.client.disconnect()
            self.client = None


async def run_architect(slug: str, entregables: list[str], brief: str,
                        on_event: Callable[[dict], Any]) -> str:
    """El Arquitecto: modelo profundo que analiza lo recabado y escribe los entregables.
    Corre en segundo plano, fuera del turno de voz. Devuelve su frase final de resumen."""
    st = load_settings()
    model = await local.prepare(st["architect_model"])
    pdir = projects.project_dir(slug)
    meta = projects.get_meta(slug)
    previous = projects.new_version(slug) if "prompt" in entregables else None
    cur = projects.current(slug)
    (cur / "brief.md").write_text(f"# Brief — {date.today():%d/%m/%Y}\n\nEntregables: {', '.join(entregables)}\n\n{brief.strip()}\n",
                                   encoding="utf-8", newline="\n")
    ctx = (f"\n\n# Contexto de la sesión\n- Fecha: {date.today():%d/%m/%Y}\n"
           f"- Proyecto: «{meta['title']}». Carpeta del proyecto: {pdir}\n"
           f"- Versión vigente (tu directorio de trabajo): {cur}\n"
           f"- Vault de Obsidian del proyecto: {projects.vault(slug)} (contexto vivo: context.md; historial/)\n"
           f"- Código del proyecto: {projects.code_dir(slug)}\n"
           f"- Solo puedes leer y escribir archivos dentro de la carpeta del proyecto.")
    opts = ClaudeAgentOptions(
        system_prompt=architect_prompt() + ctx,
        setting_sources=[], effort=st["architect_effort"], **model,
        tools=[*FILE_TOOLS, "Skill"], allowed_tools=FILE_TOOLS,
        plugins=[{"type": "local", "path": str(AGENT_DIR)}], skills=PROMETEO_SKILLS,
        # Sin resume: cada encargo es una sesión nueva. Reanudar arrastraba todas las versiones
        # anteriores de los entregables (160k-330k tokens por llamada en Opus) y la caché se
        # rompía en cada encargo. Lo que importa ya está en disco: brief, conversación y entregables.
        permission_mode="acceptEdits", cwd=str(cur),
        hooks={"PreToolUse": [HookMatcher(matcher="Read|Write|Edit|Glob", hooks=[_path_guard(pdir)])]},
        max_turns=40,
    )
    existing = [f"{e}.md" for e in entregables if (cur / f"{e}.md").exists()]
    task = (f"Entregables pedidos: {', '.join(entregables)}.\n"
            "La conversación completa está en conversacion.md. El brief (también guardado en brief.md) va abajo; no hace falta releerlo.\n")
    if existing:
        task += (f"Ya existen: {', '.join(existing)}. Es una actualización: léelos y cambia solo lo que el brief "
                 "o la conversación modifiquen, con Edit; no los reescribas enteros.\n")
    if previous:
        task += (f"Esta es una versión nueva ({cur.name}), copiada de {previous}, que se queda intacta "
                 "como historial: edita solo los archivos de tu directorio de trabajo.\n")
    if len(projects.versions(slug)) >= CLEANUP_THRESHOLD:
        task += (f"Hay {CLEANUP_THRESHOLD} o más versiones en {projects.PROMPTS_DIR}/: al terminar, "
                 "usa también la skill limpiar-archivo.\n")
    task += f"\n{brief.strip()}"
    final = ""
    async with ClaudeSDKClient(options=opts) as c:
        await c.query(task)
        async for m in c.receive_response():
            if isinstance(m, AssistantMessage):
                text = "".join(getattr(b, "text", "") for b in m.content).strip()
                if text:
                    final = text
                for b in m.content:
                    if isinstance(b, ToolUseBlock):
                        await on_event(_tool_event(b))
            elif isinstance(m, ResultMessage):
                if m.is_error:
                    raise RuntimeError(m.result or "error del Arquitecto")
    projects.purge_absorbed(slug)  # la skill solo puede listar; borrar lo hace el código
    return final


async def _one_shot(model_key: str, system: str, prompt: str, error: str) -> str:
    """Una pregunta sin herramientas a un modelo (Claude o local) y su respuesta en texto."""
    model = await local.prepare(load_settings()[model_key])
    opts = ClaudeAgentOptions(system_prompt=system, setting_sources=[], tools=[], max_turns=1, **model)
    out = ""
    async with ClaudeSDKClient(options=opts) as c:
        await c.query(prompt)
        async for m in c.receive_response():
            if isinstance(m, AssistantMessage):
                out += "".join(getattr(b, "text", "") for b in m.content)
            elif isinstance(m, ResultMessage) and m.is_error:
                raise RuntimeError(m.result or error)
    return out.strip()


async def suggest_title(text: str) -> str | None:
    """Título corto para un proyecto, en paralelo (no bloquea la voz). Haiku o un modelo local."""
    try:
        out = await _one_shot("title_model",
                              "Devuelves solo un título de 2 a 6 palabras en español, sin comillas ni punto final.",
                              f"Título para este proyecto: {text[:600]}", "error al titular")
    except Exception:  # noqa: BLE001
        return None
    title = out.strip('"«»').rstrip(".").strip()
    return title[:80] or None


VALIDATION_SYSTEM = (
    "Eres PROMETEO, el orquestador que valida el trabajo de un agente de programación (Claude Code). "
    "Recibes el prompt que tenía que cumplir y la evidencia de lo que ha cambiado (git diff, archivos nuevos). "
    "Haz una validación BREVE y concreta, en español:\n"
    "- Primera línea exactamente «VEREDICTO: OK» o «VEREDICTO: REVISAR».\n"
    "- Después, como mucho 6 viñetas: qué cumple, qué falta o está mal, y riesgos evidentes. "
    "Cita archivos cuando ayude. No repitas el prompt ni felicites.\n"
    "Si la evidencia no basta para juzgar algo, dilo en una viñeta en vez de suponer."
)


async def validate_work(prompt_text: str, evidence: str) -> str:
    """Validación breve de Prometeo sobre el trabajo de un agente: el modelo de la conversación, sin herramientas."""
    return await _one_shot("claude_model", VALIDATION_SYSTEM,
                           f"# Prompt del agente\n\n{prompt_text[:20000]}\n\n# Evidencia\n\n{evidence}", "error al validar")
