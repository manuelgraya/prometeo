import { useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  agentKey as key, agentSocket, agentsApi, AgentError, rememberForge, useAgents,
  type AgentInfo, type AgentState, type PhaseAction, type Usage, type UsageWindow,
} from '../agents'
import { api } from '../api'
import { Ciclo, Constelacion, Registro } from './Orquestador'
import { ChatIcon } from './icons'
import ProjectPicker from './ProjectPicker'
import { warpRemaining } from '../warp'
import { locale, t } from '../i18n'
import { theme, useTheme } from '../theme'
import type { AgentRef } from '../routes'
import type { CoreSpot } from '../views/common'

function StateDot({ state }: { state: AgentState }) {
  return <span className={`agdot ${state}`} aria-hidden="true" />
}

type TermEvent = { type: 'hello' | 'state' | 'exit' | 'prompted' | 'pasted'; state?: AgentState }

/** Terminal de un agente: xterm.js conectado por WebSocket a su pty en el backend.
 *  Al (re)conectar, el backend reenvía el historial, así que se limpia en cada «hello».
 *  Claude Code corre con el tema `dark-ansi`: la paleta del tema de PROMETEO pinta también sus colores. */
function AgentTerminal({ slug, version, onEvent }: { slug: string; version: string; onEvent: (e: TermEvent) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const onEv = useRef(onEvent)
  useEffect(() => { onEv.current = onEvent }, [onEvent])
  const [th] = useTheme()

  useEffect(() => {
    const el = box.current
    if (!el) return
    const term = new Terminal({
      fontFamily: "'JetBrainsMono Nerd Font', 'JetBrains Mono', 'Cascadia Code', Menlo, Consolas, monospace",
      fontSize: 13, lineHeight: 1.15, cursorBlink: true, allowProposedApi: false, scrollback: 5000,
      theme: theme().terminal, allowTransparency: true,
    })
    termRef.current = term
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
    // Atajos de edición por palabras como en cualquier editor (xterm.js manda Ctrl+Retroceso como un
    // retroceso normal). Se traducen a los de readline, que entienden Claude Code y bash.
    const WORD_KEYS: Record<string, string> = {
      Backspace: '\x17',  // Ctrl+Retroceso → Ctrl+W: borra la palabra anterior
      Delete: '\x1bd',    // Ctrl+Supr → Alt+D: borra la palabra siguiente
      ArrowLeft: '\x1bb', // Ctrl+← → Alt+B: palabra anterior
      ArrowRight: '\x1bf', // Ctrl+→ → Alt+F: palabra siguiente
    }
    term.attachCustomKeyEventHandler((e) => {
      const seq = e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey ? WORD_KEYS[e.key] : undefined
      if (!seq) return true
      if (e.type === 'keydown') { e.preventDefault(); send({ type: 'input', data: seq }) }
      return false
    })
    const ro = new ResizeObserver(() => { fit.fit(); sendSize() })
    ro.observe(el)
    term.focus()
    return () => {
      alive = false; clearTimeout(timer); ro.disconnect(); data.dispose(); ws?.close(); term.dispose(); termRef.current = null
    }
  }, [slug, version])

  // Cambiar de tema en Ajustes repinta la terminal abierta
  useEffect(() => { if (termRef.current) termRef.current.options.theme = th.terminal }, [th])

  return <div className="agterm" ref={box} onClick={() => box.current?.querySelector('textarea')?.focus()} />
}

/* ---------------- Uso de la suscripción ---------------- */
function resetLabel(at: number | null): string {
  if (!at) return ''
  const d = new Date(at * 1000)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' })
}

function Meter({ label, w }: { label: string; w?: UsageWindow }) {
  const pct = w?.used_percentage
  // Ya pasó el reinicio: el dato guardado no vale hasta la próxima respuesta de un agente
  const stale = !w || pct == null || (w.resets_at != null && w.resets_at * 1000 < Date.now())
  const v = stale ? 0 : Math.max(0, Math.min(100, pct))
  return (
    <div className={`meter ${stale ? 'stale' : v >= 85 ? 'hot' : v >= 60 ? 'warm' : ''}`}
      title={w?.resets_at && !stale ? t('usage.resets', { at: resetLabel(w.resets_at) }) : undefined}>
      <span className="lbl">{label}</span>
      <span className="bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}>
        <i style={{ width: `${v}%` }} />
      </span>
      <span className="pct">{stale ? '—' : `${v}%`}</span>
    </div>
  )
}

function UsageBox({ usage, agent }: { usage: Usage | null; agent: AgentInfo | null }) {
  return (
    <div className="usage" title={usage ? t('usage.updated', { at: new Date(usage.at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }) : t('usage.none')}>
      <span className="head">{t('usage.title')}</span>
      <Meter label="5 h" w={usage?.five_hour} />
      <Meter label="7 d" w={usage?.seven_day} />
      {agent?.context != null && <span className="ctx" title={t('usage.ctxHint')}>{t('usage.ctx', { n: String(agent.context) })}</span>}
    </div>
  )
}

/* ---------------- (+) Nuevo agente ---------------- */
function NewAgent({ project, agents, onCreated, onRun, onClose }: {
  project: string; agents: AgentInfo[]
  onCreated: (a: AgentInfo) => void; onRun: (version: string) => Promise<void>; onClose: () => void
}) {
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Versión vigente del prompt, si tiene prompt.md; se ofrece EJECUTARLA si aún no tiene agente
  const [current, setCurrent] = useState<string | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { area.current?.focus() }, [])
  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(project)}`).then((r) => r.json())
      .then((d: { meta: { version: string }; artifacts: { name: string }[] }) =>
        setCurrent(d.artifacts.some((x) => x.name === 'prompt.md') ? d.meta.version : null))
      .catch(() => setCurrent(null))
  }, [project])
  const pending = current && !agents.some((a) => a.version === current) ? current : null
  const create = async () => {
    setBusy(true); setErr(null)
    try { onCreated(await agentsApi.create(project, task)) } catch (e) {
      setErr(e instanceof AgentError && e.status === 503 ? t('ag.noClaude') : t('ag.error'))
    } finally { setBusy(false) }
  }
  return (
    <div className="newagent" role="dialog" aria-label={t('ag.new')}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
      {pending && (
        <button className="btn small run" disabled={busy} onClick={async () => { setBusy(true); try { await onRun(pending) } finally { setBusy(false) } }}>
          ▶ {t('ag.runPrompt', { v: pending })}
        </button>
      )}
      <label htmlFor="agtask">{pending ? t('ag.orFree') : t('ag.freeTask')}</label>
      <textarea id="agtask" ref={area} rows={3} value={task} placeholder={t('ag.taskPlaceholder')}
        onChange={(e) => setTask(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void create() }} />
      {err && <p className="err">{err}</p>}
      <div className="row">
        <button className="btn secondary small" onClick={onClose} disabled={busy}>{t('cancel')}</button>
        <button className="btn small" onClick={create} disabled={busy}>{busy ? t('ag.running') : t('ag.launch')}</button>
      </div>
    </div>
  )
}

/**
 * La Forja: el gestor de agentes de un proyecto (o de todos, con project = null). Arriba a la izquierda,
 * volver y Prometeo con sus agentes en órbita; debajo, la lista (con +) y el registro. A la derecha, el
 * proyecto (cambiar / abrir), el uso de Claude y la terminal del agente que está en pantalla.
 */
export default function Agentes({ project, version, onSelect, onCore, onActive, onBack, onProject, onConversation }: {
  project: string | null
  version: string | null
  onSelect: (a: AgentRef) => void
  /** Dónde debe quedar el reactor (centro de la constelación). */
  onCore?: (spot: CoreSpot | null) => void
  /** Si algún agente está trabajando: el reactor gira más deprisa. */
  onActive?: (busy: boolean) => void
  onBack: () => void
  onProject: (slug: string | null) => void
  onConversation: (slug: string) => void
}) {
  const { agents: all, log: allLog, usage } = useAgents()
  useEffect(() => { rememberForge(project) }, [project])
  const list = useMemo(() => all && (project ? all.filter((a) => a.slug === project) : all), [all, project])
  const log = useMemo(() => (project ? allLog.filter((e) => e.slug === project) : allLog), [allLog, project])
  const working = Boolean(list?.some((a) => a.alive && (a.state === 'pensando' || a.state === 'escribiendo')))
  useEffect(() => { onActive?.(working) }, [working, onActive])
  // El título del proyecto: de sus agentes o, si aún no tiene, de la lista de proyectos
  const [pjTitle, setPjTitle] = useState<string | null>(null)
  useEffect(() => {
    setPjTitle(null)
    if (project) api.projects().then((ps) => setPjTitle(ps.find((p) => p.slug === project)?.title ?? project)).catch(() => setPjTitle(project))
  }, [project])
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
  const [adding, setAdding] = useState(false)
  const cur = list?.find((a) => a.version === version && (!project || a.slug === project)) ?? (version ? null : list?.[0] ?? null)
  useEffect(() => { if (!version && cur) onSelect(cur) }, [version, cur, onSelect])
  const hint = cur && hintFor?.key === key(cur) ? hintFor.text : null
  const setHint = (text: string | null) => setHintFor(cur && text ? { key: key(cur), text } : null)

  const onEvent = (e: TermEvent) => {
    if (e.type === 'prompted') setHint(t('ag.prompted'))
    if (e.type === 'pasted') setHint(t('ag.pasted'))
    if (e.type === 'exit') setHint(null)
    const sent = hintFor?.text === t('ag.prompted') || hintFor?.text === t('ag.pasted')
    if (e.type === 'state' && e.state === 'pensando' && sent) setHint(null) // ya lo envió
  }
  /** Un agente parado sin terminar (p. ej. tras reiniciar PROMETEO) se retoma a mano: no se relanza solo. */
  const resume = async () => {
    if (!cur) return
    setBusy(true)
    try { await agentsApi.start(cur.slug, cur.version, { prompt: true }); setHint(null) } // solo lo escribe si nunca llegó a enviarse
    catch (e) { setHint(e instanceof AgentError && e.status === 503 ? t('ag.noClaude') : t('ag.error')) } finally { setBusy(false) }
  }
  const showTrust = cur?.alive && cur.pending_prompt && !hint
  const act = async (action: PhaseAction) => {
    if (!cur) return
    setBusy(true)
    try { await agentsApi.phase(cur.slug, cur.version, action) } catch (e) {
      setHint(e instanceof AgentError ? e.message : t('ag.error'))
    } finally { setBusy(false) }
  }
  const runPrompt = async (v: string) => {
    if (!project) return
    const a = await agentsApi.start(project, v, { prompt: true })
    setAdding(false)
    onSelect(a)
  }
  const dead = cur && !cur.alive && cur.phase !== 'cerrado'

  return (
    <div className="agents">
      <div className="agside">
        <button className="agback" onClick={onBack} aria-label={t('back').replace(/^←\s*/, '')} title={t('back').replace(/^←\s*/, '')}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7M8 12h12" /></svg>
        </button>
        <Constelacion agents={list ?? []} selected={cur} onSelect={onSelect} onCore={onCore} />
        <aside className="aglist">
          <header>
            {t('ag.title')}
            <button className={`agadd ${adding ? 'on' : ''}`} onClick={() => setAdding((v) => !v)} disabled={!project}
              aria-expanded={adding} aria-label={t('ag.new')} title={project ? t('ag.new') : t('ag.pickProject')}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </header>
          {adding && project && (
            <NewAgent project={project} agents={list ?? []} onRun={runPrompt} onClose={() => setAdding(false)}
              onCreated={(a) => { setAdding(false); onSelect(a) }} />
          )}
          <div className="body">
            {list === null && <p className="empty">{t('loading')}</p>}
            {list?.length === 0 && <p className="empty">{t(project ? 'ag.empty' : 'ag.emptyAll')}</p>}
            {list?.map((a) => {
              const on = cur !== null && key(cur) === key(a)
              return (
                <button key={key(a)} className={`agitem ${on ? 'active' : ''} ${a.alive ? a.state : 'parado'} ${a.phase}`}
                  onClick={() => onSelect(a)} aria-current={on ? 'true' : undefined}>
                  <StateDot state={a.alive ? a.state : 'parado'} />
                  <span className="name">{a.name}</span>
                  {on && <span className="onscreen">{t('ag.onScreen')}</span>}
                  <span className="sub">{a.prompt ?? t('ag.free')}{!project && ` · ${a.title}`}</span>
                  <span className="st">
                    {a.phase === 'cerrado' ? t('ag.phase.cerrado') : t(`ag.state.${a.alive ? a.state : 'parado'}`)}
                    {a.phase !== 'trabajando' && a.phase !== 'cerrado' && ` · ${t(`ag.phase.${a.phase}`)}`}
                  </span>
                </button>
              )
            })}
          </div>
          <Registro log={log} onSelect={(e) => onSelect(e)} />
        </aside>
      </div>
      <section className="agmain">
        <header>
          <div className="aghead-left">
            <ProjectPicker project={project} title={project ? pjTitle ?? cur?.title ?? null : null} onProject={onProject} allowAll
              extra={project ? { label: t('ag.openConversation'), onClick: () => onConversation(project) } : undefined} />
            {project && (
              <button className="btn secondary small talkbtn" onClick={() => onConversation(project)} title={t('ag.talkHint')}>
                <ChatIcon /> <span className="lbl">{t('ag.talk')}</span>
              </button>
            )}
          </div>
          <UsageBox usage={usage} agent={cur} />
        </header>
        {cur ? (
          <>
            <Ciclo a={cur} busy={busy} onAction={act} />
            {dead ? (
              <div className="aghint">
                {t('ag.stopped')}
                <button className="btn small" onClick={resume} disabled={busy}>{t('ag.resume')}</button>
              </div>
            ) : (hint || showTrust) && <div className="aghint">{hint ?? t('ag.trust')}</div>}
            {termReady ? <AgentTerminal key={key(cur)} slug={cur.slug} version={cur.version} onEvent={onEvent} /> : <div className="agterm" />}
          </>
        ) : (
          list && list.length > 0 && <p className="empty">{t('ag.select')}</p>
        )}
      </section>
    </div>
  )
}
