/** Las dos vistas que hablan con Prometeo por WebSocket: definir la voz y la conversación de un proyecto. */
import { useEffect, useState } from 'react'
import { api } from '../api'
import { t } from '../i18n'
import type { AgentRef } from '../routes'
import { useSession } from '../session'
import { RunButton } from '../ui/AgentControls'
import Artifacts, { hasPrompt, usePromptView } from '../ui/Artifacts'
import { ForgeIcon } from '../ui/icons'
import { Caption, InputBar, SessionStatus, Transcript } from '../ui/Chat'
import type { SetReactor } from './common'
import { useAgents } from '../agents'

/** «● 2 agentes trabajando · FORJA»: los agentes siguen en marcha mientras hablas con Prometeo; vuelve a ellos. */
function ForgeChip({ slug, onOpen }: { slug: string; onOpen: (slug: string) => void }) {
  const { agents } = useAgents()
  const mine = (agents ?? []).filter((a) => a.slug === slug && a.phase !== 'cerrado')
  if (mine.length === 0) return null
  const working = mine.filter((a) => a.alive).length
  return (
    <button className={`forgechip ${working ? 'live' : ''}`} onClick={() => onOpen(slug)} title={t('ag.backToForgeHint')}>
      <span className="dot" aria-hidden="true" />
      {working ? t('ag.workingN', { n: String(working) }) : t('ag.pendingN', { n: String(mine.length) })}
      <span className="go">{t('ag.backToForge')}</span>
    </button>
  )
}

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
export function Conversacion({ project, title, setReactor, onRun, onForge, onProject }: {
  project: string | null; title?: string; setReactor: SetReactor; onRun: (a: AgentRef) => void
  onForge: (slug: string) => void; onProject: (slug: string) => void
}) {
  const s = useSession({ mode: 'plan', project, title, enabled: true })
  const { enableMic } = s
  useEffect(() => { void enableMic() }, [enableMic])
  useEffect(() => { setReactor({ variant: 'escuchando', energy: s.energy, offsetY: 70, scale: 0.8 }) }, [s.energy, setReactor])

  // En cuanto la persona dice algo, el proyecto existe de verdad: lo reflejamos en la URL
  // (sin recargar) para que atrás/adelante vuelvan a él.
  const slug = s.project?.slug
  // Prompt que se ve en Entregables y que se lleva a la Forja (el vigente salvo que se elija otro)
  const pv = usePromptView(slug, s.artifacts)
  // El título cambiado en Editar proyecto se ve al momento (la sesión lo leerá de meta.json al volver)
  const [renamed, setRenamed] = useState<{ slug: string; title: string } | null>(null)
  const shown = s.project && renamed?.slug === s.project.slug ? { ...s.project, title: renamed.title } : s.project
  const spoke = s.messages.some((m) => m.role === 'user')
  useEffect(() => {
    if (!slug || !spoke) return
    const h = `#/conversacion/${encodeURIComponent(slug)}`
    if (location.hash !== h) history.replaceState(null, '', h)
  }, [slug, spoke])

  return (
    <>
      <SessionStatus connected={s.connected} label={shown?.title ?? t('connecting')} energy={s.energy} />
      {s.project && <ForgeChip slug={s.project.slug} onOpen={onForge} />}
      <Transcript messages={s.messages} />
      <Artifacts artifacts={pv.artifacts} project={shown} onProject={onProject} prompts={pv}
        onRenamed={(t) => slug && setRenamed({ slug, title: t })} onDeleted={() => { location.hash = '#/proyectos' }} />
      <Caption messages={s.messages} compact />
      <InputBar s={s} placeholder={t('chatPlaceholder')} action={s.project && hasPrompt(pv.artifacts) && (
        <RunButton slug={s.project.slug} version={pv.chosen} onLaunched={onRun} label={t('ag.toForge')} icon={<ForgeIcon />} />
      )} />
      {(s.error || s.micError) && <div className="toast">{s.error || s.micError}</div>}
    </>
  )
}
