/** Las dos pantallas de botones grandes: la primera vez (Comenzar) y la de siempre (Inicio). */
import { useEffect } from 'react'
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
export function Inicio({ setReactor, onStart, onOpen }: { setReactor: SetReactor; onStart: () => void; onOpen: () => void }) {
  useEffect(() => { setReactor({ variant: 'reposo', energy: 'idle', offsetY: 80 }) }, [setReactor])
  return (
    <div className="actions">
      <CosmicButton primary onClick={async () => { await unlockAudio(); onStart() }}>{t('start')}</CosmicButton>
      <CosmicButton onClick={onOpen}>{t('openProject')}</CosmicButton>
    </div>
  )
}
