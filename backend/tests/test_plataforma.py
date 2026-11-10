"""Pruebas de la capa del sistema operativo (app/plataforma.py).

Se ejecutan de verdad en el sistema donde corren (Linux o Windows en CI) y, además, simulan
el otro sistema donde se puede (nombres, lanzadores, rutas de librerías).
    cd backend && uv run python -m unittest discover -s tests -v
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from pathlib import Path
from unittest import mock

from app import plataforma

PY = sys.executable


def esperar_archivo(path: Path, segundos: float = 15) -> str:
    fin = time.monotonic() + segundos
    while time.monotonic() < fin:
        if path.exists() and path.read_text(encoding="utf-8").strip():
            return path.read_text(encoding="utf-8").strip()
        time.sleep(0.1)
    raise AssertionError(f"{path} no apareció")


def esperar_muerto(pid: int, segundos: float = 15) -> bool:
    fin = time.monotonic() + segundos
    while time.monotonic() < fin:
        if not plataforma.proceso_vivo(pid):
            return True
        time.sleep(0.2)
    return False


class Nombres(unittest.TestCase):
    def test_linux(self):
        with mock.patch.object(plataforma, "ES_WINDOWS", False):
            self.assertEqual(plataforma.nombre_lanzador(), "prometeo")
            self.assertIn("install.sh", plataforma.pistas_instalacion()["uv"])

    def test_windows(self):
        with mock.patch.object(plataforma, "ES_WINDOWS", True):
            self.assertEqual(plataforma.nombre_lanzador(), "prometeo.cmd")
            self.assertIn("install.ps1", plataforma.pistas_instalacion()["uv"])
            self.assertIn("winget", plataforma.pistas_instalacion()["npm"])

    def test_carpeta_bin_en_home(self):
        self.assertEqual(plataforma.carpeta_bin_usuario(), Path.home() / ".local" / "bin")

    def test_config_claude(self):
        with mock.patch.dict(os.environ, {"CLAUDE_CONFIG_DIR": "/x/claude"}):
            self.assertEqual(plataforma.carpeta_config_claude(), Path("/x/claude"))
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CLAUDE_CONFIG_DIR", None)
            self.assertEqual(plataforma.carpeta_config_claude(), Path.home() / ".claude")


class Entorno(unittest.TestCase):
    def test_sin_api_key_y_utf8(self):
        env = plataforma.entorno_hijos({"ANTHROPIC_API_KEY": "x", "A": "1"}, B="2")
        self.assertNotIn("ANTHROPIC_API_KEY", env)
        self.assertEqual((env["A"], env["B"], env["PYTHONUTF8"]), ("1", "2", "1"))

    def test_en_path(self):
        with tempfile.TemporaryDirectory() as d:
            with mock.patch.dict(os.environ, {"PATH": os.pathsep.join(["/nada", d])}):
                self.assertTrue(plataforma.en_path(Path(d)))
                self.assertFalse(plataforma.en_path(Path(d) / "otra"))


class Lanzador(unittest.TestCase):
    def test_instalar_y_reconocer_nativo(self):
        with tempfile.TemporaryDirectory() as d:
            lanzador = Path(d) / "repo" / "bin" / plataforma.nombre_lanzador()
            lanzador.parent.mkdir(parents=True)
            lanzador.write_text("x", encoding="utf-8")
            destino = plataforma.instalar_lanzador(lanzador, Path(d) / "bin")
            self.assertTrue(plataforma.es_nuestro_lanzador(destino, lanzador))
            otro = Path(d) / "otro"
            otro.write_text("x", encoding="utf-8")
            self.assertFalse(plataforma.es_nuestro_lanzador(destino, otro))
            plataforma.instalar_lanzador(lanzador, Path(d) / "bin")  # reinstalar no falla

    def test_windows_deja_un_cmd(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(plataforma, "ES_WINDOWS", True):
            lanzador = Path(d) / "Prometeo" / "bin" / "prometeo.cmd"
            destino = plataforma.instalar_lanzador(lanzador, Path(d) / "bin")
            self.assertEqual(destino.name, "prometeo.cmd")
            self.assertEqual(destino.read_bytes(), f'@"{lanzador}" %*\r\n'.encode())
            self.assertTrue(plataforma.es_nuestro_lanzador(destino, lanzador))


class Cuda(unittest.TestCase):
    def _arbol(self, d: Path) -> Path:
        nv = d / "nvidia"
        for sub in ("cublas/bin", "cudnn/bin", "cublas/lib", "cudnn/lib"):
            (nv / sub).mkdir(parents=True)
        (nv / "cublas/lib/libcublas.so.12").write_bytes(b"")
        (nv / "cudnn/lib/libcudnn.so.9").write_bytes(b"")
        return nv

    def test_windows_registra_las_carpetas_bin(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(plataforma, "ES_WINDOWS", True), \
                mock.patch.object(plataforma.os, "add_dll_directory", create=True) as add, \
                mock.patch.dict(os.environ, {"PATH": "base"}):
            nv = self._arbol(Path(d))
            plataforma.registrar_librerias_cuda(nv)
            carpetas = sorted(Path(c.args[0]).relative_to(nv).as_posix() for c in add.call_args_list)
            self.assertEqual(carpetas, ["cublas/bin", "cudnn/bin"])
            self.assertTrue(os.environ["PATH"].endswith("base"))
            self.assertIn(str(nv / "cudnn" / "bin"), os.environ["PATH"])

    def test_linux_carga_los_so(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(plataforma, "ES_WINDOWS", False), \
                mock.patch.object(plataforma.ctypes, "CDLL") as cdll:
            nv = self._arbol(Path(d))
            plataforma.registrar_librerias_cuda(nv)
            cargadas = sorted(Path(c.args[0]).name for c in cdll.call_args_list)
            self.assertEqual(cargadas, ["libcublas.so.12", "libcudnn.so.9"])


class Procesos(unittest.TestCase):
    """Procesos de verdad: el árbol completo debe morir y el cierre ordenado debe dar tiempo a limpiar."""

    def test_parar_mata_el_arbol(self):
        with tempfile.TemporaryDirectory() as d:
            nieto_pid = Path(d) / "nieto.pid"
            hijo = textwrap.dedent(f"""
                import subprocess, sys, time
                n = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
                open({str(nieto_pid)!r}, "w", encoding="utf-8").write(str(n.pid))
                time.sleep(120)
            """)
            p = plataforma.lanzar([PY, "-c", hijo], Path(d), plataforma.entorno_hijos(), grupo_propio=True)
            nieto = int(esperar_archivo(nieto_pid))
            plataforma.parar(p, grupo_propio=True, espera=5)
            self.assertTrue(esperar_muerto(p.pid), "el hijo sigue vivo")
            self.assertTrue(esperar_muerto(nieto), "el nieto sigue vivo (huérfano)")

    def test_cierre_ordenado(self):
        """El proceso recibe SIGTERM (Linux) o Ctrl+Break (Windows) y le da tiempo a terminar bien."""
        with tempfile.TemporaryDirectory() as d:
            marca = Path(d) / "cerrado"
            listo = Path(d) / "listo"
            hijo = textwrap.dedent(f"""
                import signal, sys, time
                def fin(*_):
                    open({str(marca)!r}, "w", encoding="utf-8").write("ok")
                    sys.exit(0)
                signal.signal(getattr(signal, "SIGBREAK", signal.SIGTERM), fin)
                open({str(listo)!r}, "w", encoding="utf-8").write("ok")
                # Esperas cortas, como un bucle de eventos (uvicorn): en Windows un sleep largo
                # no deja atender el Ctrl+Break hasta que termina.
                for _ in range(1200):
                    time.sleep(0.1)
            """)
            p = plataforma.lanzar([PY, "-c", hijo], Path(d), plataforma.entorno_hijos(), grupo_propio=True)
            esperar_archivo(listo)
            plataforma.parar(p, grupo_propio=True, espera=10)
            self.assertEqual(esperar_archivo(marca), "ok", "no le dio tiempo a cerrar ordenadamente")

    def test_kill_a_la_cli_tambien_para_los_hijos(self):
        """Un SIGTERM/SIGHUP (o Ctrl+Break) a quien lanzó los procesos se trata como Ctrl+C:
        para sus hijos en vez de dejarlos huérfanos ocupando puertos."""
        repo_backend = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as d:
            hijo_pid, listo = Path(d) / "hijo.pid", Path(d) / "listo"
            cli = textwrap.dedent(f"""
                import sys, time
                sys.path.insert(0, {str(repo_backend)!r})
                from pathlib import Path
                from app import plataforma
                plataforma.parar_como_ctrl_c()
                h = plataforma.lanzar([sys.executable, "-c", "import time; time.sleep(120)"], Path({d!r}),
                                      plataforma.entorno_hijos(), grupo_propio=True)
                open({str(hijo_pid)!r}, "w", encoding="utf-8").write(str(h.pid))
                try:
                    open({str(listo)!r}, "w", encoding="utf-8").write("ok")
                    while True:
                        time.sleep(0.2)
                except KeyboardInterrupt:
                    pass
                finally:
                    plataforma.ignorar_ctrl_c()
                    plataforma.parar(h, grupo_propio=True, espera=5)
            """)
            p = plataforma.lanzar([PY, "-c", cli], Path(d), plataforma.entorno_hijos(), grupo_propio=True)
            hijo = int(esperar_archivo(hijo_pid))
            esperar_archivo(listo)
            señales = [signal.CTRL_BREAK_EVENT] if plataforma.ES_WINDOWS else [signal.SIGTERM]
            for s in señales:
                os.kill(p.pid, s)  # solo a la CLI, no a su grupo
            p.wait(timeout=20)
            self.assertTrue(esperar_muerto(hijo), "el hijo quedó huérfano")

    @unittest.skipIf(plataforma.ES_WINDOWS, "SIGHUP no existe en Windows")
    def test_cerrar_la_terminal(self):
        with tempfile.TemporaryDirectory() as d:
            listo = Path(d) / "listo"
            cli = textwrap.dedent(f"""
                import sys, time
                sys.path.insert(0, {str(Path(__file__).resolve().parent.parent)!r})
                from app import plataforma
                plataforma.parar_como_ctrl_c()
                try:
                    open({str(listo)!r}, "w", encoding="utf-8").write("ok")
                    time.sleep(60)
                except KeyboardInterrupt:
                    sys.exit(7)
            """)
            p = subprocess.Popen([PY, "-c", cli])
            esperar_archivo(listo)
            p.send_signal(signal.SIGHUP)
            self.assertEqual(p.wait(timeout=10), 7)

    def test_puerto_ocupado(self):
        import socket
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            self.assertTrue(plataforma.puerto_ocupado(s.getsockname()[1]))
            libre = s.getsockname()[1]
        self.assertFalse(plataforma.puerto_ocupado(libre))


if __name__ == "__main__":
    unittest.main()
