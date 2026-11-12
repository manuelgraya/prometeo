"""Gestor de agentes: seguridad, estados a partir de los hooks, ajustes por agente y la terminal.

No lanza Claude Code (en CI no hay suscripción): la terminal se prueba con un Python cualquiera.
"""
from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

from app import agentes, plataforma, projects


class Seguridad(unittest.TestCase):
    def test_host(self):
        for h in ("localhost:5173", "127.0.0.1:8765", "[::1]:8765", "localhost"):
            self.assertTrue(agentes.host_ok(h), h)
        for h in ("evil.com", "localhost.evil.com:8765", "", None, "127.0.0.1.nip.io:8765"):
            self.assertFalse(agentes.host_ok(h), h)

    def test_origin(self):
        self.assertTrue(agentes.origin_ok(f"http://localhost:{agentes.FRONT_PORT}"))
        self.assertTrue(agentes.origin_ok(f"http://127.0.0.1:{agentes.PORT}"))
        for o in ("http://evil.com", "http://localhost:3000", "https://localhost:5173", "null", "", None):
            self.assertFalse(agentes.origin_ok(o), o)

    def test_token(self):
        self.assertTrue(agentes.token_ok(agentes.TOKEN))
        self.assertFalse(agentes.token_ok("x"))
        self.assertFalse(agentes.token_ok(None))


