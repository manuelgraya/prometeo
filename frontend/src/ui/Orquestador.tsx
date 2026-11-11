import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { AgentInfo, AgentPhase, LogEntry, PhaseAction } from '../agents'
import { locale, t } from '../i18n'

const key = (a: { slug: string; version: string }) => `${a.slug}/${a.version}`
const MAX_NODES = 10

/**
 * Prometeo en el centro, sus agentes en órbita y un haz hacia cada uno. El haz fluye según el estado:
 * rápido escribiendo código, constante pensando, quieto esperando respuesta y apagado si está parado.
 */
export function Constelacion({ agents, selected, onSelect }: {
  agents: AgentInfo[]; selected: AgentInfo | null; onSelect: (a: AgentInfo) => void
}) {
  // Primero los vivos; los cerrados al final, y como mucho MAX_NODES en la órbita.
  const shown = [...agents]
    .sort((a, b) => Number(b.alive) - Number(a.alive) || Number(a.phase === 'cerrado') - Number(b.phase === 'cerrado'))
    .slice(0, MAX_NODES)
  const cx = 150, cy = 112, rx = 118, ry = 82
  const nodes = shown.map((a, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(shown.length, 1)
    return { a, x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) }
  })
  const active = agents.filter((a) => a.alive && a.state !== 'esperando').length
  const waiting = agents.filter((a) => a.alive && a.state === 'esperando').length

  return (
    <div className="orq">
      <svg viewBox="0 0 300 224" role="img" aria-label={t('ag.orchestrator')}>
        <defs>
          <radialGradient id="orq-core">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.35" style={{ stopColor: 'var(--cyan)' }} />
            <stop offset="1" style={{ stopColor: 'var(--blue)' }} stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse className="orbit" cx={cx} cy={cy} rx={rx} ry={ry} />
        {nodes.map(({ a, x, y }) => (
          <line key={`b-${key(a)}`} className={`beam ${a.alive ? a.state : 'parado'}`} x1={cx} y1={cy} x2={x} y2={y} />
        ))}
        <g className="core">
          <circle cx={cx} cy={cy} r="34" fill="url(#orq-core)" className="halo" />
          <circle cx={cx} cy={cy} r="24" className="ring" />
          <circle cx={cx} cy={cy} r="11" fill="url(#orq-core)" />
        </g>
        {nodes.map(({ a, x, y }) => (
          <g key={`n-${key(a)}`} className={`node ${a.alive ? a.state : 'parado'} ${selected && key(selected) === key(a) ? 'sel' : ''} ${a.phase}`}
            transform={`translate(${x} ${y})`} onClick={() => onSelect(a)} role="button" tabIndex={0}
            aria-label={`${t('ag.agent', { n: String(a.n) })} · ${a.title}`}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(a) } }}>
            <circle r="15" className="bg" />
            <circle r="15" className="rim" />
            <text dy="4">{a.phase === 'cerrado' ? '✓' : a.n}</text>
          </g>
        ))}
      </svg>
      <div className="orq-label">
        <span className="name">PROMETEO</span>
        <span>{t('ag.orchestrator')} · {t('ag.summary', { active: String(active), waiting: String(waiting) })}</span>
      </div>
    </div>
  )
}

export function Registro({ log, onSelect }: { log: LogEntry[]; onSelect: (e: LogEntry) => void }) {
  const items = log.slice(-30).reverse()
  return (
    <div className="orqlog">
      <header>{t('ag.log')}</header>
      <div className="body" aria-live="polite">
        {items.length === 0 && <p className="hint">{t('ag.logEmpty')}</p>}
        {items.map((e, i) => (
          <button key={`${e.at}-${i}`} className={`entry ${e.kind}`} onClick={() => onSelect(e)}>
            <time>{new Date(e.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}</time>
            <span>{e.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const STEPS: AgentPhase[] = ['trabajando', 'validando', 'revision', 'documentando', 'cerrado']

/** Ciclo de la tarea: Trabajando → Validación → Revisión (correcciones) → Documentación → Cerrado. */
export function Ciclo({ a, busy, onAction }: { a: AgentInfo; busy: boolean; onAction: (act: PhaseAction) => void }) {
  const idx = STEPS.indexOf(a.phase)
  const v = a.validation
  return (
    <div className={`ciclo ${a.phase}`}>
      <div className="steps-row">
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i < idx ? 'done' : i === idx ? 'now' : ''}>{t(`ag.phase.${s}`)}</li>
          ))}
        </ol>
        <div className="acts">
          {a.phase === 'trabajando' && (
            <button className="btn small" disabled={busy} onClick={() => onAction('terminar')}>{t('ag.act.terminar')}</button>
          )}
          {a.phase === 'revision' && (
            <>
              <button className="btn secondary small" disabled={busy || !a.alive} title={a.alive ? undefined : t('ag.stopped')}
                onClick={() => onAction('corregir')}>{t('ag.act.corregir')}</button>
              <button className="btn small" disabled={busy || !a.alive} title={a.alive ? undefined : t('ag.stopped')}
                onClick={() => onAction('aprobar')}>{t('ag.act.aprobar')}</button>
            </>
          )}
          {a.phase === 'documentando' && (
            <button className="btn small" disabled={busy || !a.note} title={a.note ? undefined : t('ag.needNote')}
              onClick={() => onAction('cerrar')}>{t('ag.act.cerrar')}</button>
          )}
          {a.phase === 'cerrado' && (
            <button className="btn secondary small" disabled={busy} onClick={() => onAction('reabrir')}>{t('ag.act.reabrir')}</button>
          )}
        </div>
      </div>
      {a.phase === 'validando' && <p className="phase-note working">{t('ag.validating')}</p>}
      {a.phase === 'revision' && v && (
        <div className={`validacion ${v.verdict}`}>
          <div className="verdict">PROMETEO · {t(`ag.verdict.${v.verdict}`)}</div>
          <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{v.text.replace(/^VEREDICTO:.*\n?/i, '')}</ReactMarkdown></div>
          <p className="phase-note">{t('ag.correctHint')}</p>
        </div>
      )}
      {a.phase === 'documentando' && (
        <p className={`phase-note ${a.note ? 'ok' : 'working'}`}>{a.note ? t('ag.noteReady', { note: a.note }) : t('ag.waitNote')}</p>
      )}
      {a.phase === 'cerrado' && a.note && <p className="phase-note ok">{t('ag.closed', { note: a.note })}</p>}
    </div>
  )
}
