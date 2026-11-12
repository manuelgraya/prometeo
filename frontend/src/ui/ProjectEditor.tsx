/**
 * Editar proyecto: título, prompts (marcar como hechos, borrar) y eliminar el proyecto.
 * Se abre con el lápiz de cada tarjeta de Proyectos y desde Entregables en la conversación.
 * La gestión de prompts es manual: PROMETEO no borra ni condensa prompts por su cuenta.
 */
import { useEffect, useState } from 'react'
import { api, type PromptVersion } from '../api'
import { t } from '../i18n'
import { CheckIcon, CloseIcon, TrashIcon } from './icons'

export default function ProjectEditor({ slug, title, onClose, onRenamed, onPromptsChanged, onDeleted }: {
  slug: string; title: string
  onClose: () => void
  onRenamed?: (title: string) => void
  onPromptsChanged?: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(title)
  const [saved, setSaved] = useState(title)
  const [prompts, setPrompts] = useState<PromptVersion[] | null>(null)
  const [asking, setAsking] = useState<string | null>(null)  // prompt<N> o «project» pendiente de confirmar
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.prompts(slug).then(setPrompts).catch(() => setPrompts([]))
  useEffect(() => { void load() }, [slug])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (asking) setAsking(null); else onClose() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [asking, onClose])

  const run = async (fn: () => Promise<unknown>, err: string) => {
    setBusy(true); setError(null)
    try { await fn(); return true } catch { setError(err); return false } finally { setBusy(false) }
  }
  const rename = async () => {
    const v = name.trim()
    if (!v || v === saved) return
    if (await run(() => api.renameProject(slug, v), t('edit.renameError'))) { setSaved(v); setName(v); onRenamed?.(v) }
  }
  const toggleDone = async (p: PromptVersion) => {
    if (await run(() => api.setPromptDone(slug, p.version, !p.done), t('edit.error'))) {
      setPrompts((l) => l?.map((x) => (x.version === p.version ? { ...x, done: !p.done } : x)) ?? null)
      onPromptsChanged?.()
    }
  }
  const removePrompt = async (v: string) => {
    setAsking(null)
    if (await run(() => api.deletePrompt(slug, v), t('edit.promptBusy'))) { await load(); onPromptsChanged?.() }
  }
  const removeProject = async () => {
    if (await run(() => api.deleteProject(slug), t('del.error'))) onDeleted()
  }

  const only = (prompts?.length ?? 0) <= 1
  return (
    <div className="reader-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="panel peditor" role="dialog" aria-modal="true" aria-label={t('edit.title')}>
        <header>
          {t('edit.title')}
          <span className="arttools">
            <button className="iconbtn ghost" onClick={onClose} title={t('close')} aria-label={t('close')}><CloseIcon /></button>
          </span>
        </header>
        <div className="body">
          <section className="pe-sec">
            <label className="pe-label" htmlFor="pe-title">{t('edit.name')}</label>
            <form className="pe-row" onSubmit={(e) => { e.preventDefault(); void rename() }}>
              <input id="pe-title" className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <button className="btn small" disabled={busy || !name.trim() || name.trim() === saved}>{t('edit.save')}</button>
            </form>
          </section>

          <section className="pe-sec">
            <div className="pe-label">{t('edit.prompts')}</div>
            {prompts === null && <p className="empty">{t('loading')}</p>}
            <ul className="pe-prompts">
              {prompts && [...prompts].reverse().map((p) => (
                <li key={p.version} className={p.done ? 'done' : ''}>
                  <div className="pe-prompt">
                    <span className="ver">{p.version}</span>
                    <span className="t">
                      {p.title ?? t('ag.noPromptYet')}
                      {p.others.length > 0 && <small>{p.others.join(' · ')}</small>}
                    </span>
                    {p.version === prompts.at(-1)?.version && <span className="tag">{t('ag.latest')}</span>}
                    <button className={`btn secondary small pe-done ${p.done ? 'on' : ''}`} disabled={busy} aria-pressed={p.done}
                      onClick={() => toggleDone(p)}>
                      {p.done ? <><CheckIcon /> {t('edit.done')}</> : t('edit.markDone')}
                    </button>
                    <button className="iconbtn ghost pe-del" disabled={busy || only}
                      title={only ? t('edit.onlyPrompt') : t('edit.deletePrompt')} aria-label={t('edit.deletePrompt')}
                      onClick={() => setAsking(p.version)}><TrashIcon size={16} /></button>
                  </div>
                  {asking === p.version && (
                    <div className="confirm pe-confirm" role="alertdialog" aria-label={t('edit.deletePrompt')}>
                      <span>{t('edit.confirmPrompt', { v: p.version })}</span>
                      <button className="btn small danger" onClick={() => removePrompt(p.version)} autoFocus>{t('del.yes')}</button>
                      <button className="btn secondary small" onClick={() => setAsking(null)}>{t('del.no')}</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="pe-sec pe-danger">
            <div className="pe-label">{t('del.ask')}</div>
            {asking === 'project' ? (
              <div className="confirm pe-confirm" role="alertdialog" aria-label={t('del.ask')}>
                <span>{t('del.confirm', { title: saved })}</span>
                <button className="btn small danger" onClick={removeProject} autoFocus>{t('del.yes')}</button>
                <button className="btn secondary small" onClick={() => setAsking(null)}>{t('del.no')}</button>
              </div>
            ) : (
              <div className="pe-row">
                <p>{t('edit.deleteHint')}</p>
                <button className="btn small danger" disabled={busy} onClick={() => setAsking('project')}>{t('del.yes')}</button>
              </div>
            )}
          </section>
          {error && <p className="pe-error" role="alert">{error}</p>}
        </div>
      </section>
    </div>
  )
}
