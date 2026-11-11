"""Agentes de Claude Code lanzados desde el gestor: una terminal (pty) por versión del prompt.

El agente N de un proyecto es `prompts/prompt<N>`: volver a lanzarlo retoma el mismo agente.
El estado (pensando, escribiendo, esperando, parado) no se deduce de la salida de la terminal:
llega de los hooks de Claude Code, que llaman a /api/agents/{slug}/{version}/hooks con un token.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import secrets
import shutil
import threading
import uuid
from collections import deque
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from . import plataforma, projects
from .config import ROOT, env

log = logging.getLogger("prometeo.agentes")

TOKEN = secrets.token_urlsafe(24)  # cambia en cada arranque; lo piden el frontend y los hooks
PORT = str(env("PORT", "8765"))
FRONT_PORT = str(env("FRONT_PORT", "5173"))
SETTINGS_DIR = ROOT / "backend" / "cache" / "agentes"
HISTORY_BYTES = 2_000_000  # salida que se guarda para reconectar tras recargar el navegador
CODE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
HOOK_EVENTS = ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Notification", "Stop", "SessionEnd")
_LOCAL = {"localhost", "127.0.0.1", "::1"}
# Marcas de sesión que deja un Claude Code padre. Heredadas, el agente se cree subproceso de otra
# sesión y no guarda la conversación («Transcript saving is off»), y entonces --resume no puede retomarla.
_SESSION_MARKERS = ("CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID",
                    "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH",
                    "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SSE_PORT")


# ---------------- Seguridad: solo este ordenador y solo la interfaz de PROMETEO ----------------
def host_ok(host: str | None) -> bool:
    """Contra DNS rebinding: el Host tiene que ser local aunque la conexión ya lo sea."""
    return bool(host) and (urlsplit(f"//{host}").hostname or "") in _LOCAL


def origin_ok(origin: str | None) -> bool:
    if not origin:
        return False
    u = urlsplit(origin)
    return u.scheme == "http" and (u.hostname or "") in _LOCAL and str(u.port) in {PORT, FRONT_PORT}


def token_ok(token: str | None) -> bool:
    return bool(token) and secrets.compare_digest(token, TOKEN)


# ---------------- Agentes ----------------
def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


class Agente:
    def __init__(self, slug: str, version: str, record: dict | None = None) -> None:
        r = record or {}
        self.slug, self.version = slug, version
        self.session_id: str = r.get("session_id") or str(uuid.uuid4())
        self.phase: str = r.get("phase", "trabajando")
        self.created: str = r.get("created") or _now()
        self.cwd: str | None = r.get("cwd")
        self.prompted: bool = r.get("prompted", False)  # el texto inicial ya se escribió una vez
        self.base_commit: str | None = r.get("base_commit")  # HEAD al lanzarlo: la validación mira desde aquí
        self.validation: dict | None = r.get("validation")   # {"verdict", "text", "at"}
        self.approved_at: str | None = r.get("approved_at")
        self.note: str | None = r.get("note")
        self.validating: asyncio.Task | None = None
        self.state = "parado"
        self.ready = asyncio.Event()  # hook SessionStart: Claude Code ya acepta texto
        self.starting = asyncio.Lock()
        self.typing: asyncio.Task | None = None
        self.term: plataforma.Terminal | None = None
        self.history = bytearray()
        self.clients: set[asyncio.Queue] = set()

    @property
    def key(self) -> str:
        return f"{self.slug}/{self.version}"

    @property
    def alive(self) -> bool:
        return self.term is not None and self.term.viva()

    def record(self) -> dict:
        return {"id": self.version, "version": self.version, "session_id": self.session_id,
                "phase": self.phase, "cwd": self.cwd, "created": self.created, "prompted": self.prompted,
                "base_commit": self.base_commit, "validation": self.validation,
                "approved_at": self.approved_at, "note": self.note}

    def info(self) -> dict:
        try:
            title = projects.get_meta(self.slug)["title"]
        except (FileNotFoundError, ValueError):
            title = self.slug
        n = int(self.version.removeprefix("prompt") or 0)
        return {"slug": self.slug, "version": self.version, "n": n, "title": title, "state": self.state,
                "phase": self.phase, "alive": self.alive, "cwd": self.cwd, "created": self.created,
                "pending_prompt": self.typing is not None and not self.typing.done(),
                "validation": self.validation, "note": self.note or find_note(self)}

    @property
    def n(self) -> int:
        return int(self.version.removeprefix("prompt") or 0)

    # salida de la terminal → historial y clientes conectados
    def _output(self, data: bytes) -> None:
        self.history += data
        if len(self.history) > HISTORY_BYTES:
            del self.history[:len(self.history) - HISTORY_BYTES]
        for q in self.clients:
            q.put_nowait(data)

    def _send(self, msg: dict) -> None:
        for q in self.clients:
            q.put_nowait(msg)


_agents: dict[str, Agente] = {}
_watchers: set[asyncio.Queue] = set()  # vistas del gestor que siguen la lista de agentes
_log: deque[dict] = deque(maxlen=80)   # mensajes de orquestación de Prometeo («Agente 2 terminó, validando…»)


def _broadcast() -> None:
    items = list_all()
    for q in _watchers:
        q.put_nowait({"type": "agents", "agents": items})


def say(a: Agente, text: str, kind: str = "info") -> None:
    """Prometeo anuncia lo que hace con un agente: aparece en el registro del orquestador."""
    msg = {"at": _now(), "slug": a.slug, "version": a.version, "n": a.n, "text": text, "kind": kind}
    _log.append(msg)
    for q in _watchers:
        q.put_nowait({"type": "log", "entry": msg})


def _persist(a: Agente) -> None:
    items = [r for r in projects.agents(a.slug) if r.get("version") != a.version]
    items.append(a.record())
    projects.save_agents(a.slug, sorted(items, key=lambda r: int(r["version"].removeprefix("prompt"))))


def get(slug: str, version: str) -> Agente | None:
    key = f"{slug}/{version}"
    if key not in _agents:
        rec = next((r for r in projects.agents(slug) if r.get("version") == version), None)
        if rec is None:
            return None
        _agents[key] = Agente(slug, version, rec)
    return _agents[key]


def list_all() -> list[dict]:
    """Agentes vivos y los guardados en agentes.json de cada proyecto (estos, parados)."""
    if projects.PROJECTS_DIR.exists():
        for d in projects.PROJECTS_DIR.iterdir():
            if (d / projects.AGENTS_FILE).is_file():
                with contextlib.suppress(ValueError, json.JSONDecodeError):
                    for r in projects.agents(d.name):
                        get(d.name, r["version"])
    return sorted((a.info() for a in _agents.values()), key=lambda i: i["created"], reverse=True)


def _settings_file(a: Agente) -> Path:
    """Ajustes por agente pasados con --settings: los hooks avisan al backend de cada cambio de
    estado. No toca la configuración del repositorio ni la del usuario."""
    url = f"http://127.0.0.1:{PORT}/api/agents/{a.slug}/{a.version}/hooks"
    cmd = (f'curl -s -m 3 -X POST -H "Content-Type: application/json" -H "X-Prometeo-Token: {TOKEN}" '
           f'--data-binary @- {url} || exit 0')
    hook = [{"matcher": "*", "hooks": [{"type": "command", "command": cmd, "timeout": 5}]}]
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    f = SETTINGS_DIR / f"{a.slug}-{a.version}.json"
    f.write_text(json.dumps({"hooks": {e: hook for e in HOOK_EVENTS}}, indent=1), encoding="utf-8", newline="\n")
    with contextlib.suppress(OSError):
        f.chmod(0o600)  # lleva el token
    return f


def _has_transcript(session_id: str) -> bool:
    """--resume solo funciona si la sesión llegó a guardar algo."""
    return any((plataforma.carpeta_config_claude() / "projects").glob(f"*/{session_id}.jsonl"))


def claude_bin() -> str | None:
    return shutil.which("claude")


async def start(slug: str, version: str, cols: int = 120, rows: int = 32, prompt: bool = False) -> Agente:
    """Lanza (o retoma) el agente de esa versión del prompt. Si ya está vivo, lo devuelve tal cual.
    version="actual" es la vigente. Con prompt=True, la primera vez escribe el texto inicial en la
    terminal cuando Claude Code está listo, sin Enter: lo envía la persona."""
    if version == "actual":
        version = projects.current(slug).name
    if version not in projects.versions(slug):
        raise ValueError("versión del prompt desconocida")
    exe = claude_bin()
    if not exe:
        raise RuntimeError("No encuentro Claude Code (`claude`) en el PATH")
    a = get(slug, version) or Agente(slug, version)
    _agents[a.key] = a
    async with a.starting:  # doble clic en Ejecutar: el segundo recibe el agente del primero
        if not a.alive:
            await _spawn(a, exe, cols, rows)
            if prompt and not a.prompted:
                a.typing = asyncio.create_task(_type_initial(a, a.term))
                _broadcast()
    return a


READY_TIMEOUT = 15 * 60  # la persona puede tardar en aceptar el diálogo de confianza de la carpeta


async def _type_initial(a: Agente, term: plataforma.Terminal) -> None:
    """Espera a SessionStart (que llega después del diálogo de confianza) y pega el texto inicial
    como *bracketed paste*: así los saltos de línea no lo envían. Nunca escribe el Enter."""
    try:
        await asyncio.wait_for(a.ready.wait(), READY_TIMEOUT)
    except asyncio.TimeoutError:
        return
    await asyncio.sleep(0.8)  # SessionStart llega un instante antes de que se pinte la caja de texto
    if a.term is not term or not a.alive or a.prompted:
        return
    await write(a, b"\x1b[200~" + initial_text(a).encode("utf-8") + b"\x1b[201~")
    a.prompted = True
    _persist(a)
    a._send({"type": "prompted"})
    _broadcast()


NOTE_TEMPLATE = """---
agent: {n}
prompt: {version}
date: YYYY-MM-DD
status: done
repo: {repo}
---
# <Task title>

