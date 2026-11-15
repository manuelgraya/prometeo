"""Proyectos del usuario: una carpeta por proyecto dentro de projects/."""
from __future__ import annotations

import json
import logging
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

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


# projects/ también se abre en Obsidian como un vault con todos los proyectos: búsqueda y grafo comunes,
# los enlaces de context.md a prompts/ funcionan, y Proyectos.base es una tabla con el context.md de cada uno.
IGNORE_CODE = "/^[^\\/]+\\/[^\\/]+\\/code\\//"  # regex de Obsidian: <fecha>-<nombre>/<nombre>/code/, fuera
PROJECTS_BASE = """\
filters:
  and:
    - file.path.endsWith("/obsidian-vault/context.md")
properties:
  file.name:
    displayName: Contexto
views:
  - type: table
    name: Proyectos
    order:
      - proyecto
      - estado
      - tipo
      - version
      - inicio
      - actualizado
      - file.name
    sort:
      - property: actualizado
        direction: DESC
"""


def ensure_root_vault() -> None:
    """Lo que la persona cambie desde Obsidian no se pisa. Obsidian crea su propio app.json al abrir la
    carpeta, así que la regla de code/ se añade mientras no haya lista de excluidos (si la vacían, se respeta)."""
    app = PROJECTS_DIR / ".obsidian" / "app.json"
    try:
        cfg = json.loads(app.read_text(encoding="utf-8"))
    except FileNotFoundError:
        cfg = {}
    except ValueError:  # roto (o a medio escribir por Obsidian): mejor no tocarlo
        cfg = None
    if isinstance(cfg, dict) and "userIgnoreFilters" not in cfg:
        app.parent.mkdir(parents=True, exist_ok=True)
        app.write_text(json.dumps(cfg | {"userIgnoreFilters": [IGNORE_CODE]}, indent=2) + "\n", encoding="utf-8", newline="\n")
    base = PROJECTS_DIR / "Proyectos.base"
    if not base.exists():
        base.write_text(PROJECTS_BASE, encoding="utf-8", newline="\n")


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


def new_prompt(slug: str) -> str | None:
    """Un prompt distinto del vigente (otro encargo, no una corrección): carpeta prompt<N+1> limpia, solo con
    la conversación para que siga el hilo; los entregables del anterior no se copian, son de aquel prompt.
    Devuelve la versión anterior, o None si la vigente aún no tenía prompt (entonces se escribe en ella)."""
    cur = current(slug)
    if not (cur / PROMPT_FILE).is_file():
        return None
    n = int(_VERSION.match(cur.name).group(1)) + 1
    nxt = cur.parent / f"prompt{n}"
    nxt.mkdir()
    shutil.copy2(cur / "conversacion.md", nxt / "conversacion.md")
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


def version_dir(slug: str, version: str | None = None) -> Path:
    """Carpeta de una versión del prompt (None = la vigente). Solo versiones que existen."""
    if version is None:
        return current(slug)
    if version not in versions(slug):
        raise ValueError("versión del prompt desconocida")
    return project_dir(slug) / PROMPTS_DIR / version


PROMPT_FILE = "prompt.md"   # el prompt de cada versión: el que lleva la Forja a Claude Code
_H1 = re.compile(r"^#\s+(?:Prompt\s*[—:-]\s*)?(.+)$", re.M)


def prompt_file(slug: str, version: str | None = None) -> Path:
    return version_dir(slug, version) / PROMPT_FILE


def prompt_versions(slug: str) -> list[dict]:
    """Prompts del proyecto para el desplegable: cada versión con el título (la primera línea «# ...») del
    prompt.md que lanza la Forja, y los demás prompt*.md que haya en la carpeta."""
    current(slug)  # migra los proyectos antiguos
    done = set(get_meta(slug).get("prompts_done", []))
    out = []
    for v in versions(slug):
        f = prompt_file(slug, v)
        m = _H1.search(f.read_text(encoding="utf-8")) if f.is_file() else None
        others = sorted(p.name for p in version_dir(slug, v).glob("prompt*.md") if p.name != PROMPT_FILE)
        out.append({"version": v, "title": m.group(1).strip() if m else None, "others": others, "done": v in done})
    return out


def artifacts(slug: str, version: str | None = None) -> list[dict]:
    """Entregables de una versión del prompt (la vigente si no se dice) y el contexto vivo de la Vault."""
    files = [p for p in sorted(version_dir(slug, version).glob("*.md")) if p.name not in HIDDEN]
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


