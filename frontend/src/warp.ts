/**
 * Salto a velocidad luz al pulsar EJECUTAR. Reloj compartido entre la escena 3D (que lo lee en cada
 * frame: estrellas estiradas en rayas que salen de Prometeo) y la interfaz (que se desvanece, cambia de
 * vista a oscuras y aparece el gestor). Con «reducir movimiento» no hay salto: cambio directo.
 *
 *   0 ─ out ─── swap ─── relocate ─── enter ─── end
 *   la interfaz se va · viaje estelar con Prometeo en el centro · Prometeo se recoloca · entra el gestor
 */
import { now } from './intro'

/** Momentos clave (s desde el inicio del salto). */
const W = {
  out: 0.45,      // la interfaz ya se ha desvanecido: solo quedan Prometeo y las estrellas
  swap: 0.9,      // se cambia de vista a oscuras
  relocate: 1.6,  // las estrellas frenan y Prometeo viaja a su sitio en el gestor
  enter: 2.0,     // entra la interfaz del gestor
  end: 2.7,       // fin
}
/** Las rayas: aceleran hasta `full` y frenan a partir de `relocate`. */
const FULL = 0.75
const STOP = W.relocate + 0.55

const warp = { t0: -1 }

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }

/** Segundos que le quedan al salto en curso (0 si no hay). */
export function warpRemaining(): number {
  return warp.t0 < 0 ? 0 : Math.max(0, W.end - (now() - warp.t0))
}

/** 0..1: velocidad de las estrellas (largo de las rayas). 0 fuera del salto. */
export function warpSpeed(): number {
  if (warp.t0 < 0) return 0
  const t = now() - warp.t0
  if (t >= W.end) { warp.t0 = -1; return 0 }
  return t < W.relocate ? smooth((t - 0.1) / (FULL - 0.1)) : 1 - smooth((t - W.relocate) / (STOP - W.relocate))
}

export type WarpLayer = '' | 'warp-out' | 'warp-hidden' | 'warp-in'

/**
 * Lanza el salto.
 * - `layer` recibe la clase CSS de la interfaz en cada fase.
 * - `hold(true)` al empezar: Prometeo va al centro y se carga de energía; `hold(false)` cuando debe recolocarse.
 * - `swap` cambia de vista mientras la interfaz está oculta.
 */
export async function startWarp({ swap, layer, hold }: {
  swap: () => void; layer: (cls: WarpLayer) => void; hold: (on: boolean) => void
}) {
  if (reducedMotion()) { swap(); return }
  warp.t0 = now()
  hold(true)
  layer('warp-out')
  await sleep(W.out * 1000)
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
