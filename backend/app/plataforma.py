"""Todo lo que cambia entre Linux y Windows, en un solo sitio.

El resto del código (backend y `bin/prometeo.py`) llama a estas funciones y nunca pregunta
por el sistema operativo. Solo usa la librería estándar: la CLI lo importa sin el venv del backend.
"""
from __future__ import annotations

import ctypes
import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

ES_WINDOWS = os.name == "nt"

# ---------------- Consola ----------------


def preparar_consola() -> bool:
    """Salida en UTF-8 (la consola de Windows usa cp1252 y rompe ✓ ▸ ✗ y las tildes).
    Devuelve si se pueden usar colores ANSI."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    if not sys.stdout.isatty():
        return False
    if ES_WINDOWS:
        os.system("")  # activa las secuencias ANSI en la consola clásica de Windows
    return True


def entorno_hijos(base: dict[str, str] | None = None, **extra: str) -> dict[str, str]:
    """Entorno para los procesos que lanza PROMETEO."""
    env = dict(os.environ if base is None else base)
    env.pop("ANTHROPIC_API_KEY", None)  # usa la suscripción de Claude (claude login), nunca una API key
    env["PYTHONUTF8"] = "1"  # el backend escribe tildes en los logs; en Windows la consola no es UTF-8
    env.update(extra)
    return env


# ---------------- Procesos ----------------


def lanzar(cmd: list[str], cwd: Path, env: dict[str, str], grupo_propio: bool) -> subprocess.Popen:
    """Lanza un proceso que luego se para con su árbol entero (ver `parar`).

    grupo_propio=False lo deja en el grupo de la terminal en Linux, para que lea las teclas
    y reciba el Ctrl+C (vite). En Windows siempre va en su propio grupo: así el Ctrl+C no le llega
    y no aparece el «¿Desea terminar el trabajo por lotes?» de los .cmd; lo paramos nosotros.
    """
    kw: dict = {}
    if ES_WINDOWS:
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    elif grupo_propio:
        kw["start_new_session"] = True
        kw["stdin"] = subprocess.DEVNULL
    return subprocess.Popen(cmd, cwd=cwd, env=env, **kw)


def parar_como_ctrl_c() -> None:
    """Las otras formas de cerrar PROMETEO se tratan como un Ctrl+C (KeyboardInterrupt), para que
    `run` pare backend y frontend: SIGTERM y SIGHUP (cerrar la terminal) en Linux, Ctrl+Break en Windows.
    Sin esto el proceso moría sin limpiar y uvicorn se quedaba ocupando el puerto."""
    def _ctrl_c(*_):
        raise KeyboardInterrupt
    for nombre in (("SIGBREAK",) if ES_WINDOWS else ("SIGTERM", "SIGHUP")):
        signal.signal(getattr(signal, nombre), _ctrl_c)


def ignorar_ctrl_c() -> None:
    """Durante el cierre: el Ctrl+C llega dos veces (terminal y uv lo reenvía) y el segundo no debe cortarlo."""
    for nombre in ("SIGINT", "SIGBREAK") if ES_WINDOWS else ("SIGINT", "SIGTERM", "SIGHUP"):
        signal.signal(getattr(signal, nombre), signal.SIG_IGN)


def _matar_arbol_windows(pid: int) -> None:
    subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)], capture_output=True, check=False)


def parar(p: subprocess.Popen, grupo_propio: bool, ordenado: bool = True, espera: float = 8) -> None:
    """Para el proceso y todos sus hijos: terminate() solo mataría uv o npm y dejaría
    uvicorn/vite ocupando el puerto.

    ordenado=True da primero la oportunidad de cerrar bien (SIGTERM al grupo en Linux,
    Ctrl+Break en Windows, que uvicorn atiende) y, si no termina en `espera` s, lo mata.
    """
    if ES_WINDOWS:
        if ordenado and p.poll() is None:
            try:
                os.kill(p.pid, signal.CTRL_BREAK_EVENT)
                p.wait(timeout=espera)
            except (OSError, subprocess.TimeoutExpired):
                pass
        # Aunque el padre ya haya salido, quedan hijos que taskkill /T encuentra mientras viva algún
        # proceso del árbol; si no queda ninguno, taskkill falla sin más.
        _matar_arbol_windows(p.pid)
        return
    if p.poll() is not None and not grupo_propio:
        return
    try:
        if grupo_propio:
            os.killpg(p.pid, signal.SIGTERM if ordenado else signal.SIGKILL)
        else:
            p.send_signal(signal.SIGINT if ordenado else signal.SIGKILL)  # npm reenvía la señal a vite
        p.wait(timeout=espera)
    except ProcessLookupError:
        return
    except subprocess.TimeoutExpired:
        try:
            if grupo_propio:
                os.killpg(p.pid, signal.SIGKILL)
            else:
                p.kill()
        except ProcessLookupError:
            pass


def proceso_vivo(pid: int) -> bool:
    if ES_WINDOWS:
        r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, check=False)
        return str(pid) in r.stdout
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    # Un zombi (hijo terminado sin recoger) cuenta como muerto
    try:
        with open(f"/proc/{pid}/stat", encoding="ascii") as f:
            return f.read().split(") ", 1)[1][0] != "Z"
    except (OSError, IndexError):
        return True


def puerto_ocupado(port: int | str) -> bool:
    """Hay algo escuchando (vite puede escuchar solo en ::1, así que se prueban los dos)."""
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.create_connection((host, int(port)), timeout=0.3):
                return True
        except OSError:
            pass
    return False


# ---------------- Comando `prometeo` en el PATH ----------------


def carpeta_bin_usuario() -> Path:
    """~/.local/bin en los dos sistemas: en Windows es donde se instala uv, así que suele estar en el PATH."""
    return Path.home() / ".local" / "bin"


def nombre_lanzador() -> str:
    return "prometeo.cmd" if ES_WINDOWS else "prometeo"


def instalar_lanzador(lanzador: Path, carpeta: Path) -> Path:
    """Linux: enlace simbólico. Windows: los enlaces piden permisos de administrador o el
    Modo desarrollador, así que se deja un .cmd de una línea que llama al del repo."""
    carpeta.mkdir(parents=True, exist_ok=True)
    destino = carpeta / nombre_lanzador()
    if ES_WINDOWS:
        destino.write_text(f'@"{lanzador}" %*\r\n', encoding="utf-8", newline="")
    else:
        if destino.is_symlink() or destino.exists():
            destino.unlink()
        destino.symlink_to(lanzador)
    return destino


def es_nuestro_lanzador(destino: Path, lanzador: Path) -> bool:
    if ES_WINDOWS:
        return destino.is_file() and str(lanzador) in destino.read_text(encoding="utf-8", errors="ignore")
    return destino.is_symlink() and destino.resolve() == lanzador.resolve()


def en_path(carpeta: Path) -> bool:
    norm = os.path.normcase(os.path.normpath(carpeta))
    return any(os.path.normcase(os.path.normpath(p)) == norm
               for p in os.environ.get("PATH", "").split(os.pathsep) if p)


# ---------------- Claude, herramientas y GPU ----------------


def carpeta_config_claude() -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR") or Path.home() / ".claude")


def pistas_instalacion() -> dict[str, str]:
    """Cómo instalar cada herramienta en este sistema."""
    if ES_WINDOWS:
        return {
            "uv": 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"',
            "npm": "winget install OpenJS.NodeJS.LTS",
            "claude": 'powershell -ExecutionPolicy ByPass -c "irm https://claude.ai/install.ps1 | iex"',
        }
    return {
        "uv": "curl -LsSf https://astral.sh/uv/install.sh | sh",
        "npm": "mise use -g node",
        "claude": "curl -fsSL https://claude.ai/install.sh | bash",
    }


def registrar_librerias_cuda(nvidia: Path) -> None:
    """Hace visibles cuBLAS/cuDNN de los paquetes pip nvidia-* (carpeta site-packages/nvidia).

    Linux: se precargan los .so de nvidia/*/lib con RTLD_GLOBAL, sin tocar LD_LIBRARY_PATH.
    Windows: las DLL están en nvidia/*/bin; se añaden a la ruta de búsqueda de DLL y al PATH
    para que ctranslate2 las encuentre.
    """
    if ES_WINDOWS:
        for bin_dir in nvidia.glob("*/bin"):
            os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ.get('PATH', '')}"
        return
    for pattern in ("cublas/lib/libcublasLt.so*", "cublas/lib/libcublas.so*", "cudnn/lib/libcudnn*.so*"):
        for lib in sorted(nvidia.glob(pattern)):
            try:
                ctypes.CDLL(str(lib), mode=ctypes.RTLD_GLOBAL)
            except OSError:
                pass
