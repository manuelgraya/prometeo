"""Servidor PROMETEO: REST + WebSocket de sesión (voz/texto)."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import threading
from collections.abc import Coroutine

import numpy as np
from fastapi import Body, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import agentes, local, plataforma, projects
from .brain import HANDOFF_TOOL, Brain, run_architect, suggest_title
from .config import (CHOICES, FAQ_AUDIO_DIR, FAQ_CACHE_DIR, FRONTEND_DIST, PROJECTS_DIR, agent_meta, clamp_speed,
                     load_faqs, load_settings, load_voice, save_settings, save_voice)
from .speech import SAMPLE_TEXT, STT, TTS, VOICES, SentenceSplitter, capabilities

log = logging.getLogger("prometeo")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

app = FastAPI(title="PROMETEO")
PROJECTS_DIR.mkdir(exist_ok=True)

_stt: STT | None = None
_tts: TTS | None = None
_stt_lock, _tts_lock = threading.Lock(), threading.Lock()
_loading: set[str] = set()
# Trabajos del Arquitecto: siguen aunque se cierre la pestaña, para que los archivos se escriban.
_jobs: dict[str, asyncio.Task] = {}
_pending: dict[str, tuple[list[str], str]] = {}  # encargo en cola por proyecto (entregables, brief)
# asyncio solo guarda referencias débiles a las tareas: sin esto, una tarea suelta podría desaparecer a medias.
_background: set[asyncio.Task] = set()


def background(coro: Coroutine) -> asyncio.Task:
    """Lanza una tarea que nadie espera (recargar un modelo, titular un proyecto...) sin que se pierda."""
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)
    return task


def stt() -> STT:
    global _stt
    with _stt_lock:
        if _stt is None:
            st = load_settings()
            _stt = STT(st["stt_device"], st["whisper_model"])
        return _stt


def tts() -> TTS:
    global _tts
    with _tts_lock:
        if _tts is None:
            _tts = TTS(load_settings()["tts_device"])
        return _tts


def _warm_tts(engine: TTS) -> None:
    """Primera síntesis: la que más tarda (carga de la sesión ONNX), mejor antes de que hable."""
    engine.wav("Hola.", load_voice()["voice"], 1.0)


async def _reload(which: str) -> None:
    """Recarga un modelo con los ajustes nuevos sin cortar el servicio: el viejo
    sigue atendiendo hasta que el nuevo está listo."""
    global _stt, _tts
    _loading.add(which)
    try:
        st = load_settings()
        if which == "tts":
            new = await asyncio.to_thread(TTS, st["tts_device"])
            await asyncio.to_thread(_warm_tts, new)
            _tts = new
        else:
            _stt = await asyncio.to_thread(STT, st["stt_device"], st["whisper_model"])
        log.info("Modelo %s recargado", which)
    except Exception:  # noqa: BLE001
        log.exception("No se pudo recargar %s", which)
    finally:
        _loading.discard(which)
        _samples.clear()


@app.on_event("startup")
async def warmup() -> None:
    # Carga los modelos en segundo plano para que la primera frase no tarde.
    async def _load():
        _loading.update({"tts", "stt"})
        try:
            await asyncio.to_thread(lambda: _warm_tts(tts()))
            _loading.discard("tts")
            await asyncio.to_thread(stt)
            log.info("Modelos de voz listos")
        finally:
            _loading.clear()
    background(_load())


# ---------------- REST ----------------
def _runtime() -> dict:
    return {
        "tts": {"device": _tts.device, "error": _tts.error} if _tts else None,
        "stt": {"device": _stt.device, "model": _stt.size, "error": _stt.error} if _stt else None,
        "loading": sorted(_loading),
    }


@app.get("/api/state")
def state():
    return {"agent": agent_meta(), "voice": load_voice(), "voices": VOICES,
            "settings": load_settings(), "choices": CHOICES, "capabilities": capabilities(),
            "runtime": _runtime(), "models_ready": _stt is not None and _tts is not None}


@app.put("/api/settings")
async def put_settings(data: dict = Body(...)):
    before = load_settings()
    after = save_settings(**data)
    changed = {"tts": after["tts_device"] != before["tts_device"],
               "stt": any(after[k] != before[k] for k in ("stt_device", "whisper_model"))}
    for which in (w for w, c in changed.items() if c):
        _loading.add(which)  # visible ya en esta respuesta
        background(_reload(which))
    return {"settings": after, "runtime": _runtime()}


@app.get("/api/local-models")
def local_models():
    """Modelos de LM Studio (los guarda en ~/.lmstudio/models). reachable=false si no está en marcha."""
    return {**local.list_models(), "url": load_settings()["lmstudio_url"]}


@app.put("/api/voice")
def put_voice(data: dict = Body(...)):
    """Elección manual de voz (catálogo / ajustes). configured=false vuelve a la primera configuración."""
    voice = data.get("voice")
    if voice is not None and voice not in VOICES:
        raise HTTPException(400, "Voz desconocida")
    speed = data.get("speed")
    if speed is not None:
        speed = clamp_speed(speed)
    configured = data.get("configured")
    return save_voice(voice=voice, speed=speed, configured=bool(configured) if configured is not None else None)


_samples: dict[tuple[str, float], bytes] = {}


@app.get("/api/voices/{voice}/sample")
async def voice_sample(voice: str, speed: float = 1.0):
    """Prometeo se presenta con esa voz (WAV). Se cachea por voz y velocidad."""
    if voice not in VOICES:
        raise HTTPException(404, "Voz desconocida")
    key = (voice, clamp_speed(speed))
    if key not in _samples:
        wav = await asyncio.to_thread(tts().wav, SAMPLE_TEXT, *key)
        if not wav:
            raise HTTPException(500, "No se pudo generar el audio")
        _samples[key] = wav
    return Response(_samples[key], media_type="audio/wav")


# ---------------- Preguntas frecuentes ----------------
_FAQ_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".webm": "audio/webm"}
_faq_locks: dict[str, asyncio.Lock] = {}


def _recorded(fid: str):
    """Grabación hecha a mano para esa pregunta (agent/faqs-audio/<id>.wav|mp3|…), si la hay."""
    return next((p for ext in _FAQ_TYPES if (p := FAQ_AUDIO_DIR / f"{fid}{ext}").is_file()), None)


def _faq_cache(faq: dict, voice: str, speed: float):
    # La clave incluye texto, voz y velocidad: si cambian, se genera otra vez
    key = hashlib.sha1(f"{faq['answer']}|{voice}|{speed}".encode()).hexdigest()[:12]
    return FAQ_CACHE_DIR / f"{faq['id']}-{key}.wav"


async def _faq_audio(faq: dict):
    if rec := _recorded(faq["id"]):
        return rec
    v = load_voice()
    path = _faq_cache(faq, v["voice"], float(v["speed"]))
    if path.exists():
        return path
    async with _faq_locks.setdefault(faq["id"], asyncio.Lock()):
        if path.exists():
            return path
        wav = await asyncio.to_thread(tts().wav, faq["answer"], v["voice"], v["speed"])
        if not wav:
            return None
        FAQ_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        for old in FAQ_CACHE_DIR.glob(f"{faq['id']}-*.wav"):  # versiones de otra voz o texto
            old.unlink(missing_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(wav)
        tmp.replace(path)
        return path


@app.get("/api/faqs")
def list_faqs():
    """Preguntas de agent/faqs.md. recorded=true si tienen grabación propia."""
    return [{**f, "recorded": _recorded(f["id"]) is not None} for f in load_faqs()]


@app.get("/api/faqs/{fid}/audio")
async def faq_audio(fid: str):
    """Respuesta de Prometeo en audio: la grabación propia o la generada con Kokoro (cacheada en disco)."""
    faq = next((f for f in load_faqs() if f["id"] == fid), None)
    if not faq:
        raise HTTPException(404, "Pregunta desconocida")
    path = await _faq_audio(faq)
    if not path:
        raise HTTPException(500, "No se pudo generar el audio")
    return FileResponse(path, media_type=_FAQ_TYPES.get(path.suffix, "audio/wav"),
                        headers={"Cache-Control": "no-cache"})


@app.get("/api/projects")
def list_projects():
    return projects.list_all()


@app.get("/api/projects/{slug}")
def get_project(slug: str):
    try:
        return {"meta": projects.get_meta(slug) | {"version": projects.current(slug).name},
                "artifacts": projects.artifacts(slug),
                "conversation": projects.conversation(slug)}
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Proyecto no encontrado")


@app.put("/api/projects/{slug}/repo")
def set_project_repo(request: Request, slug: str, body: dict = Body(...),
                     x_prometeo_token: str | None = Header(None)):
    """Repositorio de código donde trabajan los agentes de este proyecto (None = la carpeta del proyecto)."""
    _agent_guard(request, x_prometeo_token)
    try:
        return projects.set_repo(slug, body.get("repo"))
    except FileNotFoundError:
        raise HTTPException(404, "Proyecto no encontrado")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/projects/{slug}")
def delete_project(slug: str):
    try:
        projects.delete(slug)
    except (FileNotFoundError, ValueError):
        raise HTTPException(404, "Proyecto no encontrado")
    return {"ok": True}


# ---------------- Agentes de Claude Code (gestor) ----------------
# Lanzan procesos en este ordenador: solo Host local, Origin de la interfaz y token (ver agentes.py).
def _agent_guard(request: Request, token: str | None) -> None:
    origin = request.headers.get("origin")
    if (not agentes.host_ok(request.headers.get("host")) or not agentes.token_ok(token)
            or (origin is not None and not agentes.origin_ok(origin))):
        raise HTTPException(403, "Acceso denegado")


def _find_agent(slug: str, version: str) -> agentes.Agente | None:
    try:
        return agentes.get(slug, version)
    except (FileNotFoundError, ValueError):  # proyecto inexistente o slug inválido
        return None


def _agent_or_404(slug: str, version: str) -> agentes.Agente:
    if (a := _find_agent(slug, version)) is None:
        raise HTTPException(404, "Agente no encontrado")
    return a


@app.get("/api/agents/token")
def agents_token(request: Request):
    """Sin CORS, otra web no puede leer esta respuesta; el Host local corta el DNS rebinding."""
    if not agentes.host_ok(request.headers.get("host")):
        raise HTTPException(403, "Acceso denegado")
    return {"token": agentes.TOKEN, "claude": agentes.claude_bin() is not None}


@app.get("/api/agents")
def list_agents(request: Request, x_prometeo_token: str | None = Header(None)):
    _agent_guard(request, x_prometeo_token)
    return agentes.list_all()


@app.post("/api/agents/{slug}/{version}")
async def start_agent(request: Request, slug: str, version: str, body: dict = Body(default={}),
                      x_prometeo_token: str | None = Header(None)):
    _agent_guard(request, x_prometeo_token)
    try:
        a = await agentes.start(slug, version, int(body.get("cols", 120)), int(body.get("rows", 32)),
                                prompt=bool(body.get("prompt")))
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return a.info()


@app.delete("/api/agents/{slug}/{version}")
async def stop_agent(request: Request, slug: str, version: str, x_prometeo_token: str | None = Header(None)):
    _agent_guard(request, x_prometeo_token)
    await agentes.stop(_agent_or_404(slug, version))
    return {"ok": True}


@app.post("/api/agents/{slug}/{version}/phase")
async def agent_phase(request: Request, slug: str, version: str, body: dict = Body(...),
                      x_prometeo_token: str | None = Header(None)):
    """Ciclo de la tarea: terminar → (validación de Prometeo) → corregir | aprobar → cerrar (con nota)."""
    _agent_guard(request, x_prometeo_token)
    a = _agent_or_404(slug, version)
    try:
        await agentes.advance(a, str(body.get("action", "")))
    except agentes.PhaseError as e:
        raise HTTPException(409, str(e))
    return a.info()


@app.post("/api/agents/{slug}/{version}/hooks")
async def agent_hook(request: Request, slug: str, version: str, x_prometeo_token: str | None = Header(None)):
    """Lo llaman los hooks de Claude Code (curl) con el JSON del evento por stdin. Responde vacío:
    lo que imprime un hook (UserPromptSubmit, SessionStart) acaba en el contexto del agente."""
    _agent_guard(request, x_prometeo_token)
    try:
        payload = await request.json()
    except ValueError:
        payload = {}
    agentes.hook(_agent_or_404(slug, version), payload)
    return Response(status_code=204)


def _ws_agent_ok(ws: WebSocket, token: str | None) -> bool:
    return (agentes.host_ok(ws.headers.get("host")) and agentes.origin_ok(ws.headers.get("origin"))
            and agentes.token_ok(token))


async def _pump(ws: WebSocket, q: asyncio.Queue) -> None:
    while True:
        m = await q.get()
        if isinstance(m, bytes):
            await ws.send_bytes(m)
        else:
            await ws.send_json(m)


@app.websocket("/ws/agents")
async def ws_agents(ws: WebSocket, token: str | None = None):
    """Lista de agentes y sus estados en vivo, para el gestor."""
    if not _ws_agent_ok(ws, token):
        await ws.close(code=4403)
        return
    await ws.accept()
    q = agentes.watch()
    pump = asyncio.create_task(_pump(ws, q))
    try:
        while (await ws.receive())["type"] != "websocket.disconnect":
            pass
    except WebSocketDisconnect:
        pass
    finally:
        pump.cancel()
        agentes.unwatch(q)


@app.websocket("/ws/agents/{slug}/{version}")
async def ws_agent_terminal(ws: WebSocket, slug: str, version: str, token: str | None = None):
    """Terminal de un agente. Servidor → binario (salida) | {"type": "hello"|"state"|"exit"}.
    Cliente → binario o {"type":"input","data"} (teclas) | {"type":"resize","cols","rows"}."""
    if not _ws_agent_ok(ws, token):
        await ws.close(code=4403)
        return
    if (a := _find_agent(slug, version)) is None:
        await ws.close(code=4404)
        return
    await ws.accept()
    q = agentes.subscribe(a)
    pump = asyncio.create_task(_pump(ws, q))
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                await agentes.write(a, msg["bytes"])
            elif msg.get("text"):
                with contextlib.suppress(ValueError, KeyError, TypeError):
                    d = json.loads(msg["text"])
                    if d.get("type") == "input":
                        await agentes.write(a, str(d["data"]).encode("utf-8"))
                    elif d.get("type") == "resize":
                        agentes.resize(a, int(d["cols"]), int(d["rows"]))
    except WebSocketDisconnect:
        pass
    finally:
        pump.cancel()
        agentes.unsubscribe(a, q)


@app.on_event("shutdown")
async def stop_agents() -> None:
    await agentes.stop_all()


# ---------------- Sesión WebSocket ----------------
GREETINGS = {
    "voz": "Hola, soy Prometeo. Antes de empezar, elijamos cómo quieres que suene mi voz. ¿La prefieres grave y serena, o más enérgica?",
    "nuevo": ("Hola, soy Prometeo, tu agente de planificación. "
              "Me cuentas tu idea, te hago las preguntas justas y te preparo el plan, las tareas, el prompt o las notas. "
              "¿Qué quieres planificar hoy?"),
    "reanudar": "Retomamos «{title}». ¿Por dónde seguimos?",
}


# Alucinaciones típicas de whisper con ruido o silencio
_NOISE = {"", "gracias", "gracias.", "subtítulos realizados por la comunidad de amara.org", "¡gracias!", "...", "música"}


def _meaningful(text: str) -> bool:
    t = text.strip().lower()
    # Con initial_prompt, sobre ruido Whisper a veces repite el propio prompt
    return len(t) > 1 and t not in _NOISE and "amara.org" not in t and "prometeo sobre planificar" not in t


class Session:
    """Protocolo:
    cliente → {"type":"text","text"} | {"type":"interrupt"} | binario Float32 PCM 16 kHz (una frase)
    servidor → ready, state, transcript, delta, tool, project, artifacts, architect, voice, voice_setup_done, turn_end, error
               + binario WAV (una frase de voz) precedido de {"type":"audio","turn":n}
    """

    def __init__(self, ws: WebSocket, mode: str, slug: str | None) -> None:
        self.ws, self.mode, self.slug = ws, mode, slug
        self.brain = Brain("voz" if mode == "voz" else "plan", slug, on_event=self.send, on_handoff=self.handoff)
        self.closed = False
        self.turn = 0
        self.task: asyncio.Task | None = None
        self.send_lock = asyncio.Lock()
        # Proyectos nuevos reciben título automático tras el primer mensaje
        self.titled = not slug or projects.get_meta(slug)["title"] != "Proyecto sin título"

    async def send(self, msg: dict) -> None:
        with contextlib.suppress(Exception):
            async with self.send_lock:
                await self.ws.send_json(msg)

    async def send_audio(self, turn: int, wav: bytes) -> None:
        with contextlib.suppress(Exception):
            async with self.send_lock:
                await self.ws.send_json({"type": "audio", "turn": turn})
                await self.ws.send_bytes(wav)

    async def speak(self, turn: int, sentences: asyncio.Queue) -> None:
        """Consume frases y las convierte en audio mientras Claude sigue escribiendo."""
        first = True
        while (s := await sentences.get()) is not None:
            if turn != self.turn:
                continue
            v = load_voice()
            wav = await asyncio.to_thread(tts().wav, s, v["voice"], v["speed"])
            if wav and turn == self.turn:
                if first:
                    await self.send({"type": "state", "state": "speaking"})
                    first = False
                await self.send_audio(turn, wav)

    async def say(self, text: str) -> None:
        """Frase fija (saludo) sin pasar por Claude."""
        self.turn += 1
        await self.send({"type": "turn_start", "turn": self.turn})
        await self.send({"type": "delta", "text": text})
        if self.slug:
            projects.append_turn(self.slug, "assistant", text)
        q: asyncio.Queue = asyncio.Queue()
        splitter = SentenceSplitter(min_len=15)
        for part in splitter.feed(text + " ") + splitter.flush():
            await q.put(part)
        await q.put(None)
        await self.speak(self.turn, q)
        await self.send({"type": "turn_end", "turn": self.turn})

    async def run_turn(self, user_text: str) -> None:
        self.turn += 1
        turn = self.turn
        await self.send({"type": "turn_start", "turn": turn})
        await self.send({"type": "state", "state": "thinking"})
        if self.slug:
            projects.append_turn(self.slug, "user", user_text)
        sentences: asyncio.Queue = asyncio.Queue()
        speaker = asyncio.create_task(self.speak(turn, sentences))
        if self.slug and not self.titled:
            self.titled = True
            background(self.auto_title(user_text))
        splitter, full, wrote = SentenceSplitter(), "", False
        try:
            async for ev in self.brain.ask(user_text):
                if ev["type"] == "delta":
                    full += ev["text"]
                    await self.send(ev)
                    for s in splitter.feed(ev["text"]):
                        await sentences.put(s)
                elif ev["type"] == "tool":
                    # El texto anterior a una herramienta ya está completo: que suene ya.
                    for s in splitter.flush():
                        await sentences.put(s)
                    if ev["name"] in ("Skill", HANDOFF_TOOL) and not full.strip():
                        # Que no haya silencio mientras se escribe el entregable
                        ack = "Vale, me pongo con ello."
                        full += ack + " "
                        await self.send({"type": "delta", "text": ack + " "})
                        await sentences.put(ack)
                    await self.send(ev)
                    wrote |= ev["name"] in ("Write", "Edit")
                elif ev["type"] == "done" and ev["error"]:
                    await self.send({"type": "error", "message": "Claude devolvió un error en este turno."})
            for s in splitter.flush():
                await sentences.put(s)
        except asyncio.CancelledError:
            await self.brain.interrupt()
            raise
        finally:
            await sentences.put(None)
            if self.slug and full.strip():
                projects.append_turn(self.slug, "assistant", full + (" [interrumpido]" if turn != self.turn else ""))
            if self.slug and wrote:
                await self.send({"type": "artifacts", "artifacts": projects.artifacts(self.slug)})
        await speaker
        await self.send({"type": "turn_end", "turn": turn})

    # ---------- Arquitecto (segundo plano) ----------
    async def handoff(self, entregables: list[str], brief: str) -> str:
        """Lo llama el entrevistador. Vuelve al instante; el Arquitecto trabaja aparte."""
        job = _jobs.get(self.slug)
        if job and not job.done():
            # Encargos seguidos se juntan en uno solo, con el brief más reciente, que corre al terminar el actual.
            prev = _pending.get(self.slug)
            merged = list(dict.fromkeys((prev[0] if prev else []) + entregables))
            _pending[self.slug] = (merged, brief)
            return ("Aún se está terminando el encargo anterior; este cambio queda en cola y se aplicará justo después. "
                    "No vuelvas a encargarlo.")
        _jobs[self.slug] = asyncio.create_task(self.architect_job(entregables, brief))
        return (f"Encargo en marcha ({', '.join(entregables)}). Tardará un par de minutos. "
                "Si aún no lo has dicho, avisa en una frase de que lo estás preparando; no lo repitas. Sigue conversando.")

    async def architect_job(self, entregables: list[str], brief: str) -> None:
        await self.send({"type": "architect", "state": "working", "deliverables": entregables})
        try:
            summary = await run_architect(self.slug, entregables, brief, on_event=self.send)
            note = summary or f"{', '.join(f'{e}.md' for e in entregables)} listos."
            ok = True
        except Exception as e:  # noqa: BLE001
            log.exception("Error del Arquitecto")
            note, ok = f"no he podido terminar los entregables ({e}).", False
        finally:
            _jobs.pop(self.slug, None)
        if ok and (queued := _pending.pop(self.slug, None)):
            # Hay un encargo en cola: se encadena sin anunciar nada todavía.
            await self.send({"type": "artifacts", "artifacts": projects.artifacts(self.slug)})
            _jobs[self.slug] = asyncio.create_task(self.architect_job(*queued))
            return
        _pending.pop(self.slug, None)
        await self.send({"type": "architect", "state": "done" if ok else "error", "summary": note})
        await self.send({"type": "artifacts", "artifacts": projects.artifacts(self.slug)})
        if self.closed:
            return
        idle = self.task is None or self.task.done()
        if idle:
            # Nadie está hablando: Prometeo lo anuncia en voz alta.
            spoken = note if ok and len(note) <= 220 else (
                "Ya tienes los entregables listos." if ok else "No he podido terminar los entregables, ¿lo intento otra vez?")
            self.brain.notes.append(f"ya has anunciado a la persona: «{spoken}»")
            self.task = asyncio.create_task(self.say(spoken))
        else:
            self.brain.notes.append(note)

    async def auto_title(self, text: str) -> None:
        title = await suggest_title(text)
        if title and self.slug:
            await self.send({"type": "project", "project": projects.update_meta(self.slug, title=title)})

    async def cancel_current(self) -> None:
        if self.task and not self.task.done():
            self.turn += 1  # invalida el audio pendiente del turno anterior
            self.task.cancel()
            with contextlib.suppress(BaseException):
                await self.task

    async def handle_input(self, text: str) -> None:
        await self.cancel_current()
        if text.strip():
            self.task = asyncio.create_task(self.run_turn(text))

    async def transcribe(self, data: bytes) -> None:
        pcm = np.frombuffer(data, dtype="<f4")
        if len(pcm) < 16000 * 0.3:
            return
        busy = self.task is not None and not self.task.done()
        if not busy:
            await self.send({"type": "state", "state": "thinking"})
        text = await asyncio.to_thread(stt().transcribe, pcm)
        if not _meaningful(text):
            if not busy:
                await self.send({"type": "state", "state": "idle"})
            return
        await self.send({"type": "transcript", "text": text})
        await self.handle_input(text)


@app.websocket("/ws")
async def ws_session(ws: WebSocket, mode: str = "plan", project: str | None = None):
    await ws.accept()
    greeting = "voz"
    if mode != "voz":
        if project:
            meta = projects.get_meta(project)
            greeting = "reanudar"
        else:
            meta = projects.create()
            greeting = "nuevo"
        project = meta["slug"]
    s = Session(ws, mode, project)
    try:
        await s.brain.start()
        await s.send({"type": "ready", "mode": mode,
                      "project": projects.get_meta(project) if project else None,
                      "voice": load_voice()})
        title = projects.get_meta(project)["title"] if project else ""
        s.task = asyncio.create_task(s.say(GREETINGS[greeting].format(title=title)))
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            if msg.get("bytes"):
                # Solo se cancela el turno en curso si la transcripción trae texto (ver handle_input)
                background(s.transcribe(msg["bytes"]))
            elif msg.get("text"):
                data = json.loads(msg["text"])
                if data["type"] == "text":
                    await s.handle_input(data["text"])
                elif data["type"] == "interrupt":
                    await s.cancel_current()
                    await s.send({"type": "state", "state": "listening"})
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        log.exception("Error de sesión")
        await s.send({"type": "error", "message": str(e)})
    finally:
        s.closed = True
        await s.cancel_current()
        await s.brain.close()
        if project and greeting == "nuevo":
            with contextlib.suppress(Exception):
                projects.delete_if_empty(project)


if FRONTEND_DIST.exists():
    plataforma.fijar_tipos_mime()
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
