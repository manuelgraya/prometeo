/** Vistas de la app y su ruta en el hash de la URL (atrás/adelante del navegador). */

export type View =
  | { name: 'loading' }
  | { name: 'comenzar' }
  | { name: 'voz' }
  | { name: 'inicio' }
  | { name: 'proyectos' }
  | { name: 'voces' }
  | { name: 'ajustes' }
  | { name: 'faq' }
  | { name: 'conversacion'; project: string | null; key: number }
  | { name: 'agentes'; slug: string | null; version: string | null }

/** Un agente del gestor: la versión del prompt (prompt<N>) de un proyecto. */
export interface AgentRef { slug: string; version: string }

const SIMPLE = ['comenzar', 'voz', 'inicio', 'proyectos', 'voces', 'ajustes', 'faq'] as const
const isSimple = (name: string | null): name is (typeof SIMPLE)[number] => (SIMPLE as readonly (string | null)[]).includes(name)

/** Rutas: #/inicio, #/proyectos, #/voces, #/ajustes, #/faq, #/voz, #/comenzar, #/conversacion[/slug], #/agentes/slug[/version] */
export function parseHash(): View | null {
  const raw = location.hash.replace(/^#\/?/, '')
  // Compatibilidad con el atajo antiguo: #view=conversacion&project=slug
  if (raw.startsWith('view=')) {
    const q = new URLSearchParams(raw)
    const name = q.get('view')
    if (name === 'conversacion') return { name, project: q.get('project'), key: Date.now() }
    return isSimple(name) ? { name } : null
  }
  const [name, arg, arg2] = raw.split('/')
  if (name === 'conversacion') return { name, project: arg ? decodeURIComponent(arg) : null, key: Date.now() }
  // Gestor de agentes de un proyecto (y el agente elegido). Sin proyecto, todos los agentes.
  if (name === 'agentes') return { name, slug: arg ? decodeURIComponent(arg) : null, version: arg && arg2 ? decodeURIComponent(arg2) : null }
  return isSimple(name) ? { name } : null
}

export function hashOf(v: View): string {
  if (v.name === 'loading') return ''
  if (v.name === 'conversacion') return `#/conversacion${v.project ? '/' + encodeURIComponent(v.project) : ''}`
  if (v.name === 'agentes') {
    return `#/agentes${v.slug ? '/' + encodeURIComponent(v.slug) : ''}${v.slug && v.version ? '/' + encodeURIComponent(v.version) : ''}`
  }
  return `#/${v.name}`
}
