/* ---------------- 07 · Ajustes ---------------- */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, playSample, stopSample, type AppState, type LocalModels, type Settings } from '../api'
import { useToast } from '../hooks'
import { t, type Lang } from '../i18n'
import { THEMES, useTheme } from '../theme'
import { Row, Segmented, Toast } from '../ui/controls'
import { ConfigTabs, type ConfigTab } from './Configuracion'
import { pageReactor, type SetReactor } from './common'

const DEVICE_LABELS = { cpu: 'CPU', cuda: 'GPU' } as const
const LOCAL = 'local:'

/** Modelo de Claude (botones) o local de LM Studio (botón LOCAL + desplegable). */
function ModelPicker({ label, value, claude, local, onChange }: {
  label: string; value: string; claude: string[]; local: LocalModels | null; onChange: (v: string) => void
}) {
  const isLocal = value.startsWith(LOCAL)
  const id = isLocal ? value.slice(LOCAL.length) : ''
  const models = local?.models ?? []
  const pick = (o: string) => {
    if (o !== 'local') return onChange(o)
    const first = models.find((m) => m.loaded) ?? models[0]
    if (first) onChange(LOCAL + first.id)
  }
  return (
    <div className="model-pick">
      <Segmented label={label} value={isLocal ? 'local' : value} options={[...claude, 'local']} labels={{ local: t('set.localBtn') }}
        isDisabled={(o) => o === 'local' && !isLocal && !models.length} onChange={pick} />
      {isLocal && (
        <select className="select" value={id} aria-label={`${label} · ${t('set.localBtn')}`}
          onChange={(e) => onChange(LOCAL + e.target.value)}>
          {!models.some((m) => m.id === id) && <option value={id}>{id} · {t('set.localMissing')}</option>}
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}{m.params ? ` · ${m.params}` : ''}{m.loaded ? ` · ${t('set.localLoaded')}` : ''}</option>
          ))}
        </select>
      )}
    </div>
  )
}

