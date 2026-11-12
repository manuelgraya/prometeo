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
            "permissionDecisionReason": f"You may only access the project folder ({root}).",
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
                 on_handoff: Callable[[list[str], str, bool], Any] | None = None) -> None:
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
            catalog = "; ".join(f"{k} = {v['desc'].lower()}" + (f", {v['accent']} accent" if v["accent"] else ", native Spanish")
                                for k, v in VOICES.items())

            @tool("set_voice", f"Changes PROMETEO's voice live. speed: 0.8-1.3. Voices (descriptions in Spanish): {catalog}",
                  {"voice": str, "speed": float})
            async def set_voice(args: dict) -> dict:
                v = args.get("voice") if args.get("voice") in VOICES else None
                cfg = save_voice(voice=v, speed=clamp_speed(args.get("speed") or 1.0))
                await self.on_event({"type": "voice", "voice": cfg})
                return {"content": [{"type": "text", "text": f"Current voice: {cfg['voice']} at speed {cfg['speed']}"}]}

            @tool("finish_voice_setup", "Saves the chosen voice and ends the first-time setup.", {})
            async def finish(args: dict) -> dict:
                cfg = save_voice(configured=True)
                await self.on_event({"type": "voice_setup_done", "voice": cfg})
                return {"content": [{"type": "text", "text": "Voice settings saved."}]}

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
        ctx = (f"\n\n# Session context\n- Date: {date.today():%d/%m/%Y}\n"
               f"- Project: «{meta['title']}». Working folder: {pdir}\n"
               f"- You may only read files inside that folder.\n"
               f"- The conversation and the current deliverables are in the latest folder of "
               f"{projects.PROMPTS_DIR}/ (now {projects.current(self.slug).name}); the live context is at "
               f"{projects.vault(self.slug) / 'context.md'}. The project's code goes in {projects.code_dir(self.slug)}.")
        ctx += ("\n- Forja agents (Claude Code running this project's prompts). They keep working while the person "
                "talks to you here. You don't control them from the conversation; you can only report how they are "
                "doing with the estado_agentes tool (call it if asked about them: this summary is from the start of "
                "the session). Any change to an agent is made in the Forja.\n"
                + "\n".join("  " + ln for ln in agentes.project_summary(self.slug).splitlines()))
        if meta.get("session_id") and not resume:
            ctx += "\n- The model was switched and you don't have the previous conversation: read it in conversacion.md before replying."

        @tool("encargar_entregables",
              "Produces the deliverables in the background with a deeper model (to the person, you are the one doing it). "
              "Returns immediately; the files appear when it finishes.",
              {"type": "object", "properties": {
                  "entregables": {"type": "array", "items": {"type": "string", "enum": list(DELIVERABLES)},
                                  "description": "Which deliverables to write"},
                  "brief": {"type": "string", "description": "Dense, faithful summary of everything gathered, in Spanish"},
                  "nuevo": {"type": "boolean", "description":
                            "true if it is a different prompt from the current one (something else to build, even "
                            "within the same project): it gets its own folder, without the previous deliverables. "
                            "false (default) when correcting or extending the current prompt."},
              }, "required": ["entregables", "brief"]})
        async def encargar(args: dict) -> dict:
            items = [e for e in (args.get("entregables") or []) if e in DELIVERABLES]
            if not items:
                msg = "Give at least one deliverable: prompt, plan, tareas or notas."
            elif self.on_handoff is None:
                msg = "Deliverables can't be prepared right now."
            else:
                msg = await self.on_handoff(items, str(args.get("brief") or ""), args.get("nuevo") is True)
            return {"content": [{"type": "text", "text": msg}]}

        @tool("estado_agentes", "Current status of this project's Forja agents (phase, state, validation, note).", {})
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
                        on_event: Callable[[dict], Any], nuevo: bool = False) -> str:
    """El Arquitecto: modelo profundo que analiza lo recabado y escribe los entregables.
    Corre en segundo plano, fuera del turno de voz. Devuelve su frase final de resumen."""
    st = load_settings()
    model = await local.prepare(st["architect_model"])
    pdir = projects.project_dir(slug)
    meta = projects.get_meta(slug)
    fresh = None
    if "prompt" in entregables and nuevo:
        previous, fresh = None, projects.new_prompt(slug)
    else:
        previous = projects.new_version(slug) if "prompt" in entregables else None
    cur = projects.current(slug)
    (cur / "brief.md").write_text(f"# Brief — {date.today():%d/%m/%Y}\n\nEntregables: {', '.join(entregables)}\n\n{brief.strip()}\n",
                                   encoding="utf-8", newline="\n")
    ctx = (f"\n\n# Session context\n- Date: {date.today():%d/%m/%Y}\n"
           f"- Project: «{meta['title']}». Project folder: {pdir}\n"
           f"- Current version (your working directory): {cur}\n"
           f"- Project's Obsidian vault: {projects.vault(slug)} (live context: context.md)\n"
           f"- Project code: {projects.code_dir(slug)}\n"
           f"- You may only read and write files inside the project folder.")
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
    task = (f"Requested deliverables: {', '.join(entregables)}.\n"
            "The full conversation is in conversacion.md. The brief (also saved as brief.md) is below; no need to re-read it.\n")
    if existing:
        task += (f"Already present: {', '.join(existing)}. This is an update: read them and change only what the brief "
                 "or the conversation modifies, with Edit; don't rewrite them whole.\n")
    if fresh:
        task += (f"This is a NEW prompt, different from the earlier ones: your working directory ({cur.name}) is empty except "
                 f"for the conversation. Write its deliverables from scratch under the usual names (prompt.md, tareas.md...); "
                 f"don't copy or touch the ones in {fresh} or in any other folder of {projects.PROMPTS_DIR}/.\n")
    if previous:
        task += (f"This is a new version ({cur.name}), copied from {previous}, which stays untouched "
                 "as history: edit only the files in your working directory.\n")
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
                              "Reply with only a title of 2 to 6 words, in Spanish, with no quotes and no final period.",
                              f"Title for this project: {text[:600]}", "error al titular")
    except Exception:  # noqa: BLE001
        return None
    title = out.strip('"«»').rstrip(".").strip()
    return title[:80] or None


VALIDATION_SYSTEM = (
    "You are PROMETEO, the orchestrator that validates the work of a coding agent (Claude Code). "
    "You receive the prompt it had to fulfil and the evidence of what changed (git diff, new files). "
    "Write a SHORT, concrete validation, in Spanish:\n"
    "- The first line is exactly «VEREDICTO: OK» or «VEREDICTO: REVISAR» (keep these words, they are parsed).\n"
    "- Then at most 6 bullets: what it fulfils, what is missing or wrong, and obvious risks. "
    "Cite files when it helps. Don't repeat the prompt and don't congratulate.\n"
    "If the evidence isn't enough to judge something, say so in a bullet instead of assuming."
)


async def validate_work(prompt_text: str, evidence: str) -> str:
    """Validación breve de Prometeo sobre el trabajo de un agente: el modelo de la conversación, sin herramientas."""
    return await _one_shot("claude_model", VALIDATION_SYSTEM,
                           f"# Agent's prompt\n\n{prompt_text[:20000]}\n\n# Evidence\n\n{evidence}", "error al validar")
