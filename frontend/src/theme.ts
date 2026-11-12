/**
 * Temas de color. La interfaz HTML usa las variables CSS de `index.css` (`html[data-theme]`);
 * la escena 3D y el cursor cometa leen aquí su paleta, porque pintan en WebGL/canvas.
 */
import { useCallback, useSyncExternalStore } from 'react'

type ThemeId = 'original' | 'rosa'
export const THEMES: readonly ThemeId[] = ['original', 'rosa']

type Vec3 = [number, number, number]
type Rgb = [number, number, number]

export interface ScenePalette {
  /** Fondo del lienzo (sRGB). */
  background: string
  /** Acento principal y secundario de anillos y puntos (sRGB). */
  accent: string
  accent2: string
  /** Colores de shader, en lineal (>1 = brilla con el bloom). */
  auraOuter: Vec3
  auraInner: Vec3
  coreGlow: Vec3
  coreEdge: Vec3
  maskDark: Vec3
  nebulaA: Vec3
  nebulaB: Vec3
  nebulaC: Vec3
  star: Vec3
}

interface CursorPalette {
  /** Cola: va de `trailFrom` (cola) a `trailTo` (cabeza). */
  trailFrom: Rgb
  trailTo: Rgb
  spark: Rgb
  headMid: Rgb
  headEdge: Rgb
}

/** Paleta de la terminal de los agentes (el fondo es transparente: lo pinta .agterm con --term-bg, el cristal de los paneles). Claude Code corre con el tema `dark-ansi` (solo los 16 colores
 *  ANSI), así que esta paleta pinta también sus propios colores. */
export interface TerminalPalette {
  background: string; foreground: string; cursor: string; cursorAccent: string; selectionBackground: string
  black: string; red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string; white: string
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string
  brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string
}

interface Theme { id: ThemeId; scene: ScenePalette; cursor: CursorPalette; terminal: TerminalPalette; metaColor: string }

const PALETTES: Record<ThemeId, Theme> = {
  original: {
    id: 'original',
    metaColor: '#02030a',
    scene: {
      background: '#02030a',
      accent: '#4fd1ff',
      accent2: '#1e6bff',
      auraOuter: [0.12, 0.42, 1.0],
      auraInner: [0.31, 0.82, 1.0],
      coreGlow: [0.45, 1.25, 1.6],
      coreEdge: [0.12, 0.42, 1.0],
      maskDark: [0.0006, 0.0009, 0.003],
      nebulaA: [0.07, 0.16, 0.45],
      nebulaB: [0.22, 0.08, 0.42],
      nebulaC: [0.03, 0.25, 0.38],
      star: [0.82, 0.93, 1.0],
    },
    // Tokyo Night con los neutros llevados al azul marino de los paneles y el cursor en el cian de Prometeo
    terminal: {
      background: 'rgba(0, 0, 0, 0)', foreground: '#bcd6ea', cursor: '#4fd1ff', cursorAccent: '#08122a',
      selectionBackground: 'rgba(79, 209, 255, 0.28)',
      black: '#0b1830', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#ad8ee6', cyan: '#449dab', white: '#bcd6ea',
      brightBlack: '#5b6d8f', brightRed: '#ff7a93', brightGreen: '#b9f27c', brightYellow: '#ff9e64',
      brightBlue: '#7da6ff', brightMagenta: '#bb9af7', brightCyan: '#0db9d7', brightWhite: '#e2f4ff',
    },
    cursor: {
      trailFrom: [30, 107, 255],
      trailTo: [80, 209, 255],
      spark: [170, 230, 255],
      headMid: [200, 245, 255],
      headEdge: [79, 209, 255],
    },
  },
  rosa: {
    id: 'rosa',
    metaColor: '#0a0208',
    scene: {
      background: '#0a0208',
      accent: '#ff6fb5',
      accent2: '#d63384',
      auraOuter: [0.85, 0.1, 0.45],
      auraInner: [1.0, 0.42, 0.72],
      coreGlow: [1.6, 0.62, 1.1],
      coreEdge: [0.85, 0.1, 0.45],
      maskDark: [0.003, 0.0006, 0.0024],
      nebulaA: [0.42, 0.06, 0.26],
      nebulaB: [0.3, 0.08, 0.44],
      nebulaC: [0.45, 0.12, 0.2],
      star: [1.0, 0.86, 0.94],
    },
    // La misma estructura que Tokyo Night, girada hacia el rosa y el violeta del tema
    terminal: {
      background: 'rgba(0, 0, 0, 0)', foreground: '#e8c4d8', cursor: '#ff6fb5', cursorAccent: '#28081c',
      selectionBackground: 'rgba(255, 111, 181, 0.28)',
      black: '#2a0c1f', red: '#ff6f91', green: '#a6e3a1', yellow: '#f5c08a', blue: '#c49bff', magenta: '#ff6fb5', cyan: '#e48fc8', white: '#e8c4d8',
      brightBlack: '#8c5f7c', brightRed: '#ff8aa6', brightGreen: '#c2f5b8', brightYellow: '#ffb47a',
      brightBlue: '#d6b4ff', brightMagenta: '#ff9fd0', brightCyan: '#ffb3e0', brightWhite: '#ffe4f1',
    },
    cursor: {
      trailFrom: [214, 51, 132],
      trailTo: [255, 111, 181],
      spark: [255, 200, 228],
      headMid: [255, 220, 238],
      headEdge: [255, 111, 181],
    },
  },
}

const STORAGE_KEY = 'prometeo.theme'

function initialTheme(): ThemeId {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && (THEMES as readonly string[]).includes(v)) return v as ThemeId
  } catch { /* almacenamiento no disponible */ }
  return 'original'
}

let current: ThemeId = initialTheme()
const listeners = new Set<() => void>()

function apply(id: ThemeId) {
  document.documentElement.dataset.theme = id
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', PALETTES[id].metaColor)
}
apply(current)

/** Tema activo (para código que pinta en cada frame, sin React). */
export const theme = (): Theme => PALETTES[current]

function setTheme(id: ThemeId) {
  if (id === current) return
  current = id
  apply(id)
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* sin persistencia */ }
  listeners.forEach((f) => f())
}

const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f) } }

export function useTheme(): [Theme, (id: ThemeId) => void] {
  const id = useSyncExternalStore(subscribe, () => current)
  return [PALETTES[id], useCallback(setTheme, [])]
}
