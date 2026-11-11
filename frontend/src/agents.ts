/**
 * Agentes de Claude Code (gestor). El backend los lanza en una pty; aquí solo se piden, se listan
 * y se conectan sus terminales. Todo va con un token que cambia en cada arranque del backend.
 */
import { useEffect, useState } from 'react'

export type AgentState = 'pensando' | 'escribiendo' | 'esperando' | 'parado'
export type AgentPhase = 'trabajando' | 'validando' | 'revision' | 'documentando' | 'cerrado'
export type PhaseAction = 'terminar' | 'corregir' | 'aprobar' | 'cerrar' | 'reabrir'
export interface Validation { verdict: 'ok' | 'revisar' | 'error'; text: string; at: string }
/** Mensaje de orquestación de Prometeo («Agente 2 terminó, validando…»). */
export interface LogEntry { at: string; slug: string; version: string; n: number; text: string; kind: 'info' | 'ok' | 'warn' | 'error' }
export interface AgentInfo {
  slug: string; version: string; n: number; title: string
  state: AgentState; phase: AgentPhase; alive: boolean; cwd: string | null; created: string
  validation: Validation | null
  /** Nota de la tarea en la Vault (relativa a obsidian-vault/), si ya existe. */
  note: string | null
  /** EJECUTAR está esperando a que Claude Code arranque (diálogo de confianza) para escribir el prompt. */
  pending_prompt: boolean
}

let tokenP: Promise<string> | null = null
function token(): Promise<string> {
  tokenP ??= fetch('/api/agents/token').then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  }).then((d: { token: string }) => d.token).catch((e) => { tokenP = null; throw e })
  return tokenP
}

export class AgentError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function call<T>(method: string, url: string, body?: object, retry = true): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-prometeo-token': await token() },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 403 && retry) { tokenP = null; return call(method, url, body, false) } // backend reiniciado
  if (!res.ok) {
    const detail = await res.json().then((d: { detail?: string }) => d.detail ?? '').catch(() => '')
    throw new AgentError(res.status, detail || `${res.status}`)
  }
  return (res.status === 204 ? undefined : res.json()) as Promise<T>
}

const enc = encodeURIComponent
export const agentsApi = {
  start: (slug: string, version = 'actual', opts: { prompt?: boolean; cols?: number; rows?: number } = {}) =>
    call<AgentInfo>('POST', `/api/agents/${enc(slug)}/${enc(version)}`, opts),
  stop: (slug: string, version: string) => call<{ ok: boolean }>('DELETE', `/api/agents/${enc(slug)}/${enc(version)}`),
  phase: (slug: string, version: string, action: PhaseAction) =>
    call<AgentInfo>('POST', `/api/agents/${enc(slug)}/${enc(version)}/phase`, { action }),
  setRepo: (slug: string, repo: string | null) =>
    call<{ repo: string | null }>('PUT', `/api/projects/${enc(slug)}/repo`, { repo }),
}

export async function agentSocket(path: string): Promise<WebSocket> {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  const ws = new WebSocket(`${proto}://${location.host}${path}?token=${enc(await token())}`)
  ws.binaryType = 'arraybuffer'
  ws.addEventListener('close', (e) => { if (e.code === 4403 || e.code === 1006) tokenP = null })
  return ws
}

/** Lista de agentes en vivo (estados incluidos; null mientras conecta) y registro del orquestador. */
export function useAgents(): { agents: AgentInfo[] | null; log: LogEntry[] } {
  const [list, setList] = useState<AgentInfo[] | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  useEffect(() => {
    let ws: WebSocket | null = null
    let alive = true
    let timer: number | undefined
    const connect = async () => {
      try {
        ws = await agentSocket('/ws/agents')
      } catch {
        timer = window.setTimeout(connect, 2000)
        return
      }
      if (!alive) { ws.close(); return }
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') return
        const d = JSON.parse(e.data) as { type: string; agents?: AgentInfo[]; entries?: LogEntry[]; entry?: LogEntry }
        if (d.type === 'agents' && d.agents) setList(d.agents)
        if (d.type === 'log_all' && d.entries) setLog(d.entries)
        if (d.type === 'log' && d.entry) { const entry = d.entry; setLog((l) => [...l.slice(-79), entry]) }
      }
      ws.onclose = () => { if (alive) timer = window.setTimeout(connect, 2000) }
    }
    void connect()
    return () => { alive = false; clearTimeout(timer); ws?.close() }
  }, [])
  return { agents: list, log }
}
