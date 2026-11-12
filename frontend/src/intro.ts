/**
 * Animación de inicio: reloj compartido entre la escena 3D (que lo lee en cada frame),
 * el sonido sintetizado y la interfaz. Todo se mide con performance.now() en segundos.
 */

/** Momentos clave (s desde el arranque). */
export const T = {
  core: 0.6,    // el corazón empieza a encenderse desde el centro
  ignite: 3.0,  // ignición: onda de choque, aura y primer latido
  stars: 4.0,   // las estrellas se encienden en oleada desde el corazón
  ui: 6.4,      // aparece la interfaz
  end: 7.6,     // fin
}

const SKIP_FADE = 0.6

export const intro = {
  /** idle: aún no ha empezado (todo oscuro) · running · done */
  phase: 'idle' as 'idle' | 'running' | 'done',
  t0: 0,
  skipAt: 0,
  /** Origen del latido del reactor: el primer latido cae justo en la ignición. */
  beatOrigin: 0,
  /** Altura del reactor en unidades de mundo (la escribe el reactor; centro de la oleada de estrellas). */
  cy: 0,
}

export const now = () => performance.now() / 1000

export function startIntro() {
  intro.t0 = now()
  intro.beatOrigin = intro.t0 + T.ignite
  intro.phase = 'running'
}

export function skipIntro() {
  if (intro.phase === 'running' && !intro.skipAt) intro.skipAt = now()
}

export function finishIntro() {
  intro.phase = 'done'
}

interface IntroState {
  /** Luz del núcleo 0..1 */
  core: number
  /** Radio del hueco en la oscuridad (unidades de mundo, relativo al reactor) */
  maskR: number
  /** Opacidad de la oscuridad que rodea el reactor */
  maskA: number
  /** Brillo del frente de la onda de choque */
  rim: number
  /** Intensidad del aura 0..1 */
  aura: number
  /** Destello de la ignición (decae) */
  flash: number
  /** 0 antes de la ignición: el corazón aún no late */
  beat: number
  /** Radio de la oleada de estrellas (unidades de mundo en el plano del reactor) */
  wave: number
}

const FINAL: IntroState = { core: 1, maskR: 2.4, maskA: 0, rim: 0, aura: 1, flash: 0, beat: 1, wave: 40 }
const DARK: IntroState = { core: 0, maskR: 0, maskA: 1, rim: 0, aura: 0, flash: 0, beat: 0, wave: 0 }

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => { const c = clamp01(x); return c * c * (3 - 2 * c) }
const outCubic = (x: number) => 1 - (1 - clamp01(x)) ** 3

export function introState(): IntroState {
  if (intro.phase === 'done') return FINAL
  if (intro.phase === 'idle') return DARK
  const n = now()
  const t = n - intro.t0
  const after = t - T.ignite
  const core = smooth((t - T.core) / (T.ignite - T.core))
  // Antes de la ignición el corazón titila débilmente, como si le costase arrancar.
  const flicker = after < 0 ? 0.88 + 0.12 * Math.sin(t * 23) * Math.sin(t * 7.3) : 1
  const s: IntroState = {
    core: core * flicker,
    maskR: after < 0 ? 0.42 * Math.sqrt(core) : 0.42 + 1.98 * outCubic(after / 0.9),
    maskA: 1 - clamp01((after - 0.9) / 0.5),
    rim: after < 0 ? 0 : (1 - clamp01(after / 1.1)) * clamp01(after / 0.08),
    aura: 0.18 * core + 0.82 * outCubic(after / 1.3),
    flash: after < 0 ? 0 : Math.exp(-after * 4),
    beat: after < 0 ? 0 : 1,
    wave: 14 * outCubic((t - T.stars) / 3.2) ** 1.4,
  }
  if (!intro.skipAt) return s
  // Saltar: fundido rápido hacia el estado final.
  const k = smooth((n - intro.skipAt) / SKIP_FADE)
  const out = { ...s }
  for (const key of Object.keys(FINAL) as (keyof IntroState)[]) out[key] = s[key] + (FINAL[key] - s[key]) * k
  out.beat = 1
  return out
}

export const SKIP_MS = SKIP_FADE * 1000

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