## Summary
## Changes
## Files touched
## Decisions
## Open issues / Follow-ups"""


def _prompt_body(text: str) -> str:
    """Solo la sección «## Prompt» si existe (sin el título ni el «Cómo usarlo»)."""
    import re
    m = re.search(r"^## Prompt\s*\n(.*?)(?=^## (?!#)|\Z)", text, re.S | re.M)
    return (m.group(1) if m else text).strip()


def initial_text(a: Agente) -> str:
    vdir = projects.project_dir(a.slug) / projects.PROMPTS_DIR / a.version
    vault = projects.vault(a.slug)
    tasks = projects.tasks_dir(a.slug)
    n = int(a.version.removeprefix("prompt"))
    extra = [f for f in ("notas.md", "plan.md", "tareas.md") if (vdir / f).is_file()]
    prompt_md = vdir / "prompt.md"
    body = _prompt_body(prompt_md.read_text(encoding="utf-8")) if prompt_md.is_file() else ""
    lines = [
        f"Eres el agente {n} de PROMETEO. Antes de hacer nada:",
        f"1. Lee la Vault de Obsidian del proyecto en {vault}: primero context.md (si existe) y {tasks / 'index.md'}, "
        "y las notas de tareas que sean relevantes.",
        f"2. Lee {prompt_md}" + (" y " + ", ".join(str(vdir / f) for f in extra) if extra else "") + ".",
        "3. Después ejecuta el prompt que va abajo. Trabaja conmigo en esta terminal y pregúntame lo que no esté claro.",
        "",
        "Reglas de cierre (obligatorias):",
        "- Cuando creas que has terminado, dímelo y espera a que valide o te pida correcciones.",
        f"- Cuando dé el visto bueno, documenta la tarea EN INGLÉS en {tasks}/AAAA-MM-DD-agent-{n}-<slug>.md con "
        f"esta plantilla, y enlázala al principio de {tasks / 'index.md'}. Si me olvido de pedírtelo, propónmelo tú. "
        "Documentar no es opcional: solo puedo añadir o ajustar el texto. Nota concisa y útil para el próximo agente, no un volcado.",
        "",
        NOTE_TEMPLATE.format(n=n, version=a.version, repo=a.cwd or ""),
    ]
    if body:
        lines += ["", "--- PROMPT ---", body]
    return "\n".join(lines)


