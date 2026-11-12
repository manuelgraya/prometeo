/** Páginas de lista: proyectos guardados, catálogo de voces y preguntas frecuentes. */
import { useEffect, useState } from 'react'
import { api, playFaq, playSample, type AppState, type Faq, type VoiceInfo } from '../api'
import { usePlayback, useToast } from '../hooks'
import { locale, t } from '../i18n'
import { unlockAudio, type ProjectMeta } from '../session'
import { Toast } from '../ui/controls'
import { pageReactor, type SetReactor } from './common'

/* ---------------- 05 · Proyectos ---------------- */
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  )
}

export function Proyectos({ setReactor, onOpen, onAgents, onBack }: {
  setReactor: SetReactor; onOpen: (slug: string) => void; onAgents: (slug: string) => void; onBack: () => void
}) {
  const [list, setList] = useState<ProjectMeta[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [toast, flash] = useToast(4000)
  useEffect(() => { setReactor(pageReactor()) }, [setReactor])
  useEffect(() => { api.projects().then(setList).catch(() => setList([])) }, [])

  const remove = async (slug: string) => {
    try {
      await api.deleteProject(slug)
      setList((l) => l?.filter((p) => p.slug !== slug) ?? null)
    } catch {
      flash(t('del.error'), true)
    }
    setConfirming(null)
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('projects')}</h2>
        <button className="btn secondary small" onClick={onBack}>{t('back')}</button>
      </div>
      <div className="list">
        {list === null && <p className="empty">{t('loading')}</p>}
        {list?.length === 0 && <p className="empty">{t('noProjects')}</p>}
        {list?.map((p) => (
          <div key={p.slug} className="card-wrap">
            <button className="card" onClick={async () => { await unlockAudio(); onOpen(p.slug) }}>
              <div className="title">{p.title}</div>
              <div className="meta">{t('updated', { date: new Date(p.updated).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) })}</div>
              {p.artifacts?.map((a) => <span key={a} className="chip">{a}</span>)}
            </button>
            {/* El gestor de agentes de cada proyecto se abre desde aquí */}
            <button className="btn secondary small agentsbtn" disabled={!p.agents}
              title={p.agents ? t('proj.agentsHint') : t('proj.noAgents')} onClick={() => onAgents(p.slug)}>
              {t('proj.agents')}{p.agents ? ` · ${p.agents}` : ''}
            </button>
            {confirming === p.slug ? (
              <div className="confirm" role="alertdialog" aria-label={t('del.ask')}>
                <span>{t('del.confirm', { title: p.title })}</span>
                <button className="btn small danger" onClick={() => remove(p.slug)} autoFocus>{t('del.yes')}</button>
                <button className="btn secondary small" onClick={() => setConfirming(null)}>{t('del.no')}</button>
              </div>
            ) : (
              <button className="iconbtn del" title={t('del.ask')} aria-label={t('del.ask')} onClick={() => setConfirming(p.slug)}>
                <TrashIcon />
              </button>
            )}
          </div>
        ))}
      </div>
      <Toast toast={toast} />
    </div>
  )
}

