"""STT (faster-whisper) y TTS (Kokoro ONNX), locales en CPU o GPU (CUDA)."""
from __future__ import annotations

import ctypes
import io
import logging
import os
import re
import sys
import threading
import wave
from pathlib import Path

import numpy as np

from .config import MODELS_DIR, env

log = logging.getLogger("prometeo")

# Kokoro v1.0 solo trae tres voces nativas en español. Las demás leen el español
# con el acento de su idioma: útiles si buscas un timbre distinto.
VOICES: dict[str, dict] = {
    "em_alex": {"name": "Álex", "desc": "Masculina, serena y neutra", "gender": "m", "accent": None},
    "em_santa": {"name": "Santa", "desc": "Masculina, grave y cálida", "gender": "m", "accent": None},
    "ef_dora": {"name": "Dora", "desc": "Femenina, clara y cercana", "gender": "f", "accent": None},
    "im_nicola": {"name": "Nicola", "desc": "Masculina, expresiva", "gender": "m", "accent": "italiano"},
    "if_sara": {"name": "Sara", "desc": "Femenina, suave", "gender": "f", "accent": "italiano"},
    "pm_alex": {"name": "Alex", "desc": "Masculina, cálida", "gender": "m", "accent": "portugués"},
    "pm_santa": {"name": "Santa (PT)", "desc": "Masculina, profunda", "gender": "m", "accent": "portugués"},
    "pf_dora": {"name": "Dora (PT)", "desc": "Femenina, luminosa", "gender": "f", "accent": "portugués"},
    "ff_siwis": {"name": "Siwis", "desc": "Femenina, elegante", "gender": "f", "accent": "francés"},
}

SAMPLE_TEXT = ("Hola, soy Prometeo. Te ayudo a convertir ideas difusas en planes claros y accionables. "
               "¿Empezamos?")


# ---------------- CUDA ----------------
_cuda_preloaded = False