async def _spawn(a: Agente, exe: str, cols: int, rows: int) -> None:
    slug = a.slug
    cwd = projects.workdir(slug)
    projects.tasks_dir(slug)
    a.cwd, a.ready = str(cwd), asyncio.Event()
    cmd = [exe, "--settings", str(_settings_file(a))]
    cmd += ["--resume", a.session_id] if _has_transcript(a.session_id) else ["--session-id", a.session_id]
    environ = plataforma.entorno_hijos(TERM="xterm-256color", COLORTERM="truecolor",
                                       PROMETEO_AGENT=a.key, PROMETEO_PROJECT_DIR=str(projects.project_dir(slug)))
    for k in _SESSION_MARKERS:  # si PROMETEO se arrancó desde otro Claude Code: sin esto no guarda la sesión
        environ.pop(k, None)
    if a.base_commit is None:
        a.base_commit = _git(cwd, "rev-parse", "HEAD") or None
    a.term = plataforma.Terminal(cmd, cwd, environ, cols, rows)
    a.state = "esperando"
    _persist(a)
    loop = asyncio.get_running_loop()
    threading.Thread(target=_reader, args=(a, a.term, loop), daemon=True, name=f"pty-{a.key}").start()
    log.info("Agente %s lanzado en %s (pid %s)", a.key, cwd, a.term.pid)
    say(a, f"Agente {a.n} en marcha en {cwd.name}.")
    _broadcast()