def delete_prompt(slug: str, version: str) -> None:
    """Borra un prompt (su carpeta en prompts/) a mano, desde Editar proyecto. No borra el único que queda
    ni uno con un agente sin cerrar (su terminal lo está leyendo); los agentes ya cerrados de ese prompt se van con él."""
    d = version_dir(slug, version)
    if len(versions(slug)) <= 1:
        raise PermissionError("Es el único prompt del proyecto")
    mine = [a for a in agents(slug) if a.get("version") == version]
    if any(a.get("phase") != "cerrado" for a in mine):
        raise PermissionError("Ese prompt tiene un agente sin cerrar en la Forja")
    if mine:
        save_agents(slug, [a for a in agents(slug) if a.get("version") != version])
    shutil.rmtree(d)
    done = [v for v in get_meta(slug).get("prompts_done", []) if v != version]
    update_meta(slug, prompts_done=done)


def set_prompt_done(slug: str, version: str, done: bool) -> list[str]:
    """Marca un prompt como hecho (o pendiente otra vez). Se guarda en meta.json."""
    version_dir(slug, version)  # valida
    cur = [v for v in get_meta(slug).get("prompts_done", []) if v != version]
    return update_meta(slug, prompts_done=cur + [version] if done else cur)["prompts_done"]


def rename(slug: str, title: str) -> dict:
    """Cambia el título que se ve. Las carpetas no se renombran (la sesión de Claude va ligada a su ruta)."""
    title = title.strip()
    if not title:
        raise ValueError("El título no puede estar vacío")
    return update_meta(slug, title=title[:120])


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


# ---------------- Comprobaciones del Arquitecto ----------------
# Código, no instrucciones: un modelo puede saltarse una frase de su prompt; esto no.
CONTEXT_FILE = "context.md"
PROMPT_TAIL = {"Cómo usarlo"}  # las secciones «## » que la plantilla de crear-prompt pone después de «## Prompt»
_PROMPT_SECTION = re.compile(r"^## Prompt\s*\n(.*?)(?=^## (?!#)|\Z)", re.S | re.M)
_FENCE = re.compile(r"^(`{3,}|~{3,}).*?^\1[ \t]*$", re.S | re.M)
_MD_LINK = re.compile(r"!?\[[^\]\n]*\]\(<?([^)\s>]+)>?(?:\s+\"[^\"]*\")?\)")
_WIKILINK = re.compile(r"!?\[\[([^\]|#\n]+)(?:[#|][^\]\n]*)?\]\]")


def prompt_body(text: str) -> str:
    """Solo la sección «## Prompt» si existe (sin el título ni el «Cómo usarlo»): lo que la Forja pega al agente."""
    m = _PROMPT_SECTION.search(text)
    return (m.group(1) if m else text).strip()


def check_prompt(text: str) -> list[str]:
    """Que prompt.md tenga una sección «## Prompt» con contenido y que la Forja no la corte antes de tiempo."""
    m = _PROMPT_SECTION.search(text)
    if not m:
        return ["prompt.md has no `## Prompt` section: the Forja pastes only that section into the coding agent."]
    if not m.group(1).strip():
        return ["The `## Prompt` section of prompt.md is empty."]
    nxt = re.match(r"## (.*)", text[m.end():])
    if nxt and nxt.group(1).strip() not in PROMPT_TAIL:
        return [f"The `## Prompt` section of prompt.md is cut off at the heading «## {nxt.group(1).strip()}»: the Forja stops "
                "at the first `## ` line, so everything from there on never reaches the agent. Make the headings inside "
                "the prompt `###` or deeper (also inside code blocks) and keep only «## Cómo usarlo» after it."]
    return []


def _link_ok(target: str, base: Path) -> bool:
    path = unquote(target.split("#", 1)[0])
    return not path or (base / path).exists()


def _wikilink_ok(name: str, vault_dir: Path) -> bool:
    name = name.strip()
    for cand in (vault_dir / name, vault_dir / f"{name}.md"):
        if cand.exists():
            return True
    stem = Path(name).name  # Obsidian también resuelve por nombre en cualquier carpeta de la Vault
    return any(vault_dir.rglob(f"{stem}.md")) or any(vault_dir.rglob(stem))


