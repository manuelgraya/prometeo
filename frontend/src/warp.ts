/**
 * Salto a velocidad luz al pulsar EJECUTAR. Reloj compartido entre la escena 3D (que lo lee en cada
 * frame), el sonido (public/sounds/warp.m4a) y la interfaz (que se desvanece, cambia de vista a oscuras
 * y aparece el gestor). Los tiempos siguen las fases del sonido; el reloj arranca cuando empieza a sonar.
 * Con «reducir movimiento» no hay salto: cambio directo.
 *
 *   0 ──── accel ──── swap ──── relocate ──── enter ──── stop ──── end
 *   subida: Prometeo se encoge · acelerón: destello y rayas por los bordes · rugido · se apaga: frena, crece y se recoloca
 */
import { now } from './intro'

/** Momentos clave (s desde que empieza a sonar), medidos sobre la envolvente de warp.m4a. */
export const W = {
  out: 0.45,      // la interfaz ya se ha desvanecido: solo quedan Prometeo y las estrellas
  accel: 0.8,     // el acelerón (salto de volumen del sonido): las estrellas salen disparadas
  swap: 0.9,      // se cambia de vista a oscuras
  relocate: 1.65, // el rugido empieza a apagarse: las estrellas frenan, Prometeo crece y viaja a su sitio
  enter: 2.05,    // entra la interfaz del gestor
  stop: 2.3,      // las estrellas se han parado (el sonido ya es solo cola)
  end: 2.8,       // fin
}
/** Tamaño de Prometeo al final de la subida y tras el acelerón, relativo al normal. */
const SMALL = 0.16
const TINY = 0.06

const warp = { t0: -1 }

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const elapsed = () => (warp.t0 < 0 ? -1 : now() - warp.t0)

/** Segundos que le quedan al salto en curso (0 si no hay). */
export function warpRemaining(): number {
  return warp.t0 < 0 ? 0 : Math.max(0, W.end - (now() - warp.t0))
}

/**
 * 0..1: velocidad de las estrellas (largo de las rayas). 0 fuera del salto.
 * Durante la subida apenas se mueven; con el acelerón llegan de golpe a tope; frenan cuando se apaga.
 */
export function warpSpeed(): number {
  const t = elapsed()
  if (t < 0) return 0
  if (t >= W.end) { warp.t0 = -1; return 0 }
  if (t < W.accel) return 0.22 * smooth((t - 0.1) / (W.accel - 0.1))
  if (t < W.relocate) return 0.22 + 0.78 * smooth((t - W.accel) / 0.14)
  return 1 - smooth((t - W.relocate) / (W.stop - W.relocate))
}

/**
 * Escala de Prometeo durante el salto (1 fuera de él). En la subida se va alejando (en perspectiva,
 * 1 / (1 + k·d)) hasta `SMALL`; con el acelerón sale disparado hasta `TINY`; al frenar vuelve a acercarse.
 */
export function warpScale(): number {
  const t = elapsed()
  if (t < 0) return 1
  const away = (size: number) => 1 / size - 1  // distancia que da ese tamaño
  let d: number
  if (t < W.accel) d = away(SMALL) * smooth(t / W.accel)
  else if (t < W.relocate) d = away(SMALL) + (away(TINY) - away(SMALL)) * (1 - (1 - clamp01((t - W.accel) / 0.15)) ** 3)
  else d = away(TINY) * (1 - smooth((t - W.relocate) / (W.enter + 0.2 - W.relocate)))
  return 1 / (1 + d)
}

/** 0..1: fogonazo del núcleo en el acelerón, que se apaga en medio segundo. */
export function warpFlash(): number {
  const t = elapsed() - W.accel
  return t < 0 || elapsed() < 0 ? 0 : Math.exp(-t * 7)
}

export type WarpLayer = '' | 'warp-out' | 'warp-hidden' | 'warp-in'

/**
 * Lanza el salto.
 * - `layer` recibe la clase CSS de la interfaz en cada fase.
 * - `hold(true)` al empezar: Prometeo va al centro; `hold(false)` cuando debe recolocarse.
 * - `swap` cambia de vista mientras la interfaz está oculta.
 * - `sound` arranca el sonido y resuelve con el retraso (s) hasta que se oye: ahí arranca el reloj.
 */
export async function startWarp({ swap, layer, hold, sound }: {
  swap: () => void; layer: (cls: WarpLayer) => void; hold: (on: boolean) => void; sound?: () => Promise<number>
}) {
  if (reducedMotion()) { swap(); return }
  const delay = sound ? await sound().catch(() => 0) : 0
  warp.t0 = now() + delay
  hold(true)
  layer('warp-out')
  await sleep((delay + W.out) * 1000)
  layer('warp-hidden')
  await sleep((W.swap - W.out) * 1000)
  swap()
  await sleep((W.relocate - W.swap) * 1000)
  hold(false)
  await sleep((W.enter - W.relocate) * 1000)
  layer('warp-in')
  await sleep((W.end - W.enter) * 1000)
  layer('')
}