def _reader(a: Agente, term: plataforma.Terminal, loop: asyncio.AbstractEventLoop) -> None:
    while data := term.leer():
        loop.call_soon_threadsafe(a._output, data)
    term.cerrar()
    loop.call_soon_threadsafe(_exited, a, term)


def _exited(a: Agente, term: plataforma.Terminal) -> None:
    if a.term is not term:  # ya se relanzó
        return
    a.term = None
    a.state = "parado"
    a._send({"type": "exit"})
    a._send({"type": "state", "state": a.state})
    log.info("Agente %s terminado", a.key)
    say(a, f"Agente {a.n} se ha detenido.")
    _broadcast()


async def write(a: Agente, data: bytes) -> None:
    if a.alive:
        await asyncio.to_thread(a.term.escribir, data)


def resize(a: Agente, cols: int, rows: int) -> None:
    if a.alive and 10 <= cols <= 500 and 5 <= rows <= 300:
        a.term.redimensionar(cols, rows)


async def stop(a: Agente) -> None:
    if a.term is not None:
        await asyncio.to_thread(a.term.parar)


async def stop_all() -> None:
    await asyncio.gather(*(stop(a) for a in _agents.values() if a.alive), return_exceptions=True)


def set_state(a: Agente, state: str) -> None:
    if state != a.state:
        a.state = state
        a._send({"type": "state", "state": state})
        _broadcast()


def hook(a: Agente, payload: dict) -> str:
    """Traduce un evento de Claude Code a un estado del agente."""
    ev, tool = payload.get("hook_event_name"), payload.get("tool_name") or ""
    if ev == "SessionStart":
        a.ready.set()
        state = "esperando"
    elif ev == "UserPromptSubmit" or ev == "PostToolUse":
        state = "pensando"
    elif ev == "PreToolUse":
        state = "escribiendo" if tool in CODE_TOOLS else "pensando"
    elif ev == "PostToolUse" and a.phase == "documentando" and tool in CODE_TOOLS:
        set_state(a, "pensando")
        _broadcast()  # puede que acabe de escribir su nota en la Vault
        return a.state
    elif ev in ("Notification", "Stop"):  # Stop salta en cada turno: no es «tarea terminada»
        state = "esperando"
    elif ev == "SessionEnd":
        state = "parado"
    else:
        return a.state
    set_state(a, state)
    return state


def subscribe(a: Agente) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait({"type": "hello", "agent": a.info()})
    if a.history:
        q.put_nowait(bytes(a.history))
    a.clients.add(q)
    return q


def unsubscribe(a: Agente, q: asyncio.Queue) -> None:
    a.clients.discard(q)


def watch() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    q.put_nowait({"type": "agents", "agents": list_all()})
    q.put_nowait({"type": "log_all", "entries": list(_log)})
    _watchers.add(q)
    return q


