import { useCallback, useEffect, useRef, useState } from 'react'
import type { Mic } from './audio/mic'
import { VoicePlayer } from './audio/player'
import { t } from './i18n'
import type { Energy } from './scene/Scene'

export interface Artifact { name: string; content: string; mtime: number }
export interface ProjectMeta { slug: string; title: string; created: string; updated: string; artifacts?: string[]; repo?: string | null
  /** Agentes lanzados con EJECUTAR (solo en la lista de proyectos). */
  agents?: number }
export interface Msg { role: 'user' | 'agent'; text: string; tools: string[] }

let player: VoicePlayer | null = null
let micPromise: Promise<Mic> | null = null
function getMic() {
  micPromise ??= import('./audio/mic').then(({ Mic }) => new Mic())
  return micPromise
}
/** Reproductor compartido, creado al vuelo (su AudioContext puede nacer suspendido hasta un gesto). */
export function audioPlayer() {
  player ??= new VoicePlayer()
  return player
}

/** Debe llamarse desde un gesto del usuario (clic) para desbloquear el audio. */
export async function unlockAudio() {
  const p = audioPlayer()
  await p.unlock()
  return p
}

const TOOL_LABELS: Record<string, () => string> = {
  'prometeo:crear-prompt': () => t('tool.crear-prompt'),
  'prometeo:documentar-plan': () => t('tool.documentar-plan'),
  'prometeo:desglosar-tareas': () => t('tool.desglosar-tareas'),
  'prometeo:resumen-notas': () => t('tool.resumen-notas'),
  mcp__prometeo__encargar_entregables: () => t('tool.handoff'),
  mcp__prometeo__set_voice: () => t('tool.voice'),
  mcp__prometeo__finish_voice_setup: () => t('tool.voiceSaved'),
}

/** auto: el VAD decide cuándo acabas. manual: hablas por tramos y pulsas TERMINAR. */
type TurnMode = 'auto' | 'manual'
const TURN_KEY = 'prometeo.turnMode'
function initialTurnMode(): TurnMode {
  try { return localStorage.getItem(TURN_KEY) === 'manual' ? 'manual' : 'auto' } catch { return 'auto' }
}

/** Une los tramos con ~0,2 s de silencio para que Whisper no pegue palabras. */
function joinChunks(chunks: Float32Array[]): Float32Array {
  const gap = 3200
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0) + gap * (chunks.length - 1))
  let at = 0
  chunks.forEach((c, i) => { out.set(c, at); at += c.length + (i < chunks.length - 1 ? gap : 0) })
  return out
}

