"""Comprobaciones al terminar el Arquitecto y el saludo al retomar un proyecto.

Usan carpetas temporales y un Arquitecto de mentira: no llaman a Claude.
"""
from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from app import agentes, brain, projects

PROMPT_OK = "# Prompt — Huerto\n\n> Destino: Claude Code\n\n## Prompt\nHaz el riego.\n\n### Criterios\n- pasa\n\n## Cómo usarlo\nPégalo.\n"
CONTEXT_OK = ("---\nproyecto: Huerto\n---\n# Contexto — Huerto\n\n## Hecho\n- 2026-11-10 — Plan inicial\n"
              "- 2026-11-12 — Prompt del riego (prompt1)\n\n## Pendiente\n- [ ] Elegir el riego.\n- [x] Medir el patio\n"
              "- [ ] **Pendiente:** confirmar el presupuesto\n\n## Lecciones\n\n## Versiones\n"
              "- [prompt1](../../prompts/prompt1/prompt.md) — Riego · nuevo prompt\n")


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        p = mock.patch.object(projects, "PROJECTS_DIR", Path(self._tmp.name))
        p.start()
        self.addCleanup(p.stop)
        self.slug = projects.create("Huerto")["slug"]
        self.cur = projects.current(self.slug)
        self.ctx = projects.vault(self.slug) / "context.md"

    def escribir(self, prompt: str | None = PROMPT_OK, context: str | None = CONTEXT_OK) -> None:
        if prompt is not None:
            (self.cur / "prompt.md").write_text(prompt, encoding="utf-8")
        if context is not None:
            self.ctx.parent.mkdir(parents=True, exist_ok=True)
            self.ctx.write_text(context, encoding="utf-8")


class Prompt(unittest.TestCase):
    def test_bien_formado(self):
        self.assertEqual(projects.check_prompt(PROMPT_OK), [])
        self.assertEqual(projects.check_prompt("## Prompt\nsolo esto\n"), [])

    def test_sin_seccion_o_vacia(self):
        self.assertIn("no `## Prompt`", projects.check_prompt("# Prompt\n\nHaz algo.\n")[0])
        self.assertIn("empty", projects.check_prompt("## Prompt\n\n## Cómo usarlo\nx\n")[0])

    def test_cortado_por_un_titulo_de_nivel_dos(self):
        texto = "## Prompt\nRol.\n\n## Criterios de terminado\n- tests\n\n## Cómo usarlo\nx\n"
        problema = projects.check_prompt(texto)
        self.assertEqual(len(problema), 1)
        self.assertIn("Criterios de terminado", problema[0])
        self.assertNotIn("tests", agentes._prompt_body(texto))  # lo que de verdad le llega al agente

    def test_cortado_dentro_de_un_bloque_de_codigo(self):
        texto = "## Prompt\nCrea README:\n```md\n## Instalación\n```\n"
        self.assertTrue(projects.check_prompt(texto))


class Enlaces(Base):
    def test_enlaces_que_existen(self):
        self.escribir()
        (projects.vault(self.slug) / "tasks").mkdir(exist_ok=True)
        (projects.vault(self.slug) / "tasks" / "index.md").write_text("# Tasks\n", encoding="utf-8")
        self.ctx.write_text(CONTEXT_OK + "- [[tasks/index]] · [[index|tareas]] · [web](https://x.dev) · [arriba](#hecho)\n"
                            "`[no](es-un-enlace.md)`\n", encoding="utf-8")
        self.assertEqual(projects.check_context_links(self.ctx), [])

    def test_enlace_roto_de_un_nivel(self):
        """El de verdad: «../prompts/» en vez de «../../prompts/»."""
        self.escribir(context=CONTEXT_OK + "- [prompt1](../prompts/prompt1/prompt.md) — viejo\n- [[tasks/nada]]\n")
        problema = projects.check_context_links(self.ctx)
        self.assertEqual(len(problema), 1)
        self.assertIn("`../prompts/prompt1/prompt.md`", problema[0])
        self.assertIn("`tasks/nada`", problema[0])

    def test_borrado_no_cuenta(self):
        self.escribir(context=CONTEXT_OK + "- [prompt7](../../prompts/prompt7/prompt.md) — Viejo · nuevo prompt (borrado)\n")
        self.assertEqual(projects.check_context_links(self.ctx), [])


