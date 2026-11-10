"""El comando `prometeo` (bin/prometeo.py) y sus lanzadores, con un HOME temporal."""
from __future__ import annotations

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


if __name__ == "__main__":
    unittest.main()
