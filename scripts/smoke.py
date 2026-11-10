"""Prueba de humo de PROMETEO, igual en Linux y en Windows.

Arranca `prometeo run` (opcional), comprueba la API y el frontend, genera voz con Kokoro,
manda una frase hablada por el WebSocket como si fuera el micrófono del navegador (PCM float32
a 16 kHz), espera la transcripción y, si hay sesión de Claude, la respuesta hablada. Al final
borra el proyecto de prueba, para PROMETEO con todo su árbol de procesos y comprueba que los
puertos quedan libres.

    cd backend
    uv run python ../scripts/smoke.py --arrancar                 # todo, con Claude (gasta un turno)
    uv run python ../scripts/smoke.py --arrancar --sin-claude    # sin Claude (CI)
    uv run python ../scripts/smoke.py --arrancar --instalado     # versión de release: un solo puerto
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
import websockets

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from app import plataforma  # noqa: E402

FRASE = "Quiero planificar una aplicación para regar las plantas de casa"
PALABRAS = ("planificar", "aplicación", "regar", "plantas")

plataforma.preparar_consola()


def paso(msg: str) -> None:
    print(f"[ok] {msg}", flush=True)


def fallo(msg: str) -> None:
    print(f"[fallo] {msg}", flush=True)
    sys.exit(1)


def get(url: str, metodo: str = "GET") -> tuple[int, bytes]:
    req = urllib.request.Request(url, method=metodo)
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.status, r.read()


def esperar(url: str, segundos: int) -> None:
    fin = time.monotonic() + segundos
    while time.monotonic() < fin:
        try:
            get(url)
            return
        except OSError:
            time.sleep(1)
    fallo(f"{url} no responde tras {segundos} s")


def sintetizar(voz: str) -> np.ndarray:
    """La frase de prueba con la misma Kokoro de PROMETEO, remuestreada a 16 kHz."""
    import onnxruntime as rt
    from kokoro_onnx import Kokoro

    models = ROOT / "backend" / "models"
    rt.set_default_logger_severity(3)
    sess = rt.InferenceSession(str(models / "kokoro-v1.0.onnx"), providers=["CPUExecutionProvider"])
    samples, sr = Kokoro.from_session(sess, str(models / "voices-v1.0.bin")).create(FRASE, voice=voz, lang="es")
    t = np.arange(0, len(samples) / sr, 1 / 16000)
    return np.interp(t, np.arange(len(samples)) / sr, samples).astype("<f4")


def tipo(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.headers.get("Content-Type", "").split(";")[0]


def comprobar_recursos(front: str, html: str) -> None:
    """Los JS y el WASM del detector de voz deben llegar con su tipo, o el navegador los rechaza
    (en Windows el registro puede decir text/plain para .js)."""
    import re
    scripts = re.findall(r'<script[^>]+src="([^"]+)"', html)
    if not scripts:
        fallo("la página no carga ningún script")
    for src in scripts:
        if tipo(f"{front}{src}") != "text/javascript":
            fallo(f"{src} llega como {tipo(front + src)}")
    for recurso, esperado in (("/vad/vad.worklet.bundle.min.js", "text/javascript"),
                              ("/vad/ort-wasm-simd-threaded.wasm", "application/wasm"),
                              ("/vad/silero_vad_v5.onnx", "application/octet-stream")):
        if (t := tipo(f"{front}{recurso}")) != esperado:
            fallo(f"{recurso} llega como {t} (se esperaba {esperado})")
    paso(f"scripts y detector de voz con su tipo MIME ({len(scripts)} script(s))")


def comprobar_transcripcion(texto: str) -> None:
    aciertos = [p for p in PALABRAS if p in texto.lower()]
    if len(aciertos) < 2:
        fallo(f"la transcripción no se parece a la frase: «{texto}»")
    paso(f"STT transcribió: «{texto}»")


async def conversar(back: str, pcm: np.ndarray, con_claude: bool) -> str | None:
    async with websockets.connect(f"{back.replace('http', 'ws', 1)}/ws?mode=plan", max_size=None) as ws:
        slug, audio, dicho, transcrito, fines = None, 0, [], None, 0
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=240)
            if isinstance(msg, bytes):
                audio += 1
                continue
            m = json.loads(msg)
            tipo = m.get("type")
            if tipo == "ready":
                slug = m["project"]["slug"]
                paso(f"sesión lista, proyecto {slug}")
            elif tipo == "error":
                if slug is None and not con_claude:
                    print(f"[aviso] la sesión no arrancó sin Claude ({m.get('message')}); pruebo el STT directamente")
                    return None
                fallo(f"error del backend: {m}")
            elif tipo == "transcript":
                transcrito = m["text"]
                comprobar_transcripcion(transcrito)
                if not con_claude:
                    return slug
            elif tipo == "delta" and fines >= 1:
                dicho.append(m["text"])
            elif tipo == "turn_end":
                fines += 1
                if fines == 1:
                    if not audio:
                        fallo("el saludo no trajo audio")
                    paso(f"saludo hablado ({audio} trozos de audio); envío la frase como si fuera el micrófono")
                    audio = 0
                    await ws.send(pcm.tobytes())
                elif transcrito:
                    if not audio:
                        fallo("la respuesta no trajo audio")
                    paso(f"Prometeo respondió con {audio} trozo(s) de audio: «{''.join(dicho).strip()[:160]}»")
                    return slug


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--arrancar", action="store_true", help="arranca y para PROMETEO (si no, usa uno ya arrancado)")
    ap.add_argument("--sin-claude", action="store_true", help="no espera la respuesta de Claude (CI, sin sesión)")
    ap.add_argument("--instalado", action="store_true", help="versión de release: el backend sirve el frontend")
    ap.add_argument("--lanzador", type=Path, default=ROOT / "bin" / plataforma.nombre_lanzador())
    ap.add_argument("--puerto", default=os.environ.get("PROMETEO_PORT", "18765"))
    ap.add_argument("--puerto-front", default=os.environ.get("PROMETEO_FRONT_PORT", "15173"))
    ap.add_argument("--espera", type=int, default=600, help="segundos máximos para arrancar")
    a = ap.parse_args()

    back = f"http://127.0.0.1:{a.puerto}"
    front = back if a.instalado else f"http://localhost:{a.puerto_front}"
    proc = None
    if a.arrancar:
        for p in {a.puerto, a.puerto_front}:
            if plataforma.puerto_ocupado(p):
                fallo(f"el puerto {p} ya está ocupado")
        env = plataforma.entorno_hijos(PROMETEO_PORT=a.puerto, PROMETEO_FRONT_PORT=a.puerto_front)
        proc = plataforma.lanzar([str(a.lanzador), "run"], ROOT, env, grupo_propio=True)
    try:
        t0 = time.monotonic()
        esperar(f"{back}/api/state", a.espera)
        esperar(f"{front}/", a.espera)
        paso(f"PROMETEO responde tras {time.monotonic() - t0:.0f} s")
        code, body = get(f"{back}/api/state")
        estado = json.loads(body)
        paso(f"backend /api/state {code}")
        code, html = get(f"{front}/")
        if b'<div id="root">' not in html:
            fallo("el frontend no devuelve la página de la app")
        paso(f"frontend / {code}")
        code, _ = get(f"{front}/api/state")
        paso(f"frontend → /api/state {code}")
        comprobar_recursos(front, html.decode("utf-8"))

        voz = estado["voice"]["voice"]
        code, wav = get(f"{back}/api/voices/{voz}/sample")
        if not wav.startswith(b"RIFF"):
            fallo("la muestra de voz no es un WAV")
        paso(f"TTS: muestra de la voz {voz}, {len(wav) // 1024} KB")
        pcm = sintetizar(voz)
        paso(f"frase de prueba sintetizada: {len(pcm) / 16000:.1f} s a 16 kHz")

        slug = asyncio.run(conversar(back, pcm, con_claude=not a.sin_claude))
        if slug is None:
            from app.speech import STT
            comprobar_transcripcion(STT("cpu", estado["settings"]["whisper_model"]).transcribe(pcm))
        else:
            carpeta = ROOT / "projects" / slug
            archivos = sorted(p.name for p in carpeta.iterdir())
            conv = (carpeta / "conversacion.md").read_text(encoding="utf-8")
            if "regar" not in conv.lower():
                fallo("la frase no quedó en conversacion.md")
            paso(f"archivos del proyecto: {archivos}; conversacion.md en UTF-8 con la frase")
            time.sleep(1)  # que el backend cierre la sesión antes de borrar
            get(f"{back}/api/projects/{slug}", "DELETE")
            paso("proyecto de prueba borrado")
    finally:
        if proc:
            plataforma.parar(proc, grupo_propio=True)
    if proc:
        time.sleep(2)
        ocupados = [p for p in {a.puerto, a.puerto_front} if plataforma.puerto_ocupado(p)]
        if ocupados or plataforma.proceso_vivo(proc.pid):
            fallo(f"tras parar quedan puertos ocupados {ocupados} o procesos vivos")
        paso("PROMETEO parado: puertos libres y sin procesos")
    print("PRUEBA DE HUMO SUPERADA")


if __name__ == "__main__":
    main()
