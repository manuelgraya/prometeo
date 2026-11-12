/**
 * Raíz de la interfaz: escena 3D de fondo, intro, navegación y la vista activa.
 * Cada vista vive en src/views/; las piezas que comparten, en src/ui/.
 */
import { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'
import { t, useLang, type Lang } from './i18n'
import { hashOf, parseHash, type AgentRef, type View } from './routes'
import Scene, { type ReactorProps } from './scene/Scene'
import { playWarpSound } from './audio/warpSound'
import { audioPlayer, unlockAudio } from './session'
import CometCursor from './ui/CometCursor'
import { installCosmicInteractions } from './ui/cosmic'
import Intro from './ui/Intro'
import Ajustes from './views/Ajustes'
import { Comenzar, Inicio } from './views/Bienvenida'
import { Faqs, Proyectos, Voces } from './views/Paginas'
import { Conversacion, DefinirVoz } from './views/Sesiones'
import { startWarp, warpRemaining, type WarpLayer } from './warp'
import { lastForge } from './agents'

// El gestor trae xterm.js: se carga la primera vez que se abre, no al arrancar.
const loadGestor = () => import('./views/Gestor')
const Gestor = lazy(loadGestor)

/** Prometeo durante el viaje estelar: en el centro, con los anillos girando deprisa (warp.ts lo encoge hasta un punto). */
const WARP_REACTOR: ReactorProps = { variant: 'despertar', energy: 'thinking', offsetX: 0, offsetY: 0, scale: 1 }

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
  const startConversation = (project: string | null, title?: string) => go({ name: 'conversacion', project, key: Date.now(), title })
  const openAgent = useCallback((a: AgentRef) => go({ name: 'agentes', slug: a.slug, version: a.version }), [go])
  // EJECUTAR: la interfaz se desvanece, Prometeo se encoge mientras sube el sonido, da el acelerón con las
  // estrellas pasando por los bordes, frena, se recoloca en su sitio del gestor y entra el gestor (ver warp.ts).
  const [warpCls, setWarpCls] = useState<WarpLayer>('')
  const [holdCenter, setHoldCenter] = useState(false)
  // El mismo salto se usa al entrar en la FORJA desde la barra de navegación.
  const warpTo = useCallback((swap: () => void) => {
    if (warpRemaining() > 0) return  // ya hay un salto en curso
    void loadGestor()  // se descarga durante el salto: al cambiar de vista ya está listo
    const sound = () => playWarpSound(audioPlayer().ctx)
    void startWarp({ swap, layer: setWarpCls, hold: setHoldCenter, sound })
  }, [])
  const launchAgent = useCallback((a: AgentRef) => warpTo(() => openAgent(a)), [warpTo, openAgent])
  const openForge = useCallback(() => warpTo(() => go({ name: 'agentes', slug: lastForge(), version: null })), [warpTo, go])
  // Elegir otro agente en el gestor no añade una entrada al historial por cada clic.
  const selectAgent = useCallback((a: AgentRef) => {
    const v: View = { name: 'agentes', slug: a.slug, version: a.version }
    setView(v)
    history.replaceState(null, '', hashOf(v))
  }, [])

  return (
    <>
      <Scene {...(holdCenter ? WARP_REACTOR : reactor)} />
      <CometCursor />
      <Intro onReveal={reveal} />
      <div className={`layer ${revealed ? '' : 'intro-hidden'} ${warpCls}`} inert={!revealed || warpCls === 'warp-out' || warpCls === 'warp-hidden'}>
        <div className="topleft">
          <button className="wordmark" onClick={goHome} title={t('home')}>PROMETEO</button>
          {view.name !== 'loading' && <Nav current={view.name} go={go} onForge={openForge} />}
        </div>
        <LangSwitch lang={lang} setLang={setLang} />
        <ViewBoundary key={view.name} onHome={goHome}>
          {view.name === 'comenzar' && (
            <Comenzar setReactor={setReactor} onStart={() => go({ name: 'voz' })} onChoose={() => go({ name: 'voces' })} />
          )}
          {view.name === 'voz' && <DefinirVoz setReactor={setReactor} onDone={goHome} onVoices={() => go({ name: 'voces' })} />}
          {view.name === 'inicio' && (
            <Inicio setReactor={setReactor} onStart={(title) => startConversation(null, title)} onOpen={() => go({ name: 'proyectos' })} />
          )}
          {view.name === 'proyectos' && (
            <Proyectos setReactor={setReactor} onOpen={(slug) => startConversation(slug)} onBack={goHome}
              onAgents={(slug) => go({ name: 'agentes', slug, version: null })} />
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
          {view.name === 'conversacion' && (
            <Conversacion key={view.key} project={view.project} title={view.title} setReactor={setReactor} onRun={launchAgent}
              onForge={(slug) => warpTo(() => go({ name: 'agentes', slug, version: null }))} />
          )}
          {view.name === 'agentes' && (
            <Suspense fallback={<div className="page"><p className="empty">{t('loading')}</p></div>}>
              <Gestor setReactor={setReactor} project={view.slug} version={view.version} onSelect={selectAgent}
                onBack={() => (history.length > 1 ? history.back() : go({ name: 'proyectos' }))}
                onProject={(slug) => go({ name: 'agentes', slug, version: null })}
                onConversation={(slug) => startConversation(slug)} />
            </Suspense>
          )}
        </ViewBoundary>
      </div>
    </>
  )
}

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
// FORJA es el gestor de agentes: abre el último proyecto que se vio en él (o todos).
const NAV = [
  { name: 'inicio', label: 'nav.home' },
  { name: 'proyectos', label: 'nav.projects' },
  { name: 'agentes', label: 'nav.forge' },
  { name: 'voces', label: 'nav.voices' },
  { name: 'ajustes', label: 'nav.settings' },
  { name: 'faq', label: 'nav.faq' },
] as const

function Nav({ current, go, onForge }: { current: View['name']; go: (v: View) => void; onForge: () => void }) {
  return (
    <nav className="nav" aria-label={t('navLabel')}>
      {NAV.map((n) => (
        <button
          key={n.name}
          className={`${current === n.name ? 'active' : ''} ${n.name === 'agentes' ? 'forge' : ''}`}
          aria-current={current === n.name ? 'page' : undefined}
          onClick={() => {
            void unlockAudio()
            if (n.name !== 'agentes') go({ name: n.name })
            else if (current !== 'agentes') onForge()  // entrar en la FORJA: salto a velocidad luz
            else go({ name: 'agentes', slug: lastForge(), version: null })  // ya dentro: sin salto
          }}
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