class Entregables(Base):
    def test_todo_en_orden(self):
        self.escribir()
        (self.cur / "plan.md").write_text("# Plan\n", encoding="utf-8")
        self.assertEqual(projects.check_deliverables(self.slug, ["prompt", "plan"]), [])

    def test_faltan_archivos(self):
        self.escribir()
        (self.cur / "tareas.md").write_text("  \n", encoding="utf-8")
        problemas = projects.check_deliverables(self.slug, ["prompt", "plan", "tareas"])
        self.assertEqual(len(problemas), 2)
        self.assertTrue(problemas[0].startswith("plan.md") and problemas[1].startswith("tareas.md"))

    def test_sin_context_md(self):
        self.escribir(context=None)
        self.assertIn("contexto-vivo", projects.check_deliverables(self.slug, ["prompt"])[0])


class Arquitecto(Base):
    """Si las comprobaciones fallan, se le devuelven al Arquitecto en la misma sesión hasta un límite."""

    def correr(self, turnos):
        mensajes = []

        async def turno(c, texto, on_event):
            mensajes.append(texto)
            turnos[min(len(mensajes), len(turnos)) - 1]()
            return f"frase {len(mensajes)}"

        sesiones = []

        class Cliente:
            def __init__(self, options):
                sesiones.append(options)

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

        with mock.patch.object(brain, "_architect_turn", turno), mock.patch.object(brain, "ClaudeSDKClient", Cliente), \
                mock.patch.object(brain.local, "prepare", mock.AsyncMock(return_value={})):
            final = asyncio.run(brain.run_architect(self.slug, ["prompt"], "brief", on_event=mock.AsyncMock()))
        self.assertEqual(len(sesiones), 1)  # siempre la misma sesión
        return final, mensajes

    def test_bien_a_la_primera(self):
        final, mensajes = self.correr([lambda: self.escribir()])
        self.assertEqual((final, len(mensajes)), ("frase 1", 1))

    def test_se_lo_devuelve_y_lo_corrige(self):
        roto = PROMPT_OK.replace("### Criterios", "## Criterios")
        final, mensajes = self.correr([lambda: self.escribir(prompt=roto), lambda: self.escribir()])
        self.assertEqual((final, len(mensajes)), ("frase 2", 2))
        self.assertIn("## Criterios", mensajes[1])

    def test_se_rinde_tras_el_limite(self):
        final, mensajes = self.correr([lambda: self.escribir(context=None)])
        self.assertEqual(len(mensajes), brain.ARCHITECT_FIX_ROUNDS + 1)


class Retomar(Base):
    def test_estado(self):
        self.escribir()
        (self.cur / "tareas.md").write_text("- [ ] uno\n- [x] dos\n  - [ ] tres\n", encoding="utf-8")
        estado = projects.resume_state(self.slug)
        self.assertEqual(estado["pending"], ["Elegir el riego.", "confirmar el presupuesto"])
        self.assertEqual(estado["done"][-1], "2026-11-12 — Prompt del riego (prompt1)")
        self.assertEqual(estado["open_tasks"], 2)

    def test_saludo(self):
        s = lambda p, t=0: projects.resume_greeting("Huerto", {"pending": p, "done": [], "open_tasks": t})  # noqa: E731
        self.assertEqual(s(["Elegir el riego."], 2), "Retomamos «Huerto»: queda elegir el riego y hay 2 tareas abiertas. ¿Seguimos por ahí?")
        self.assertEqual(s(["Elegir el riego", "b"]), "Retomamos «Huerto»: queda elegir el riego y una cosa más. ¿Seguimos por ahí?")
        self.assertEqual(s(["Elegir el riego", "b", "c"], 1),
                         "Retomamos «Huerto»: queda elegir el riego y 2 cosas más, y hay una tarea abierta. ¿Seguimos por ahí?")
        self.assertEqual(s(["x" * 200, "b"]), "Retomamos «Huerto»: quedan 2 cosas pendientes. ¿Seguimos por ahí?")
        self.assertEqual(s(["API de riego"]), "Retomamos «Huerto»: queda API de riego. ¿Seguimos por ahí?")
        self.assertEqual(s([]), "Retomamos «Huerto». ¿Por dónde seguimos?")

    def test_proyecto_sin_context(self):
        self.assertEqual(projects.resume_state(self.slug), {"pending": [], "done": [], "open_tasks": 0})
        self.assertEqual(brain._where_we_left(projects.resume_state(self.slug)), "")

    def test_contexto_del_entrevistador(self):
        self.escribir()
        texto = brain._where_we_left(projects.resume_state(self.slug))
        self.assertIn("Elegir el riego.", texto)
        self.assertIn("Prompt del riego", texto)


if __name__ == "__main__":
    unittest.main()
