import type { ReactorProps } from '../scene/Scene'

/** Cada vista coloca el reactor de fondo a su manera al montarse. */
export type SetReactor = (p: ReactorProps) => void

/** Reactor de las páginas con lista (proyectos, voces, ajustes, FAQ): arriba y pequeño; late mientras suena un audio. */
export const pageReactor = (sounding = false): ReactorProps => ({
  variant: sounding ? 'escuchando' : 'reposo', energy: sounding ? 'speaking' : 'idle', offsetY: -230, scale: 0.9,
})

/** Centro y radio (px de pantalla) del hueco donde debe quedar el anillo de Prometeo. */
export interface CoreSpot { x: number; y: number; r: number }

// La cámara está en z = 6 con 50° de campo: el plano del reactor mide 2·6·tan(25°) unidades de alto.
const VIEW_H = 2 * 6 * Math.tan((25 * Math.PI) / 180)
const RING = 0.78 // radio del anillo exterior de segmentos (unidades de mundo, escala 1)

/** Lleva el reactor a un punto de la pantalla con el anillo exterior del radio pedido. */
export function reactorAt({ x, y, r }: CoreSpot): Pick<ReactorProps, 'offsetX' | 'offsetY' | 'scale'> {
  const w = window.innerWidth, h = window.innerHeight
  return { offsetX: x - w / 2, offsetY: h / 2 - y, scale: (r * VIEW_H) / (RING * h) }
}
