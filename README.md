# PROMETEO

Agente de voz local para planificar proyectos. Hablas (o escribes) con PROMETEO y te devuelve el plan, el prompt, las tareas y las notas en `.md`.

## Instalar y arrancar
Funciona en **Linux** y en **Windows 10/11** con el mismo código (macOS no está probado). PROMETEO usa **tu suscripción de Claude** a través de Claude Code (`claude login`), no una API key.

> [!NOTE]
> Pensado para uso personal: cada persona entra con su propia cuenta de Claude. Para distribuirlo más allá, los términos de Anthropic piden autenticarse con una API key.

### Linux
Requisitos: `git`, [uv](https://docs.astral.sh/uv/) (`curl -LsSf https://astral.sh/uv/install.sh | sh`), Node con npm y [Claude Code](https://claude.com/claude-code). No hace falta instalar Python: uv lo trae.
```bash
git clone https://github.com/manuelgraya/prometeo && cd prometeo
claude login             # solo la primera vez
./bin/prometeo install   # solo la primera vez: deja el comando `prometeo` en ~/.local/bin
prometeo                 # backend :8765 + frontend :5173 (igual que ./run.sh)
```
Abre **http://localhost:5173**.

### Windows
En **PowerShell** (no hace falta abrirla como administrador):
```powershell
powershell -ExecutionPolicy ByPass -c "irm https://github.com/manuelgraya/prometeo/releases/latest/download/install.ps1 | iex"
```
El instalador pone uv si falta, descarga la última versión en `%LOCALAPPDATA%\Prometeo` (con la interfaz ya compilada: **no necesita Node ni git**), instala las dependencias, baja los modelos de voz (~350 MB) y deja el comando `prometeo` en `%USERPROFILE%\.local\bin`. Después, en una terminal nueva:
```powershell
irm https://claude.ai/install.ps1 | iex   # Claude Code, si no lo tienes
claude login                               # solo la primera vez
prometeo --open                            # abre http://localhost:8765
```
Para **actualizar**, vuelve a ejecutar el instalador con PROMETEO cerrado: conserva tus proyectos, ajustes, modelos y audios de FAQ grabados.

Para desarrollar en Windows también vale el `git clone` (necesita Node): `bin\prometeo.cmd install` y luego `prometeo`, igual que en Linux (frontend en :5173).

### Micrófono
PROMETEO escucha desde el navegador. La primera vez el navegador pide permiso para el micrófono en `localhost`: acéptalo (si lo rechazaste, pulsa el candado de la barra de direcciones → Micrófono → Permitir). En **Windows** comprueba además *Configuración → Privacidad y seguridad → Micrófono*: activa «Acceso al micrófono» y «Permitir que las aplicaciones de escritorio accedan al micrófono». Usa auriculares para que PROMETEO no se escuche a sí mismo.

### Si Windows avisa
- **«Windows protegió su PC» (SmartScreen)**: con el instalador de una línea no debería salir, porque no se descarga ningún `.exe`. Si descargas el zip a mano desde el navegador y abres un `.cmd`, puede salir: *Más información → Ejecutar de todas formas*. Para evitarlo, en PowerShell: `Get-ChildItem -Recurse $env:LOCALAPPDATA\Prometeo | Unblock-File`.
- **Antivirus**: si bloquea `uv.exe` o la descarga de modelos, añade `%LOCALAPPDATA%\Prometeo` como excepción.
- **`prometeo` no se reconoce**: abre una terminal nueva (el PATH se actualiza al abrirla) o ejecuta `%LOCALAPPDATA%\Prometeo\bin\prometeo.cmd`.

### Problemas conocidos
- **Nada de esto se ha probado aún en un Windows de verdad**, salvo Whisper en GPU. Lo que sí está probado: la CI de GitHub en Windows (pruebas, instalador y una prueba de humo con micrófono simulado) y todo el flujo en Linux.
- En Windows, la caché de modelos de Whisper (Hugging Face) ocupa más si no tienes el Modo desarrollador activado: no puede usar enlaces y copia los archivos. Solo avisa; funciona igual.
- `prometeo update` y el instalador fallan si PROMETEO está en marcha (Windows bloquea los archivos en uso): ciérralo antes.
- Al pulsar Ctrl+C, CMD puede preguntar «¿Desea terminar el trabajo por lotes (S/N)?»: responde S; PROMETEO ya se ha cerrado.
- Claude Code en Windows a veces pide Git Bash (`CLAUDE_CODE_GIT_BASH_PATH`). PROMETEO no usa la herramienta Bash, así que no debería hacer falta; si `claude` lo exige, instala [Git for Windows](https://git-scm.com/download/win).

### El comando `prometeo`
`bin/prometeo` (bash) y `bin\prometeo.cmd` son solo lanzadores: los dos ejecutan `bin/prometeo.py` con `uv run --script`, así que los comandos son los mismos en todos los sistemas. Lo que cambia entre Linux y Windows está solo en `backend/app/plataforma.py`.

| Comando | Qué hace |
|---|---|
| `prometeo` / `prometeo run [--open]` | Arranca backend y frontend (`--open` abre el navegador). En la versión instalada, solo el backend, que sirve también la interfaz |
| `prometeo update [--backend\|--frontend]` | En la versión instalada de Windows, indica cómo volver a ejecutar el instalador. Con `git clone`, actualiza las dependencias: `uv lock --upgrade` + `uv sync` y `npm update`. Repone `onnxruntime-gpu` y las librerías CUDA si las tenías |
| `prometeo models [--force]` | Descarga los modelos de voz Kokoro |
| `prometeo build` | Compila el frontend (`frontend/dist`) |
| `prometeo doctor` | Comprueba herramientas, modelos, dependencias, sesión de Claude y puertos |
| `prometeo install` / `uninstall` | Pone o quita el comando `prometeo` en `~/.local/bin` |
| `prometeo --help` / `--version` | Ayuda y versión |

## Estructura
| Ruta | Qué es |
|---|---|
| `agent/agent.md` | **Entrevistador**: identidad, método y preguntas de PROMETEO (rápido, habla contigo) |
| `agent/arquitecto.md` | **Arquitecto**: modelo profundo que analiza lo recabado y escribe los entregables en segundo plano |
| `agent/mcp-catalog.md` | Servidores MCP que el entrevistador puede recomendar según el proyecto |
| `agent/faqs.md` | **Preguntas frecuentes** (vista FAQ): cada `## pregunta` con su respuesta. Prometeo la dice con un audio pregrabado: `agent/faqs-audio/<id>.wav\|mp3\|ogg` si lo grabas tú, o uno generado con Kokoro una sola vez (en `backend/cache/faqs/`, se rehace si cambias la voz o el texto) |
| `agent/voice.md` | Voz **por defecto** (Kokoro). La elegida en cada ordenador va a `settings.local.json` |
| `settings.local.json` | Ajustes de esta máquina (voz, CPU/GPU, modelo de Whisper, de Claude o local). No se versiona |
| `agent/skills/*/SKILL.md` | Skills: `crear-prompt`, `documentar-plan`, `desglosar-tareas`, `resumen-notas` |
| `agent/modes/definir-voz.md` | Instrucciones de la conversación de primera configuración |
| `projects/<fecha>-<nombre>/` | Proyectos. Lo de PROMETEO (`meta.json`, `agentes.json`, `prompts/` con conversación y entregables) queda fuera de `<nombre>/`, que es el proyecto en sí (`code/` y `obsidian-vault/`) y se puede convertir en repositorio tal cual |
| `backend/` | FastAPI + Claude Agent SDK (Claude o LM Studio) + faster-whisper + Kokoro ONNX |
| `frontend/` | React + react-three-fiber (reactor y galaxia) + Silero VAD en el navegador. Estructura en `frontend/README.md` |
| `backend/app/plataforma.py` | **Todo lo que cambia entre Linux y Windows** (procesos y señales, consola, lanzador en el PATH, librerías CUDA, tipos MIME). El resto del código no pregunta por el sistema |
| `bin/` | `prometeo.py` (el comando) y sus lanzadores `prometeo` (bash) y `prometeo.cmd` (Windows) |
| `install.ps1` | Instalador de Windows (descarga la release) |
| `scripts/smoke.py` · `scripts/empaquetar.py` | Prueba de humo (arranca, simula el micrófono, comprueba el cierre) y creación del zip de release |
| `backend/tests/` | Pruebas unitarias |
| `.github/workflows/` | CI en Linux y Windows (`ci.yml`) y publicación de releases (`release.yml`) |

## Ajustes
Todo se cambia desde la vista **Ajustes** (voz, velocidad, CPU/GPU, modelo de Whisper, modelo y esfuerzo de Claude, idioma) y la vista **Voces** (escuchar cada voz y elegirla).

**GPU (NVIDIA):** Whisper puede ir en GPU instalando las librerías CUDA en el backend:
```bash
cd backend && uv pip install nvidia-cublas-cu12 "nvidia-cudnn-cu12>=9,<10"
```
Para Kokoro en GPU, instala además `onnxruntime-gpu` (misma versión que `onnxruntime`) con sus librerías CUDA 13:
```bash
cd backend && uv pip install "onnxruntime-gpu[cuda,cudnn]==1.31.1"
```
Se instala encima de `onnxruntime` (que `kokoro-onnx` exige y `uv run` repondría si se quitase), así que no desinstales ninguno de los dos. Si `onnxruntime` se reinstala o actualiza, vuelve a ejecutar el comando. Necesita un driver con CUDA 13. Si la GPU falla, PROMETEO vuelve a CPU y lo indica en Ajustes.

Los comandos son los mismos en Windows (en Windows PowerShell 5, que no tiene `&&`, ejecuta primero `cd backend` y luego el `uv pip install`). Allí los paquetes `nvidia-*` dejan las DLL en `nvidia/*/bin` y el backend las añade solo a la ruta de búsqueda.

## Modelos locales (LM Studio)
El entrevistador, el Arquitecto y el título pueden usar un modelo local en vez de Claude: en **Ajustes → Cerebro**, botón **LOCAL** y eliges el modelo.

- Los modelos los gestiona LM Studio y los guarda en `~/.lmstudio/models` (su `downloadsFolder`, en `~/.lmstudio/settings.json`). Para añadir uno, descárgalo desde LM Studio: aparece solo en PROMETEO.
- El servidor de LM Studio tiene que estar en marcha: `lms server start` (por defecto en `http://localhost:1234`, configurable en Ajustes).
- PROMETEO usa la API compatible con Anthropic de LM Studio, así que todo sigue pasando por el mismo Claude Agent SDK.
- Carga el modelo con el contexto elegido en Ajustes (32K por defecto; la carga automática de LM Studio solo da 8K).
- Cada modelo distinto ocupa su propia memoria de vídeo: con 8 GB usa el mismo para todo.
- Si cambias de proveedor en un proyecto empezado, la sesión no se reanuda (los historiales no son compatibles): el modelo nuevo relee `conversacion.md`.

## Variables opcionales
Valores por defecto; lo que guardes en Ajustes tiene prioridad.

Las antiguas `ORION_*` siguen funcionando como alternativa.

| Variable | Por defecto | Para qué |
|---|---|---|
| `PROMETEO_MODEL` | `sonnet` | Modelo del entrevistador (el que habla; mejor rápido) |
| `PROMETEO_EFFORT` | `low` | Esfuerzo del entrevistador |
| `PROMETEO_ARCHITECT_MODEL` | `opus` | Modelo del Arquitecto (escribe los entregables) |
| `PROMETEO_ARCHITECT_EFFORT` | `high` | Esfuerzo del Arquitecto (`medium`…`max`) |
| `PROMETEO_TITLE_MODEL` | `haiku` | Modelo del título automático (`haiku`, `sonnet` o `local:<id>`) |
| `PROMETEO_LMSTUDIO_URL` | `http://localhost:1234` | Servidor de LM Studio |
| `PROMETEO_LOCAL_CONTEXT` | `32768` | Contexto con el que se cargan los modelos locales |
| `PROMETEO_WHISPER_MODEL` | `base` | `small` transcribe mejor pero tarda unos 3 s en CPU |

## Volver a la primera configuración
Ajustes → «Repetir primera configuración» (o borra `settings.local.json`).

Rutas: `http://localhost:5173/#/inicio|proyectos|voces|ajustes|faq|voz|comenzar|conversacion[/slug]`. Atrás/adelante del navegador funcionan.

## Pruebas, CI y releases
```bash
cd backend
uv run python -m unittest discover -s tests -v                 # pruebas unitarias
uv run python ../scripts/smoke.py --arrancar --sin-claude      # prueba de humo en :18765/:15173, sin gastar Claude
uv run python ../scripts/smoke.py --arrancar                   # completa: también una respuesta de Claude (un turno)
```
La prueba de humo sustituye al micrófono: manda por el WebSocket una frase sintetizada con Kokoro, en el mismo formato que el navegador, y comprueba la transcripción, la respuesta hablada, los archivos del proyecto y que al parar no quedan procesos ni puertos ocupados.

La CI (`.github/workflows/ci.yml`) la ejecuta en Ubuntu y en Windows junto con las pruebas, el build del frontend y los lanzadores, e instala con `install.ps1` en un Windows limpio. Claude no se prueba en CI (necesita una suscripción).

Para publicar una versión (la que descarga el instalador de Windows): sube el número en `backend/pyproject.toml` y crea la etiqueta: `git tag v0.1.0 && git push origin v0.1.0`.
