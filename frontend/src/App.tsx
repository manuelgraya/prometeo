import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import Scene, { type Energy, type ReactorProps } from './scene/Scene'
import CometCursor from './ui/CometCursor'
import CosmicButton from './ui/CosmicButton'
import Intro from './ui/Intro'
import { installCosmicInteractions } from './ui/cosmic'
import { locale, t, useLang, type Lang } from './i18n'
import { THEMES, useTheme } from './theme'
import { unlockAudio, useSession, type Artifact, type Msg, type ProjectMeta } from './session'
import { api, playFaq, playSample, stopSample, type AppState, type Faq, type LocalModels, type Settings, type VoiceInfo } from './api'

type View =
  | { name: 'loading' }
  | { name: 'comenzar' }
  | { name: 'voz' }
  | { name: 'inicio' }
  | { name: 'proyectos' }
  | { name: 'voces' }
  | { name: 'ajustes' }
  | { name: 'faq' }
  | { name: 'conversacion'; project: string | null; key: number }

const SIMPLE = ['comenzar', 'voz', 'inicio', 'proyectos', 'voces', 'ajustes', 'faq'] as const

/** Rutas: #/inicio, #/proyectos, #/voces, #/ajustes, #/faq, #/voz, #/comenzar, #/conversacion[/slug] */
function parseHash(): View | null {
  const raw = location.hash.replace(/^#\/?/, '')
  // Compatibilidad con el atajo antiguo: #view=conversacion&project=slug
  if (raw.startsWith('view=')) {
    const q = new URLSearchParams(raw)
    const name = q.get('view')
    if (name === 'conversacion') return { name, project: q.get('project'), key: Date.now() }
    return (SIMPLE as readonly string[]).includes(name ?? '') ? ({ name } as View) : null
  }
  const [name, arg] = raw.split('/')
  if (name === 'conversacion') return { name, project: arg ? decodeURIComponent(arg) : null, key: Date.now() }
  return (SIMPLE as readonly string[]).includes(name) ? ({ name } as View) : null
}

function hashOf(v: View): string {
  if (v.name === 'loading') return ''
  if (v.name === 'conversacion') return `#/conversacion${v.project ? '/' + encodeURIComponent(v.project) : ''}`
  return `#/${v.name}`
}

const energyLabel = (e: Energy) => t(`energy.${e}`)

export default function App() {
  const [view, setView] = useState<View>({ name: 'loading' })
  const [lang, setLang] = useLang()
  const [reactor, setReactor] = useState<ReactorProps>({ variant: 'despertar', energy: 'idle', offsetY: 60 })
  // La interfaz (y el cursor cometa) aparecen al final de la animación de inicio.
  const [revealed, setRevealed] = useState(false)
  const reveal = useCallback(() => setRevealed(true), [])
  useEffect(() => { document.documentElement.classList.toggle('intro-dark', !revealed) }, [revealed])

  const go = useCallback((v: View) => {
    setView(v)
    const h = hashOf(v)
    if (h && location.hash !== h) history.pushState(null, '', h)
  }, [])

  useEffect(() => {
    const forced = parseHash()
    if (forced) { setView(forced); return }
    api.state()
      .then((s) => {
        const v: View = s.voice?.configured ? { name: 'inicio' } : { name: 'comenzar' }
        setView(v)
        history.replaceState(null, '', hashOf(v))
      })
      .catch(() => setView({ name: 'comenzar' }))
  }, [])

  // Botones atrás / adelante del navegador
  useEffect(() => {
    const onPop = () => setView(parseHash() ?? { name: 'inicio' })
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => installCosmicInteractions(), [])

  const goHome = useCallback(() => go({ name: 'inicio' }), [go])
  const startConversation = (project: string | null) => go({ name: 'conversacion', project, key: Date.now() })

  return (
    <>
      <Scene {...reactor} />
      <CometCursor />
      <Intro onReveal={reveal} />
      <div className={revealed ? 'layer' : 'layer intro-hidden'} inert={!revealed}>
        <div className="topleft">
          <button className="wordmark" onClick={goHome} title={t('home')}>PROMETEO</button>
          {view.name !== 'loading' && <Nav current={view.name} go={go} />}
        </div>
        <LangSwitch lang={lang} setLang={setLang} />
        <ViewBoundary key={view.name} onHome={goHome}>
        {view.name === 'comenzar' && (
          <Comenzar setReactor={setReactor} onStart={() => go({ name: 'voz' })} onChoose={() => go({ name: 'voces' })} />
        )}
        {view.name === 'voz' && <DefinirVoz setReactor={setReactor} onDone={goHome} onVoices={() => go({ name: 'voces' })} />}
        {view.name === 'inicio' && (
          <Inicio setReactor={setReactor} onStart={() => startConversation(null)} onOpen={() => go({ name: 'proyectos' })} />
        )}
        {view.name === 'proyectos' && (
          <Proyectos setReactor={setReactor} onOpen={(slug) => startConversation(slug)} onBack={goHome} />
        )}
        {view.name === 'voces' && <Voces setReactor={setReactor} onFirstChoice={goHome} />}
        {view.name === 'ajustes' && (
          <Ajustes
            setReactor={setReactor}
            lang={lang}
            setLang={setLang}
            onVoices={() => go({ name: 'voces' })}
            onTalk={async () => { await unlockAudio(); go({ name: 'voz' }) }}
            onReset={() => go({ name: 'comenzar' })}
          />
        )}
        {view.name === 'faq' && <Faqs setReactor={setReactor} />}
        {view.name === 'conversacion' && <Conversacion key={view.key} project={view.project} setReactor={setReactor} />}
        </ViewBoundary>
      </div>
    </>
  )
}

type SetReactor = (p: ReactorProps) => void

/** Si una vista falla al renderizar, se muestra un aviso en su lugar en vez de desmontar toda la app (pantalla en negro). */
class ViewBoundary extends Component<{ children: ReactNode; onHome: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: unknown) { console.error('[PROMETEO] Error en la vista:', err) }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page">
        <p className="empty">{t('viewError')}</p>
        <button className="btn secondary small" onClick={this.props.onHome}>{t('back')}</button>
      </div>
    )
  }
}