/* ---------------- 06 · Voces ---------------- */
export function Voces({ setReactor, onFirstChoice }: { setReactor: SetReactor; onFirstChoice: () => void }) {
  const [state, setState] = useState<AppState | null>(null)
  const [speed, setSpeed] = useState(1)
  const { playing, pending, toggle, stop } = usePlayback()
  const [toast, flash] = useToast()

  useEffect(() => {
    api.state().then((s) => { setState(s); setSpeed(s.voice.speed) }).catch(() => flash(t('sampleError'), false, 0))
  }, [flash])
  useEffect(() => { setReactor(pageReactor(Boolean(playing))) }, [playing, setReactor])

  const play = async (id: string) => {
    if (!(await toggle(id, (onEnd) => playSample(id, speed, onEnd)))) flash(t('sampleError'))
  }

  const choose = async (id: string) => {
    if (!state) return
    const first = !state.voice.configured
    try {
      const voice = await api.saveVoice({ voice: id, speed, configured: true })
      setState({ ...state, voice })
      flash(t('set.saved'))
      if (first) setTimeout(onFirstChoice, 700)
    } catch {
      flash(t('set.error'))
    }
  }

  const entries = state ? Object.entries(state.voices) : []
  const groups: [string, [string, VoiceInfo][]][] = [
    [t('native'), entries.filter(([, v]) => !v.accent)],
    [t('accented'), entries.filter(([, v]) => v.accent)],
  ]

  return (
    <div className="page">
      <div className="page-head">
        <h2>{t('voicesTitle')}</h2>
        <label className="speed">
          <span>{t('speed')} · {speed.toFixed(2)}×</span>
          <input type="range" min={0.8} max={1.3} step={0.05} value={speed}
            onChange={(e) => { setSpeed(Number(e.target.value)); if (playing) stop() }} />
        </label>
      </div>
      <p className="intro">{t('voicesIntro')}</p>
      <div className="list">
        {!state && <p className="empty">{t('loading')}</p>}
        {state && groups.map(([title, items]) => (
          <section key={title}>
            <h3 className="group">{title}</h3>
            <div className="vgrid">
              {items.map(([id, v]) => {
                const current = state.voice.voice === id
                const isPlaying = playing === id
                return (
                  <div key={id} className={`vcard ${current ? 'current' : ''} ${isPlaying ? 'playing' : ''}`}>
                    <div className="vhead">
                      <span className="title">{v.name}</span>
                      {current && <span className="chip">{t('current')}</span>}
                    </div>
                    <div className="meta">
                      {v.gender === 'f' ? t('female') : t('male')} · {v.desc.replace(/^(Masculina|Femenina), /, '')}
                      {v.accent && <> · {t('accent', { accent: v.accent })}</>}
                    </div>
                    <div className="vactions">
                      <button className="btn secondary small" onClick={() => play(id)} disabled={pending === id} aria-pressed={isPlaying}>
                        {pending === id ? '…' : isPlaying ? `■ ${t('stop')}` : `▶ ${t('play')}`}
                      </button>
                      <button className="btn small" onClick={() => choose(id)}
                        disabled={current && Math.abs(state.voice.speed - speed) < 0.001 && state.voice.configured}>
                        {t('use')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <Toast toast={toast} />
    </div>
  )
}

/* ---------------- 08 · Preguntas frecuentes ---------------- */
export function Faqs({ setReactor }: { setReactor: SetReactor }) {
  const [list, setList] = useState<Faq[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const { playing, pending, toggle } = usePlayback()
  const [toast, flash] = useToast()

  useEffect(() => {
    api.faqs().then(setList).catch(() => { setList([]); flash(t('faqError'), true, 0) })
  }, [flash])
  useEffect(() => { setReactor(pageReactor(Boolean(playing))) }, [playing, setReactor])

  const ask = async (id: string) => {
    setOpen(id)
    if (!(await toggle(id, (onEnd) => playFaq(id, onEnd)))) flash(t('faqError'), true)
  }

  return (
    <div className="page">
      <div className="page-head"><h2>{t('faqTitle')}</h2></div>
      <p className="intro">{t('faqIntro')}</p>
      <div className="list faqs">
        {list === null && <p className="empty">{t('loading')}</p>}
        {list?.length === 0 && <p className="empty">{t('faqEmpty')}</p>}
        {list?.map((f) => {
          const isOpen = open === f.id
          const isPlaying = playing === f.id
          return (
            <div key={f.id} className={`faq ${isOpen ? 'open' : ''} ${isPlaying ? 'playing' : ''}`}>
              <button className="faq-q" onClick={() => ask(f.id)} aria-expanded={isOpen} aria-pressed={isPlaying} disabled={pending === f.id}>
                <span className="title">{f.question}</span>
                {f.recorded && <span className="chip">{t('faqRecorded')}</span>}
                <span className="faq-act">{pending === f.id ? '…' : isPlaying ? `■ ${t('stop')}` : `▶ ${t('faqAsk')}`}</span>
              </button>
              {isOpen && <p className="faq-a" aria-live="polite"><span className="who">PROMETEO</span>{f.answer}</p>}
            </div>
          )
        })}
      </div>
      <Toast toast={toast} />
    </div>
  )
}
