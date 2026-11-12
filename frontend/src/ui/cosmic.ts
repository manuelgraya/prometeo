/**
 * Interacción cursor ↔ botones, delegada en el documento (un único listener para toda la app).
 * - Ilumina el interior del botón donde está el cursor (--mx / --my).
 * - Efecto magnético en los botones `.cosmic` (se acercan al cursor).
 * - Onda (ripple) al pulsar y ráfaga de chispas del cometa.
 * El cursor cometa escucha `cursorBus` sin conocer los botones.
 */

/** Elementos interactivos que reciben luz y ripple. */
const INTERACTIVE = '.cosmic, .btn, .card, .iconbtn, .tab, .nav button, .seg button, .wordmark'
const MAGNET_RADIUS = 80
const MAGNET_PULL = 0.22

type BurstFn = (x: number, y: number) => void

export const cursorBus = {
  /** Botón bajo el cursor (el cometa se siente atraído hacia su centro). */
  target: null as HTMLElement | null,
  /** El cursor está sobre un campo de texto: se muestra el caret nativo. */
  overText: false,
  burstListeners: new Set<BurstFn>(),
  burst(x: number, y: number) { this.burstListeners.forEach((f) => f(x, y)) },
}

export function installCosmicInteractions(): () => void {
  let raf = 0
  let last: PointerEvent | null = null

  const frame = () => {
    raf = 0
    const e = last
    if (!e) return
    const el = e.target instanceof Element ? e.target : null
    cursorBus.overText = !!el?.closest('input, textarea, [contenteditable="true"]')
    const hit = el?.closest<HTMLElement>(INTERACTIVE) ?? null
    cursorBus.target = hit && !(hit as HTMLButtonElement).disabled ? hit : null
    if (hit) {
      const r = hit.getBoundingClientRect()
      hit.style.setProperty('--mx', `${e.clientX - r.left}px`)
      hit.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    // Magnetismo: solo el botón principal más cercano, dentro de un radio alrededor de su borde.
    const btns = [...document.querySelectorAll<HTMLElement>('.cosmic')].map((b) => {
      const r = b.getBoundingClientRect()
      // Rect sin la traslación actual, para que no se retroalimente.
      // El navegador normaliza "0px 0px" a "0px", así que la y puede faltar.
      const [tx = 0, ty = 0] = (b.style.translate || '').split(' ').map((v) => parseFloat(v) || 0)
      const dx = e.clientX - (r.left - tx + r.width / 2)
      const dy = e.clientY - (r.top - ty + r.height / 2)
      const dist = Math.hypot(Math.max(0, Math.abs(dx) - r.width / 2), Math.max(0, Math.abs(dy) - r.height / 2))
      return { b, dx, dy, dist }
    })
    const best = btns.reduce<(typeof btns)[number] | null>((m, x) => (x.dist < MAGNET_RADIUS && (!m || x.dist < m.dist) ? x : m), null)
    for (const { b, dx, dy } of btns) {
      const near = b === best?.b
      b.classList.toggle('near', near)
      b.style.translate = near
        ? `${(dx * MAGNET_PULL * 0.25).toFixed(1)}px ${(dy * MAGNET_PULL * 0.5).toFixed(1)}px`
        : '0px 0px'
    }
  }

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    last = e
    raf ||= requestAnimationFrame(frame)
  }

  const onDown = (e: PointerEvent) => {
    const el = e.target instanceof Element ? e.target.closest<HTMLElement>(INTERACTIVE) : null
    if (!el || (el as HTMLButtonElement).disabled) return
    const r = el.getBoundingClientRect()
    const size = Math.max(r.width, r.height) * 2.2
    const ripple = document.createElement('span')
    ripple.className = 'ripple'
    Object.assign(ripple.style, {
      width: `${size}px`, height: `${size}px`,
      left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px`,
    })
    el.appendChild(ripple)
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
    setTimeout(() => ripple.remove(), 1200)
    cursorBus.burst(e.clientX, e.clientY)
  }

  const onLeave = () => {
    cursorBus.target = null
    document.querySelectorAll<HTMLElement>('.cosmic').forEach((b) => { b.style.translate = '0px 0px'; b.classList.remove('near') })
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  window.addEventListener('pointerdown', onDown, { passive: true })
  document.documentElement.addEventListener('pointerleave', onLeave)
  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerdown', onDown)
    document.documentElement.removeEventListener('pointerleave', onLeave)
  }
}