def unwatch(q: asyncio.Queue) -> None:
    _watchers.discard(q)


# ---------------- Ciclo de la tarea: validación, correcciones y documentación obligatoria ----------------
# trabajando → validando → revision → (corregir → trabajando …) → documentando → cerrado
PHASES = ("trabajando", "validando", "revision", "documentando", "cerrado")
EVIDENCE_CHARS = 40_000
# La Vault y los entregables los escribe PROMETEO (o el agente al documentar), no son el trabajo que se valida.
_SKIP_DIRS = {".git", "node_modules", ".venv", "__pycache__", "dist", projects.PROMPTS_DIR, projects.VAULT_DIR}


class PhaseError(Exception):
    """Acción no permitida en la fase actual (o falta la nota de la Vault)."""


def _git(cwd: Path, *args: str) -> str:
    import subprocess
    try:
        r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8",
                           errors="replace", timeout=20)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def _small_text(p: Path, limit: int = 8000) -> str | None:
    try:
        if p.stat().st_size > limit:
            return None
        return p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def evidence(a: Agente) -> str:
    """Lo que ha cambiado desde que se lanzó el agente: git diff si es un repo; si no, archivos tocados."""
    cwd = Path(a.cwd or projects.workdir(a.slug))
    parts: list[str] = []
    # La carpeta de un proyecto vive dentro del repo de PROMETEO: su diff sería el de PROMETEO, no el del agente.
    in_projects = cwd.resolve().is_relative_to(projects.PROJECTS_DIR.resolve())
    if not in_projects and _git(cwd, "rev-parse", "--is-inside-work-tree") == "true":
        base = a.base_commit or "HEAD"
        parts.append(f"Repositorio git en {cwd}. Cambios desde {base[:10]}.")
        if commits := _git(cwd, "log", "--oneline", f"{base}..HEAD"):
            parts.append(f"## Commits del agente\n{commits}")
        parts.append(f"## git status\n{_git(cwd, 'status', '--porcelain') or '(limpio)'}")
        if stat := _git(cwd, "diff", base, "--stat"):
            parts.append(f"## git diff --stat\n{stat}")
        if diff := _git(cwd, "diff", base):
            parts.append(f"## git diff\n{diff}")
        new = _git(cwd, "ls-files", "--others", "--exclude-standard").splitlines()
        for f in new[:10]:
            if (txt := _small_text(cwd / f)) is not None:
                parts.append(f"## Archivo nuevo: {f}\n{txt}")
        if len(new) > 10:
            parts.append("Otros archivos nuevos: " + ", ".join(new[10:60]))
    else:
        since = datetime.fromisoformat(a.created).timestamp()
        touched: list[Path] = []
        for root, dirs, files in os.walk(cwd):
            dirs[:] = [d for d in dirs if d not in _SKIP_DIRS]
            for f in files:
                p = Path(root) / f
                if f not in (projects.AGENTS_FILE, "meta.json") and p.stat().st_mtime >= since:
                    touched.append(p)
            if len(touched) > 200:
                break
        parts.append(f"{cwd} no es un repositorio git. Archivos creados o modificados desde que empezó el agente:")
        parts.append("\n".join(str(p.relative_to(cwd)) for p in touched[:200]) or "(ninguno)")
        for p in touched[:10]:
            if (txt := _small_text(p)) is not None:
                parts.append(f"## {p.relative_to(cwd)}\n{txt}")
    out = "\n\n".join(parts)
    return out if len(out) <= EVIDENCE_CHARS else out[:EVIDENCE_CHARS] + "\n\n[… evidencia recortada …]"


