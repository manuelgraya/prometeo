---
tags: [prometeo, ui, design]
updated: 2026-11-10
---
# UI — Midnight Galaxy

Figma: https://www.figma.com/design/ieSA764l6YXaKg9c4LgdYO

UI labels below are the Spanish ones shown by default (EN equivalents in `i18n.ts`).

## Views
| View | When | Content |
|---|---|---|
| **01 · First time — Comenzar** | First run on that machine (no `configured` in `settings.local.json`) | *Despertar* (awakening) reactor with a spiky aura + **COMENZAR** and **ELEGIR VOZ** |
| **02 · Definir voz** (voice setup) | After pressing COMENZAR | *Escuchando* (listening) reactor with a soft aura, status top right, Prometeo's caption, **VER VOCES** and **SALTAR** buttons |
| **03 · Inicio** (home) | Later visits | *Reposo* (rest) reactor + **EMPEZAR / START** (new conversation) and **ABRIR PROYECTO / OPEN PROJECT** |
| 04 · Conversación | After EMPEZAR | In code only (missing in Figma): reactor, transcript, text box and deliverables panel |
| 05 · Proyectos | After ABRIR PROYECTO | In code only (missing in Figma): project list with a trash button and in-card confirmation |
| 06 · Voces | Navigation or ELEGIR VOZ | In code only: one card per voice (native / accented) with ESCUCHAR and USAR, shared speed. The reactor switches to *speaking* during a sample |
| 08 · FAQ | Navigation (`#/faq`) | In code only: one card per question from `agent/faqs.md`; clicking it plays Prometeo's pre-recorded answer and expands the text (PROMETEO label). Click again to stop. *Speaking* reactor while it plays. A **GRABADA / RECORDED** chip marks hand-recorded answers |
| 07 · Ajustes (settings) | Navigation | In code only: sections Voz, Rendimiento (CPU/GPU, Whisper), Cerebro (model, effort), Interfaz (language) and Primera configuración. Segmented controls (`.seg`) |

Shared header: **PROMETEO** wordmark + navigation **Inicio · Proyectos · Voces · Ajustes · FAQ** top left (under 760 px the nav wraps); **ES | EN** switch fixed top right (`.langswitch`, outside `.topleft`); status (project · listening) just left of the switch (`.status { right: 196px }`). Under 760 px wide the switch goes to the corner (16 px), the status drops below it (`top: 84px`) and toasts move down to `top: 112px`; `.inputbar input` has `min-width: 0` so the text box can shrink. Routes `#/inicio`, `#/proyectos`, `#/voces`, `#/ajustes`, `#/faq`, `#/voz`, `#/comenzar`, `#/conversacion[/slug]`; browser back/forward work. A new conversation only goes into the URL once the user has said something, because empty projects are deleted on exit.

> [!note] Figma is out of date
> The Figma views still use the ORION name and the old buttons.

