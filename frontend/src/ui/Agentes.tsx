import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { agentKey as key, agentSocket, agentsApi, AgentError, useAgents, type AgentState, type PhaseAction } from '../agents'
import { Ciclo, Constelacion, Registro } from './Orquestador'
import { warpRemaining } from '../warp'
import { t } from '../i18n'
import type { AgentRef } from '../routes'
import type { CoreSpot } from '../views/common'

function cssRgb(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v ? `rgba(${v}, ${alpha})` : ''
}

function StateDot({ state }: { state: AgentState }) {
  return <span className={`agdot ${state}`} aria-hidden="true" />
}

type TermEvent = { type: 'hello' | 'state' | 'exit' | 'prompted' | 'pasted'; state?: AgentState }

/** Terminal de un agente: xterm.js conectado por WebSocket a su pty en el backend.
 *  Al (re)conectar, el backend reenvía el historial, así que se limpia en cada «hello». */
function AgentTerminal({ slug, version, onEvent }: { slug: string; version: string; onEvent: (e: TermEvent) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const onEv = useRef(onEvent)
  useEffect(() => { onEv.current = onEvent }, [onEvent])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const term = new Terminal({
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
      fontSize: 13, lineHeight: 1.15, cursorBlink: true, allowProposedApi: false, scrollback: 5000,
      theme: {
        background: 'rgba(0, 0, 0, 0)', foreground: cssRgb('--text-rgb') || '#d8f4ff',
        cursor: cssRgb('--cyan-rgb') || '#4fd1ff', selectionBackground: cssRgb('--cyan-rgb', 0.3),
      },
      allowTransparency: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    fit.fit()
    let ws: WebSocket | null = null
    let alive = true
    let timer: number | undefined
    const send = (m: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)) }
    const sendSize = () => send({ type: 'resize', cols: term.cols, rows: term.rows })

    const connect = async () => {
      try { ws = await agentSocket(`/ws/agents/${encodeURIComponent(slug)}/${encodeURIComponent(version)}`) } catch {
        timer = window.setTimeout(connect, 1500)
        return
      }
      if (!alive) { ws.close(); return }
      ws.onopen = sendSize
      ws.onmessage = (e) => {
        if (e.data instanceof ArrayBuffer) { term.write(new Uint8Array(e.data)); return }
        const d = JSON.parse(e.data as string) as TermEvent
        if (d.type === 'hello') term.reset()
        onEv.current(d)
      }
      ws.onclose = (e) => { if (alive && e.code !== 4404) timer = window.setTimeout(connect, 1500) }
    }
    void connect()
    const data = term.onData((d) => send({ type: 'input', data: d }))
    const ro = new ResizeObserver(() => { fit.fit(); sendSize() })
    ro.observe(el)
    term.focus()
    return () => { alive = false; clearTimeout(timer); ro.disconnect(); data.dispose(); ws?.close(); term.dispose() }
  }, [slug, version])

  return <div className="agterm" ref={box} onClick={() => box.current?.querySelector('textarea')?.focus()} />
}

/**
 * Gestor de agentes de un proyecto (o de todos, con project = null): Prometeo y sus agentes en órbita
 * arriba a la izquierda, la lista y el registro debajo, y la terminal del agente elegido a la derecha.
 */
