"""Proyectos del usuario: una carpeta por proyecto dentro de projects/."""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from .config import PROJECTS_DIR

HIDDEN = {"meta.json", "conversacion.md", "brief.md"}


def _slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "proyecto"


def project_dir(slug: str) -> Path:
    d = (PROJECTS_DIR / slug).resolve()
    if d.parent != PROJECTS_DIR.resolve():
        raise ValueError("slug inválido")
    return d


def create(title: str = "Proyecto sin título") -> dict:
    now = datetime.now()
    base = f"{now:%Y%m%d-%H%M%S}-{_slugify(title)}"
    slug, n = base, 1
    while True:  # dos sesiones en el mismo segundo no deben chocar
        d = project_dir(slug)
        try:
            d.mkdir(parents=True)
            break
        except FileExistsError:
            n += 1
            slug = f"{base}-{n}"
    meta = {"slug": slug, "title": title, "created": now.isoformat(timespec="seconds"),
            "updated": now.isoformat(timespec="seconds"), "session_id": None}
    (d / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    (d / "conversacion.md").write_text(f"# Conversación\n", encoding="utf-8", newline="\n")
    return meta


def get_meta(slug: str) -> dict:
    return json.loads((project_dir(slug) / "meta.json").read_text(encoding="utf-8"))


def update_meta(slug: str, **fields) -> dict:
    meta = get_meta(slug) | fields | {"updated": datetime.now().isoformat(timespec="seconds")}
    (project_dir(slug) / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")
    return meta


def list_all() -> list[dict]:
    if not PROJECTS_DIR.exists():
        return []
    metas = []
    for d in PROJECTS_DIR.iterdir():
        if (d / "meta.json").exists():
            m = get_meta(d.name)
            m["artifacts"] = [p.name for p in sorted(d.glob("*.md")) if p.name not in HIDDEN]
            metas.append(m)
    return sorted(metas, key=lambda m: m["updated"], reverse=True)


def append_turn(slug: str, role: str, text: str) -> None:
    who = "Tú" if role == "user" else "PROMETEO"
    with (project_dir(slug) / "conversacion.md").open("a", encoding="utf-8", newline="\n") as f:
        f.write(f"\n**{who}** ({datetime.now():%H:%M}): {text.strip()}\n")


def artifacts(slug: str) -> list[dict]:
    d = project_dir(slug)
    return [{"name": p.name, "content": p.read_text(encoding="utf-8"), "mtime": p.stat().st_mtime}
            for p in sorted(d.glob("*.md")) if p.name not in HIDDEN]


def conversation(slug: str) -> str:
    return (project_dir(slug) / "conversacion.md").read_text(encoding="utf-8")


def delete(slug: str) -> None:
    """Borra un proyecto y todos sus entregables."""
    import shutil
    d = project_dir(slug)
    if not (d / "meta.json").exists():
        raise FileNotFoundError(slug)
    shutil.rmtree(d)


def delete_if_empty(slug: str) -> bool:
    """Borra un proyecto en el que la persona no llegó a decir nada."""
    import shutil
    d = project_dir(slug)
    if not d.exists() or "**Tú**" in conversation(slug) or artifacts(slug):
        return False
    shutil.rmtree(d)
    return True
