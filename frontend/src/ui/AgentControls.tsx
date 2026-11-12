/** Controles de agentes fuera del gestor (panel de entregables): sin xterm, para no cargarlo con la conversación. */
import { useState, type ReactNode } from 'react'
import { agentsApi, AgentError, type AgentInfo } from '../agents'
import { t } from '../i18n'

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

/** Lanza el agente de la versión vigente con su prompt.md escrito en la terminal y lleva a la Forja. */
export function RunButton({ slug, onLaunched, label, icon }: {
  slug: string; onLaunched: (a: AgentInfo) => void; label?: string; icon?: ReactNode
}) {
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
      <button className="btn small run" onClick={run} disabled={busy} title={t('ag.runHint')} aria-label={label ?? t('ag.run')}>
        {busy ? t('ag.running') : <>{icon ?? '▶'} <span className="lbl">{label ?? t('ag.run')}</span></>}
      </button>
      {error && <div className="toast">{error}</div>}
    </>
  )
}
