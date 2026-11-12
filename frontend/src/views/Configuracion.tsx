/** CONFIGURACIÓN (la tuerca de arriba a la derecha): agrupa Ajustes y Voces en pestañas. */
import { t } from '../i18n'

export type ConfigTab = 'ajustes' | 'voces'

const TABS = [
  { id: 'ajustes', label: 'cfg.general' },
  { id: 'voces', label: 'cfg.voices' },
] as const satisfies readonly { id: ConfigTab; label: string }[]

/** Pestañas que hacen de título en la cabecera de Ajustes y de Voces. */
export function ConfigTabs({ current, onTab }: { current: ConfigTab; onTab: (tab: ConfigTab) => void }) {
  return (
    <div className="cfgtabs" role="tablist" aria-label={t('cfg.title')}>
      {TABS.map((tab) => (
        <button key={tab.id} role="tab" aria-selected={current === tab.id} className={current === tab.id ? 'active' : ''}
          onClick={() => current !== tab.id && onTab(tab.id)}>
          {t(tab.label)}
        </button>
      ))}
    </div>
  )
}