/* ---------------- Navegación ---------------- */
const NAV = [
  { name: 'inicio', label: 'nav.home' },
  { name: 'proyectos', label: 'nav.projects' },
  { name: 'voces', label: 'nav.voices' },
  { name: 'ajustes', label: 'nav.settings' },
  { name: 'faq', label: 'nav.faq' },
] as const

function Nav({ current, go }: { current: View['name']; go: (v: View) => void }) {
  return (
    <nav className="nav" aria-label={t('navLabel')}>
      {NAV.map((n) => (
        <button
          key={n.name}
          className={current === n.name ? 'active' : ''}
          aria-current={current === n.name ? 'page' : undefined}
          onClick={() => { void unlockAudio(); go({ name: n.name }) }}
        >
          {t(n.label)}
        </button>
      ))}
    </nav>
  )
}

/** ES | EN siempre visible (solo la interfaz; la voz sigue en español). Comparte estado con Ajustes vía App. */
function LangSwitch({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div className="seg langswitch" role="radiogroup" aria-label={t('langLabel')} title={t('langHint')}>
      {(['es', 'en'] as const).map((l) => (
        <button key={l} role="radio" aria-checked={lang === l} className={lang === l ? 'active' : ''}
          onClick={() => lang !== l && setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/* ---------------- 01 · Primera vez ---------------- */
function Comenzar({ setReactor, onStart, onChoose }: { setReactor: SetReactor; onStart: () => void; onChoose: () => void }) {
  useEffect(() => { setReactor({ variant: 'despertar', energy: 'idle', offsetY: 60 }) }, [setReactor])
  return (
    <>
      <div className="status">{t('firstSetup')}</div>
      <div className="actions">
        <CosmicButton primary onClick={async () => { await unlockAudio(); onStart() }}>{t('begin')}</CosmicButton>
        <CosmicButton onClick={async () => { await unlockAudio(); onChoose() }}>{t('chooseVoice')}</CosmicButton>
      </div>
    </>
  )
}

/* ---------------- 02 · Definir voz ---------------- */
function DefinirVoz({ setReactor, onDone, onVoices }: { setReactor: SetReactor; onDone: () => void; onVoices: () => void }) {
  const s = useSession({ mode: 'voz', enabled: true })
  const { enableMic } = s
  useEffect(() => { void enableMic() }, [enableMic])
  useEffect(() => { setReactor({ variant: 'escuchando', energy: s.energy, offsetY: 40 }) }, [s.energy, setReactor])
  useEffect(() => {
    if (s.voiceDone && !s.playing) {
      const t = setTimeout(onDone, 900)
      return () => clearTimeout(t)
    }
  }, [s.voiceDone, s.playing, onDone])

  const skip = async () => {
    await api.saveVoice({ configured: true }).catch(() => {})
    onDone()
  }

  return (
    <>
      <div className="status"><span className={`dot ${s.connected ? '' : 'off'}`} />{t('definingVoice')} · {energyLabel(s.energy)}</div>
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

/* ---------------- 03 · Inicio ---------------- */
function Inicio({ setReactor, onStart, onOpen }: { setReactor: SetReactor; onStart: () => void; onOpen: () => void }) {
  useEffect(() => { setReactor({ variant: 'reposo', energy: 'idle', offsetY: 80 }) }, [setReactor])
  return (
    <div className="actions">
      <CosmicButton primary onClick={async () => { await unlockAudio(); onStart() }}>{t('start')}</CosmicButton>
      <CosmicButton onClick={onOpen}>{t('openProject')}</CosmicButton>
    </div>
  )
}

/* ---------------- 05 · Proyectos ---------------- */
function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  )
}

function Proyectos({ setReactor, onOpen, onBack }: { setReactor: SetReactor; onOpen: (slug: string) => void; onBack: () => void }) {
  const [list, setList] = useState<ProjectMeta[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setReactor({ variant: 'reposo', energy: 'idle', offsetY: -230, scale: 0.9 }) }, [setReactor])
  useEffect(() => { fetch('/api/projects').then((r) => r.json()).then(setList).catch(() => setList([])) }, [])

  const remove = async (slug: string) => {
    try {
      await api.deleteProject(slug)
      setList((l) => l?.filter((p) => p.slug !== slug) ?? null)
    } catch {
      setError(t('del.error'))
      setTimeout(() => setError(null), 4000)
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
      {error && <div className="toast">{error}</div>}
    </div>
  )
}

/* ---------------- 06 · Voces ---------------- */
function Voces({ setReactor, onFirstChoice }: { setReactor: SetReactor; onFirstChoice: () => void }) {
  const [state, setState] = useState<AppState | null>(null)
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    api.state().then((s) => { setState(s); setSpeed(s.voice.speed) }).catch(() => setToast(t('sampleError')))
    return () => { void stopSample() }
  }, [])
  useEffect(() => {
    setReactor({ variant: playing ? 'escuchando' : 'reposo', energy: playing ? 'speaking' : 'idle', offsetY: -230, scale: 0.9 })
  }, [playing, setReactor])

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const toggle = async (id: string) => {
    if (playing === id) { setPlaying(null); await stopSample(); return }
    setPending(id)
    try {
      await playSample(id, speed, () => setPlaying((p) => (p === id ? null : p)))
      setPlaying(id)
    } catch {
      flash(t('sampleError'))
    } finally {
      setPending((p) => (p === id ? null : p))
    }
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
            onChange={(e) => { setSpeed(Number(e.target.value)); if (playing) { setPlaying(null); void stopSample() } }} />
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
                      <button className="btn secondary small" onClick={() => toggle(id)} disabled={pending === id} aria-pressed={isPlaying}>
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
      {toast && <div className="toast info">{toast}</div>}
    </div>
  )
}

/* ---------------- 08 · Preguntas frecuentes ---------------- */
function Faqs({ setReactor }: { setReactor: SetReactor }) {
  const [list, setList] = useState<Faq[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    api.faqs().then(setList).catch(() => { setList([]); setToast(t('faqError')) })
    return () => { void stopSample() }
  }, [])
  useEffect(() => {
    setReactor({ variant: playing ? 'escuchando' : 'reposo', energy: playing ? 'speaking' : 'idle', offsetY: -230, scale: 0.9 })
  }, [playing, setReactor])

  const ask = async (id: string) => {
    setOpen(id)
    if (playing === id) { setPlaying(null); await stopSample(); return }
    setPending(id)
    try {
      await playFaq(id, () => setPlaying((p) => (p === id ? null : p)))
      setPlaying(id)
    } catch {
      setPlaying(null)
      setToast(t('faqError'))
      setTimeout(() => setToast(null), 3000)
    } finally {
      setPending((p) => (p === id ? null : p))
    }
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
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

/* ---------------- 07 · Ajustes ---------------- */
function Segmented<T extends string>({ value, options, onChange, label, labels, isDisabled }: {
  value: T; options: readonly T[]; onChange: (v: T) => void; label: string
  labels?: Partial<Record<T, string>>; isDisabled?: (v: T) => boolean
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {(options ?? []).map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className={value === o ? 'active' : ''}
          disabled={isDisabled?.(o)} onClick={() => value !== o && onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="row-ctl">{children}</div>
    </div>
  )
}

const DEVICE_LABELS = { cpu: 'CPU', cuda: 'GPU' } as const

const LOCAL = 'local:'

/** Modelo de Claude (botones) o local de LM Studio (botón LOCAL + desplegable). */
function ModelPicker({ label, value, claude, local, onChange }: {
  label: string; value: string; claude: string[]; local: LocalModels | null; onChange: (v: string) => void
}) {
  const isLocal = value.startsWith(LOCAL)
  const id = isLocal ? value.slice(LOCAL.length) : ''
  const models = local?.models ?? []
  const pick = (o: string) => {
    if (o !== 'local') return onChange(o)
    const first = models.find((m) => m.loaded) ?? models[0]
    if (first) onChange(LOCAL + first.id)
  }
  return (
    <div className="model-pick">
      <Segmented label={label} value={isLocal ? 'local' : value} options={[...claude, 'local']} labels={{ local: t('set.localBtn') }}
        isDisabled={(o) => o === 'local' && !isLocal && !models.length} onChange={pick} />
      {isLocal && (
        <select className="select" value={id} aria-label={`${label} · ${t('set.localBtn')}`}
          onChange={(e) => onChange(LOCAL + e.target.value)}>
          {!models.some((m) => m.id === id) && <option value={id}>{id} · {t('set.localMissing')}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}{m.params ? ` · ${m.params}` : ''}{m.loaded ? ` · ${t('set.localLoaded')}` : ''}</option>
          ))}
        </select>
      )}
    </div>
  )
}

function Ajustes({ setReactor, lang, setLang, onVoices, onTalk, onReset }: {
  setReactor: SetReactor; lang: Lang; setLang: (l: Lang) => void
  onVoices: () => void; onTalk: () => void; onReset: () => void
}) {
  const [state, setState] = useState<AppState | null>(null)
  const [theme, setTheme] = useTheme()
  const [speed, setSpeed] = useState(1)
  const [testing, setTesting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
  const speedTimer = useRef<number | undefined>(undefined)
  const [local, setLocal] = useState<LocalModels | null>(null)
  const [url, setUrl] = useState('')
  const [checking, setChecking] = useState(false)

  const checkLocal = useCallback(async () => {
    setChecking(true)
    try {
      const r = await api.localModels()
      setLocal(r)
      setUrl(r.url)
    } catch {
      setLocal(null)
    } finally {
      setChecking(false)
    }
  }, [])
  useEffect(() => { void checkLocal() }, [checkLocal])

  const refresh = useCallback(() => api.state().then((s) => { setState(s); return s }), [])
  useEffect(() => { refresh().then((s) => setSpeed(s.voice.speed)).catch(() => setToast({ msg: t('set.error'), error: true })) }, [refresh])
  useEffect(() => { setReactor({ variant: testing ? 'escuchando' : 'reposo', energy: testing ? 'speaking' : 'idle', offsetY: -230, scale: 0.9 }) }, [testing, setReactor])
  useEffect(() => () => { void stopSample(); clearTimeout(speedTimer.current) }, [])

  // Mientras se recarga un modelo (cambio CPU/GPU), consultamos el estado hasta que termine.
  const loading = state?.runtime.loading.length ? state.runtime.loading.join() : ''
  useEffect(() => {
    if (!loading) return
    const id = setInterval(() => { void refresh() }, 1200)
    return () => clearInterval(id)
  }, [loading, refresh])

  const flash = (msg: string, error = false) => { setToast({ msg, error }); setTimeout(() => setToast(null), 2500) }

  const update = async (patch: Partial<Settings>) => {
    if (!state) return
    setState({ ...state, settings: { ...state.settings, ...patch } })
    try {
      const r = await api.saveSettings(patch)
      setState((s) => (s ? { ...s, settings: r.settings, runtime: r.runtime } : s))
      flash(t('set.saved'))
    } catch {
      flash(t('set.error'), true)
      void refresh()
    }
  }

  const changeSpeed = (v: number) => {
    setSpeed(v)
    clearTimeout(speedTimer.current)
    speedTimer.current = window.setTimeout(() => {
      api.saveVoice({ speed: v }).then((voice) => setState((s) => (s ? { ...s, voice } : s))).catch(() => flash(t('set.error'), true))
    }, 400)
  }

  const test = async () => {
    if (!state) return
    if (testing) { setTesting(false); await stopSample(); return }
    try {
      setTesting(true)
      await playSample(state.voice.voice, speed, () => setTesting(false))
    } catch {
      setTesting(false)
      flash(t('sampleError'), true)
    }
  }

  const reset = async () => {
    try {
      await api.saveVoice({ configured: false })
      onReset()
    } catch {
      flash(t('set.error'), true)
    }
  }

  if (!state) return <div className="page"><p className="empty">{t('loading')}</p></div>

  const { settings, choices, capabilities: caps, runtime } = state
  const voiceInfo = state.voices[state.voice.voice]
  const deviceStatus = (which: 'tts' | 'stt') => {
    const rt = runtime[which]
    if (runtime.loading.includes(which)) return <span className="status-line">{t('set.loading')}</span>
    if (!rt) return null
    return (
      <>
        <span className="status-line">{t('set.active', { device: DEVICE_LABELS[rt.device as 'cpu' | 'cuda'] ?? rt.device })}</span>
        {rt.error && settings[`${which}_device`] === 'cuda' && <span className="status-line warn">{rt.error}</span>}
      </>
    )
  }

  return (
    <div className="page">
      <div className="page-head"><h2>{t('settingsTitle')}</h2></div>
      <div className="list settings">
        <section>
          <h3 className="group">{t('set.voice')}</h3>
          <Row label={t('set.voiceCurrent')} hint={voiceInfo ? `${voiceInfo.name} · ${voiceInfo.desc}${voiceInfo.accent ? ` · ${t('accent', { accent: voiceInfo.accent })}` : ''}` : state.voice.voice}>
            <button className="btn secondary small" onClick={test}>{testing ? `■ ${t('stop')}` : `▶ ${t('set.test')}`}</button>
          </Row>
          <Row label={`${t('speed')} · ${speed.toFixed(2)}×`}>
            <input className="range" type="range" min={0.8} max={1.3} step={0.05} value={speed}
              onChange={(e) => changeSpeed(Number(e.target.value))} aria-label={t('speed')} />
          </Row>
          <div className="row-buttons">
            <button className="btn secondary small" onClick={onVoices}>{t('set.change')}</button>
            <button className="btn secondary small" onClick={onTalk}>{t('set.talk')}</button>
          </div>
        </section>

        <section>
          <h3 className="group">{t('set.perf')}</h3>
          <Row label={t('set.tts')} hint={<>{!caps.tts_cuda && <>{t('set.noCudaTts')} </>}{deviceStatus('tts')}</>}>
            <Segmented label={t('set.tts')} value={settings.tts_device} options={['cpu', 'cuda'] as const} labels={DEVICE_LABELS}
              isDisabled={(o) => o === 'cuda' && !caps.tts_cuda && settings.tts_device !== 'cuda'}
              onChange={(v) => update({ tts_device: v })} />
          </Row>
          <Row label={t('set.stt')} hint={<>{!caps.stt_cuda && <>{t('set.noCudaStt')} </>}{deviceStatus('stt')}</>}>
            <Segmented label={t('set.stt')} value={settings.stt_device} options={['cpu', 'cuda'] as const} labels={DEVICE_LABELS}
              isDisabled={(o) => o === 'cuda' && !caps.stt_cuda && settings.stt_device !== 'cuda'}
              onChange={(v) => update({ stt_device: v })} />
          </Row>
          <Row label={t('set.whisper')} hint={t('set.whisperHint')}>
            <Segmented label={t('set.whisper')} value={settings.whisper_model} options={choices.whisper_model} onChange={(v) => update({ whisper_model: v })} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.brain')}</h3>
          <Row label={t('set.model')} hint={t('set.modelHint')}>
            <ModelPicker label={t('set.model')} value={settings.claude_model} claude={choices.claude_model} local={local} onChange={(v) => update({ claude_model: v })} />
          </Row>
          <Row label={t('set.effort')} hint={t('set.nextSession')}>
            <Segmented label={t('set.effort')} value={settings.effort} options={choices.effort}
              labels={{ low: t('effort.low'), medium: t('effort.medium'), high: t('effort.high') }}
              onChange={(v) => update({ effort: v })} />
          </Row>
          <Row label={t('set.architectModel')} hint={t('set.architectHint')}>
            <ModelPicker label={t('set.architectModel')} value={settings.architect_model} claude={choices.architect_model} local={local} onChange={(v) => update({ architect_model: v })} />
          </Row>
          <Row label={t('set.architectEffort')} hint={t('set.nextSession')}>
            <Segmented label={t('set.architectEffort')} value={settings.architect_effort} options={choices.architect_effort}
              labels={{ medium: t('effort.medium'), high: t('effort.high'), xhigh: t('effort.xhigh'), max: t('effort.max') }}
              onChange={(v) => update({ architect_effort: v })} />
          </Row>
          <Row label={t('set.titleModel')} hint={t('set.titleHint')}>
            <ModelPicker label={t('set.titleModel')} value={settings.title_model} claude={choices.title_model} local={local} onChange={(v) => update({ title_model: v })} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.local')}</h3>
          <Row label={t('set.localServer')} hint={
            checking ? <span className="status-line">{t('set.localChecking')}</span>
              : local?.reachable ? <span className="status-line">{t('set.localOk', { n: String(local.models.length) })}</span>
                : <span className="status-line warn">{t('set.localDown')}</span>
          }>
            <form className="row-ctl" onSubmit={(e) => {
              e.preventDefault()
              void (url.trim() && url.trim() !== settings.lmstudio_url ? update({ lmstudio_url: url.trim() }) : Promise.resolve()).then(checkLocal)
            }}>
              <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false}
                aria-label={t('set.localServer')} placeholder="http://localhost:1234" />
              <button className="btn secondary small" type="submit" disabled={checking}>{t('set.localCheck')}</button>
            </form>
          </Row>
          <Row label={t('set.localContext')} hint={t('set.localContextHint')}>
            <Segmented label={t('set.localContext')} value={settings.local_context} options={choices.local_context}
              labels={{ '8192': '8K', '16384': '16K', '32768': '32K', '65536': '64K' }}
              onChange={(v) => update({ local_context: v })} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.ui')}</h3>
          <Row label={t('set.lang')} hint={t('langHint')}>
            <Segmented label={t('langLabel')} value={lang} options={['es', 'en'] as const} labels={{ es: 'ES', en: 'EN' }} onChange={setLang} />
          </Row>
          <Row label={t('set.theme')} hint={t('set.themeHint')}>
            <Segmented label={t('set.theme')} value={theme.id} options={THEMES}
              labels={{ original: t('theme.original'), rosa: t('theme.rosa') }} onChange={setTheme} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.reset')}</h3>
          <Row label={t('set.resetHint')}>
            <button className="btn secondary small" onClick={reset}>{t('set.resetBtn')}</button>
          </Row>
        </section>
      </div>
      {toast && <div className={`toast ${toast.error ? '' : 'info'}`}>{toast.msg}</div>}
    </div>
  )
}

/* ---------------- 04 · Conversación ---------------- */
function Conversacion({ project, setReactor }: { project: string | null; setReactor: SetReactor }) {
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
      <div className="status">
        <span className={`dot ${s.connected ? '' : 'off'}`} />
        {s.project?.title ?? t('connecting')} · {energyLabel(s.energy)}
      </div>
      <Transcript messages={s.messages} />
      <Artifacts artifacts={s.artifacts} />
      <Caption messages={s.messages} compact />
      <InputBar s={s} placeholder={t('chatPlaceholder')} />
      {(s.error || s.micError) && <div className="toast">{s.error || s.micError}</div>}
    </>
  )
}

/* ---------------- Piezas compartidas ---------------- */
function Caption({ messages, compact }: { messages: Msg[]; compact?: boolean }) {
  const lastAgent = [...messages].reverse().find((m) => m.role === 'agent')
  const lastIdx = lastAgent ? messages.lastIndexOf(lastAgent) : -1
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

function InputBar({ s, placeholder }: { s: ReturnType<typeof useSession>; placeholder: string }) {
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

  return (
    <>
    {manual && micOn && (
      <div className={`turnhint ${s.capturing ? 'live' : ''}`} aria-live="polite">
        {s.capturing ? t('turn.capturing') : t('turn.waiting')}
      </div>
    )}
    <form className="inputbar" onSubmit={(e) => { e.preventDefault(); s.sendText(text); setText('') }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label={t('message')} />
      <button type="button" className={`btn secondary small turnmode ${manual ? 'on' : ''}`} aria-pressed={manual}
        title={manual ? t('turn.manualHint') : t('turn.autoHint')}
        onClick={() => s.setTurnMode(manual ? 'auto' : 'manual')}>
        {manual ? t('turn.manual') : t('turn.auto')}
      </button>
      {manual && micOn && (
        <button type="button" className={`btn small finish ${s.capturing ? 'live' : ''}`} disabled={!s.capturing}
          title={t('turn.finishHint')} onClick={() => void finishTurn()}>
          {t('turn.finish')}
        </button>
      )}
      {s.playing && <button type="button" className="iconbtn" title={t('silence')} onClick={s.interrupt}>■</button>}
      <button
        type="button"
        className={`iconbtn ${s.micOn ? 'on' : ''}`}
        title={s.micOn ? t('micOff') : t('micOn')}
        onClick={() => (s.micOn ? s.disableMic() : s.enableMic())}
      >
        {s.micOn ? '🎙' : '🔇'}
      </button>
      <button type="submit" className="iconbtn" disabled={!text.trim() || !s.connected} title={t('send')}>➤</button>
    </form>
    </>
  )
}

function Transcript({ messages }: { messages: Msg[] }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { void end.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  return (
    <aside className="panel left">
      <header>{t('transcript')}</header>
      <div className="body">
        {messages.length === 0 && <p className="empty">{t('transcriptEmpty')}</p>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <span className="who">{m.role === 'user' ? t('you') : 'PROMETEO'}</span>
            {m.text}
            {m.tools.map((t, j) => <span key={j} className="tool">{t}</span>)}
          </div>
        ))}
        <div ref={end} />
      </div>
    </aside>
  )
}

function Artifacts({ artifacts }: { artifacts: Artifact[] }) {
  const [active, setActive] = useState<string | null>(null)
  // COPIADO pertenece a una pestaña concreta: al cambiar de .md vuelve a COPIAR.
  const [copiedFor, setCopiedFor] = useState<string | null>(null)
  const copyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  const newest = useMemo(() => [...artifacts].sort((a, b) => b.mtime - a.mtime)[0]?.name ?? null, [artifacts])
  useEffect(() => { if (newest) setActive(newest) }, [newest])
  const cur = artifacts.find((a) => a.name === active) ?? artifacts[0]

  const copy = async () => {
    if (!cur) return
    const name = cur.name
    try {
      await navigator.clipboard.writeText(cur.content)
    } catch {
      setCopiedFor(null)
      return
    }
    setCopiedFor(name)
    clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopiedFor(null), 1500)
  }
  const download = () => {
    if (!cur) return
    const url = URL.createObjectURL(new Blob([cur.content], { type: 'text/markdown' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: cur.name })
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <aside className="panel right">
      <header>
        {t('deliverables')}
        {cur && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button className="btn secondary small" onClick={copy}>{copiedFor === cur.name ? t('copied') : t('copy')}</button>
            <button className="btn secondary small" onClick={download}>.MD</button>
          </span>
        )}
      </header>
      {artifacts.length > 0 && (
        <div className="tabs">
          {artifacts.map((a) => (
            <button key={a.name} className={`tab ${a.name === cur?.name ? 'active' : ''}`} onClick={() => setActive(a.name)}>{a.name}</button>
          ))}
        </div>
      )}
      <div className="body">
        {cur ? (
          <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cur.content}</ReactMarkdown></div>
        ) : (
          <p className="empty">{t('deliverablesEmpty')}</p>
        )}
      </div>
    </aside>
  )
}
