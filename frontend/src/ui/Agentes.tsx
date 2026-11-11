import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { agentSocket, agentsApi, AgentError, useAgents, type AgentInfo, type AgentState, type PhaseAction } from '../agents'
import { Ciclo, Constelacion, Registro } from './Orquestador'
import { warpRemaining } from '../warp'
import { t } from '../i18n'

const key = (a: { slug: string; version: string }) => `${a.slug}/${a.version}`

function cssRgb(name: string, alpha = 1): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v ? `rgba(${v}, ${alpha})` : ''
}

export function StateDot({ state }: { state: AgentState }) {
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

/** Dónde trabajan los agentes de un proyecto: su repositorio, o la carpeta del proyecto. */
export function RepoField({ slug, repo, onChange }: { slug: string; repo: string | null | undefined; onChange?: (r: string | null) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(repo ?? '')
  const [error, setError] = useState(false)
  const edit = () => { setValue(repo ?? ''); setError(false); setEditing(true) }
  const save = async () => {
    try {
      const m = await agentsApi.setRepo(slug, value.trim() || null)
      setError(false)
      setEditing(false)
      onChange?.(m.repo)
    } catch { setError(true) }
  }
  if (!editing) {
    return (
      <div className="repofield">
        <span className="label">{t('ag.repo')}</span>
        <code title={repo ?? undefined}>{repo || t('ag.repoProject')}</code>
        <button className="linkbtn" onClick={edit}>{t('ag.repoEdit')}</button>
      </div>
    )
  }
  return (
    <form className="repofield editing" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('ag.repoPlaceholder')}
        aria-label={t('ag.repo')} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }} />
      <button className="btn secondary small" type="submit">{t('ag.repoSave')}</button>
      {error && <span className="err">{t('ag.repoError')}</span>}
    </form>
  )
}

/** Botón EJECUTAR junto al prompt: lanza el agente de la versión vigente con el prompt escrito. */
export function RunButton({ slug, onLaunched }: { slug: string; onLaunched: (a: AgentInfo) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      onLaunched(await agentsApi.start(slug, 'actual', { prompt: true }))
    } catch (e) {
      setError(e instanceof AgentError && e.status === 503 ? t('ag.noClaude') : t('ag.error'))
      setTimeout(() => setError(null), 5000)
    } finally { setBusy(false) }
  }
  return (
    <>
      <button className="btn small run" onClick={run} disabled={busy} title={t('ag.runHint')}>
        {busy ? t('ag.running') : <>▶ {t('ag.run')}</>}
      </button>
      {error && <div className="toast">{error}</div>}
    </>
  )
}

export default function Agentes({ selected, onSelect }: {
  selected: { slug: string; version: string } | null
  onSelect: (a: { slug: string; version: string }) => void
}) {
  const { agents: list, log } = useAgents()
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
  const cur = list?.find((a) => selected && key(a) === key(selected)) ?? (selected ? null : list?.[0] ?? null)
  useEffect(() => { if (!selected && cur) onSelect(cur) }, [selected, cur, onSelect])
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
      else { await agentsApi.start(cur.slug, cur.version); setHint(null) }
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
      <aside className="aglist">
        <Constelacion agents={list ?? []} selected={cur} onSelect={onSelect} />
        <header>{t('ag.title')}</header>
        <div className="body">
          {list === null && <p className="empty">{t('loading')}</p>}
          {list?.length === 0 && <p className="empty">{t('ag.empty')}</p>}
          {list?.map((a) => (
            <button key={key(a)} className={`agitem ${cur && key(cur) === key(a) ? 'active' : ''} ${a.state}`}
              onClick={() => onSelect(a)} aria-current={cur && key(cur) === key(a) ? 'true' : undefined}>
              <StateDot state={a.state} />
              <span className="name">{t('ag.agent', { n: String(a.n) })}</span>
              <span className="proj">{a.title}</span>
              <span className="st">{t(`ag.state.${a.state}`)}{a.phase !== 'trabajando' && ` · ${t(`ag.phase.${a.phase}`)}`}</span>
            </button>
          ))}
        </div>
        <Registro log={log} onSelect={(e) => onSelect(e)} />
      </aside>
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
