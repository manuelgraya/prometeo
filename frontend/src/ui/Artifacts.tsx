/**
 * Panel de entregables de la conversación: pestañas por .md, copiar, descargar y leer a pantalla completa.
 * Un proyecto puede tener varios prompts (prompts/prompt1, prompt2...): el desplegable PROMPT elige cuál se ve
 * aquí y cuál se lleva a la Forja con el botón de junto a la caja de texto, esté abierta la pestaña que esté.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, type PromptVersion } from '../api'
import { t } from '../i18n'
import type { Artifact, ProjectMeta } from '../session'
import { RepoField } from './AgentControls'
import ProjectPicker, { PromptPicker } from './ProjectPicker'
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, ExpandIcon, PencilIcon } from './icons'
import ProjectEditor from './ProjectEditor'

const stripFrontmatter = (md: string) => md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')

/** El prompt está listo cuando la versión vigente tiene prompt.md. */
export const hasPrompt = (artifacts: Artifact[]) => artifacts.some((a) => a.name === 'prompt.md')

export interface PromptView {
  versions: PromptVersion[]
  /** Versión que se ve (null si aún no se sabe: la vigente). */
  viewing: string | null
  /** Versión anterior elegida a mano, que es la que se lleva a la Forja; null = la vigente, como siempre. */
  chosen: string | null
  latest: string | null
  artifacts: Artifact[]
  pick: (version: string) => void
  /** Vuelve a pedir la lista (tras editar el proyecto). */
  reload: () => void
}

/** Qué prompt del proyecto se está viendo. Los entregables de la vigente llegan en vivo por la sesión; los de
 *  una anterior se piden al elegirla. Si aparece una versión nueva (Prometeo ha escrito otro prompt), se vuelve
 *  a la vigente para verla llegar. */
export function usePromptView(slug: string | undefined, live: Artifact[]): PromptView {
  const [list, setList] = useState<{ slug: string; versions: PromptVersion[] } | null>(null)
  const [picked, setPicked] = useState<{ slug: string; version: string; latest: string | null } | null>(null)
  const [old, setOld] = useState<{ key: string; artifacts: Artifact[] } | null>(null)
  const [bump, setBump] = useState(0)
  // Cada entrega en vivo puede traer una versión nueva: se refresca la lista
  const liveKey = live.map((a) => `${a.name}:${a.mtime}`).join('|')
  useEffect(() => {
    if (!slug) return
    let on = true
    api.prompts(slug).then((v) => { if (on) setList({ slug, versions: v }) }).catch(() => { if (on) setList({ slug, versions: [] }) })
    return () => { on = false }
  }, [slug, liveKey, bump])
  const versions = list && list.slug === slug ? list.versions : []
  const latest = versions.at(-1)?.version ?? null
  const chosen = picked && picked.slug === slug && picked.latest === latest && picked.version !== latest ? picked.version : null
  const key = slug && chosen ? `${slug}/${chosen}` : null
  useEffect(() => {
    if (!slug || !chosen) return
    let on = true
    const k = `${slug}/${chosen}`
    api.promptArtifacts(slug, chosen)
      .then((a) => { if (on) setOld({ key: k, artifacts: a }) })
      .catch(() => { if (on) setOld({ key: k, artifacts: [] }) })
    return () => { on = false }
  }, [slug, chosen])
  return {
    versions, latest, chosen, viewing: chosen ?? latest,
    artifacts: key ? (old?.key === key ? old.artifacts : []) : live,
    pick: (version) => { if (slug) setPicked({ slug, version, latest }) },
    reload: () => setBump((n) => n + 1),
  }
}

