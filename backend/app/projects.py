"""Proyectos del usuario: una carpeta por proyecto dentro de projects/."""
from __future__ import annotations

import json
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path

from .config import PROJECTS_DIR, slugify

log = logging.getLogger("prometeo.projects")
HIDDEN = {"meta.json", "conversacion.md", "brief.md"}


def project_dir(slug: str) -> Path:
    d = (PROJECTS_DIR / slug).resolve()
    if d.parent != PROJECTS_DIR.resolve():
        raise ValueError("slug inválido")
    return d


PROMPTS_DIR = "prompts"   # prompts/prompt1, prompt2...: una carpeta por versión del prompt
VAULT_DIR = "obsidian-vault"   # la Vault de Obsidian del proyecto, con context.md
_VERSION = re.compile(r"^prompt(\d+)$")


DEFAULT_TITLE = "Proyecto"
CODE_DIR = "code"              # <nombre>/code: el código del proyecto
# Nombres que Windows no deja usar para una carpeta, aunque lleven extensión
_RESERVED = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(10)), *(f"lpt{i}" for i in range(10))}


def folder_name(title: str) -> str:
    """Nombre de la carpeta del proyecto en sí (la que puede ser un repo): el título en slug, sin fecha."""
    name = slugify(title, max_len=40) or "proyecto"
    return f"{name}-pj" if name in _RESERVED else name


def create(title: str = DEFAULT_TITLE) -> dict:
    """projects/<fecha>-<nombre>/ guarda lo que usa PROMETEO (meta.json, agentes.json, prompts/);
    dentro, <nombre>/ es el proyecto de la persona (code/ y obsidian-vault/): se puede convertir
    en repositorio sin arrastrar nada de PROMETEO."""
    title = title.strip() or DEFAULT_TITLE
    name = folder_name(title)
    now = datetime.now()
    base = f"{now:%Y%m%d-%H%M%S}-{name}"
    slug, n = base, 1
    while True:  # dos sesiones en el mismo segundo no deben chocar
        d = project_dir(slug)
        try:
            d.mkdir(parents=True)
            break
        except FileExistsError:
            n += 1
            slug = f"{base}-{n}"
    meta = {"slug": slug, "title": title, "name": name, "created": now.isoformat(timespec="seconds"),
            "updated": now.isoformat(timespec="seconds"), "session_id": None}
    _write_json(d / "meta.json", meta)
    v = d / PROMPTS_DIR / "prompt1"
    v.mkdir(parents=True)
    (v / "conversacion.md").write_text("# Conversación\n", encoding="utf-8", newline="\n")
    (d / name / CODE_DIR).mkdir(parents=True)
    (d / name / VAULT_DIR / ".obsidian").mkdir(parents=True)  # se abre en Obsidian sin configurar nada
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


# Lo que es de PROMETEO y se queda fuera de la carpeta del proyecto al migrar
_PROMETEO_FILES = {"meta.json", "agentes.json", PROMPTS_DIR}
# El gestor de agentes dice aquí si un proyecto tiene agentes vivos: entonces no se migra (lo están usando)
is_busy = lambda slug: False  # noqa: E731


def _migrate_layout(slug: str, d: Path, meta: dict) -> dict:
    """Proyectos de antes de la carpeta <nombre>/: obsidian-vault/ pasa a <nombre>/obsidian-vault y el
    resto (código suelto) a <nombre>/code/. La carpeta de fuera no se renombra (el slug no cambia)."""
    if not (d / PROMPTS_DIR).is_dir():
        _migrate(d)
    name = folder_name(meta.get("title") or DEFAULT_TITLE)
    # Que no choque con lo que ya hay en la raíz (salvo una migración a medias, que se retoma)
    while name in (VAULT_DIR, CODE_DIR, PROMPTS_DIR) or ((d / name).exists() and not (d / name / CODE_DIR).is_dir()):
        name += "-pj"
    inner = d / name
    (inner / CODE_DIR).mkdir(parents=True, exist_ok=True)
    old_vault = d / VAULT_DIR
    if old_vault.is_dir() and not (inner / VAULT_DIR).exists():
        old_vault.rename(inner / VAULT_DIR)
    (inner / VAULT_DIR / ".obsidian").mkdir(parents=True, exist_ok=True)
    for p in list(d.iterdir()):
        if p.name not in _PROMETEO_FILES and p != inner:
            p.rename(inner / CODE_DIR / p.name)
    meta["name"] = name
    _write_json(d / "meta.json", meta)
    return meta


def inner(slug: str) -> Path:
    """La carpeta del proyecto en sí: <nombre>/ con code/ y obsidian-vault/."""
    d = project_dir(slug)
    meta = get_meta(slug)
    if not meta.get("name"):
        if is_busy(slug):
            return d  # proyecto antiguo con agentes trabajando: se migra cuando paren
        try:
            meta = _migrate_layout(slug, d, meta)
        except OSError:  # p. ej. Windows con la Vault abierta en Obsidian: se reintenta la próxima vez
            log.warning("No se pudo migrar %s a la carpeta del proyecto", slug, exc_info=True)
            return d
    return d / meta["name"]


