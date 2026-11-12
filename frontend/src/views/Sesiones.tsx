/** Las dos vistas que hablan con Prometeo por WebSocket: definir la voz y la conversación de un proyecto. */
import { useEffect } from 'react'
import { api } from '../api'
import { t } from '../i18n'
import type { AgentRef } from '../routes'
import { useSession } from '../session'
import Artifacts from '../ui/Artifacts'
import { Caption, InputBar, SessionStatus, Transcript } from '../ui/Chat'
import type { SetReactor } from './common'

/* ---------------- 02 · Definir voz ---------------- */
export function DefinirVoz({ setReactor, onDone, onVoices }: { setReactor: SetReactor; onDone: () => void; onVoices: () => void }) {
  const s = useSession({ mode: 'voz', enabled: true })
  const { enableMic } = s
  useEffect(() => { void enableMic() }, [enableMic])
  useEffect(() => { setReactor({ variant: 'escuchando', energy: s.energy, offsetY: 40 }) }, [s.energy, setReactor])
  useEffect(() => {
    if (s.voiceDone && !s.playing) {
      const id = setTimeout(onDone, 900)
      return () => clearTimeout(id)
    }
  }, [s.voiceDone, s.playing, onDone])

  const skip = async () => {
    await api.saveVoice({ configured: true }).catch(() => {})
    onDone()
  }

  return (
    <>
      <SessionStatus connected={s.connected} label={t('definingVoice')} energy={s.energy} />
      <Caption messages={s.messages} />
      <div className="subactions">
        <button className="btn secondary small" onClick={onVoices}>{t('seeVoices')}</button>
        <button className="btn secondary small" onClick={skip}>{t('skip')}</button>
      </div>
      <InputBar s={s} placeholder={t('voicePlaceholder')} />
      {(s.error || s.micError) && <div className="toast">{s.error || s.micError}</div>}
    </>
  )
}

/* ---------------- 04 · Conversación ---------------- */
export function Conversacion({ project, setReactor, onRun }: {
  project: string | null; setReactor: SetReactor; onRun: (a: AgentRef) => void
}) {
  const s = useSession({ mode: 'plan', project, enabled: true })
  const { enableMic } = s
  useEffect(() => { void enableMic() }, [enableMic])
  useEffect(() => { setReactor({ variant: 'escuchando', energy: s.energy, offsetY: 70, scale: 0.8 }) }, [s.energy, setReactor])

  // En cuanto la persona dice algo, el proyecto existe de verdad: lo reflejamos en la URL
  // (sin recargar) para que atrás/adelante vuelvan a él.
  const slug = s.project?.slug
  const spoke = s.messages.some((m) => m.role === 'user')
  useEffect(() => {
    if (!slug || !spoke) return
    const h = `#/conversacion/${encodeURIComponent(slug)}`
    if (location.hash !== h) history.replaceState(null, '', h)
  }, [slug, spoke])

  return (
    <>
      <SessionStatus connected={s.connected} label={s.project?.title ?? t('connecting')} energy={s.energy} />
      <Transcript messages={s.messages} />
      <Artifacts artifacts={s.artifacts} project={s.project} onRun={onRun} />
      <Caption messages={s.messages} compact />
      <InputBar s={s} placeholder={t('chatPlaceholder')} />
      {(s.error || s.micError) && <div className="toast">{s.error || s.micError}</div>}
    </>
  )
}
