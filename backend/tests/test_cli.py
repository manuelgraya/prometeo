"""El comando `prometeo` (bin/prometeo.py) y sus lanzadores, con un HOME temporal."""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from app import plataforma

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "bin" / "prometeo.py"
LANZADOR = ROOT / "bin" / plataforma.nombre_lanzador()


class Cli(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.home = Path(self._tmp.name)
        self.env = {**os.environ, "HOME": str(self.home), "USERPROFILE": str(self.home)}

    def run_cli(self, *args: str, cmd: list[str] | None = None) -> subprocess.CompletedProcess:
        return subprocess.run((cmd or [sys.executable, str(CLI)]) + list(args), env=self.env, capture_output=True,
                              text=True, encoding="utf-8", errors="replace", timeout=120, check=False)

    def test_ayuda_version_y_path(self):
        r = self.run_cli("--help")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("prometeo", r.stdout)
        self.assertIn("— agente de voz", r.stdout)  # UTF-8 en la salida, también en Windows
        self.assertRegex(self.run_cli("-v").stdout, r"^prometeo \d+\.\d+\.\d+ \(")
        self.assertEqual(Path(self.run_cli("path").stdout.strip()).resolve(), ROOT.resolve())

    def test_errores(self):
        self.assertEqual(self.run_cli("nada").returncode, 2)
        r = self.run_cli("run", "--nada")
        self.assertEqual(r.returncode, 1)
        self.assertIn("Opción desconocida", r.stderr)

    def test_install_y_uninstall(self):
        r = self.run_cli("install")
        self.assertEqual(r.returncode, 0, r.stderr)
        destino = self.home / ".local" / "bin" / plataforma.nombre_lanzador()
        self.assertTrue(plataforma.es_nuestro_lanzador(destino, LANZADOR))
        self.assertEqual(self.run_cli("uninstall").returncode, 0)
        self.assertFalse(destino.exists())
        self.assertIn("No hay enlace", self.run_cli("uninstall").stderr)

    @unittest.skipUnless(shutil.which("uv"), "necesita uv")
    def test_lanzador_del_sistema(self):
        """bin/prometeo en Linux o bin\\prometeo.cmd en Windows: ejecutan el mismo prometeo.py con uv."""
        r = self.run_cli("-v", cmd=[str(LANZADOR)])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("prometeo "), r.stdout)

    @unittest.skipUnless(shutil.which("uv"), "necesita uv")
    def test_lanzador_instalado(self):
        self.run_cli("install")
        r = self.run_cli("-v", cmd=[str(self.home / ".local" / "bin" / plataforma.nombre_lanzador())])
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(r.stdout.startswith("prometeo "), r.stdout)


def cargar_cli():
    spec = importlib.util.spec_from_file_location("prometeo_cli", CLI)
    mod = importlib.util.module_from_spec(spec)
    antes, sys.dont_write_bytecode = sys.dont_write_bytecode, True  # que no deje bin/__pycache__ en el repo
    try:
        spec.loader.exec_module(mod)
    finally:
        sys.dont_write_bytecode = antes
    return mod


class Doctor(unittest.TestCase):
    """Las comprobaciones de `prometeo doctor` que miran más allá de que exista la carpeta."""

    def setUp(self):
        self.cli = cargar_cli()
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)

    def escribir(self, ruta: str, datos: dict) -> None:
        p = self.dir / ruta
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(datos), encoding="utf-8")

    def test_frontend_detecta_paquetes_que_faltan_o_no_son_los_del_lock(self):
        self.escribir("package.json", {"dependencies": {"bien": "^1.0.0", "viejo": "^2.0.0"},
                                       "devDependencies": {"falta": "^3.0.0"}})
        self.escribir("package-lock.json", {"packages": {"node_modules/bien": {"version": "1.0.0"},
                                                         "node_modules/viejo": {"version": "2.1.0"},
                                                         "node_modules/falta": {"version": "3.0.0"}}})
        self.escribir("node_modules/bien/package.json", {"version": "1.0.0"})
        self.escribir("node_modules/viejo/package.json", {"version": "2.0.0"})
        self.assertEqual(sorted(self.cli.paquetes_frontend_desfasados(self.dir)), ["falta", "viejo 2.0.0 ≠ 2.1.0"])

    def test_frontend_al_dia(self):
        self.escribir("package.json", {"dependencies": {"bien": "^1.0.0"}})
        self.escribir("package-lock.json", {"packages": {"node_modules/bien": {"version": "1.0.0"}}})
        self.escribir("node_modules/bien/package.json", {"version": "1.0.0"})
        self.assertEqual(self.cli.paquetes_frontend_desfasados(self.dir), [])

    def test_venv_movido_de_carpeta(self):
        uvicorn = plataforma.ejecutable_venv(self.dir / ".venv", "uvicorn")
        uvicorn.parent.mkdir(parents=True)
        # Linux: un shebang al Python de una ruta que ya no existe. Windows: un .exe que no es un ejecutable.
        uvicorn.write_text("#!/ruta/que/no/existe/.venv/bin/python\n", encoding="utf-8")
        uvicorn.chmod(0o755)
        self.assertTrue(self.cli.venv_roto(self.dir))

    def test_sin_venv_no_es_un_venv_roto(self):
        self.assertFalse(self.cli.venv_roto(self.dir))

    @unittest.skipUnless(plataforma.ejecutable_venv(ROOT / "backend" / ".venv", "uvicorn").is_file(), "sin venv")
    def test_venv_del_repo_arranca(self):
        self.assertFalse(self.cli.venv_roto(ROOT / "backend"))


if __name__ == "__main__":
    unittest.main()
