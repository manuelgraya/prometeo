/** Las dos pantallas de botones grandes: la primera vez (Comenzar) y la de siempre (Inicio). */
import { useEffect, useRef, useState } from 'react'
import CosmicButton from '../ui/CosmicButton'
import { t } from '../i18n'
import { unlockAudio } from '../session'
import type { SetReactor } from './common'

/* ---------------- 01 · Primera vez ---------------- */
export function Comenzar({ setReactor, onStart, onChoose }: { setReactor: SetReactor; onStart: () => void; onChoose: () => void }) {
  useEffect(() => { setReactor({ variant: 'despertar', energy: 'idle', offsetY: 60 }) }, [setReactor])
  return (
    <>
      <div className="status">{t('firstSetup')}</div>
      <div className="actions">
        <CosmicButton primary onClick={async () => { await unlockAudio(); onStart() }}>{t('begin')}</CosmicButton>
        <CosmicButton onClick={async () => { await unlockAudio(); onChoose() }}>{t('chooseVoice')}</CosmicButton>
      </div>
    </>
  )
}

/* ---------------- 03 · Inicio ---------------- */
export function Inicio({ setReactor, onStart, onOpen }: {
  setReactor: SetReactor; onStart: (title: string) => void; onOpen: () => void
}) {
  useEffect(() => { setReactor({ variant: 'reposo', energy: 'idle', offsetY: 80 }) }, [setReactor])
  // EMPEZAR pide primero el nombre del proyecto; sin nombre, Prometeo lo saca del primer mensaje.
  const [naming, setNaming] = useState(false)
  const [title, setTitle] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { if (naming) input.current?.focus() }, [naming])
  const go = async (name: string) => { await unlockAudio(); onStart(name.trim()) }
  if (naming) {
    return (
      <form className="actions naming" onSubmit={(e) => { e.preventDefault(); void go(title) }}>
        <label htmlFor="pjname">{t('nameAsk')}</label>
        <input id="pjname" ref={input} value={title} maxLength={80} autoComplete="off" spellCheck={false}
          placeholder={t('namePlaceholder')} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') setNaming(false) }} />
        <CosmicButton primary type="submit" disabled={!title.trim()}>{t('start')}</CosmicButton>
        <button type="button" className="btn secondary small" onClick={() => void go('')}>{t('nameAuto')}</button>
        <p className="hint">{t('nameHint')}</p>
      </form>
    )
  }
  return (
    <div className="actions">
      <CosmicButton primary onClick={() => setNaming(true)}>{t('start')}</CosmicButton>
      <CosmicButton onClick={onOpen}>{t('openProject')}</CosmicButton>
    </div>
  )
}