export default function Ajustes({ setReactor, lang, setLang, onTab, onVoices, onTalk, onReset }: {
  setReactor: SetReactor; lang: Lang; setLang: (l: Lang) => void; onTab: (tab: ConfigTab) => void
  onVoices: () => void; onTalk: () => void; onReset: () => void
}) {
  const [state, setState] = useState<AppState | null>(null)
  const [theme, setTheme] = useTheme()
  const [speed, setSpeed] = useState(1)
  const [testing, setTesting] = useState(false)
  const [toast, flash] = useToast(2500)
  const speedTimer = useRef<number | undefined>(undefined)
  const [local, setLocal] = useState<LocalModels | null>(null)
  const [url, setUrl] = useState('')
  const [checking, setChecking] = useState(false)

  const checkLocal = useCallback(async () => {
    setChecking(true)
    try {
      const r = await api.localModels()
      setLocal(r)
      setUrl(r.url)
    } catch {
      setLocal(null)
    } finally {
      setChecking(false)
    }
  }, [])
  useEffect(() => { void checkLocal() }, [checkLocal])

  const refresh = useCallback(() => api.state().then((s) => { setState(s); return s }), [])
  useEffect(() => { refresh().then((s) => setSpeed(s.voice.speed)).catch(() => flash(t('set.error'), true, 0)) }, [refresh, flash])
  useEffect(() => { setReactor(pageReactor(testing)) }, [testing, setReactor])
  useEffect(() => () => { void stopSample(); clearTimeout(speedTimer.current) }, [])

  // Mientras se recarga un modelo (cambio CPU/GPU), consultamos el estado hasta que termine.
  const loading = state?.runtime.loading.length ? state.runtime.loading.join() : ''
  useEffect(() => {
    if (!loading) return
    const id = setInterval(() => { void refresh() }, 1200)
    return () => clearInterval(id)
  }, [loading, refresh])

  const update = async (patch: Partial<Settings>) => {
    if (!state) return
    setState({ ...state, settings: { ...state.settings, ...patch } })
    try {
      const r = await api.saveSettings(patch)
      setState((s) => (s ? { ...s, settings: r.settings, runtime: r.runtime } : s))
      flash(t('set.saved'))
    } catch {
      flash(t('set.error'), true)
      void refresh()
    }
  }

  const changeSpeed = (v: number) => {
    setSpeed(v)
    clearTimeout(speedTimer.current)
    speedTimer.current = window.setTimeout(() => {
      api.saveVoice({ speed: v }).then((voice) => setState((s) => (s ? { ...s, voice } : s))).catch(() => flash(t('set.error'), true))
    }, 400)
  }

  const test = async () => {
    if (!state) return
    if (testing) { setTesting(false); await stopSample(); return }
    try {
      setTesting(true)
      await playSample(state.voice.voice, speed, () => setTesting(false))
    } catch {
      setTesting(false)
      flash(t('sampleError'), true)
    }
  }

  const reset = async () => {
    try {
      await api.saveVoice({ configured: false })
      onReset()
    } catch {
      flash(t('set.error'), true)
    }
  }

  if (!state) return <div className="page"><p className="empty">{t('loading')}</p><Toast toast={toast} /></div>

  const { settings, choices, capabilities: caps, runtime } = state
  const voiceInfo = state.voices[state.voice.voice]
  const deviceStatus = (which: 'tts' | 'stt') => {
    const rt = runtime[which]
    if (runtime.loading.includes(which)) return <span className="status-line">{t('set.loading')}</span>
    if (!rt) return null
    return (
      <>
        <span className="status-line">{t('set.active', { device: DEVICE_LABELS[rt.device as 'cpu' | 'cuda'] ?? rt.device })}</span>
        {rt.error && settings[`${which}_device`] === 'cuda' && <span className="status-line warn">{rt.error}</span>}
      </>
    )
  }

  return (
    <div className="page">
      <div className="page-head"><ConfigTabs current="ajustes" onTab={onTab} /></div>
      <div className="list settings">
        <section>
          <h3 className="group">{t('set.voice')}</h3>
          <Row label={t('set.voiceCurrent')} hint={voiceInfo ? `${voiceInfo.name} · ${voiceInfo.desc}${voiceInfo.accent ? ` · ${t('accent', { accent: voiceInfo.accent })}` : ''}` : state.voice.voice}>
            <button className="btn secondary small" onClick={test}>{testing ? `■ ${t('stop')}` : `▶ ${t('set.test')}`}</button>
          </Row>
          <Row label={`${t('speed')} · ${speed.toFixed(2)}×`}>
            <input className="range" type="range" min={0.8} max={1.3} step={0.05} value={speed}
              onChange={(e) => changeSpeed(Number(e.target.value))} aria-label={t('speed')} />
          </Row>
          <div className="row-buttons">
            <button className="btn secondary small" onClick={onVoices}>{t('set.change')}</button>
            <button className="btn secondary small" onClick={onTalk}>{t('set.talk')}</button>
          </div>
        </section>

        <section>
          <h3 className="group">{t('set.perf')}</h3>
          <Row label={t('set.tts')} hint={<>{!caps.tts_cuda && <>{t('set.noCudaTts')} </>}{deviceStatus('tts')}</>}>
            <Segmented label={t('set.tts')} value={settings.tts_device} options={['cpu', 'cuda'] as const} labels={DEVICE_LABELS}
              isDisabled={(o) => o === 'cuda' && !caps.tts_cuda && settings.tts_device !== 'cuda'}
              onChange={(v) => update({ tts_device: v })} />
          </Row>
          <Row label={t('set.stt')} hint={<>{!caps.stt_cuda && <>{t('set.noCudaStt')} </>}{deviceStatus('stt')}</>}>
            <Segmented label={t('set.stt')} value={settings.stt_device} options={['cpu', 'cuda'] as const} labels={DEVICE_LABELS}
              isDisabled={(o) => o === 'cuda' && !caps.stt_cuda && settings.stt_device !== 'cuda'}
              onChange={(v) => update({ stt_device: v })} />
          </Row>
          <Row label={t('set.whisper')} hint={t('set.whisperHint')}>
            <Segmented label={t('set.whisper')} value={settings.whisper_model} options={choices.whisper_model} onChange={(v) => update({ whisper_model: v })} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.brain')}</h3>
          <Row label={t('set.model')} hint={t('set.modelHint')}>
            <ModelPicker label={t('set.model')} value={settings.claude_model} claude={choices.claude_model} local={local} onChange={(v) => update({ claude_model: v })} />
          </Row>
          <Row label={t('set.effort')} hint={t('set.nextSession')}>
            <Segmented label={t('set.effort')} value={settings.effort} options={choices.effort}
              labels={{ low: t('effort.low'), medium: t('effort.medium'), high: t('effort.high') }}
              onChange={(v) => update({ effort: v })} />
          </Row>
          <Row label={t('set.architectModel')} hint={t('set.architectHint')}>
            <ModelPicker label={t('set.architectModel')} value={settings.architect_model} claude={choices.architect_model} local={local} onChange={(v) => update({ architect_model: v })} />
          </Row>
          <Row label={t('set.architectEffort')} hint={t('set.nextSession')}>
            <Segmented label={t('set.architectEffort')} value={settings.architect_effort} options={choices.architect_effort}
              labels={{ medium: t('effort.medium'), high: t('effort.high'), xhigh: t('effort.xhigh'), max: t('effort.max') }}
              onChange={(v) => update({ architect_effort: v })} />
          </Row>
          <Row label={t('set.titleModel')} hint={t('set.titleHint')}>
            <ModelPicker label={t('set.titleModel')} value={settings.title_model} claude={choices.title_model} local={local} onChange={(v) => update({ title_model: v })} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.local')}</h3>
          <Row label={t('set.localServer')} hint={
            checking ? <span className="status-line">{t('set.localChecking')}</span>
              : local?.reachable ? <span className="status-line">{t('set.localOk', { n: String(local.models.length) })}</span>
                : <span className="status-line warn">{t('set.localDown')}</span>
          }>
            <form className="row-ctl" onSubmit={(e) => {
              e.preventDefault()
              void (url.trim() && url.trim() !== settings.lmstudio_url ? update({ lmstudio_url: url.trim() }) : Promise.resolve()).then(checkLocal)
            }}>
              <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} spellCheck={false}
                aria-label={t('set.localServer')} placeholder="http://localhost:1234" />
              <button className="btn secondary small" type="submit" disabled={checking}>{t('set.localCheck')}</button>
            </form>
          </Row>
          <Row label={t('set.localContext')} hint={t('set.localContextHint')}>
            <Segmented label={t('set.localContext')} value={settings.local_context} options={choices.local_context}
              labels={{ '8192': '8K', '16384': '16K', '32768': '32K', '65536': '64K' }}
              onChange={(v) => update({ local_context: v })} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.ui')}</h3>
          <Row label={t('set.lang')} hint={t('langHint')}>
            <Segmented label={t('langLabel')} value={lang} options={['es', 'en'] as const} labels={{ es: 'ES', en: 'EN' }} onChange={setLang} />
          </Row>
          <Row label={t('set.theme')} hint={t('set.themeHint')}>
            <Segmented label={t('set.theme')} value={theme.id} options={THEMES}
              labels={{ original: t('theme.original'), rosa: t('theme.rosa') }} onChange={setTheme} />
          </Row>
        </section>

        <section>
          <h3 className="group">{t('set.reset')}</h3>
          <Row label={t('set.resetHint')}>
            <button className="btn secondary small" onClick={reset}>{t('set.resetBtn')}</button>
          </Row>
        </section>
      </div>
      <Toast toast={toast} />
    </div>
  )
}
