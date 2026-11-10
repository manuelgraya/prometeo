# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""prometeo: arranca, actualiza y revisa PROMETEO en Linux, macOS y Windows.

Se ejecuta con `uv run --script` desde los lanzadores `bin/prometeo` (bash) y
`bin/prometeo.cmd` (Windows), así que no hace falta tener Python instalado.
Solo usa la librería estándar. Ejecuta `prometeo --help` para ver los comandos.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
import tomllib
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
# Lo que depende del sistema operativo vive en backend/app/plataforma.py (solo librería estándar,
# así que se importa sin el venv del backend).
sys.path.insert(0, str(BACKEND))
from app import plataforma  # noqa: E402
FRONTEND = ROOT / "frontend"
MODELS = BACKEND / "models"
KOKORO_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
KOKORO_FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")
BACK_PORT = os.environ.get("PROMETEO_PORT", "8765")
FRONT_PORT = os.environ.get("PROMETEO_FRONT_PORT", "5173")
BIN_DIR = plataforma.carpeta_bin_usuario()
BIN_LINK = BIN_DIR / plataforma.nombre_lanzador()
LAUNCHER = ROOT / "bin" / plataforma.nombre_lanzador()

if plataforma.preparar_consola():
    B, D, R, G, Y, C, N = "\033[1m", "\033[2m", "\033[31m", "\033[32m", "\033[33m", "\033[36m", "\033[0m"
else:
    B = D = R = G = Y = C = N = ""


def say(msg: str) -> None:
    print(f"{C}▸{N} {msg}", flush=True)


