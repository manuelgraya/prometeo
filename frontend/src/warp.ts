/**
 * Salto a velocidad luz al pulsar EJECUTAR. Reloj compartido entre la escena 3D (que lo lee en
 * cada frame: estrellas estiradas en rayas y giro de cámara) y la interfaz (que gira y se cambia
 * de vista en mitad del salto). Con «reducir movimiento» no hay salto: cambio directo.
 */
import { now } from './intro'

/** Momentos clave (s desde el inicio del salto). */
export const W = {
  swap: 0.7,   // la vista actual ya ha salido por la izquierda: se cambia de vista
  enter: 0.95, // la vista nueva empieza a entrar por la derecha
  end: 1.8,    // fin: velocidad normal
}

export const warp = { t0: -1 }

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Segundos que le quedan al salto en curso (0 si no hay). */
export function warpRemaining(): number {
  return warp.t0 < 0 ? 0 : Math.max(0, W.end - (now() - warp.t0))
}

export interface WarpState {
  /** 0..1: velocidad de las estrellas (largo de las rayas). */
  speed: number
  /** Giro de la cámara en radianes (negativo: el cielo se va hacia la izquierda). */
  yaw: number
}

const smooth = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c) }

export function warpState(): WarpState {
  if (warp.t0 < 0) return { speed: 0, yaw: 0 }
  const t = now() - warp.t0
  if (t >= W.end) { warp.t0 = -1; return { speed: 0, yaw: 0 } }
  // Acelera hasta el cambio de vista, mantiene y frena al final.
  const speed = t < W.swap ? smooth(t / W.swap) : 1 - smooth((t - W.enter) / (W.end - W.enter))
  // El cielo se desplaza a la izquierda con la interfaz que sale (cámara hacia la derecha)
  // y vuelve al frente mientras entra la vista nueva por la derecha.
  const yaw = -0.32 * (t < W.swap ? smooth(t / W.swap) : 1 - smooth((t - W.swap) / (W.end - W.swap)))
  return { speed, yaw }
}

/**
 * Lanza el salto. `swap` se llama cuando la vista actual ya ha salido (ahí se cambia de vista);
 * `layer` recibe la clase CSS de cada fase para girar la interfaz.
 */
export async function startWarp(swap: () => void, layer: (cls: '' | 'warp-out' | 'warp-in') => void) {
  if (reducedMotion()) { swap(); return }
  warp.t0 = now()
  layer('warp-out')
  await sleep(W.swap * 1000)
  swap()
  await sleep((W.enter - W.swap) * 1000)
  layer('warp-in')
  await sleep((W.end - W.enter) * 1000)
  layer('')
}