export function useSession(opts: { mode: 'voz' | 'plan'; project?: string | null; enabled: boolean }) {
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [serverState, setServerState] = useState<'idle' | 'thinking' | 'speaking' | 'listening'>('idle')
  const [playing, setPlaying] = useState(false)
  const [micOn, setMicOn] = useState(false)
  const [micError, setMicError] = useState<string | null>(null)
  const [project, setProject] = useState<ProjectMeta | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [voiceDone, setVoiceDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [turnMode, setTurnModeState] = useState<TurnMode>(initialTurnMode)
  const [buffered, setBuffered] = useState(false)
  const [speechActive, setSpeechActive] = useState(false)

  const ws = useRef<WebSocket | null>(null)
  const turn = useRef(0)
  const minTurn = useRef(0)
  const pendingAudioTurn = useRef<number | null>(null)
  const turnModeRef = useRef(turnMode)
  const chunks = useRef<Float32Array[]>([])
  /** Se pulsó TERMINAR mientras el VAD aún no había cerrado el último tramo. */
  const pendingFinish = useRef(false)

  const send = useCallback((data: object | ArrayBuffer) => {
    const s = ws.current
    if (s?.readyState !== WebSocket.OPEN) return
    s.send(data instanceof ArrayBuffer ? data : JSON.stringify(data))
  }, [])

  /** Barge-in: la persona habla mientras PROMETEO habla o piensa. */
  const interrupt = useCallback(() => {
    player?.stop()
    minTurn.current = turn.current + 1
    send({ type: 'interrupt' })
  }, [send])

  const appendAgent = (fn: (m: Msg) => Msg) =>
    setMessages((ms) => {
      const last = ms[ms.length - 1]
      if (last?.role === 'agent') return [...ms.slice(0, -1), fn(last)]
      return [...ms, fn({ role: 'agent', text: '', tools: [] })]
    })

  useEffect(() => {
    if (!opts.enabled) return
    const p = player
    if (p) p.onPlayingChange = (on) => {
      setPlaying(on)
      void micPromise?.then((m) => m.setStrict(on))
    }
    const q = new URLSearchParams({ mode: opts.mode })
    if (opts.project) q.set('project', opts.project)
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const sock = new WebSocket(`${proto}://${location.host}/ws?${q}`)
    sock.binaryType = 'arraybuffer'
    ws.current = sock
    sock.onopen = () => setConnected(true)
    sock.onclose = () => setConnected(false)
    sock.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        const t = pendingAudioTurn.current
        pendingAudioTurn.current = null
        if (t !== null && t >= minTurn.current) player?.enqueue(e.data)
        return
      }
      const d = JSON.parse(e.data)
      switch (d.type) {
        case 'ready':
          setProject(d.project)
          if (d.project) fetch(`/api/projects/${d.project.slug}`).then((r) => r.json()).then((p) => {
            setArtifacts(p.artifacts)
            // Historial previo (conversacion.md) al reanudar un proyecto
            const prev = parseConversation(p.conversation)
            setMessages((ms) => [...prev.filter((p) => !ms.some((m) => m.text.trim() === p.text.trim())), ...ms])
          }).catch(() => {})
          break
        case 'turn_start':
          turn.current = d.turn
          setMessages((ms) => [...ms, { role: 'agent', text: '', tools: [] }])
          break
        case 'audio':
          pendingAudioTurn.current = d.turn
          break
        case 'delta':
          appendAgent((m) => ({ ...m, text: m.text + d.text }))
          break
        case 'tool': {
          const label = (TOOL_LABELS[d.skill ?? ''] ?? TOOL_LABELS[d.name])?.() ?? (d.file ? t('tool.writing', { file: d.file }) : null)
          if (label) appendAgent((m) => ({ ...m, tools: [...m.tools, label] }))
          break
        }
        case 'transcript':
          setMessages((ms) => {
            // El transcript va antes de la respuesta de PROMETEO que empieza después.
            const last = ms[ms.length - 1]
            const base = last?.role === 'agent' && !last.text ? ms.slice(0, -1) : ms
            return [...base, { role: 'user', text: d.text, tools: [] }]
          })
          break
        case 'state':
          setServerState(d.state)
          break
        case 'turn_end':
          setServerState('idle')
          setMessages((ms) => ms.filter((m) => m.text || m.tools.length))
          break
        case 'project':
          setProject(d.project)
          break
        case 'artifacts':
          setArtifacts(d.artifacts)
          break
        case 'architect': {
          // El Arquitecto trabaja en segundo plano: su estado se anota en el último mensaje.
          const label = d.state === 'working' ? t('architect.working') : d.state === 'done' ? t('architect.done') : t('architect.error')
          appendAgent((m) => ({ ...m, tools: [...m.tools, label] }))
          if (d.state === 'error') { setError(d.summary); setTimeout(() => setError(null), 6000) }
          break
        }
        case 'voice_setup_done':
          setVoiceDone(true)
          break
        case 'error':
          setError(d.message)
          setTimeout(() => setError(null), 6000)
          break
      }
    }
    return () => {
      sock.close()
      player?.stop()
    }
  }, [opts.enabled, opts.mode, opts.project])

  const sendAudio = useCallback((audio: Float32Array) => {
    send(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer)
  }, [send])

  const clearTurn = useCallback(() => {
    chunks.current = []
    pendingFinish.current = false
    setBuffered(false)
  }, [])

  /** Envía lo acumulado en modo por turnos como una sola frase. */
  const flushTurn = useCallback(() => {
    const parts = chunks.current
    clearTurn()
    if (parts.length) sendAudio(joinChunks(parts))
  }, [clearTurn, sendAudio])

  /** Botón TERMINAR: si el VAD sigue dentro de un tramo, espera a que lo entregue. */
  const finishTurn = useCallback(async () => {
    const m = await getMic()
    if (m.inSpeech) pendingFinish.current = true
    else flushTurn()
  }, [flushTurn])

  const setTurnMode = useCallback((mode: TurnMode) => {
    turnModeRef.current = mode
    setTurnModeState(mode)
    try { localStorage.setItem(TURN_KEY, mode) } catch { /* sin persistencia */ }
    if (mode === 'auto') flushTurn()
  }, [flushTurn])

  // Micrófono: singleton de módulo; cada sesión solo cambia los callbacks.
  const enableMic = useCallback(async () => {
    try {
      const m = await getMic()
      m.setCallbacks({
        // Barge-in solo si PROMETEO está hablando; si está pensando, esperamos a la transcripción.
        onSpeechStart: () => { if (player?.playing) interrupt() },
        onUtterance: (audio) => {
          if (turnModeRef.current === 'auto') { sendAudio(audio); return }
          chunks.current.push(audio)
          setBuffered(true)
          if (pendingFinish.current) flushTurn()
        },
        onSpeechActive: (active) => {
          setSpeechActive(active)
          // Falso positivo del VAD tras pulsar TERMINAR: enviamos lo que ya había.
          if (!active && pendingFinish.current) flushTurn()
        },
      })
      await m.start()
      setMicOn(true)
      setMicError(null)
    } catch (e) {
      setMicError(t('micError'))
      console.error(e)
    }
  }, [interrupt, sendAudio, flushTurn])

  const disableMic = useCallback(async () => {
    await (await getMic()).pause()
    clearTurn()
    setSpeechActive(false)
    setMicOn(false)
  }, [clearTurn])

  // Al salir de la vista, el micrófono se pausa (no se destruye) y se descarta lo no enviado.
  useEffect(() => () => {
    chunks.current = []
    pendingFinish.current = false
    void micPromise?.then((m) => m.pause())
  }, [])

  const sendText = useCallback((text: string) => {
    if (!text.trim()) return
    if (player?.playing) interrupt()
    setMessages((ms) => [...ms, { role: 'user', text, tools: [] }])
    send({ type: 'text', text })
  }, [interrupt, send])

  const energy: Energy = playing ? 'speaking' : serverState === 'thinking' ? 'thinking' : micOn ? 'listening' : 'idle'

  // En modo por turnos, el VAD sigue detectando voz pero solo se envía al pulsar TERMINAR.
  const capturing = turnMode === 'manual' && micOn && (buffered || speechActive)

  return {
    connected, messages, energy, micOn, micError, enableMic, disableMic, sendText, interrupt, project, artifacts, voiceDone, playing, error,
    turnMode, setTurnMode, finishTurn, capturing,
  }
}

/** Convierte conversacion.md («**Tú** (12:00): …») en mensajes. */
function parseConversation(md: string): Msg[] {
  const out: Msg[] = []
  for (const line of md.split('\n')) {
    const m = line.match(/^\*\*(Tú|PROMETEO|ORION)\*\* \([^)]*\): (.*)$/)
    if (m) out.push({ role: m[1] === 'Tú' ? 'user' : 'agent', text: m[2], tools: [] })
  }
  return out
}

/** Lo que devuelve useSession: lo reciben las piezas de la conversación (InputBar...). */
export type Session = ReturnType<typeof useSession>
