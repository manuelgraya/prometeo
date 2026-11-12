/**
 * Panel de entregables de la conversación: pestañas por .md, copiar, descargar y leer a pantalla completa.
 * El prompt se lleva a la Forja desde `ForgeButton`, junto a la caja de texto, esté abierta la pestaña que esté.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '../i18n'
import type { Artifact, ProjectMeta } from '../session'
import { RepoField } from './AgentControls'
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, ExpandIcon } from './icons'

/** El prompt está listo cuando la versión vigente tiene prompt.md. */
export const hasPrompt = (artifacts: Artifact[]) => artifacts.some((a) => a.name === 'prompt.md')

export default function Artifacts({ artifacts, project }: { artifacts: Artifact[]; project: ProjectMeta | null }) {
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
  useEffect(() => { if (newest) setActive(newest) }, [newest])
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
  const doc = cur && <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{cur.content}</ReactMarkdown></div>

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
        {project && hasPrompt(artifacts) && (
          <RepoField slug={project.slug} repo={repo} onChange={(r) => setEdited({ slug: project.slug, repo: r })} />
        )}
        {tabs}
        <div className="body">{doc ?? <p className="empty">{t('deliverablesEmpty')}</p>}</div>
      </aside>
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