## Tokens
Values of the **Original** theme; each theme redefines them → [[#Colour themes — `src/theme.ts`]].

| Token | Value |
|---|---|
| `color/bg` | `#02030A` |
| `color/cyan` | `#4FD1FF` |
| `color/blue` | `#1E6BFF` |
| `color/text` | `#D8F4FF` |
| Headings / buttons | Orbitron |
| Body text | Inter Light |

## Reactor: states and animation
- **Awakening / idle**: slow breathing, a beat every ~1.2 s and a rippling spiky aura.
- **Listening**: rings react to microphone volume.
- **Thinking**: fast rotation and orbiting particles.
- **Speaking**: the core pulses with TTS amplitude (AnalyserNode).

## Startup animation — `intro.ts`, `ui/Intro.tsx`, `audio/introSound.ts`
Plays on every full page load, only when landing on `inicio`, `comenzar` or no hash (on `#/voz` or `#/conversacion` the mic would start under it). ~7.6 s; timeline in `T` (`intro.ts`):

| Time | Visual | Sound |
|---|---|---|
| 0 – 0.6 s | Everything dark (`#02030A`) | Sub-bass drone (E1, two detuned saws) starts swelling |
| 0.6 – 3 s (`T.core`) | Heart lights up from the centre, flickering | Drone grows + filtered-noise riser sweeping up |
| 3 s (`T.ignite`) | **Ignition**: core flash, cyan shockwave ring, rings and aura revealed | Impact: sine dropping 130 → 34 Hz + noise burst into a generated reverb |
| from 3 s | Heart starts beating | Low double thumps in sync with the reactor beat |
| 4 – 7 s (`T.stars`) | Stars light up in a wave radiating from the heart, each with a brief flare; nebula fades in | Open-fifths chord (E) blooming + random high E-pentatonic pings |
| 6.4 s (`T.ui`) | UI (`.layer`) and comet cursor fade in | Fades out |

- **Shared clock**: `intro.ts` holds the phase (`idle · running · done`) and `introState()` (core light, mask radius, rim, aura, flash, star wave…), read by `Scene.tsx` in `useFrame` like `levels`. Uses `performance.now()`, not the R3F clock.
- **Darkness**: a large plane parented to the reactor group (`maskFrag`, `renderOrder 999`, no depth test) with a hole that opens from the heart, so it follows `offsetY` / `scale`. Its colour is in **linear** space (the postprocessing converts to sRGB). Bloom still leaks past the hole edge on purpose.
- **Stars**: `starVert` projects each star onto the reactor plane and lights it when `uWave` reaches it (staggered by `aPhase`). The nebula is faded by multiplying its colour (its alpha is always 1).
- **Beat sync**: the reactor beat phase is now `(now − intro.beatOrigin) % 1.2`, with the origin at the ignition, so the visual double beat and the sound thumps coincide. Before ignition the heart doesn't beat.
- **Hidden UI**: `.layer` gets `inert` + `.intro-hidden` (opacity 0) and `html.intro-dark` hides the comet canvas until `T.ui`.
- **Skip**: click or any key after the start → 0.6 s fade to the final state, sound ramps down in 0.3 s.
- **Autoplay gate**: browsers usually leave the `AudioContext` suspended without a gesture, and `resume()` then stays pending instead of failing. After 150 ms the state is checked: if not `running`, a dim **TOCA PARA DESPERTAR A PROMETEO / TAP TO AWAKEN PROMETEO** (`intro.gate`) shows in the dark; `click` or a key starts it (`click`, not `pointerdown`, because a touch only grants activation on click). If the gesture doesn't unlock audio (e.g. Esc) the intro runs silent after 300 ms: sound is only scheduled on a running context, or it would play later over the UI.
- **Sound**: 100 % Web Audio, no files. Goes straight to the destination (not through the voice analyser, so `levels.out` stays clean), through a compressor. Volume `master.gain` = 0.42 → rendered peak ≈ 0.71 (0.75 clipped at 1.23). Uses the shared `audioPlayer()` context, so the gate click also unlocks Prometeo's voice.
- `prefers-reduced-motion`: no intro. StrictMode-safe (module-level `launched` flag).

## Cosmic buttons — `ui/CosmicButton.tsx`
EMPEZAR, ABRIR PROYECTO and COMENZAR. CSS only (`index.css`, section «Botones cósmicos»):
- Border with a rotating cyan → blue → violet `conic-gradient` (`@property --angle`, 6 s).
- Inner nebula (radial-gradients) and twinkling, drifting micro-stars.
- Outer glow that beats **in sync with the reactor** (double pulse every 1.2 s, `@property --glow`).
- Diagonal *shine* every ~4.2 s.
- EMPEZAR is primary (`--i: 1`); ABRIR PROYECTO secondary (`--i: 0.55`), same visual language.

## Comet cursor — `ui/CometCursor.tsx`
- Full-screen canvas (`z-index: 50`, `pointer-events: none`), animated with `requestAnimationFrame`, no React re-renders.
- White-cyan head with a halo that beats like the reactor; tail that lengthens with speed; sparks when moving and occasionally at rest.
- Pull towards the centre of the hovered button **capped at 4 px** (`MAX_PULL`): the comet never drifts away from the real click point.
- Over inputs: native text cursor and a smaller comet. Only with `pointer: fine` (absent on touch).
- `prefers-reduced-motion`: head only, no tail or sparks. Pauses while the tab is hidden.

## Cursor ↔ buttons interaction — `ui/cosmic.ts`
A single delegated listener on the document:
- Light under the cursor: `--mx` / `--my` variables → `radial-gradient` inside the button.
- **Magnetism**: the nearest cosmic button (80 px radius) shifts a few px towards the cursor and springs back; on approach a fast bright ring lights up.
- Click: *ripple* from the click point + a burst of comet sparks.
- Softer version on `.btn.small`, project cards, `.iconbtn`, tabs, `.nav button` and `.seg button`.
- `cursorBus` tells the comet about the hovered button and bursts without coupling them (the comet is drawn towards the button centre, at most 4 px).

## Interface language — `src/i18n.ts`
- **ES | EN** selector in two places: the header switch, top right (`LangSwitch` in `App.tsx`), and **Ajustes → Interfaz** (`Segmented`). Both use the same `lang` state. It used to sit next to the wordmark inside `.topleft`. Only the interface changes: **voice, agent and transcription stay in Spanish**.
- Home-grown i18n, no library: `t('key')`, `es` / `en` dictionaries; persisted in `localStorage` (`prometeo.lang`) and updates `<html lang>`. Spanish by default.
- In English it shows «Voice: Spanish only (for now)». Buttons: COMENZAR → START, EMPEZAR → START, ABRIR PROYECTO → OPEN PROJECT (keys `begin`, `start`, `openProject`).

## Colour themes — `src/theme.ts`
Selector in **Ajustes → Interfaz → Tema**: **Original** (cyan/blue) and **Rosa** (fuchsia reactor, magenta/lavender nebula, pink comet, dark maroon background `#0a0208`). Instant switch, saved in `localStorage` (`prometeo.theme`), sets `<html data-theme>` and `<meta theme-color>`. Merged from PR #1 (`36a5014`).
- **HTML/CSS:** every fixed colour in `index.css` became an RGB variable (`--cyan-rgb`, `--blue-rgb`, `--violet-rgb`, `--text-rgb`, `--surface-rgb`, `--panel-rgb`, `--glint-rgb`, `--ripple-rgb`, `--star-tint`, `--option-bg`) defined per `html[data-theme='…']`; the rest of the CSS only uses them.
- **3D scene:** shader colours (aura, core, intro mask, nebula, stars) are uniforms copied from `theme().scene` every frame; rings and dots use `accent` / `accent2`. Shader colours are linear (>1 glows with bloom).
- **Comet cursor:** tail, sparks and head read `theme().cursor`.
- Error colours (`.btn.danger`, error toasts) stay red in both themes.
- Adding a theme = one palette in `theme.ts` + one variable block in `index.css`.
- Known nits: Original is not pixel-identical to before (one star tint, `.cosmic` and `.toast.info` backgrounds shifted slightly); the theme applies when the JS loads, so a Rosa user may see the original background for an instant on reload.

Libraries: `three`, `@react-three/fiber`, `@react-three/drei`, `@react-three/postprocessing`, `react-markdown`.

Related: [[09 Logo prompts]] · [[01 Architecture]]
