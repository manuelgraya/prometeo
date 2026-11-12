/* ---------------- 09 · Gestor de agentes ---------------- */
import { useCallback, useEffect, useState } from 'react'
import type { AgentRef } from '../routes'
import Agentes from '../ui/Agentes'
import { reactorAt, type CoreSpot, type SetReactor } from './common'

/**
 * Gestor de los agentes de un proyecto. Prometeo (el reactor de la escena) se coloca en el centro de la
 * constelación, arriba a la izquierda; tras EJECUTAR, el salto lo trae hasta ahí desde el centro de la pantalla.
 */
export default function Gestor({ setReactor, project, version, onSelect, onBack }: {
  setReactor: SetReactor; project: string | null; version: string | null
  onSelect: (a: AgentRef) => void; onBack: () => void
}) {
  const [spot, setSpot] = useState<CoreSpot | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const energy = busy ? 'thinking' : 'idle'
    // Sin constelación (pantalla estrecha): arriba, pequeño, como en las demás páginas
    setReactor(spot ? { variant: 'escuchando', energy, ...reactorAt(spot) } : { variant: 'reposo', energy, offsetY: -260, scale: 0.55 })
  }, [spot, busy, setReactor])
  const onCore = useCallback((s: CoreSpot | null) => setSpot(s), [])
  return <Agentes project={project} version={version} onSelect={onSelect} onCore={onCore} onActive={setBusy} onBack={onBack} />
}
