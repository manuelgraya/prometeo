/**
 * Sonido del salto a velocidad luz (EJECUTAR): public/sounds/warp.m4a, cuyas fases marcan los tiempos de
 * warp.ts (el acelerón cae en `W.accel`). Se descarga al arrancar y se decodifica en el primer salto.
 * Va directo al destino (no al analizador de la voz) para no mover el reactor.
 */
const fileBytes: Promise<ArrayBuffer | null> = fetch('/sounds/warp.m4a')
  .then((r) => (r.ok ? r.arrayBuffer() : null))
  .catch(() => null)
let decoded: { ctx: AudioContext; buf: Promise<AudioBuffer | null> } | null = null

/** Arranca el sonido y devuelve en cuántos segundos empezará a oírse (para arrancar ahí la animación). */
export async function playWarpSound(ctx: AudioContext): Promise<number> {
  // Sin un gesto reciente el navegador puede dejar resume() colgado: como mucho 300 ms y salto sin sonido.
  if (ctx.state !== 'running') await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))])
  if (decoded?.ctx !== ctx) {
    decoded = { ctx, buf: fileBytes.then((b) => (b ? ctx.decodeAudioData(b.slice(0)) : null)).catch(() => null) }
  }
  const buf = await decoded.buf
  if (!buf || ctx.state !== 'running') return 0
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.value = 0.8
  src.connect(g).connect(ctx.destination)
  const lead = 0.03  // margen para programarlo sin cortes
  src.start(ctx.currentTime + lead)
  return lead + (ctx.outputLatency || ctx.baseLatency || 0)
}
