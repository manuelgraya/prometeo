"""WebSocket de sesión (/ws): solo lo abre la interfaz de PROMETEO y un mensaje roto no la corta.

No usa Claude ni los modelos de voz: en modo plan sin proyecto no arranca el cerebro, y el saludo se omite.
"""
from __future__ import annotations

import unittest
from unittest import mock

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import agentes, main

LOCAL = {"host": f"localhost:{agentes.FRONT_PORT}", "origin": f"http://localhost:{agentes.FRONT_PORT}"}


@mock.patch.object(main.Session, "say", mock.AsyncMock())
class SesionWebSocket(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app)

    def test_rechaza_otras_webs(self):
        for headers in ({**LOCAL, "origin": "https://evil.example"}, {"host": LOCAL["host"]},
                        {**LOCAL, "host": "evil.example"}):
            with self.assertRaises(WebSocketDisconnect, msg=headers) as cm:
                with self.client.websocket_connect("/ws", headers=headers) as ws:
                    ws.receive_json()
            self.assertEqual(cm.exception.code, 4403)

    def test_mensaje_mal_formado_no_corta_la_sesion(self):
        with self.client.websocket_connect("/ws", headers=LOCAL) as ws:
            self.assertEqual(ws.receive_json()["type"], "ready")
            for roto in ("no es json", "[1, 2]", '"texto"', '{"sin": "tipo"}'):
                ws.send_text(roto)
            ws.send_json({"type": "interrupt"})
            self.assertEqual(ws.receive_json(), {"type": "state", "state": "listening"})


if __name__ == "__main__":
    unittest.main()