def _preload_cuda_libs() -> None:
    """Carga cuBLAS/cuDNN de los paquetes pip nvidia-* (extra «gpu») para que
    ctranslate2 y onnxruntime los encuentren sin tocar LD_LIBRARY_PATH."""
    global _cuda_preloaded
    if _cuda_preloaded:
        return
    _cuda_preloaded = True
    try:
        import onnxruntime as rt
        if hasattr(rt, "preload_dlls"):
            rt.preload_dlls()
    except Exception:  # noqa: BLE001
        pass
    for site in map(Path, sys.path):
        nv = site / "nvidia"
        if not nv.is_dir():
            continue
        if sys.platform == "win32":
            # En Windows las DLL van en nvidia/*/bin: se añaden a la ruta de búsqueda
            for bin_dir in nv.glob("*/bin"):
                os.add_dll_directory(str(bin_dir))
                os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"
            continue
        for pattern in ("cublas/lib/libcublasLt.so*", "cublas/lib/libcublas.so*", "cudnn/lib/libcudnn*.so*"):
            for lib in sorted(nv.glob(pattern)):
                try:
                    ctypes.CDLL(str(lib), mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


def capabilities() -> dict:
    """Qué dispositivos se pueden usar en esta máquina."""
    tts_cuda = stt_cuda = False
    try:
        import onnxruntime as rt
        tts_cuda = "CUDAExecutionProvider" in rt.get_available_providers()
    except Exception:  # noqa: BLE001
        pass
    try:
        import ctranslate2
        stt_cuda = ctranslate2.get_cuda_device_count() > 0
    except Exception:  # noqa: BLE001
        pass
    return {"tts_cuda": tts_cuda, "stt_cuda": stt_cuda}


# Contexto para Whisper: fija el español, la puntuación y el vocabulario habitual
PROMPT_ES = ("Conversación en español con Prometeo sobre planificar un proyecto: "
             "plan, tareas, notas, prompt, MCP, Claude, frontend, backend.")


class STT:
    def __init__(self, device: str = "cpu", size: str = "base") -> None:
        from faster_whisper import WhisperModel

        self.size = size
        self.error: str | None = None
        self._lock = threading.Lock()
        if device == "cuda":
            try:
                _preload_cuda_libs()
                self.model = WhisperModel(size, device="cuda", compute_type="float16")
                # Si faltan cuBLAS/cuDNN, falla aquí y no en la primera frase
                list(self.model.transcribe(np.zeros(16000, dtype=np.float32), language="es", beam_size=1)[0])
                self.device = "cuda"
                return
            except Exception as e:  # noqa: BLE001
                self.error = f"Whisper no pudo usar la GPU ({e}); usando CPU."
                log.warning(self.error)
        self.model = WhisperModel(size, device="cpu", compute_type="int8",
                                  cpu_threads=int(env("STT_THREADS", "8")))
        self.device = "cpu"

    def transcribe(self, pcm16k: np.ndarray) -> str:
        with self._lock:
            segments, _ = self.model.transcribe(
                pcm16k, language="es", vad_filter=False,
                # Beam search: bastante más preciso; en GPU apenas cuesta
                beam_size=5 if self.device == "cuda" else 3,
                initial_prompt=PROMPT_ES,
                condition_on_previous_text=False,
            )
            return " ".join(s.text.strip() for s in segments).strip()


_MD = re.compile(r"[*_#`>|~]|\[(.*?)\]\(.*?\)")


def clean_for_speech(text: str) -> str:
    text = _MD.sub(lambda m: m.group(1) or "", text)
    return re.sub(r"\s+", " ", text).strip()


class TTS:
    def __init__(self, device: str = "cpu") -> None:
        import onnxruntime as rt
        from kokoro_onnx import Kokoro

        self.error: str | None = None
        providers = ["CPUExecutionProvider"]
        if device == "cuda":
            if "CUDAExecutionProvider" in rt.get_available_providers():
                _preload_cuda_libs()
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
            else:
                self.error = "onnxruntime no tiene soporte CUDA instalado; Kokoro usa la CPU."
                log.warning(self.error)
        rt.set_default_logger_severity(3)
        opts = rt.SessionOptions()
        opts.log_severity_level = 3  # solo errores: en CUDA avisa de nodos Memcpy en cada carga, sin importancia
        sess = rt.InferenceSession(str(MODELS_DIR / "kokoro-v1.0.onnx"), sess_options=opts, providers=providers)
        self.device = "cuda" if "CUDAExecutionProvider" in sess.get_providers() else "cpu"
        if device == "cuda" and self.device == "cpu" and not self.error:
            self.error = "Kokoro no pudo arrancar en la GPU; usa la CPU."
        self.k = Kokoro.from_session(sess, str(MODELS_DIR / "voices-v1.0.bin"))
        self._lock = threading.Lock()

    def wav(self, text: str, voice: str, speed: float) -> bytes | None:
        text = clean_for_speech(text)
        if not re.search(r"\w", text):
            return None
        with self._lock:
            samples, sr = self.k.create(text, voice=voice if voice in VOICES else "em_alex",
                                        speed=float(speed), lang="es")
        pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes(pcm)
        return buf.getvalue()


class SentenceSplitter:
    """Acumula texto en streaming y devuelve frases completas para TTS."""

    _END = re.compile(r"(.+?[.!?…:;])(\s+|$)", re.S)

    def __init__(self, min_len: int = 25) -> None:
        self.buf = ""
        self.min_len = min_len
        self.emitted = False

    def feed(self, delta: str) -> list[str]:
        self.buf += delta
        out: list[str] = []
        pending = ""
        while True:
            m = self._END.match(self.buf)
            # Solo cortamos si después del signo viene espacio (frase cerrada de verdad)
            if not m or not m.group(2):
                break
            pending += m.group(1) + " "
            self.buf = self.buf[m.end():]
            if len(pending) >= self.min_len:
                out.append(pending.strip())
                pending = ""
        self.buf = pending + self.buf
        # Primer fragmento de la respuesta: cortamos en una coma para empezar a hablar antes.
        if not self.emitted and not out and len(self.buf) > 70:
            cut = self.buf.rfind(", ", 30)
            if cut > 0:
                out.append(self.buf[: cut + 1].strip())
                self.buf = self.buf[cut + 2:]
        if out:
            self.emitted = True
        return out

    def flush(self) -> list[str]:
        rest, self.buf = self.buf.strip(), ""
        return [rest] if rest else []