export default function Agentes({ project, version, onSelect, onCore, onActive, onBack }: {
  project: string | null
  version: string | null
  onSelect: (a: AgentRef) => void
  /** Dónde debe quedar el reactor (centro de la constelación). */
  onCore?: (spot: CoreSpot | null) => void
  /** Si algún agente está trabajando: el reactor gira más deprisa. */
  onActive?: (busy: boolean) => void
  onBack: () => void
}) {
  const { agents: all, log: allLog } = useAgents()
  const list = useMemo(() => all && (project ? all.filter((a) => a.slug === project) : all), [all, project])
  const log = useMemo(() => (project ? allLog.filter((e) => e.slug === project) : allLog), [allLog, project])
  const working = Boolean(list?.some((a) => a.alive && (a.state === 'pensando' || a.state === 'escribiendo')))
  useEffect(() => { onActive?.(working) }, [working, onActive])
  // La terminal se monta al acabar el salto a velocidad luz: así no compite con la animación.
  const [termReady, setTermReady] = useState(() => warpRemaining() === 0)
  useEffect(() => {
    if (termReady) return
    const id = window.setTimeout(() => setTermReady(true), warpRemaining() * 1000)
    return () => clearTimeout(id)
  }, [termReady])
  // El aviso pertenece a un agente concreto: al cambiar de agente deja de verse.
  const [hintFor, setHintFor] = useState<{ key: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const cur = list?.find((a) => a.version === version && (!project || a.slug === project)) ?? (version ? null : list?.[0] ?? null)
  useEffect(() => { if (!version && cur) onSelect(cur) }, [version, cur, onSelect])
  const hint = cur && hintFor?.key === key(cur) ? hintFor.text : null
  const setHint = (text: string | null) => setHintFor(cur && text ? { key: key(cur), text } : null)

  const onEvent = (e: TermEvent) => {
    if (e.type === 'prompted') setHint(t('ag.prompted'))
    if (e.type === 'pasted') setHint(t('ag.pasted'))
    if (e.type === 'exit') setHint(t('ag.stopped'))
    const sent = hintFor?.text === t('ag.prompted') || hintFor?.text === t('ag.pasted')
    if (e.type === 'state' && e.state === 'pensando' && sent) setHint(null) // ya lo envió
  }
  const toggle = async () => {
    if (!cur) return
    setBusy(true)
    try {
      if (cur.alive) await agentsApi.stop(cur.slug, cur.version)
      else { await agentsApi.start(cur.slug, cur.version, { prompt: true }); setHint(null) } // solo lo escribe si nunca llegó a enviarse
    } catch { setHint(t('ag.error')) } finally { setBusy(false) }
  }
  const showTrust = cur?.alive && cur.pending_prompt && !hint
  const act = async (action: PhaseAction) => {
    if (!cur) return
    setBusy(true)
    try { await agentsApi.phase(cur.slug, cur.version, action) } catch (e) {
      setHint(e instanceof AgentError ? e.message : t('ag.error'))
    } finally { setBusy(false) }
  }

  return (
    <div className="agents">
      <div className="agside">
        <Constelacion agents={list ?? []} selected={cur} onSelect={onSelect} onCore={onCore} />
        <aside className="aglist">
          <header>
            {t('ag.title')}
            <button className="btn secondary small" onClick={onBack}>{t('ag.back')}</button>
          </header>
          <div className="body">
            {list === null && <p className="empty">{t('loading')}</p>}
            {list?.length === 0 && <p className="empty">{t('ag.empty')}</p>}
            {list?.map((a) => (
              <button key={key(a)} className={`agitem ${cur && key(cur) === key(a) ? 'active' : ''} ${a.state}`}
                onClick={() => onSelect(a)} aria-current={cur && key(cur) === key(a) ? 'true' : undefined}>
                <StateDot state={a.state} />
                <span className="name">{t('ag.agent', { n: String(a.n) })}</span>
                {!project && <span className="proj">{a.title}</span>}
                <span className="st">{t(`ag.state.${a.state}`)}{a.phase !== 'trabajando' && ` · ${t(`ag.phase.${a.phase}`)}`}</span>
              </button>
            ))}
          </div>
          <Registro log={log} onSelect={(e) => onSelect(e)} />
        </aside>
      </div>
      <section className="agmain">
        {cur ? (
          <>
            <header>
              <div className="who">
                <StateDot state={cur.state} />
                <span className="name">{t('ag.agent', { n: String(cur.n) })}</span>
                <span className="proj">{cur.title}</span>
                <span className={`badge ${cur.state}`}>{t(`ag.state.${cur.state}`)}</span>
              </div>
              <button className={`btn small ${cur.alive ? 'secondary' : ''}`} onClick={toggle} disabled={busy}>
                {cur.alive ? t('ag.stop') : t('ag.resume')}
              </button>
            </header>
            {cur.cwd && <div className="agcwd"><span className="label">{t('ag.cwd')}</span><code>{cur.cwd}</code></div>}
            <Ciclo a={cur} busy={busy} onAction={act} />
            {(hint || showTrust || !cur.alive) && <div className="aghint">{hint ?? (cur.alive ? t('ag.trust') : t('ag.stopped'))}</div>}
            {termReady ? <AgentTerminal key={key(cur)} slug={cur.slug} version={cur.version} onEvent={onEvent} /> : <div className="agterm" />}
          </>
        ) : (
          list && list.length > 0 && <p className="empty">{t('ag.select')}</p>
        )}
      </section>
    </div>
  )
}