def ok(msg: str) -> None:
    print(f"{G}✓{N} {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"{Y}!{N} {msg}", file=sys.stderr, flush=True)


def die(msg: str, code: int = 1):
    print(f"{R}✗{N} {msg}", file=sys.stderr, flush=True)
    sys.exit(code)


def need(tool: str) -> str:
    """Ruta completa de una herramienta. En Windows npm es npm.cmd: sin la ruta, Popen no lo encuentra."""
    path = shutil.which(tool)
    if not path:
        die(f"Falta '{tool}' en el PATH.")
    return path


def child_env(**extra: str) -> dict[str, str]:
    return plataforma.entorno_hijos(**extra)


def run(cmd: list[str], cwd: Path = ROOT, check: bool = True) -> subprocess.CompletedProcess:
    """Ejecuta un comando mostrando su salida; si falla, termina con su código."""
    r = subprocess.run(cmd, cwd=cwd, env=child_env())
    if check and r.returncode != 0:
        sys.exit(r.returncode)
    return r


def usage() -> str:
    home = str(BIN_LINK).replace(str(Path.home()), "~", 1)
    return f"""{B}prometeo{N} — agente de voz local para planificar proyectos

{B}Uso:{N}
  prometeo [comando] [opciones]

{B}Comandos:{N}
  {B}run{N}         Arranca backend (:{BACK_PORT}) y frontend (:{FRONT_PORT}). Es el comando por defecto.
                --open    abre el navegador al arrancar
  {B}update{N}      Actualiza las dependencias del backend (uv) y del frontend (npm)
                --backend   solo el backend
                --frontend  solo el frontend
  {B}models{N}      Descarga los modelos de voz Kokoro si faltan (--force para volver a bajarlos)
  {B}build{N}       Compila el frontend para producción (frontend/dist)
  {B}doctor{N}      Comprueba herramientas, modelos, dependencias y sesión de Claude
  {B}install{N}     Deja este comando en {home}
  {B}uninstall{N}   Lo quita de ahí
  {B}path{N}        Muestra dónde está el repo de PROMETEO

{B}Opciones:{N}
  -h, --help     Muestra esta ayuda
  -v, --version  Muestra la versión

{B}Variables:{N}
  PROMETEO_PORT        puerto del backend  (por defecto 8765)
  PROMETEO_FRONT_PORT  puerto del frontend (por defecto 5173)
  Las demás (PROMETEO_MODEL, PROMETEO_ARCHITECT_MODEL…) están en el README.

{D}Repo: {ROOT}{N}"""


def version() -> str:
    with open(BACKEND / "pyproject.toml", "rb") as f:
        v = tomllib.load(f)["project"]["version"]
    rev = "?"
    if git := shutil.which("git"):
        r = subprocess.run([git, "-C", str(ROOT), "rev-parse", "--short", "HEAD"], capture_output=True, text=True)
        rev = r.stdout.strip() or "?"
    return f"prometeo {v} ({rev})"


# ---------------- Modelos ----------------

def download(url: str, dest: Path) -> None:
    """Descarga a un .part y lo renombra al terminar: una descarga cortada no deja un modelo roto."""
    part = dest.with_name(dest.name + ".part")
    with urllib.request.urlopen(url, timeout=60) as r, open(part, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            done += len(chunk)
            if total and sys.stdout.isatty():
                print(f"\r  {dest.name}: {done * 100 // total:3d} % de {total >> 20} MB", end="", flush=True)
    if total and sys.stdout.isatty():
        print()
    part.replace(dest)


def ensure_models(force: bool = False) -> None:
    if force or not all((MODELS / f).is_file() for f in KOKORO_FILES):
        say("Descargando modelo de voz Kokoro (~350 MB)…")
        MODELS.mkdir(parents=True, exist_ok=True)
        try:
            for f in KOKORO_FILES:
                download(f"{KOKORO_URL}/{f}", MODELS / f)
        except OSError as e:
            die(f"No se pudo descargar el modelo de voz: {e}")
        ok("Modelos de voz listos.")


def ensure_node_modules(npm: str) -> None:
    if not (FRONTEND / "node_modules").is_dir():
        run([npm, "install"], cwd=FRONTEND)


# ---------------- run ----------------

def cmd_run(args: list[str]) -> None:
    open_browser = False
    for a in args:
        if a in ("--open", "-o"):
            open_browser = True
        else:
            die(f"Opción desconocida para run: {a}")
    uv, npm = need("uv"), need("npm")
    ensure_models()
    ensure_node_modules(npm)

    env = child_env()
    plataforma.parar_como_ctrl_c()  # cerrar la terminal o un kill también paran todo
    back = plataforma.lanzar([uv, "run", "uvicorn", "app.main:app", "--port", BACK_PORT, "--log-level", "warning"],
                             BACKEND, env, grupo_propio=True)
    front = None
    back_died = False
    try:
        if open_browser:
            t = threading.Timer(3, webbrowser.open, [f"http://localhost:{FRONT_PORT}"])
            t.daemon = True
            t.start()
        front_env = {**env, "PROMETEO_BACKEND": env.get("PROMETEO_BACKEND", f"http://127.0.0.1:{BACK_PORT}")}
        # En Linux vite se queda en el grupo de la terminal: lee las teclas (h, q…) y recibe el Ctrl+C.
        front = plataforma.lanzar([npm, "run", "dev", "--", "--port", FRONT_PORT, "--strictPort"], FRONTEND, front_env,
                                  grupo_propio=False)
        # Espera con sleep y no con wait(): en Windows wait() no deja pasar el Ctrl+C.
        while front.poll() is None:
            if back.poll() is not None:
                warn(f"El backend se ha cerrado (código {back.returncode}). Mira el error de arriba.")
                back_died = True
                break
            time.sleep(0.3)
    except KeyboardInterrupt:
        pass
    finally:
        plataforma.ignorar_ctrl_c()
        if front:
            plataforma.parar(front, grupo_propio=False, ordenado=False)  # vite no guarda nada al salir
        plataforma.parar(back, grupo_propio=True)
    if back_died:
        sys.exit(1)


# ---------------- update ----------------

def pkg_version(pkg: str) -> str:
    """Versión instalada de un paquete en el venv del backend (vacío si no está)."""
    uv = shutil.which("uv")
    if not uv:
        return ""
    r = subprocess.run([uv, "pip", "show", pkg], cwd=BACKEND, capture_output=True, text=True, env=child_env())
    for line in r.stdout.splitlines():
        if line.startswith("Version: "):
            return line.removeprefix("Version: ").strip()
    return ""


def update_backend() -> None:
    uv = need("uv")
    say("Backend: buscando versiones nuevas (uv lock --upgrade)…")
    # Los paquetes de GPU se instalan a mano con `uv pip install` y no están en el lock:
    # se anotan antes para reponerlos después.
    had_ort_gpu = pkg_version("onnxruntime-gpu")
    had_cuda12 = pkg_version("nvidia-cublas-cu12")

    run([uv, "lock", "--upgrade"], cwd=BACKEND)
    run([uv, "sync", "--inexact"], cwd=BACKEND)

    if had_cuda12:
        say("Backend: actualizando librerías CUDA 12 de Whisper…")
        run([uv, "pip", "install", "-U", "nvidia-cublas-cu12", "nvidia-cudnn-cu12>=9,<10"], cwd=BACKEND)
    if had_ort_gpu and (ort := pkg_version("onnxruntime")):
        say(f"Backend: reponiendo onnxruntime-gpu=={ort} (Kokoro en GPU)…")
        r = run([uv, "pip", "install", "--reinstall-package", "onnxruntime-gpu", f"onnxruntime-gpu[cuda,cudnn]=={ort}"],
                cwd=BACKEND, check=False)
        if r.returncode != 0:
            warn(f"No hay onnxruntime-gpu {ort}; Kokoro irá en CPU hasta que salga.")
    ok("Backend actualizado.")


def update_frontend() -> None:
    npm = need("npm")
    say("Frontend: actualizando paquetes (npm update)…")
    run([npm, "update"], cwd=FRONTEND)
    run([npm, "outdated"], cwd=FRONTEND, check=False)  # lista lo que queda fuera de los rangos de package.json
    ok("Frontend actualizado.")


def cmd_update(args: list[str]) -> None:
    back = front = True
    for a in args:
        if a == "--backend":
            front = False
        elif a == "--frontend":
            back = False
        else:
            die(f"Opción desconocida para update: {a}")
    if back:
        update_backend()
    if front:
        update_frontend()
    git = shutil.which("git")
    if not git:
        return
    locks = ["--", "backend/uv.lock", "frontend/package-lock.json"]
    if subprocess.run([git, "-C", str(ROOT), "diff", "--quiet", *locks]).returncode == 0:
        ok("Todo estaba al día.")
    else:
        say("Han cambiado los locks:")
        subprocess.run([git, "-C", str(ROOT), "diff", "--stat", *locks])
        print(f"{D}Revisa que todo arranca (prometeo) antes de hacer commit.{N}")


# ---------------- models / build ----------------

def cmd_models(args: list[str]) -> None:
    match args:
        case ["--force" | "-f"]:
            ensure_models(force=True)
        case []:
            ensure_models()
            ok(f"Modelos en {MODELS}")
        case _:
            die(f"Opción desconocida para models: {args[0]}")


def cmd_build(_args: list[str]) -> None:
    npm = need("npm")
    ensure_node_modules(npm)
    run([npm, "run", "build"], cwd=FRONTEND)


# ---------------- doctor ----------------

def installed() -> bool:
    found = shutil.which("prometeo")
    if not found:
        return False
    return Path(found).resolve() == LAUNCHER.resolve() or plataforma.es_nuestro_lanzador(Path(found), LAUNCHER)


def cmd_doctor(_args: list[str]) -> None:
    bad = False

    def check(name: str, passed: bool, hint: str) -> None:
        nonlocal bad
        if passed:
            ok(name)
        else:
            warn(f"{name} — {hint}")
            bad = True

    uv = shutil.which("uv")
    pista = plataforma.pistas_instalacion()
    check("uv", bool(uv), f"instálalo con: {pista['uv']}")
    check("npm", bool(shutil.which("npm")), f"instala Node: {pista['npm']}")
    check("claude", bool(shutil.which("claude")), f"instala Claude Code: {pista['claude']}")
    cred = plataforma.carpeta_config_claude() / ".credentials.json"
    check("Sesión de Claude (claude login)", cred.is_file() and cred.stat().st_size > 0, "ejecuta: claude login")
    check("Modelos Kokoro", all((MODELS / f).is_file() for f in KOKORO_FILES), "ejecuta: prometeo models")
    synced = bool(uv) and subprocess.run([uv, "sync", "--inexact", "--locked", "--dry-run"], cwd=BACKEND,
                                         capture_output=True, env=child_env()).returncode == 0
    check("Dependencias del backend", synced, "ejecuta: cd backend && uv sync")
    check("Dependencias del frontend", (FRONTEND / "node_modules").is_dir(), "ejecuta: cd frontend && npm install")
    if b := pkg_version("onnxruntime-gpu"):
        a = pkg_version("onnxruntime")
        check(f"onnxruntime-gpu {b} = onnxruntime {a}", a == b, "ejecuta: prometeo update --backend")
    for port in (BACK_PORT, FRONT_PORT):
        if plataforma.puerto_ocupado(port):
            print(f"{D}·{N} Puerto {port} ocupado (¿PROMETEO ya arrancado?)")
        else:
            ok(f"Puerto {port} libre")
    check("Comando en el PATH", installed(), f"ejecuta: {LAUNCHER} install")
    if os.environ.get("ANTHROPIC_API_KEY"):
        warn("ANTHROPIC_API_KEY está definida: prometeo la ignora y usa tu suscripción.")
    if bad:
        sys.exit(1)


# ---------------- install ----------------

def cmd_install(_args: list[str]) -> None:
    destino = plataforma.instalar_lanzador(LAUNCHER, BIN_DIR)
    ok(f"Instalado: {destino} → {LAUNCHER}")
    if not plataforma.en_path(BIN_DIR):
        warn(f"{BIN_DIR} no está en tu PATH.")


def cmd_uninstall(_args: list[str]) -> None:
    if plataforma.es_nuestro_lanzador(BIN_LINK, LAUNCHER):
        BIN_LINK.unlink()
        ok(f"Quitado {BIN_LINK}")
    else:
        warn(f"No hay enlace en {BIN_LINK}")


# ---------------- main ----------------

def main(argv: list[str]) -> None:
    cmd, args = (argv[0], argv[1:]) if argv else ("run", [])
    match cmd:
        case "run" | "start":
            cmd_run(args)
        case "--open" | "-o":
            cmd_run([cmd, *args])
        case "update" | "upgrade":
            cmd_update(args)
        case "models":
            cmd_models(args)
        case "build":
            cmd_build(args)
        case "doctor":
            cmd_doctor(args)
        case "install":
            cmd_install(args)
        case "uninstall":
            cmd_uninstall(args)
        case "path":
            print(ROOT)
        case "-h" | "--help" | "help":
            print(usage())
        case "-v" | "--version" | "version":
            print(version())
        case _:
            print(f"{R}✗{N} Comando desconocido: {cmd}\n", file=sys.stderr)
            print(usage(), file=sys.stderr)
            sys.exit(2)


if __name__ == "__main__":
    main(sys.argv[1:])
