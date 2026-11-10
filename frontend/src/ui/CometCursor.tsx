import { useEffect, useRef } from 'react'
import { theme } from '../theme'
import { cursorBus } from './cosmic'

interface Pt { x: number; y: number; life: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; size: number }

const MAX_TRAIL = 70
const MAX_SPARKS = 160
/** Desplazamiento máximo (px) del cometa hacia el centro del botón bajo el cursor. */
const MAX_PULL = 4

/**
 * Cursor cometa: cabeza brillante con cola que se alarga con la velocidad.
 * Canvas a pantalla completa, sin re-renders de React (todo en refs y rAF).
 */
export default function CometCursor() {
  const ref = useRef<HTMLCanvasElement>(null)
  const fine = typeof matchMedia !== 'undefined' && matchMedia('(pointer: fine)').matches

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !fine) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    document.documentElement.classList.add('comet-cursor')

    let dpr = 1, w = 0, h = 0
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth; h = window.innerHeight
      canvas.width = w * dpr; canvas.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const p = { x: -100, y: -100 }
    const head = { x: -100, y: -100 }
    let visible = 0 // 0..1, para aparecer/desaparecer con suavidad
    let inside = false
    const trail: Pt[] = []
    const sparks: Spark[] = []
    let raf = 0

    const spawn = (x: number, y: number, n: number, speed: number) => {
      for (let i = 0; i < n && sparks.length < MAX_SPARKS; i++) {
        const a = Math.random() * Math.PI * 2
        const v = speed * (0.3 + Math.random())
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, size: 0.6 + Math.random() * 1.4 })
      }
    }

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      p.x = e.clientX; p.y = e.clientY
      if (!inside) { head.x = p.x; head.y = p.y; trail.length = 0 }
      inside = true
    }
    const onLeave = () => { inside = false }
    const onBurst = (x: number, y: number) => { if (!reduced.matches) spawn(x, y, 26, 4.5) }
    cursorBus.burstListeners.add(onBurst)

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const t = now / 1000
      visible += ((inside ? 1 : 0) - visible) * 0.2
      ctx.clearRect(0, 0, w, h)
      if (visible < 0.01 && !sparks.length) return

      const still = reduced.matches
      const pal = theme().cursor
      const rgb = (c: readonly number[]) => c.join(', ')
      const text = cursorBus.overText
      // Atracción hacia el centro del botón bajo el cursor.
      let gx = p.x, gy = p.y
      const tg = cursorBus.target
      if (tg && !text) {
        // Limitada a unos px: en elementos grandes (tarjetas) el tirón proporcional
        // separaba el cometa del punto real de clic y hacía difícil acertar botones pequeños.
        const r = tg.getBoundingClientRect()
        const ox = (r.left + r.width / 2 - p.x) * 0.12
        const oy = (r.top + r.height / 2 - p.y) * 0.12
        const m = Math.hypot(ox, oy)
        const s = m > MAX_PULL ? MAX_PULL / m : 1
        gx += ox * s
        gy += oy * s
      }
      const px = head.x, py = head.y
      const k = still ? 1 : tg ? 0.5 : 0.36
      head.x += (gx - head.x) * k
      head.y += (gy - head.y) * k
      const speed = Math.hypot(head.x - px, head.y - py)

      ctx.globalCompositeOperation = 'lighter'

      // --- Cola ---
      if (!still && !text) {
        if (speed > 0.4) trail.push({ x: head.x, y: head.y, life: 1 })
        if (trail.length > MAX_TRAIL) trail.shift()
        const decay = speed > 2 ? 0.045 : 0.09
        for (const q of trail) q.life -= decay
        while (trail.length && trail[0].life <= 0) trail.shift()
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1], b = trail[i]
          const f = (i / trail.length) * b.life
          const [r0, g0, b0] = pal.trailFrom, [r1, g1, b1] = pal.trailTo
          ctx.strokeStyle = `rgba(${Math.round(r0 + (r1 - r0) * f)}, ${Math.round(g0 + (g1 - g0) * f)}, ${Math.round(b0 + (b1 - b0) * f)}, ${(0.55 * f * visible).toFixed(3)})`
          ctx.lineWidth = 0.6 + 7 * f ** 1.4
          ctx.lineCap = 'round'
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        }
        if (speed > 3 && Math.random() < Math.min(0.9, speed / 25)) spawn(head.x, head.y, 1, 0.8)
        else if (speed < 0.5 && Math.random() < 0.025) spawn(head.x, head.y, 1, 0.6) // chispa en reposo
      } else {
        trail.length = 0
      }

      // --- Chispas ---
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i]
        s.x += s.vx; s.y += s.vy; s.vx *= 0.93; s.vy *= 0.93; s.life -= 0.022
        if (s.life <= 0) { sparks.splice(i, 1); continue }
        ctx.fillStyle = `rgba(${rgb(pal.spark)}, ${(s.life * 0.9).toFixed(3)})`
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size * s.life, 0, Math.PI * 2); ctx.fill()
      }

      // --- Cabeza (late como el reactor: doble pulso cada 1,2 s) ---
      const ph = t % 1.2
      const beat = Math.exp(-ph * 9) + (ph > 0.22 ? 0.6 * Math.exp(-(ph - 0.22) * 9) : 0)
      const base = text ? 5 : tg ? 16 : 12
      const R = base * (1 + (still ? 0 : 0.18 * beat) + Math.min(0.4, speed / 40))
      const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, R)
      const a = (text ? 0.45 : 1) * visible
      g.addColorStop(0, `rgba(255, 255, 255, ${a})`)
      g.addColorStop(0.18, `rgba(${rgb(pal.headMid)}, ${0.95 * a})`)
      g.addColorStop(0.4, `rgba(${rgb(pal.headEdge)}, ${0.45 * a})`)
      g.addColorStop(1, `rgba(${rgb(pal.trailFrom)}, 0)`)
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(head.x, head.y, R, 0, Math.PI * 2); ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
    }

    const start = () => { if (!raf) raf = requestAnimationFrame(tick) }
    const stop = () => { cancelAnimationFrame(raf); raf = 0 }
    const onVis = () => (document.hidden ? stop() : start())

    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVis)
    start()
    return () => {
      stop()
      cursorBus.burstListeners.delete(onBurst)
      document.documentElement.classList.remove('comet-cursor')
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fine])

  if (!fine) return null
  return <canvas ref={ref} className="comet" aria-hidden="true" />
}
