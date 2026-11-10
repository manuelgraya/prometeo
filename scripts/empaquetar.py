"""Crea el zip de release que instala install.ps1 (Windows).

Lleva los archivos versionados en git, el frontend ya compilado (frontend/dist, con `npm run build`
antes) y release.json, que hace que `prometeo run` sirva todo desde el backend sin Node.
No lleva el vault, la CI ni nada de la máquina (modelos, venv, proyectos, ajustes).

    cd frontend && npm ci && npm run build && cd ..
    python scripts/empaquetar.py --version 0.1.0 --salida dist/prometeo-windows.zip
"""
from __future__ import annotations

import argparse
import json
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FUERA = ("obsidian-vault-context/", ".github/")


def archivos_git() -> list[str]:
    out = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True, check=True).stdout
    return [f for f in out.decode("utf-8").split("\0") if f and not f.startswith(FUERA) and (ROOT / f).is_file()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", required=True)
    ap.add_argument("--salida", type=Path, default=ROOT / "dist" / "prometeo-windows.zip")
    a = ap.parse_args()

    dist = ROOT / "frontend" / "dist"
    if not (dist / "index.html").is_file():
        raise SystemExit("Falta frontend/dist: ejecuta antes `npm run build` en frontend/")
    commit = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                            capture_output=True, text=True, check=True).stdout.strip()

    a.salida.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with zipfile.ZipFile(a.salida, "w", zipfile.ZIP_DEFLATED) as z:
        for f in archivos_git():
            z.write(ROOT / f, f)
            n += 1
        for p in sorted(dist.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(ROOT).as_posix())
                n += 1
        z.writestr("release.json", json.dumps({"version": a.version, "commit": commit}, indent=2) + "\n")
    print(f"{a.salida} ({n + 1} archivos, {a.salida.stat().st_size >> 20} MB) · versión {a.version} ({commit})")


if __name__ == "__main__":
    main()