class ConProyecto(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        for target, attr, value in ((projects, "PROJECTS_DIR", Path(self._tmp.name) / "projects"),
                                    (agentes, "SETTINGS_DIR", Path(self._tmp.name) / "cache")):
            p = mock.patch.object(target, attr, value)
            p.start()
            self.addCleanup(p.stop)
        p = mock.patch.dict(agentes._agents, clear=True)
        p.start()
        self.addCleanup(p.stop)
        agentes._log.clear()
        self.slug = projects.create("Gestor")["slug"]


class Estados(ConProyecto):
    def test_hooks_a_estados(self):
        a = agentes.Agente(self.slug, "prompt1")
        q = agentes.subscribe(a)
        casos = [({"hook_event_name": "SessionStart"}, "esperando"),
                 ({"hook_event_name": "UserPromptSubmit"}, "pensando"),
                 ({"hook_event_name": "PreToolUse", "tool_name": "Read"}, "pensando"),
                 ({"hook_event_name": "PreToolUse", "tool_name": "Edit"}, "escribiendo"),
                 ({"hook_event_name": "PostToolUse", "tool_name": "Edit"}, "pensando"),
                 ({"hook_event_name": "PermissionRequest", "tool_name": "Bash"}, "esperando"),
                 ({"hook_event_name": "UserPromptSubmit"}, "pensando"),
                 ({"hook_event_name": "Notification"}, "esperando"),
                 ({"hook_event_name": "Stop"}, "esperando"),
                 ({"hook_event_name": "SessionEnd"}, "parado")]
        for payload, estado in casos:
            self.assertEqual(agentes.hook(a, payload), estado, payload)
        self.assertTrue(a.ready.is_set())
        self.assertEqual(agentes.hook(a, {"hook_event_name": "Raro"}), "parado")  # se ignora
        msgs = []
        while not q.empty():
            msgs.append(q.get_nowait())
        self.assertEqual(msgs[0]["type"], "hello")
        self.assertEqual([m["state"] for m in msgs[1:]],
                         ["esperando", "pensando", "escribiendo", "pensando", "esperando", "pensando", "esperando", "parado"])

    def test_documentando_avisa_al_gestor_de_cada_escritura(self):
        # Al documentar, cada Edit/Write puede ser la nota de la Vault: el gestor tiene que recibir la lista otra vez
        a = agentes.Agente(self.slug, "prompt1", {"phase": "documentando"})
        agentes._agents[a.key] = a
        a.state = "pensando"
        q = agentes.watch()
        while not q.empty():
            q.get_nowait()
        self.assertEqual(agentes.hook(a, {"hook_event_name": "PostToolUse", "tool_name": "Write"}), "pensando")
        self.assertEqual(q.get_nowait()["type"], "agents")
        agentes.unwatch(q)

    def test_ajustes_por_agente(self):
        a = agentes.Agente(self.slug, "prompt1")
        hooks = json.loads(agentes._settings_file(a).read_text(encoding="utf-8"))["hooks"]
        self.assertEqual(set(hooks), set(agentes.HOOK_EVENTS))
        cmd = hooks["PreToolUse"][0]["hooks"][0]["command"]
        self.assertIn(agentes.TOKEN, cmd)
        self.assertIn(f"/api/agents/{self.slug}/prompt1/hooks", cmd)
        data = json.loads(agentes._settings_file(a).read_text(encoding="utf-8"))
        self.assertEqual(data["theme"], "dark-ansi")  # colores ANSI: manda la paleta del tema de PROMETEO
        self.assertIn(f"/api/agents/{self.slug}/prompt1/status", data["statusLine"]["command"])

    def test_nombres_de_estrella(self):
        self.assertEqual([agentes.star_name(n) for n in (1, 2, 3)], ["Orión", "Centauri", "Sol"])
        self.assertEqual(agentes.star_name(len(agentes.STARS) + 1), "Orión II")

    def test_agente_libre_numero_unico(self):
        async def run():
            with mock.patch.object(agentes, "_spawn", mock.AsyncMock()), mock.patch.object(agentes, "claude_bin", lambda: "claude"):
                p1 = await agentes.start(self.slug, "prompt1")
                libre = await agentes.create_free(self.slug, "Arregla el README")
                return p1, libre
        p1, libre = asyncio.run(run())
        self.assertEqual((p1.n, p1.name), (1, "Orión"))
        self.assertEqual((libre.version, libre.n, libre.name, libre.prompt), ("libre1", 2, "Centauri", None))
        self.assertIn("Arregla el README", agentes.initial_text(libre))
        self.assertEqual(agentes._read_prompt(libre), "Arregla el README")  # lo que se valida
        agentes._agents.clear()
        self.assertEqual(agentes.get(self.slug, "libre1").n, 2)  # se guarda en agentes.json
        with self.assertRaises(ValueError):
            asyncio.run(agentes.start(self.slug, "libre9"))
        with self.assertRaises(ValueError):
            asyncio.run(agentes.start(self.slug, "../x"))

    def test_libre_sin_tarea_toma_su_primer_mensaje(self):
        a = agentes.Agente(self.slug, "libre1", {"n": 1})
        agentes.hook(a, {"hook_event_name": "UserPromptSubmit", "prompt": "Haz un juego"})
        agentes.hook(a, {"hook_event_name": "UserPromptSubmit", "prompt": "otra cosa"})
        self.assertEqual(a.task, "Haz un juego")

    def test_uso_de_la_suscripcion(self):
        a = agentes.Agente(self.slug, "prompt1")
        q = agentes.watch()
        with mock.patch.object(agentes, "USAGE_FILE", Path(self._tmp.name) / "usage.json"), \
                mock.patch.object(agentes, "_usage", None):
            agentes.status(a, {"context_window": {"used_percentage": 5}})
            self.assertIsNone(agentes.usage())  # antes de la primera respuesta no hay límites
            agentes.status(a, {"rate_limits": {"five_hour": {"used_percentage": 26, "resets_at": 1},
                                               "seven_day": {"used_percentage": 52, "resets_at": 2}}})
            self.assertEqual(agentes.usage()["five_hour"]["used_percentage"], 26)
            self.assertTrue((Path(self._tmp.name) / "usage.json").is_file())
        self.assertEqual(a.context, 5)
        tipos = []
        while not q.empty():
            tipos.append(q.get_nowait()["type"])
        self.assertIn("usage", tipos)
        agentes.unwatch(q)

    def test_sesion_ligada_a_su_carpeta(self):
        self.assertEqual(agentes._transcript_dir("/home/a/Work/pro_x.y"), "-home-a-Work-pro-x-y")

    def test_registro_y_lista(self):
        a = agentes.Agente(self.slug, "prompt1")
        agentes._persist(a)
        agentes._agents.clear()
        b = agentes.get(self.slug, "prompt1")
        self.assertEqual(b.session_id, a.session_id)  # retomar = la misma sesión de Claude Code
        self.assertIsNone(agentes.get(self.slug, "prompt2"))
        [info] = agentes.list_all()
        self.assertEqual((info["n"], info["state"], info["alive"], info["title"]), (1, "parado", False, "Gestor"))

    def test_version_desconocida(self):
        with self.assertRaises(ValueError):
            asyncio.run(agentes.start(self.slug, "prompt9"))

    def test_doble_clic_lanza_un_solo_agente(self):
        lanzados = []

        async def falso_spawn(a, exe, cols, rows):
            await asyncio.sleep(0.05)
            lanzados.append(a.key)
            a.term = mock.Mock(viva=lambda: True)

        async def dos_clics():
            return await asyncio.gather(agentes.start(self.slug, "prompt1"), agentes.start(self.slug, "prompt1"))
        with mock.patch.object(agentes, "_spawn", falso_spawn), mock.patch.object(agentes, "claude_bin", lambda: "claude"):
            a, b = asyncio.run(dos_clics())
        self.assertIs(a, b)
        self.assertEqual(lanzados, [f"{self.slug}/prompt1"])

    def test_historial_limitado(self):
        a = agentes.Agente(self.slug, "prompt1")
        with mock.patch.object(agentes, "HISTORY_BYTES", 10):
            a._output(b"0123456789")
            a._output(b"abc")
        self.assertEqual(bytes(a.history), b"3456789abc")


class TextoInicial(ConProyecto):
    PROMPT = "# Prompt — X\n\n> Destino\n\n## Prompt\n\nHaz la cosa.\n\n### Detalle\nCon cuidado.\n\n## Cómo usarlo\nPégalo.\n"

    def setUp(self):
        super().setUp()
        cur = projects.current(self.slug)
        (cur / "prompt.md").write_text(self.PROMPT, encoding="utf-8")
        (cur / "notas.md").write_text("notas", encoding="utf-8")

    def test_contenido(self):
        a = agentes.Agente(self.slug, "prompt1")
        txt = agentes.initial_text(a)
        self.assertIn(str(projects.vault(self.slug)), txt)
        self.assertIn("notas.md", txt)
        self.assertIn("EN INGLÉS", txt)
        self.assertIn("## Files touched", txt)
        self.assertIn("Haz la cosa.", txt)
        self.assertIn("### Detalle", txt)
        self.assertNotIn("Pégalo", txt)  # «Cómo usarlo» es para la persona, no para el agente
        self.assertNotIn("\r", txt)

    def test_se_pega_sin_enter_y_solo_una_vez(self):
        a = agentes.Agente(self.slug, "prompt1")
        escrito = []
        term = mock.Mock(viva=lambda: True, escribir=escrito.append)
        a.term = term

        async def run():
            with mock.patch.object(agentes.asyncio, "sleep", mock.AsyncMock()):
                a.ready.set()
                await agentes._type_initial(a, term)
                await agentes._type_initial(a, term)  # relanzar no vuelve a escribirlo
        asyncio.run(run())
        self.assertEqual(len(escrito), 1)
        self.assertTrue(escrito[0].startswith(b"\x1b[200~") and escrito[0].endswith(b"\x1b[201~"))
        self.assertNotIn(b"\r", escrito[0])
        self.assertTrue(a.prompted)
        self.assertTrue(projects.agents(self.slug)[0]["prompted"])

    def test_prompt_no_enviado_se_reescribe_al_relanzar(self):
        a = agentes.Agente(self.slug, "prompt1", {"prompted": True})
        agentes._persist(a)
        agentes._agents.clear()
        tareas = []

        async def run(transcript):
            with mock.patch.object(agentes, "_spawn", mock.AsyncMock()), \
                    mock.patch.object(agentes, "claude_bin", lambda: "claude"), \
                    mock.patch.object(agentes, "_has_transcript", lambda sid, cwd=None: transcript), \
                    mock.patch.object(agentes, "_type_initial", mock.Mock(side_effect=lambda *x: tareas.append(x) or asyncio.sleep(0))):
                agentes._agents.clear()
                await agentes.start(self.slug, "prompt1", prompt=True)
        asyncio.run(run(True))
        self.assertEqual(tareas, [])  # se envió: la conversación ya lo tiene
        asyncio.run(run(False))
        self.assertEqual(len(tareas), 1)  # nunca se envió: se vuelve a escribir

    def test_version_actual(self):
        async def run():
            with mock.patch.object(agentes, "_spawn", mock.AsyncMock()), mock.patch.object(agentes, "claude_bin", lambda: "claude"):
                return await agentes.start(self.slug, "actual")
        self.assertEqual(asyncio.run(run()).version, "prompt1")


class Ciclo(ConProyecto):
    """trabajando → validando → revision → corregir/aprobar → documentando → cerrado (con nota)."""

    def setUp(self):
        super().setUp()
        (projects.current(self.slug) / "prompt.md").write_text("## Prompt\n\nCrea hola.txt\n", encoding="utf-8")
        self.a = agentes.Agente(self.slug, "prompt1")
        self.a.cwd = str(projects.workdir(self.slug))
        self.pegado: list[bytes] = []
        self.a.term = mock.Mock(viva=lambda: True, escribir=self.pegado.append)
        agentes._agents[self.a.key] = self.a

    def run_(self, *acciones, veredicto="VEREDICTO: REVISAR\n- falta X"):
        async def go():
            with mock.patch("app.brain.validate_work", mock.AsyncMock(return_value=veredicto)):
                for acc in acciones:
                    await agentes.advance(self.a, acc)
                    if self.a.validating:
                        await self.a.validating
                        self.a.validating = None
        asyncio.run(go())

    def test_ciclo_completo_con_nota(self):
        self.run_("terminar")
        self.assertEqual(self.a.phase, "revision")
        self.assertEqual(self.a.validation["verdict"], "revisar")
        self.run_("corregir")
        self.assertEqual(self.a.phase, "trabajando")
        self.assertIn(b"falta X", self.pegado[-1])
        self.assertNotIn(b"\r", self.pegado[-1])
        self.run_("terminar", "aprobar", veredicto="VEREDICTO: OK\n- bien")
        self.assertEqual(self.a.phase, "documentando")
        self.assertIn(b"EN INGL", self.pegado[-1])
        nota = projects.tasks_dir(self.slug) / "2026-11-11-agent-1-hola.md"
        nota.write_text("---\nagent: 1\n---\n# Hola\n", encoding="utf-8")
        self.run_("cerrar")
        self.assertEqual((self.a.phase, self.a.note), ("cerrado", "tasks/2026-11-11-agent-1-hola.md"))
        self.assertEqual(projects.agents(self.slug)[0]["phase"], "cerrado")
        self.assertTrue(any("terminado su trabajo" in e["text"] for e in agentes._log))
        self.a.term.parar.assert_called_once()  # finalizar cierra también la terminal

    def test_cerrar_sin_nota(self):
        self.run_("terminar", "aprobar", veredicto="VEREDICTO: OK\n- bien")
        self.assertEqual(self.a.phase, "documentando")
        self.run_("cerrar")  # la nota no es obligatoria para cerrar
        self.assertEqual((self.a.phase, self.a.note), ("cerrado", None))
        self.assertTrue(any("sin nota" in e["text"] for e in agentes._log))
        self.a.term.parar.assert_called_once()

    def test_acciones_fuera_de_fase(self):
        for acc in ("corregir", "aprobar", "cerrar", "reabrir", "inventada"):
            with self.assertRaises(agentes.PhaseError, msg=acc):
                self.run_(acc)

    def test_parado_no_recibe_texto(self):
        self.run_("terminar")
        self.a.term = None
        with self.assertRaises(agentes.PhaseError):
            self.run_("aprobar")
        self.assertEqual(self.a.phase, "revision")

    def test_evidencia_git(self):
        import shutil
        import subprocess
        if not shutil.which("git"):
            self.skipTest("sin git")
        repo = Path(self._tmp.name) / "repo"
        repo.mkdir()
        g = lambda *a: subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=repo,  # noqa: E731
                                      check=True, capture_output=True)
        g("init", "-q")
        (repo / "a.txt").write_text("uno\n", encoding="utf-8")
        g("add", ".")
        g("commit", "-qm", "base")
        self.a.cwd, self.a.base_commit = str(repo), agentes._git(repo, "rev-parse", "HEAD")
        (repo / "a.txt").write_text("dos\n", encoding="utf-8")
        (repo / "nuevo.py").write_text("print(1)\n", encoding="utf-8")
        ev = agentes.evidence(self.a)
        self.assertIn("+dos", ev)
        self.assertIn("Archivo nuevo: nuevo.py", ev)

    def test_proyecto_convertido_en_repo(self):
        """<nombre>/ convertido en repo (aunque viva dentro de projects/): se usa su git, sin commits incluso."""
        import shutil
        import subprocess
        if not shutil.which("git"):
            self.skipTest("sin git")
        cwd = Path(self.a.cwd)
        subprocess.run(["git", "init", "-q"], cwd=cwd, check=True)
        self.assertTrue(agentes._own_repo(cwd))
        (cwd / "code" / "main.c").write_text("int main(){}\n", encoding="utf-8")
        ev = agentes.evidence(self.a)
        self.assertIn("Repositorio git", ev)
        self.assertIn("main.c", ev)

    def test_evidencia_sin_git(self):
        (Path(self.a.cwd) / "hola.txt").write_text("hola", encoding="utf-8")
        ev = agentes.evidence(self.a)
        self.assertIn("hola.txt", ev)
        self.assertNotIn("prompt.md", ev)  # los entregables no son trabajo del agente


class TerminalReal(unittest.TestCase):
    def test_eco_y_fin(self):
        code = "import sys; l = sys.stdin.readline(); print('ECO:' + l.strip(), flush=True)"
        t = plataforma.Terminal([sys.executable, "-c", code], Path.cwd(), plataforma.entorno_hijos(), 80, 24)
        out = bytearray()

        def leer():
            while data := t.leer():
                out.extend(data)
            t.cerrar()
        th = threading.Thread(target=leer, daemon=True)
        th.start()
        t.redimensionar(100, 30)
        t.escribir(b"hola\r")
        th.join(timeout=20)
        self.assertFalse(th.is_alive(), "la terminal no terminó")
        self.assertIn(b"ECO:hola", bytes(out))
        self.assertFalse(t.viva())


if __name__ == "__main__":
    unittest.main()
