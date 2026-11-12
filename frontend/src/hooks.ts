/** Hooks compartidos por varias vistas. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { stopSample } from './api'

export interface ToastMsg { msg: string; error: boolean }

/** Aviso flotante que se borra solo a los `ms` milisegundos (con ms = 0 se queda). */
export function useToast(defaultMs = 3000) {
  const [toast, setToast] = useState<ToastMsg | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const flash = useCallback((msg: string, error = false, ms = defaultMs) => {
    setToast({ msg, error })
    clearTimeout(timer.current)
    if (ms > 0) timer.current = window.setTimeout(() => setToast(null), ms)
  }, [defaultMs])
  return [toast, flash] as const
}

/**
 * Un audio a la vez entre varios (muestras de voz, respuestas de las FAQ): cuál suena, cuál se está
 * pidiendo al backend, y pulsar otra vez el que suena lo para. Al salir de la vista, se calla.
 */
export function usePlayback() {
  const [playing, setPlaying] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  useEffect(() => () => { void stopSample() }, [])

  const stop = useCallback(() => { setPlaying(null); void stopSample() }, [])

  /** `play` empieza el audio y llama a su argumento cuando termina. Devuelve false si falló. */
  const toggle = useCallback(async (id: string, play: (onEnd: () => void) => Promise<void>): Promise<boolean> => {
    if (playing === id) { setPlaying(null); await stopSample(); return true }
    setPending(id)
    try {
      await play(() => setPlaying((p) => (p === id ? null : p)))
      setPlaying(id)
      return true
    } catch {
      setPlaying(null)
      return false
    } finally {
      setPending((p) => (p === id ? null : p))
    }
  }, [playing])

  return { playing, pending, toggle, stop }
}
