import { unlockAudio, type Artifact, type ProjectMeta } from './session'

export interface VoiceInfo { name: string; desc: string; gender: 'm' | 'f'; accent: string | null }
/** Una versión del prompt: `title` es el de su prompt.md (el que lanza la Forja); `others`, otros prompt*.md de la carpeta. */
export interface PromptVersion { version: string; title: string | null; others: string[]; done: boolean }
export interface Faq { id: string; question: string; answer: string; recorded: boolean }
export interface VoiceCfg { voice: string; speed: number; configured: boolean }
export interface Settings {
  tts_device: 'cpu' | 'cuda'; stt_device: 'cpu' | 'cuda'; whisper_model: string
  /** «haiku|sonnet|opus» o «local:<id de LM Studio>» */
  claude_model: string; effort: string; architect_model: string; architect_effort: string; title_model: string
  local_context: string; lmstudio_url: string
}
export interface LocalModel { id: string; name: string; params: string | null; size: number | null; loaded: boolean; tools: boolean; max_context: number | null }
export interface LocalModels { reachable: boolean; models: LocalModel[]; url: string; error?: string }
export interface Runtime {
  tts: { device: string; error: string | null } | null
  stt: { device: string; model: string; error: string | null } | null
  loading: string[]
}
export interface AppState {
  voice: VoiceCfg
  voices: Record<string, VoiceInfo>
  settings: Settings
  choices: Record<string, string[]>
  capabilities: { tts_cuda: boolean; stt_cuda: boolean }
  runtime: Runtime
}

async function json<T>(r: Promise<Response>): Promise<T> {
  const res = await r
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json() as Promise<T>
}
const put = (url: string, body: object) =>
  fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  state: () => json<AppState>(fetch('/api/state')),
  saveSettings: (s: Partial<Settings>) => json<{ settings: Settings; runtime: Runtime }>(put('/api/settings', s)),
  localModels: () => json<LocalModels>(fetch('/api/local-models')),
  saveVoice: (v: Partial<VoiceCfg>) => json<VoiceCfg>(put('/api/voice', v)),
  faqs: () => json<Faq[]>(fetch('/api/faqs')),
  projects: () => json<ProjectMeta[]>(fetch('/api/projects')),
  prompts: (slug: string) => json<PromptVersion[]>(fetch(`/api/projects/${encodeURIComponent(slug)}/prompts`)),
  promptArtifacts: (slug: string, version: string) =>
    json<Artifact[]>(fetch(`/api/projects/${encodeURIComponent(slug)}/prompts/${encodeURIComponent(version)}`)),
  renameProject: (slug: string, title: string) =>
    json<ProjectMeta>(fetch(`/api/projects/${encodeURIComponent(slug)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) })),
  deletePrompt: (slug: string, version: string) =>
    json<{ ok: boolean }>(fetch(`/api/projects/${encodeURIComponent(slug)}/prompts/${encodeURIComponent(version)}`, { method: 'DELETE' })),
  setPromptDone: (slug: string, version: string, done: boolean) =>
    json<{ done: string[] }>(put(`/api/projects/${encodeURIComponent(slug)}/prompts/${encodeURIComponent(version)}/done`, { done })),
  deleteProject: (slug: string) => json<{ ok: boolean }>(fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: 'DELETE' })),
}

/**
 * Audios sueltos (muestras de voz, respuestas de las FAQ). Pasan por el mismo
 * reproductor que la conversación, así el reactor late con ellas.
 */
let sampleGen = 0
async function playAudio(url: string, onEnd: () => void) {
  const gen = ++sampleGen
  const player = await unlockAudio()
  player.stop()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}`)
  const buf = await res.arrayBuffer()
  if (gen !== sampleGen) return
  player.onPlayingChange = (on) => { if (!on && gen === sampleGen) onEnd() }
  player.enqueue(buf)
}
/** Muestra de voz: Prometeo se presenta con esa voz. */
export const playSample = (voice: string, speed: number, onEnd: () => void) =>
  playAudio(`/api/voices/${voice}/sample?speed=${speed}`, onEnd)
/** Respuesta pregrabada de una pregunta frecuente. */
export const playFaq = (id: string, onEnd: () => void) => playAudio(`/api/faqs/${encodeURIComponent(id)}/audio`, onEnd)
export async function stopSample() {
  sampleGen++
  ;(await unlockAudio()).stop()
}
