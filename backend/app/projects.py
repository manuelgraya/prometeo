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


PROMPTS_DIR = "prompts"   # prompts/prompt1, prompt2...: una carpeta por versión del prompt
VAULT_DIR = "obsidian-vault"   # la Vault de Obsidian del proyecto, con context.md
_VERSION = re.compile(r"^prompt(\d+)$")


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
    v = d / PROMPTS_DIR / "prompt1"
    v.mkdir(parents=True)
    (v / "conversacion.md").write_text(f"# Conversación\n", encoding="utf-8", newline="\n")
    (d / VAULT_DIR / ".obsidian").mkdir(parents=True)  # se abre en Obsidian sin configurar nada
    return meta


def versions(slug: str) -> list[str]:
    """Versiones del prompt (prompt1, prompt2...), de la más antigua a la vigente."""
    p = project_dir(slug) / PROMPTS_DIR
    names = [c.name for c in p.iterdir() if c.is_dir() and _VERSION.match(c.name)] if p.is_dir() else []
    return sorted(names, key=lambda n: int(_VERSION.match(n).group(1)))


def _migrate(d: Path) -> None:
    """Proyectos con la estructura antigua (todo en la raíz): pasan a prompts/prompt1 y obsidian-vault/."""
    v = d / PROMPTS_DIR / "prompt1"
    v.mkdir(parents=True)
    for f in d.glob("*.md"):
        f.rename(v / f.name)
    (d / VAULT_DIR / ".obsidian").mkdir(parents=True, exist_ok=True)


def current(slug: str) -> Path:
    """Carpeta de la versión vigente: ahí van la conversación, el brief y los entregables."""
    d = project_dir(slug)
    if not (d / PROMPTS_DIR).is_dir():
        _migrate(d)
    return d / PROMPTS_DIR / versions(slug)[-1]


def vault(slug: str) -> Path:
    return project_dir(slug) / VAULT_DIR


def new_version(slug: str) -> str | None:
    """Antes de actualizar un prompt ya escrito, copia la versión vigente a prompt<N+1> y deja
    la anterior intacta como historial. Lo hace el código y no el modelo, para que no dependa
    de que se acuerde. Devuelve la versión anterior, o None si aún no había prompt."""
    import shutil
    cur = current(slug)
    if not (cur / "prompt.md").is_file():
        return None
    n = int(_VERSION.match(cur.name).group(1)) + 1
    shutil.copytree(cur, cur.parent / f"prompt{n}")
    return cur.name


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
            m["artifacts"] = [a["name"] for a in artifacts(d.name)]
            metas.append(m)
    return sorted(metas, key=lambda m: m["updated"], reverse=True)


def append_turn(slug: str, role: str, text: str) -> None:
    who = "Tú" if role == "user" else "PROMETEO"
    with (current(slug) / "conversacion.md").open("a", encoding="utf-8", newline="\n") as f:
        f.write(f"\n**{who}** ({datetime.now():%H:%M}): {text.strip()}\n")


def artifacts(slug: str) -> list[dict]:
    """Entregables de la versión vigente y el contexto vivo de la Vault."""
    files = [p for p in sorted(current(slug).glob("*.md")) if p.name not in HIDDEN]
    files += [p for p in [vault(slug) / "context.md"] if p.is_file()]
    return [{"name": p.name, "content": p.read_text(encoding="utf-8"), "mtime": p.stat().st_mtime} for p in files]


def conversation(slug: str) -> str:
    return (current(slug) / "conversacion.md").read_text(encoding="utf-8")


def purge_absorbed(slug: str) -> list[str]:
    """Borra las versiones que la skill de limpieza ya condensó: las que tienen su nota en
    obsidian-vault/historial/prompt<N>.md. Nunca borra la versión vigente."""
    import shutil
    hist = vault(slug) / "historial"
    old = versions(slug)[:-1]
    gone = [v for v in old if (hist / f"{v}.md").is_file()]
    for v in gone:
        shutil.rmtree(project_dir(slug) / PROMPTS_DIR / v)
    return gone


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
