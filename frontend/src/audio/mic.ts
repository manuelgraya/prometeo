import { MicVAD } from '@ricky0123/vad-web'
import { levels } from './levels'

interface MicCallbacks {
  /** La persona ha empezado a hablar de verdad (para barge-in). */
  onSpeechStart: () => void
  /** Frase completa, Float32 PCM a 16 kHz. */
  onUtterance: (audio: Float32Array) => void
  /** El VAD entra o sale de un tramo de voz (incluye falsos positivos). */
  onSpeechActive?: (active: boolean) => void
}

/** Micrófono manos libres con Silero VAD ejecutándose en el navegador. */
export class Mic {
  private vad: MicVAD | null = null
  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private raf = 0
  /** Mientras PROMETEO habla exigimos más confianza para evitar que se interrumpa con su propia voz. */
  private strict = false
  /** El VAD está dentro de un tramo de voz (aún no ha entregado la frase). */
  inSpeech = false

  private cb: MicCallbacks = { onSpeechStart: () => {}, onUtterance: () => {} }
  private starting: Promise<void> | null = null

  setCallbacks(cb: MicCallbacks) {
    this.cb = cb
  }

  async start() {
    this.starting ??= this.init()
    await this.starting
    await this.vad!.start()
  }

  private async init() {
    this.vad = await MicVAD.new({
      model: 'v5',
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.4,
      redemptionMs: 700,
      minSpeechMs: 300,
      preSpeechPadMs: 300,
      getStream: async () => {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
        })
        this.meter(this.stream)
        return this.stream
      },
      onSpeechStart: () => { this.inSpeech = true; this.cb.onSpeechActive?.(true) },
      onSpeechRealStart: () => this.cb.onSpeechStart(),
      onSpeechEnd: (audio) => { this.inSpeech = false; this.cb.onUtterance(audio); this.cb.onSpeechActive?.(false) },
      onVADMisfire: () => { this.inSpeech = false; this.cb.onSpeechActive?.(false) },
    })
  }

  /** Mientras PROMETEO habla, sube el umbral para que no se escuche a sí mismo. */
  setStrict(on: boolean) {
    if (!this.vad || on === this.strict) return
    this.strict = on
    this.vad.setOptions(on ? { positiveSpeechThreshold: 0.85, negativeSpeechThreshold: 0.6 } : { positiveSpeechThreshold: 0.6, negativeSpeechThreshold: 0.4 })
  }

  async pause() {
    await this.vad?.pause()
    this.inSpeech = false
    levels.mic = 0
  }

  private meter(stream: MediaStream) {
    this.ctx = new AudioContext()
    const an = this.ctx.createAnalyser()
    an.fftSize = 512
    this.ctx.createMediaStreamSource(stream).connect(an)
    const data = new Uint8Array(an.fftSize)
    const loop = () => {
      an.getByteTimeDomainData(data)
      let sum = 0
      for (const v of data) sum += ((v - 128) / 128) ** 2
      levels.mic = this.vad?.listening ? Math.min(1, Math.sqrt(sum / data.length) * 5) : 0
      this.raf = requestAnimationFrame(loop)
    }
    loop()
  }

  async dispose() {
    cancelAnimationFrame(this.raf)
    await this.vad?.destroy()
    this.stream?.getTracks().forEach((t) => t.stop())
    await this.ctx?.close()
    this.vad = null
    levels.mic = 0
  }
}