def check_context_links(ctx: Path) -> list[str]:
    """Enlaces de context.md que no llevan a nada. Las líneas marcadas «(borrado)» se dejan como historial."""
    text = _FENCE.sub("", ctx.read_text(encoding="utf-8"))
    broken: list[str] = []
    for line in text.splitlines():
        if "(borrado)" in line:
            continue
        line = re.sub(r"`[^`]*`", "", line)
        for target in _MD_LINK.findall(line):
            if re.match(r"[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("#"):
                continue  # http:, mailto:, obsidian:... y anclas de la propia nota
            if not _link_ok(target, ctx.parent):
                broken.append(target)
        broken += [w for w in _WIKILINK.findall(line) if not _wikilink_ok(w, ctx.parent)]
    if not broken:
        return []
    return [f"context.md links to something that doesn't exist: {', '.join(f'`{b}`' for b in dict.fromkeys(broken))}. "
            f"Links are relative to {ctx.parent} (prompt folders are `../../prompts/prompt<N>/...`). Fix the path, or, "
            "if the person deleted that folder, keep the line and append « (borrado)»."]


def check_deliverables(slug: str, entregables: list[str]) -> list[str]:
    """Lo que tiene que estar bien cuando acaba el Arquitecto. Lista vacía = todo en orden."""
    cur = current(slug)
    problems = []
    for e in entregables:
        f = cur / f"{e}.md"
        if not f.is_file() or not f.read_text(encoding="utf-8").strip():
            problems.append(f"{f.name} was requested but is missing or empty in {cur}.")
    p = cur / PROMPT_FILE
    if "prompt" in entregables and p.is_file() and p.read_text(encoding="utf-8").strip():
        problems += check_prompt(p.read_text(encoding="utf-8"))
    ctx = vault(slug) / CONTEXT_FILE
    if not ctx.is_file():
        problems.append(f"{ctx} doesn't exist: create it with the contexto-vivo skill.")
    else:
        problems += check_context_links(ctx)
    return problems


# ---------------- Dónde se quedó el proyecto ----------------
def _section(text: str, title: str) -> str:
    m = re.search(rf"^## {re.escape(title)}[ \t]*\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    return m.group(1) if m else ""


def _clean(item: str) -> str:
    item = re.sub(r"\*\*Pendiente:\*\*\s*", "", item)
    item = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", item)  # [texto](enlace) → texto
    item = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]", r"\1", item)
    return re.sub(r"[*_`]", "", item).strip()


def resume_state(slug: str) -> dict:
    """Lo pendiente y lo último hecho según context.md, y las tareas abiertas del prompt vigente."""
    ctx = vault(slug) / CONTEXT_FILE
    text = ctx.read_text(encoding="utf-8") if ctx.is_file() else ""
    pending = [_clean(m) for m in re.findall(r"^\s*[-*] \[ \]\s+(.+)$", _section(text, "Pendiente"), re.M)]
    done = [_clean(m) for m in re.findall(r"^\s*[-*] (.+)$", _section(text, "Hecho"), re.M)]
    tareas = current(slug) / "tareas.md"
    open_tasks = len(re.findall(r"^\s*[-*] \[ \]", tareas.read_text(encoding="utf-8"), re.M)) if tareas.is_file() else 0
    return {"pending": [p for p in pending if p], "done": [d for d in done if d][-3:], "open_tasks": open_tasks}


def _short(item: str, limit: int = 90) -> str | None:
    """Un pendiente que se pueda decir en voz alta: sin el punto final, en minúscula, y no demasiado largo."""
    item = item.rstrip(". ")
    if not item or len(item) > limit:
        return None
    return item[0].lower() + item[1:] if not item[:2].isupper() else item


def _count(n: int, one: str, many: str) -> str:
    return one if n == 1 else f"{n} {many}"


def resume_greeting(title: str, state: dict) -> str:
    """«Retomamos «Huerto»: queda elegir el riego y hay 2 tareas abiertas. ¿Seguimos por ahí?»"""
    parts = []
    pending, tasks = state["pending"], state["open_tasks"]
    if pending:
        first, rest = _short(pending[0]), len(pending) - 1
        if first:
            parts.append(f"queda {first}" + (f" y {_count(rest, 'una cosa', 'cosas')} más" if rest else ""))
        else:
            parts.append("queda una cosa pendiente" if rest == 0 else f"quedan {len(pending)} cosas pendientes")
    if tasks:
        parts.append(f"hay {_count(tasks, 'una tarea abierta', 'tareas abiertas')}")
    if not parts:
        return f"Retomamos «{title}». ¿Por dónde seguimos?"
    return f"Retomamos «{title}»: {(', y ' if len(parts) > 1 and ' y ' in parts[0] else ' y ').join(parts)}. ¿Seguimos por ahí?"
