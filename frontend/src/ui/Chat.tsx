/** Piezas de una sesión con Prometeo (definir voz y conversación): estado, subtítulo, transcripción y entrada. */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Energy } from '../scene/Scene'
import { t } from '../i18n'
import type { Msg, Session } from '../session'
import { MicIcon, MicOffIcon, SendIcon, StopIcon } from './icons'

/** «● Título · Escuchando». El punto se apaga si se pierde la conexión. */
export function SessionStatus({ connected, label, energy }: { connected: boolean; label: string; energy: Energy }) {
  return (
    <div className="status">
      <span className={`dot ${connected ? '' : 'off'}`} />
      {label} · {t(`energy.${energy}`)}
    </div>
  )
}

/** Lo último que ha dicho Prometeo bajo el reactor, y lo que has dicho tú después. */
export function Caption({ messages, compact }: { messages: Msg[]; compact?: boolean }) {
  const lastIdx = messages.findLastIndex((m) => m.role === 'agent')
  const lastAgent = lastIdx >= 0 ? messages[lastIdx] : undefined
  const userAfter = messages.slice(lastIdx + 1).find((m) => m.role === 'user')
  const text = lastAgent?.text ?? ''
  const shown = compact && text.length > 260 ? '…' + text.slice(-260) : text
  return (
    <div className="caption passthrough" style={compact ? { width: 'min(460px, calc(100vw - 32px))', fontSize: 17, top: 'calc(50% + 150px)' } : undefined}>
      {shown}
      {lastAgent?.tools.length ? <span className="you" style={{ marginTop: 8 }}>{lastAgent.tools[lastAgent.tools.length - 1]}</span> : null}
      {userAfter && <span className="you" data-you={t('you')}>{userAfter.text}</span>}
    </div>
  )
}

/**
 * Caja de texto: switch AUTO | TURNOS a la izquierda, enviar a la derecha. Encima flota el micrófono, que
 * se ilumina en neón (color del tema) mientras detecta voz; a sus lados, silenciar / TERMINAR y `action`
 * (en la conversación, el botón que lleva el prompt a la Forja).
 */
export function InputBar({ s, placeholder, action }: { s: Session; placeholder: string; action?: ReactNode }) {
  const [text, setText] = useState('')
  const manual = s.turnMode === 'manual'
  const { finishTurn, micOn } = s

  // Espacio = TERMINAR en modo por turnos (salvo escribiendo en un campo de texto).
  useEffect(() => {
    if (!manual || !micOn) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      void finishTurn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [manual, micOn, finishTurn])

  const hint = manual && micOn ? (s.capturing ? t('turn.capturing') : t('turn.waiting')) : null

  return (
    <div className="composer">
      <div className="micdock">
        <div className="side left">
          {s.playing && (
            <button type="button" className="iconbtn" title={t('silence')} aria-label={t('silence')} onClick={s.interrupt}><StopIcon /></button>
          )}
          {manual && micOn && (
            <button type="button" className={`btn small finish ${s.capturing ? 'live' : ''}`} disabled={!s.capturing}
              title={t('turn.finishHint')} onClick={() => void finishTurn()}>
              {t('turn.finish')}
            </button>
          )}
        </div>
        <div className="miccol">
          {hint && <div className={`turnhint ${s.capturing ? 'live' : ''}`} aria-live="polite">{hint}</div>}
          <button type="button" className={`micbtn ${micOn ? 'on' : 'off'} ${s.speaking ? 'speaking' : ''}`}
            aria-pressed={micOn} title={micOn ? t('micOff') : t('micOn')} aria-label={micOn ? t('micOff') : t('micOn')}
            onClick={() => (micOn ? s.disableMic() : s.enableMic())}>
            {micOn ? <MicIcon size={24} /> : <MicOffIcon size={24} />}
          </button>
        </div>
        <div className="side right">{action}</div>
      </div>
      <form className="inputbar" onSubmit={(e) => { e.preventDefault(); s.sendText(text); setText('') }}>
        <div className="seg turnswitch" role="radiogroup" aria-label={t('turn.label')}>
          <button type="button" role="radio" aria-checked={!manual} className={manual ? '' : 'active'}
            title={t('turn.autoHint')} onClick={() => manual && s.setTurnMode('auto')}>{t('turn.auto')}</button>
          <button type="button" role="radio" aria-checked={manual} className={manual ? 'active' : ''}
            title={t('turn.manualHint')} onClick={() => !manual && s.setTurnMode('manual')}>{t('turn.manual')}</button>
        </div>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={t('message')} />
        <button type="submit" className="iconbtn send" disabled={!text.trim() || !s.connected} title={t('send')} aria-label={t('send')}>
          <SendIcon />
        </button>
      </form>
    </div>
  )
}

export function Transcript({ messages }: { messages: Msg[] }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  return (
    <aside className="panel left">
      <header>{t('transcript')}</header>
      <div className="body">
        {messages.length === 0 && <p className="empty">{t('transcriptEmpty')}</p>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <span className="who">{m.role === 'user' ? t('you') : 'PROMETEO'}</span>
            {m.text}
            {m.tools.map((tool, j) => <span key={j} className="tool">{tool}</span>)}
          </div>
        ))}
        <div ref={end} />
      </div>
    </aside>
  )
}