export default function Artifacts({ artifacts, project, onProject, prompts, onRenamed, onDeleted }: {
  artifacts: Artifact[]; project: ProjectMeta | null; onProject: (slug: string) => void; prompts?: PromptView
  onRenamed?: (title: string) => void; onDeleted?: () => void
}) {
  const [editing, setEditing] = useState(false)
  // El repo cambiado aquí manda sobre el de la sesión hasta que se cambie de proyecto.
  const [edited, setEdited] = useState<{ slug: string; repo: string | null } | null>(null)
  const repo = edited && edited.slug === project?.slug ? edited.repo : project?.repo
  const [active, setActive] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  // El check de copiado pertenece a una pestaña concreta: al cambiar de .md vuelve el icono de copiar.
  const [copiedFor, setCopiedFor] = useState<string | null>(null)
  const copyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  // Al llegar un entregable nuevo o actualizado, se abre su pestaña.
  const newest = useMemo(() => artifacts.reduce<Artifact | null>((a, b) => (!a || b.mtime > a.mtime ? b : a), null)?.name ?? null, [artifacts])
  // Al mirar un prompt anterior se abre su prompt.md (lo más reciente suele ser context.md, que es de la Vault).
  const older = prompts?.chosen ?? null
  useEffect(() => { if (older) setActive('prompt.md'); else if (newest) setActive(newest) }, [newest, older])
  const cur = artifacts.find((a) => a.name === active) ?? artifacts[0]

  useEffect(() => {
    if (!reading) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setReading(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reading])

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

  const copied = copiedFor === cur?.name
  const tools = cur && (
    <>
      <button className={`iconbtn ghost ${copied ? 'done' : ''}`} onClick={copy} title={copied ? t('copied') : t('copy')} aria-label={copied ? t('copied') : t('copy')}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
      <button className="iconbtn ghost" onClick={download} title={t('download', { name: cur.name })} aria-label={t('download', { name: cur.name })}>
        <DownloadIcon />
      </button>
    </>
  )
  const tabs = artifacts.length > 0 && (
    <div className="tabs" role="tablist">
      {artifacts.map((a) => (
        <button key={a.name} role="tab" aria-selected={a.name === cur?.name} className={`tab ${a.name === cur?.name ? 'active' : ''}`}
          onClick={() => setActive(a.name)}>{a.name}</button>
      ))}
    </div>
  )
  // El frontmatter YAML (context.md) no es markdown: se quita al mostrarlo (copiar y descargar lo conservan).
  const doc = cur && <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{stripFrontmatter(cur.content)}</ReactMarkdown></div>

  return (
    <>
      <aside className="panel right">
        <header>
          {t('deliverables')}
          {cur && (
            <span className="arttools">
              {tools}
              <button className="iconbtn ghost" onClick={() => setReading(true)} title={t('read')} aria-label={t('read')}><ExpandIcon /></button>
            </span>
          )}
        </header>
        {project && (
          // Proyecto de la conversación: cambiarlo abre la conversación del otro. Al pie, dónde trabajan sus agentes.
          <div className="artproject">
            <div className="pjrow">
              <ProjectPicker project={project.slug} title={project.title} onProject={(slug) => slug && onProject(slug)}
                footer={<RepoField slug={project.slug} repo={repo} onChange={(r) => setEdited({ slug: project.slug, repo: r })} />} />
              {onDeleted && (
                <button className="iconbtn ghost" onClick={() => setEditing(true)} title={t('edit.open')} aria-label={t('edit.open')}>
                  <PencilIcon size={16} />
                </button>
              )}
            </div>
            {prompts && prompts.versions.length > 0 && (
              <PromptPicker versions={prompts.versions} current={prompts.viewing} latest={prompts.latest} onPick={prompts.pick} />
            )}
          </div>
        )}
        {tabs}
        <div className="body">{doc ?? <p className="empty">{t('deliverablesEmpty')}</p>}</div>
      </aside>
      {editing && project && onDeleted && (
        <ProjectEditor slug={project.slug} title={project.title} onClose={() => setEditing(false)}
          onRenamed={onRenamed} onPromptsChanged={prompts?.reload} onDeleted={() => { setEditing(false); onDeleted() }} />
      )}
      {reading && cur && (
        <div className="reader-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setReading(false) }}>
          <section className="panel reader" role="dialog" aria-modal="true" aria-label={cur.name}>
            <header>
              {t('deliverables')}
              <span className="arttools">
                {tools}
                <button className="iconbtn ghost" onClick={() => setReading(false)} title={t('close')} aria-label={t('close')} autoFocus><CloseIcon /></button>
              </span>
            </header>
            {tabs}
            <div className="body">{doc}</div>
          </section>
        </div>
      )}
    </>
  )
}
