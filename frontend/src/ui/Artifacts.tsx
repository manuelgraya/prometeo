/** Panel de entregables de la conversación: pestañas por .md, copiar, descargar y EJECUTAR el prompt. */
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { t } from '../i18n'
import type { AgentRef } from '../routes'
import type { Artifact, ProjectMeta } from '../session'
import { RepoField, RunButton } from './AgentControls'

export default function Artifacts({ artifacts, project, onRun }: {
  artifacts: Artifact[]; project: ProjectMeta | null; onRun: (a: AgentRef) => void
}) {
  // El repo cambiado aquí manda sobre el de la sesión hasta que se cambie de proyecto.
  const [edited, setEdited] = useState<{ slug: string; repo: string | null } | null>(null)
  const repo = edited && edited.slug === project?.slug ? edited.repo : project?.repo
  const [active, setActive] = useState<string | null>(null)
  // COPIADO pertenece a una pestaña concreta: al cambiar de .md vuelve a COPIAR.
  const [copiedFor, setCopiedFor] = useState<string | null>(null)
  const copyTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimer.current), [])
  // Al llegar un entregable nuevo o actualizado, se abre su pestaña.
  const newest = useMemo(() => artifacts.reduce<Artifact | null>((a, b) => (!a || b.mtime > a.mtime ? b : a), null)?.name ?? null, [artifacts])
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
  const isPrompt = cur?.name === 'prompt.md' && project

  return (
    <aside className="panel right">
      <header>
        {t('deliverables')}
        {cur && (
          <span style={{ display: 'flex', gap: 6 }}>
            {isPrompt && <RunButton slug={project.slug} onLaunched={onRun} />}
            <button className="btn secondary small" onClick={copy}>{copiedFor === cur.name ? t('copied') : t('copy')}</button>
            <button className="btn secondary small" onClick={download}>.MD</button>
          </span>
        )}
      </header>
      {isPrompt && <RepoField slug={project.slug} repo={repo} onChange={(r) => setEdited({ slug: project.slug, repo: r })} />}
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
