"""Rutas del repo y carga de agent.md / voice.md / modos."""
from __future__ import annotations

import json
import os
import re
import threading
import unicodedata
from pathlib import Path

import yaml

def env(name: str, default=None):
    """PROMETEO_<name>, con ORION_<name> como alternativa por compatibilidad."""
    return os.environ.get(f"PROMETEO_{name}", os.environ.get(f"ORION_{name}", default))


ROOT = Path(env("ROOT", Path(__file__).resolve().parents[2]))
AGENT_DIR = ROOT / "agent"
PROJECTS_DIR = ROOT / "projects"
MODELS_DIR = ROOT / "backend" / "models"
FRONTEND_DIST = ROOT / "frontend" / "dist"
# Ajustes de esta máquina (voz elegida, CPU/GPU, modelo...). Fuera de git: cada ordenador
# pasa por su propia primera configuración.
SETTINGS_FILE = Path(env("SETTINGS", ROOT / "settings.local.json"))

_FM = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)


def read_md(path: Path) -> tuple[dict, str]:
    """Devuelve (frontmatter, cuerpo) de un .md."""
    text = path.read_text(encoding="utf-8")
    m = _FM.match(text)
    if not m:
        return {}, text
    return (yaml.safe_load(m.group(1)) or {}), text[m.end():]


def write_md(path: Path, meta: dict, body: str) -> None:
    fm = yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
    path.write_text(f"---\n{fm}\n---\n{body.lstrip()}", encoding="utf-8", newline="\n")


def agent_meta() -> dict:
    return read_md(AGENT_DIR / "agent.md")[0]


def agent_prompt() -> str:
    return read_md(AGENT_DIR / "agent.md")[1]


def mode_prompt(name: str) -> str:
    return read_md(AGENT_DIR / "modes" / f"{name}.md")[1]


def architect_prompt() -> str:
    return read_md(AGENT_DIR / "arquitecto.md")[1]


def mcp_catalog() -> str:
    return read_md(AGENT_DIR / "mcp-catalog.md")[1]


# ---------------- Preguntas frecuentes ----------------
FAQ_AUDIO_DIR = AGENT_DIR / "faqs-audio"   # grabaciones a mano (opcionales), <id>.wav|mp3|ogg…
FAQ_CACHE_DIR = ROOT / "backend" / "cache" / "faqs"   # audios generados con Kokoro (fuera de git)


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "faq"


def load_faqs() -> list[dict]:
    """agent/faqs.md → [{id, question, answer}]. Cada «## pregunta» va seguida de su respuesta."""
    try:
        body = read_md(AGENT_DIR / "faqs.md")[1]
    except FileNotFoundError:
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for block in re.split(r"^##\s+", body, flags=re.M)[1:]:
        question, _, answer = block.partition("\n")
        question, answer = question.strip(), re.sub(r"\s+", " ", answer).strip()
        if not question or not answer:
            continue
        fid, n = _slug(question), 2
        while fid in seen:
            fid, n = f"{_slug(question)}-{n}", n + 1
        seen.add(fid)
        out.append({"id": fid, "question": question, "answer": answer})
    return out


# ---------------- Ajustes locales ----------------
_settings_lock = threading.Lock()

CHOICES = {
    "tts_device": ("cpu", "cuda"),
    "stt_device": ("cpu", "cuda"),
    # Solo modelos multilingües: los .en y distil-* son de inglés
    "whisper_model": ("tiny", "base", "small", "medium", "large-v3-turbo"),
    # Entrevistador (habla contigo): rápido
    "claude_model": ("haiku", "sonnet", "opus"),
    "effort": ("low", "medium", "high"),
    # Arquitecto (escribe los entregables en segundo plano): profundo
    "architect_model": ("sonnet", "opus"),
    "architect_effort": ("medium", "high", "xhigh", "max"),
    # Título automático de cada proyecto
    "title_model": ("haiku", "sonnet"),
    # Contexto con el que se cargan los modelos locales en LM Studio
    "local_context": ("8192", "16384", "32768", "65536"),
}
# Estos también aceptan «local:<id de LM Studio>» (ver app/local.py)
MODEL_KEYS = ("claude_model", "architect_model", "title_model")
DEFAULT_LMSTUDIO_URL = "http://localhost:1234"


def _valid(key: str, value) -> bool:
    if not isinstance(value, str):
        return False
    if key == "lmstudio_url":
        return value.startswith(("http://", "https://")) and len(value) < 200
    if key in MODEL_KEYS and value.startswith("local:"):
        return len(value) > len("local:") and len(value) < 200
    return key in CHOICES and value in CHOICES[key]


def _defaults() -> dict:
    return {
        "tts_device": env("TTS_DEVICE", "cpu"),
        "stt_device": env("STT_DEVICE", "cpu"),
        "whisper_model": env("WHISPER_MODEL", "base"),
        "claude_model": env("MODEL", "sonnet"),
        "effort": env("EFFORT", "low"),
        "architect_model": env("ARCHITECT_MODEL", "opus"),
        "architect_effort": env("ARCHITECT_EFFORT", "high"),
        "title_model": env("TITLE_MODEL", "haiku"),
        "local_context": env("LOCAL_CONTEXT", "32768"),
        "lmstudio_url": env("LMSTUDIO_URL", DEFAULT_LMSTUDIO_URL),
    }


def _read_settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _write_settings(data: dict) -> None:
    tmp = SETTINGS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    tmp.replace(SETTINGS_FILE)


def load_settings() -> dict:
    """Ajustes de rendimiento y modelo (sin la voz)."""
    saved = _read_settings()
    out = _defaults()
    for k in out:
        if _valid(k, saved.get(k)):
            out[k] = saved[k]
    return out


def save_settings(**updates) -> dict:
    with _settings_lock:
        data = _read_settings()
        for k, v in updates.items():
            if k == "lmstudio_url" and isinstance(v, str):
                v = v.strip().rstrip("/")
            if _valid(k, v):
                data[k] = v
        _write_settings(data)
    return load_settings()


def load_voice() -> dict:
    """Voz por defecto de agent/voice.md + la elegida en esta máquina (settings.local.json)."""
    meta, _ = read_md(AGENT_DIR / "voice.md")
    base = {"engine": "kokoro", "voice": "em_alex", "language": "es", "speed": 1.0, **meta}
    local = _read_settings().get("voice", {})
    # "configured" solo cuenta si se ha hecho en este ordenador
    return {**base, **local, "configured": bool(local.get("configured", False))}


def save_voice(**updates) -> dict:
    with _settings_lock:
        data = _read_settings()
        voice = data.get("voice", {})
        voice.update({k: v for k, v in updates.items() if v is not None})
        data["voice"] = voice
        _write_settings(data)
    return load_voice()
