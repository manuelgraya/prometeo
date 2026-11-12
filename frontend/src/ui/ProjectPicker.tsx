/** «PROYECTO  Título ▾»: desplegable con los proyectos disponibles. Lo usan la Forja y la conversación (sin xterm). */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { t } from '../i18n'
import type { ProjectMeta } from '../session'

export default function ProjectPicker({ project, title, onProject, allowAll, extra, footer }: {
  project: string | null; title: string | null
  onProject: (slug: string | null) => void
  /** Ofrece «Todos los proyectos» (la Forja). */
  allowAll?: boolean
  /** Acción destacada arriba del menú (p. ej. abrir la conversación del proyecto). */
  extra?: { label: string; onClick: () => void }
  /** Contenido al pie del menú. */
  footer?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<ProjectMeta[] | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    api.projects().then(setItems).catch(() => setItems([]))
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const pick = (slug: string | null) => { setOpen(false); if (slug !== project) onProject(slug) }
  return (
    <div className="pjpick" ref={root}>
      <button className={`pjbtn ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="label">{t('ag.project')}</span>
        <span className="val">{title ?? t('ag.allProjects')}</span>
        <span className="chev" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pjmenu" role="menu">
          {extra && (
            <button role="menuitem" className="pjopen" onClick={() => { setOpen(false); extra.onClick() }}>{extra.label}</button>
          )}
          <div className="sep">{t('ag.switchProject')}</div>
          <div className="list">
            {items === null && <p className="empty">{t('loading')}</p>}
            {items?.map((p) => (
              <button key={p.slug} role="menuitemradio" aria-checked={p.slug === project}
                className={p.slug === project ? 'current' : ''} onClick={() => pick(p.slug)}>
                <span className="t">{p.title}</span>
                {!!p.agents && <span className="n" title={t('ag.title')}>{p.agents}</span>}
              </button>
            ))}
            {allowAll && (
              <button role="menuitemradio" aria-checked={project === null} className={project === null ? 'current' : ''}
                onClick={() => pick(null)}>
                <span className="t">{t('ag.allProjects')}</span>
              </button>
            )}
          </div>
          {footer && <div className="pjfoot">{footer}</div>}
        </div>
      )}
    </div>
  )
}
