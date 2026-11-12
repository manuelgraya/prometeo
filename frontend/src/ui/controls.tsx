/** Controles pequeños compartidos: botones segmentados, filas de ajustes y avisos. */
import type { ReactNode } from 'react'
import type { ToastMsg } from '../hooks'

export function Segmented<T extends string>({ value, options, onChange, label, labels, isDisabled }: {
  value: T; options: readonly T[]; onChange: (v: T) => void; label: string
  labels?: Partial<Record<T, string>>; isDisabled?: (v: T) => boolean
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {(options ?? []).map((o) => (
        <button key={o} role="radio" aria-checked={value === o} className={value === o ? 'active' : ''}
          disabled={isDisabled?.(o)} onClick={() => value !== o && onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="row">
      <div className="row-label">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <div className="row-ctl">{children}</div>
    </div>
  )
}

/** Aviso de useToast: rojo si es un error, informativo si no. */
export function Toast({ toast }: { toast: ToastMsg | null }) {
  if (!toast) return null
  return <div className={`toast ${toast.error ? '' : 'info'}`}>{toast.msg}</div>
}