def vault(slug: str) -> Path:
    return inner(slug) / VAULT_DIR


def code_dir(slug: str) -> Path:
    c = inner(slug) / CODE_DIR
    c.mkdir(parents=True, exist_ok=True)
    return c


def new_version(slug: str) -> str | None:
    """Antes de actualizar un prompt ya escrito, copia la versión vigente a prompt<N+1> y deja
    la anterior intacta como historial. Lo hace el código y no el modelo, para que no dependa
    de que se acuerde. Devuelve la versión anterior, o None si aún no había prompt."""
    cur = current(slug)
    if not (cur / "prompt.md").is_file():
        return None
    n = int(_VERSION.match(cur.name).group(1)) + 1
    shutil.copytree(cur, cur.parent / f"prompt{n}")
    return cur.name


def _write_json(path: Path, data) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8", newline="\n")


def get_meta(slug: str) -> dict:
    return json.loads((project_dir(slug) / "meta.json").read_text(encoding="utf-8"))


def update_meta(slug: str, **fields) -> dict:
    meta = get_meta(slug) | fields | {"updated": datetime.now().isoformat(timespec="seconds")}
    _write_json(project_dir(slug) / "meta.json", meta)
    return meta


def list_all() -> list[dict]:
    if not PROJECTS_DIR.exists():
        return []
    metas = []
    for d in PROJECTS_DIR.iterdir():
        if (d / "meta.json").exists():
            m = get_meta(d.name)
            m["artifacts"] = [a["name"] for a in artifacts(d.name)]
            try:
                m["agents"] = len(agents(d.name))  # para el botón AGENTES de Proyectos
            except (OSError, ValueError):  # agentes.json roto: el proyecto se lista igual
                m["agents"] = 0
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


AGENTS_FILE = "agentes.json"   # registro de agentes de Claude Code lanzados desde el gestor
TASKS_DIR = "tasks"            # obsidian-vault/tasks/: una nota en inglés por tarea documentada
_TASKS_INDEX = "# Tasks\n\nOne note per task done by a Claude Code agent. Newest first.\n"


def agents(slug: str) -> list[dict]:
    f = project_dir(slug) / AGENTS_FILE
    return json.loads(f.read_text(encoding="utf-8")) if f.is_file() else []


def save_agents(slug: str, items: list[dict]) -> None:
    _write_json(project_dir(slug) / AGENTS_FILE, items)


def tasks_dir(slug: str) -> Path:
    """obsidian-vault/tasks/ con su index.md; se crea al primer uso."""
    t = vault(slug) / TASKS_DIR
    t.mkdir(parents=True, exist_ok=True)
    (vault(slug) / ".obsidian").mkdir(exist_ok=True)
    idx = t / "index.md"
    if not idx.is_file():
        idx.write_text(_TASKS_INDEX, encoding="utf-8", newline="\n")
    return t


def workdir(slug: str) -> Path:
    """Dónde trabaja el agente: el repo de código guardado en meta.json o, si no hay, la carpeta
    del proyecto (<nombre>/, con code/ y obsidian-vault/: la que se convierte en repo)."""
    repo = get_meta(slug).get("repo")
    if repo and Path(repo).is_dir():
        return Path(repo).resolve()
    return inner(slug)


def set_repo(slug: str, repo: str | None) -> dict:
    if repo:
        p = Path(repo).expanduser().resolve()
        if not p.is_dir():
            raise ValueError("la carpeta del repositorio no existe")
        repo = str(p)
    return update_meta(slug, repo=repo or None)


def purge_absorbed(slug: str) -> list[str]:
    """Borra las versiones que la skill de limpieza ya condensó: las que tienen su nota en
    obsidian-vault/historial/prompt<N>.md. Nunca borra la versión vigente ni una versión
    con un agente sin cerrar (su terminal la está leyendo)."""
    hist = vault(slug) / "historial"
    busy = {a.get("version") for a in agents(slug) if a.get("phase") != "cerrado"}
    old = [v for v in versions(slug)[:-1] if v not in busy]
    gone = [v for v in old if (hist / f"{v}.md").is_file()]
    for v in gone:
        shutil.rmtree(project_dir(slug) / PROMPTS_DIR / v)
    return gone


def delete(slug: str) -> None:
    """Borra un proyecto y todos sus entregables."""
    d = project_dir(slug)
    if not (d / "meta.json").exists():
        raise FileNotFoundError(slug)
    shutil.rmtree(d)


def delete_if_empty(slug: str) -> bool:
    """Borra un proyecto en el que la persona no llegó a decir nada."""
    d = project_dir(slug)
    if not d.exists() or "**Tú**" in conversation(slug) or artifacts(slug):
        return False
    shutil.rmtree(d)
    return True
