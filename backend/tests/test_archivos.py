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
            self.assertTrue((self.dir / slug / "obsidian-vault" / ".obsidian").is_dir())  # cada proyecto tiene su Vault
            self.assertTrue((self.dir / slug / "prompts" / "prompt1" / "conversacion.md").is_file())

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
        (projects.current(slug) / "plan.md").write_text(f"# {TEXTO}\n", encoding="utf-8")
        crudo = (projects.current(slug) / "conversacion.md").read_bytes()
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


class Versiones(unittest.TestCase):
    """Al actualizar el prompt, la versión anterior se queda intacta en prompts/ (lo hace el código, no el modelo)."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        p = mock.patch.object(projects, "PROJECTS_DIR", Path(self._tmp.name))
        p.start()
        self.addCleanup(p.stop)
        self.slug = projects.create("Web")["slug"]
        self.d = projects.project_dir(self.slug)

    def escribir(self, texto: str) -> None:
        (projects.current(self.slug) / "prompt.md").write_text(texto, encoding="utf-8")

    def test_sin_prompt_no_crea_version(self):
        self.assertIsNone(projects.new_version(self.slug))
        self.assertEqual(projects.versions(self.slug), ["prompt1"])

    def test_version_nueva_copia_y_conserva_la_anterior(self):
        self.escribir(f"# v1 {TEXTO}\n")
        projects.append_turn(self.slug, "user", "hola")
        self.assertEqual(projects.new_version(self.slug), "prompt1")
        self.assertEqual(projects.current(self.slug).name, "prompt2")
        self.escribir("# v2\n")
        projects.append_turn(self.slug, "user", "sigo")
        v1 = self.d / "prompts" / "prompt1"
        crudo = (v1 / "prompt.md").read_bytes()
        self.assertIn(TEXTO.encode("utf-8"), crudo)
        self.assertNotIn(b"\r\n", crudo)
        self.assertNotIn("sigo", (v1 / "conversacion.md").read_text(encoding="utf-8"))
        conv = projects.conversation(self.slug)  # la vigente tiene toda la conversación
        self.assertIn("hola", conv)
        self.assertIn("sigo", conv)
        self.assertEqual([a["name"] for a in projects.artifacts(self.slug)], ["prompt.md"])

    def test_orden_numerico(self):
        for n in range(1, 11):
            self.escribir(f"v{n}")
            projects.new_version(self.slug)
        self.assertEqual(projects.versions(self.slug)[-2:], ["prompt10", "prompt11"])
        self.assertEqual(projects.current(self.slug).name, "prompt11")

    def test_contexto_en_la_vault(self):
        (projects.vault(self.slug) / "context.md").write_text("# Contexto\n", encoding="utf-8")
        self.assertIn("context.md", [a["name"] for a in projects.artifacts(self.slug)])

    def test_purga_solo_lo_absorbido(self):
        for v in ("v1", "v2", "v3"):
            self.escribir(v)
            projects.new_version(self.slug)
        hist = projects.vault(self.slug) / "historial"
        hist.mkdir()
        for n in ("prompt1", "prompt2", "prompt4"):  # prompt4 es la vigente: nunca se borra
            (hist / f"{n}.md").write_text("# condensado\n", encoding="utf-8")
        self.assertEqual(projects.purge_absorbed(self.slug), ["prompt1", "prompt2"])
        self.assertEqual(projects.versions(self.slug), ["prompt3", "prompt4"])
        self.assertEqual(projects.purge_absorbed(self.slug), [])  # idempotente

    def test_purga_respeta_agentes_sin_cerrar(self):
        for v in ("v1", "v2", "v3"):
            self.escribir(v)
            projects.new_version(self.slug)
        hist = projects.vault(self.slug) / "historial"
        hist.mkdir()
        for n in ("prompt1", "prompt2"):
            (hist / f"{n}.md").write_text("# condensado\n", encoding="utf-8")
        projects.save_agents(self.slug, [{"id": "a1", "version": "prompt1", "phase": "trabajando"},
                                         {"id": "a2", "version": "prompt2", "phase": "cerrado"}])
        self.assertEqual(projects.purge_absorbed(self.slug), ["prompt2"])
        self.assertIn("prompt1", projects.versions(self.slug))

    def test_vault_tasks_e_indice(self):
        t = projects.tasks_dir(self.slug)
        self.assertEqual(t, self.d / "obsidian-vault" / "tasks")
        idx = (t / "index.md").read_text(encoding="utf-8")
        (t / "index.md").write_text(idx + "- [[x]]\n", encoding="utf-8")
        projects.tasks_dir(self.slug)  # no pisa el índice existente
        self.assertIn("[[x]]", (t / "index.md").read_text(encoding="utf-8"))

    def test_carpeta_de_trabajo(self):
        self.assertEqual(projects.workdir(self.slug), self.d)
        repo = Path(self._tmp.name) / "repo"
        repo.mkdir()
        projects.set_repo(self.slug, str(repo))
        self.assertEqual(projects.workdir(self.slug), repo.resolve())
        with self.assertRaises(ValueError):
            projects.set_repo(self.slug, str(repo / "no-existe"))
        projects.set_repo(self.slug, None)
        self.assertEqual(projects.workdir(self.slug), self.d)

    def test_migra_proyectos_antiguos(self):
        viejo = self.d.parent / "20260101-000000-viejo"
        viejo.mkdir()
        (viejo / "meta.json").write_text(json.dumps({"slug": viejo.name, "title": "v", "updated": "x"}), encoding="utf-8")
        for f in ("conversacion.md", "brief.md", "prompt.md"):
            (viejo / f).write_text(f"# {f}\n", encoding="utf-8")
        self.assertEqual(projects.current(viejo.name), viejo / "prompts" / "prompt1")
        self.assertEqual(sorted(p.name for p in (viejo / "prompts" / "prompt1").iterdir()),
                         ["brief.md", "conversacion.md", "prompt.md"])
        self.assertTrue((viejo / "obsidian-vault" / ".obsidian").is_dir())
        self.assertEqual(sorted(p.name for p in viejo.iterdir()), ["meta.json", "obsidian-vault", "prompts"])


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
