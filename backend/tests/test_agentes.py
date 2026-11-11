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
                         ["esperando", "pensando", "escribiendo", "pensando", "esperando", "parado"])

    def test_ajustes_por_agente(self):
        a = agentes.Agente(self.slug, "prompt1")
        hooks = json.loads(agentes._settings_file(a).read_text(encoding="utf-8"))["hooks"]
        self.assertEqual(set(hooks), set(agentes.HOOK_EVENTS))
        cmd = hooks["PreToolUse"][0]["hooks"][0]["command"]
        self.assertIn(agentes.TOKEN, cmd)
        self.assertIn(f"/api/agents/{self.slug}/prompt1/hooks", cmd)

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