def find_note(a: Agente) -> str | None:
    """La nota de este agente en obsidian-vault/tasks/ (escrita tras el visto bueno), relativa a la Vault."""
    try:
        tasks = projects.vault(a.slug) / projects.TASKS_DIR
    except (FileNotFoundError, ValueError):
        return None
    if not tasks.is_dir():
        return None
    since = datetime.fromisoformat(a.approved_at).timestamp() - 5 if a.approved_at else 0
    notes = sorted((p for p in tasks.glob(f"*agent-{a.n}-*.md") if p.stat().st_mtime >= since),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    return f"{projects.TASKS_DIR}/{notes[0].name}" if notes else None


def _verdict(text: str) -> str:
    first = text.strip().splitlines()[0].upper() if text.strip() else ""
    return "ok" if "VEREDICTO: OK" in first else "revisar"


async def _validate(a: Agente) -> None:
    from .brain import validate_work
    prompt_md = projects.project_dir(a.slug) / projects.PROMPTS_DIR / a.version / "prompt.md"
    prompt_text = _prompt_body(prompt_md.read_text(encoding="utf-8")) if prompt_md.is_file() else ""
    try:
        ev = await asyncio.to_thread(evidence, a)
        text = await validate_work(prompt_text, ev)
        a.validation = {"verdict": _verdict(text), "text": text, "at": _now()}
        say(a, f"Validación del agente {a.n}: {'todo en orden' if a.validation['verdict'] == 'ok' else 'hay cosas que revisar'}.",
            "ok" if a.validation["verdict"] == "ok" else "warn")
    except Exception as e:  # noqa: BLE001
        log.exception("No se pudo validar %s", a.key)
        a.validation = {"verdict": "error", "text": f"No pude validar: {e}", "at": _now()}
        say(a, f"No he podido validar al agente {a.n}.", "error")
    a.phase = "revision"
    _persist(a)
    _broadcast()


async def _paste(a: Agente, text: str) -> None:
    """Escribe un texto en la terminal del agente sin enviarlo: la persona lo revisa y pulsa Enter."""
    if not a.alive:
        raise PhaseError("El agente está parado: retómalo primero.")
    await write(a, b"\x1b[200~" + text.encode("utf-8") + b"\x1b[201~")
    a._send({"type": "pasted"})


async def advance(a: Agente, action: str) -> None:
    """Acciones del ciclo: terminar, corregir, aprobar, cerrar, reabrir."""
    if action == "terminar":
        if a.phase != "trabajando":
            raise PhaseError("Solo se puede marcar como terminado mientras trabaja.")
        a.phase = "validando"
        say(a, f"Agente {a.n} ha terminado. Validando su trabajo…")
        a.validating = asyncio.create_task(_validate(a))
    elif action == "corregir":
        if a.phase != "revision":
            raise PhaseError("Primero hay que validar el trabajo.")
        if a.validation and a.validation.get("verdict") == "revisar":
            await _paste(a, "Prometeo ha revisado tu trabajo. Corrige esto y avísame cuando esté:\n\n"
                         + a.validation["text"])
        a.phase = "trabajando"
        say(a, f"Agente {a.n} vuelve al trabajo con correcciones.")
    elif action == "aprobar":
        if a.phase != "revision":
            raise PhaseError("Primero hay que validar el trabajo.")
        tasks = projects.tasks_dir(a.slug)
        await _paste(a, f"Visto bueno. Ahora documenta la tarea EN INGLÉS en {tasks}/AAAA-MM-DD-agent-{a.n}-<slug>.md "
                        f"con la plantilla que te di (frontmatter + Summary, Changes, Files touched, Decisions, "
                        f"Open issues / Follow-ups) y enlázala al principio de {tasks / 'index.md'}. "
                        "Concisa y útil para el próximo agente.")
        a.approved_at = _now()
        a.phase = "documentando"
        say(a, f"Visto bueno al agente {a.n}. Le pido que documente la tarea en la Vault.", "ok")
    elif action == "cerrar":
        if a.phase != "documentando":
            raise PhaseError("Solo se cierra después del visto bueno y la documentación.")
        note = find_note(a)
        if not note:
            raise PhaseError("Falta la nota de la tarea en obsidian-vault/tasks/. Documentar es obligatorio.")
        a.note = note
        a.phase = "cerrado"
        say(a, f"Agente {a.n} cerrado. Tarea documentada en {note}.", "ok")
    elif action == "reabrir":
        if a.phase != "cerrado":
            raise PhaseError("Solo se reabre un agente cerrado.")
        a.phase, a.note, a.approved_at, a.validation = "trabajando", None, None, None
        say(a, f"Agente {a.n} reabierto.")
    else:
        raise PhaseError(f"Acción desconocida: {action}")
    _persist(a)
    _broadcast()
