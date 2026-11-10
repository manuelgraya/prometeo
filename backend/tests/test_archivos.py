"""Archivos que genera PROMETEO: carpetas de proyecto, conversación, ajustes y el guardián de rutas.

Usan carpetas temporales, nunca projects/ ni settings.local.json reales.
"""
from __future__ import annotations

import asyncio
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import config, plataforma, projects

TEXTO = "Señal de cañería: ¿qué riego? Acción «ñandú» — 100 % €"


class Proyectos(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name) / "projects"
        self.dir.mkdir()
        p = mock.patch.object(projects, "PROJECTS_DIR", self.dir)
        p.start()
        self.addCleanup(p.stop)
        self.addCleanup(self._tmp.cleanup)

    def test_slug_valido_en_windows_y_linux(self):
        for titulo in ("Con", "NUL", "aux.", "Proyecto: ¿riego? <casa> | \"jardín\" *", "   ", "a" * 300):
            slug = projects.create(titulo)["slug"]
            self.assertRegex(slug, r"^\d{8}-\d{6}-[a-z0-9-]+$")  # sin caracteres prohibidos en Windows
            self.assertLessEqual(len(slug), 60)  # lejos del límite de rutas de Windows
            self.assertTrue((self.dir / slug / "meta.json").is_file())

    def test_mismo_segundo_no_choca(self):
        a = projects.create("Igual")["slug"]
        b = projects.create("Igual")["slug"]
        self.assertNotEqual(a, b)

    def test_slug_fuera_de_projects(self):
        malos = ["../fuera", "..", "a/../../b", "/etc"]
        if plataforma.ES_WINDOWS:  # en Linux «C:\\Windows» es un nombre de archivo válido
            malos += ["C:\\Windows", "..\\fuera"]
        for malo in malos:
            with self.assertRaises(ValueError, msg=malo):
                projects.project_dir(malo)

    def test_utf8_en_conversacion_meta_y_entregables(self):
        meta = projects.create(TEXTO)
        slug = meta["slug"]
        projects.append_turn(slug, "user", TEXTO)
        projects.append_turn(slug, "assistant", "Vale")
        (self.dir / slug / "plan.md").write_text(f"# {TEXTO}\n", encoding="utf-8")
        crudo = (self.dir / slug / "conversacion.md").read_bytes()
        self.assertIn(TEXTO.encode("utf-8"), crudo)
        self.assertNotIn(b"\r\n", crudo, "conversacion.md debe tener LF también en Windows")
        self.assertEqual(json.loads((self.dir / slug / "meta.json").read_text(encoding="utf-8"))["title"], TEXTO)
        self.assertIn(TEXTO, projects.conversation(slug))
        self.assertEqual([a["name"] for a in projects.artifacts(slug)], ["plan.md"])
        self.assertEqual(projects.list_all()[0]["artifacts"], ["plan.md"])

    def test_borrar(self):
        vacio = projects.create("Vacío")["slug"]
        self.assertTrue(projects.delete_if_empty(vacio))
        lleno = projects.create("Lleno")["slug"]
        projects.append_turn(lleno, "user", "hola")
        self.assertFalse(projects.delete_if_empty(lleno))
        projects.delete(lleno)
        self.assertFalse((self.dir / lleno).exists())


class Ajustes(unittest.TestCase):
    def test_guardar_y_leer(self):
        with tempfile.TemporaryDirectory() as d, \
                mock.patch.object(config, "SETTINGS_FILE", Path(d) / "settings.local.json"):
            config.save_settings(lmstudio_url=" http://localhost:1234/ ")
            self.assertEqual(config.load_settings()["lmstudio_url"], "http://localhost:1234")
            config.save_voice(voice="ef_dora", configured=True)
            config.save_settings(lmstudio_url="http://otra:1")  # no pisa la voz
            self.assertEqual(config.load_voice()["voice"], "ef_dora")
            self.assertEqual(sorted(p.name for p in Path(d).iterdir()), ["settings.local.json"])  # sin .tmp


class GuardianDeRutas(unittest.TestCase):
    """El Arquitecto solo puede tocar archivos de la carpeta del proyecto."""

    def setUp(self):
        from app.brain import _path_guard
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name) / "proyecto"
        self.root.mkdir()
        self.guard = _path_guard(self.root)

    def decide(self, ruta: str) -> str:
        r = asyncio.run(self.guard({"tool_input": {"file_path": ruta}}, None, None))
        return r.get("hookSpecificOutput", {}).get("permissionDecision", "allow")

    def test_dentro(self):
        for ruta in ("plan.md", str(self.root / "notas.md"), str(self.root / "sub" / "x.md"), "./tareas.md"):
            self.assertEqual(self.decide(ruta), "allow", ruta)

    def test_fuera(self):
        fuera = self.root.parent / "otro.md"
        for ruta in ("../otro.md", str(fuera), str(self.root) + "-hermano/x.md", str(Path.home() / ".claude" / "x")):
            self.assertEqual(self.decide(ruta), "deny", ruta)

    def test_separadores_de_windows(self):
        """Claude puede escribir rutas con \\ o / en Windows; las dos deben resolverse igual."""
        if not re.match(r"^[A-Za-z]:", str(self.root)):
            self.skipTest("solo tiene sentido con rutas de Windows")
        self.assertEqual(self.decide(str(self.root).replace("\\", "/") + "/plan.md"), "allow")
        self.assertEqual(self.decide(str(self.root).upper() + "\\plan.md"), "allow")  # sin distinguir mayúsculas
        self.assertEqual(self.decide(str(self.root) + "\\..\\otro.md"), "deny")


if __name__ == "__main__":
    unittest.main()
