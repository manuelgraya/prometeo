import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Bloom, EffectComposer } from '@react-three/postprocessing'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { levels } from '../audio/levels'
import { intro, introState, now } from '../intro'
import { theme, useTheme, type ScenePalette } from '../theme'
import { warpSpeed } from '../warp'

export type ReactorVariant = 'despertar' | 'escuchando' | 'reposo'
export type Energy = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface ReactorProps {
  variant: ReactorVariant
  energy: Energy
  /** Desplazamiento horizontal del reactor en px desde el centro (positivo = hacia la derecha). */
  offsetX?: number
  /** Desplazamiento vertical del reactor en px (positivo = hacia arriba). */
  offsetY?: number
  /** Escala relativa (1 = tamaño de las vistas de Figma). */
  scale?: number
}

const v3 = (c: [number, number, number]) => new THREE.Vector3(...c)
/** Copia la paleta del tema activo en los uniforms de color (se llama cada frame: es barato). */
function setColors(u: Record<string, THREE.IUniform>, pairs: Record<string, keyof ScenePalette>) {
  const pal = theme().scene
  for (const [name, key] of Object.entries(pairs)) (u[name].value as THREE.Vector3).set(...(pal[key] as [number, number, number]))
}

/* ------------------------------------------------------------------ */
/*  Aura: shader con borde de picos (despertar) o suave (escuchando)   */
/* ------------------------------------------------------------------ */
const auraFrag = /* glsl */ `
  uniform float uTime, uSpiky, uLevel, uIntensity, uBeat;
  uniform vec3 uOuter, uInner;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 4.0;
    float r = length(p);
    float a = atan(p.y, p.x);
    float spikes = uSpiky * (0.20 * pow(abs(sin(a * 17.0 + uTime * 0.5)), 3.0)
                 + 0.07 * sin(a * 31.0 - uTime * 1.4) + 0.06 * sin(a * 7.0 + uTime * 0.9));
    float wobble = (1.0 - uSpiky) * (0.045 * sin(a * 3.0 + uTime * 1.1) + 0.035 * sin(a * 5.0 - uTime * 0.7));
    float edge = 1.08 + spikes + wobble + uLevel * 0.32 + uBeat * 0.04;
    float body = smoothstep(edge, 0.25, r);
    float rim = smoothstep(0.035, 0.0, abs(r - edge)) * (0.35 + 0.4 * uSpiky);
    vec3 col = mix(uOuter, uInner, smoothstep(edge, 0.45, r));
    float alpha = (body * body * 0.42 + body * 0.08 * uSpiky + rim) * uIntensity;
    gl_FragColor = vec4(col * alpha, alpha);
  }
`
const coreFrag = /* glsl */ `
  uniform float uPulse, uLight;
  uniform vec3 uGlow, uEdge;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * 2.0;
    vec3 white = vec3(1.6), cyan = uGlow, blue = uEdge;
    vec3 col = mix(white, cyan, smoothstep(0.0, 0.45, r));
    col = mix(col, blue, smoothstep(0.45, 1.0, r));
    float alpha = smoothstep(1.0, 0.82, r);
    gl_FragColor = vec4(col * (1.0 + uPulse * 0.6) * uLight, alpha);
  }
`
/* Oscuridad de la intro: tapa todo salvo un hueco alrededor del reactor que se abre desde el centro;
   en la ignición su borde es una onda de choque cian. */
// Color en lineal: el postprocesado lo pasa a sRGB (≈ el fondo del tema).
const maskFrag = /* glsl */ `
  uniform float uR, uA, uRim, uSize;
  uniform vec3 uDark, uGlow;
  varying vec2 vUv;
  void main() {
    float r = length(vUv - 0.5) * uSize;
    float soft = 0.08 + uR * 0.35;
    float dark = smoothstep(uR - soft, uR, r) * uA;
    float rim = smoothstep(0.22, 0.0, abs(r - uR + soft * 0.4)) * uRim;
    vec3 col = mix(uDark, uGlow, clamp(rim, 0.0, 1.0));
    gl_FragColor = vec4(col, max(dark, rim));
  }
`
const MASK_SIZE = 80

const vert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`

function Segments({ inner, outer, count, gap, color, opacity = 1 }: { inner: number; outer: number; count: number; gap: number; color: THREE.Color; opacity?: number }) {
  const geos = useMemo(() => {
    const step = (Math.PI * 2) / count
    return Array.from({ length: count }, (_, i) => new THREE.RingGeometry(inner, outer, 24, 1, i * step + gap / 2, step - gap))
  }, [inner, outer, count, gap])
  return (
    <>
      {geos.map((g, i) => (
        <mesh key={i} geometry={g}>
          <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
        </mesh>
      ))}
    </>
  )
}

function DottedRing({ radius, count, size, opacity, color }: { radius: number; count: number; size: number; opacity: number; color: THREE.Color }) {
  const geo = useMemo(() => {
    const pts = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2
      pts.set([Math.cos(a) * radius, Math.sin(a) * radius, 0], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    return g
  }, [radius, count])
  return (
    <points geometry={geo}>
      <pointsMaterial color={color} size={size} sizeAttenuation transparent opacity={opacity} toneMapped={false} />
    </points>
  )
}

function Orbiters({ refObj, color }: { refObj: React.RefObject<THREE.Points | null>; color: THREE.Color }) {
  const geo = useMemo(() => {
    const n = 70
    const pts = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 0.95 + Math.random() * 0.35
      pts.set([Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.5) * 0.2], i * 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3))
    return g
  }, [])
  return (
    <points ref={refObj} geometry={geo}>
      <pointsMaterial color={color} size={0.035} sizeAttenuation transparent opacity={0} toneMapped={false} depthWrite={false} />
    </points>
  )
}

function Reactor({ variant, energy, offsetX = 0, offsetY = 0, scale = 1 }: ReactorProps) {
  const group = useRef<THREE.Group>(null)
  const seg = useRef<THREE.Group>(null)
  const coils = useRef<THREE.Group>(null)
  const dots = useRef<THREE.Group>(null)
  const orbit = useRef<THREE.Points>(null)
  const core = useRef<THREE.Mesh>(null)
  const mask = useRef<THREE.Mesh>(null)
  const { viewport, size } = useThree()
  const [{ scene: pal }] = useTheme()
  const CYAN = useMemo(() => new THREE.Color(pal.accent), [pal.accent])
  const BLUE = useMemo(() => new THREE.Color(pal.accent2), [pal.accent2])
  const s = useRef({ spiky: 1, level: 0, speed: 1, orbit: 0, intensity: 0, x: 0, y: 0, scale: 1 })

  const auraMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: auraFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uSpiky: { value: 1 }, uLevel: { value: 0 }, uIntensity: { value: 0 }, uBeat: { value: 0 }, uOuter: { value: v3(theme().scene.auraOuter) }, uInner: { value: v3(theme().scene.auraInner) } },
  }), [])
  const coreMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: coreFrag, transparent: true, toneMapped: false, uniforms: { uPulse: { value: 0 }, uLight: { value: 0 }, uGlow: { value: v3(theme().scene.coreGlow) }, uEdge: { value: v3(theme().scene.coreEdge) } },
  }), [])
  const maskMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: maskFrag, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { uR: { value: 0 }, uA: { value: 1 }, uRim: { value: 0 }, uSize: { value: MASK_SIZE }, uDark: { value: v3(theme().scene.maskDark) }, uGlow: { value: v3(theme().scene.coreGlow) } },
  }), [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-dt * 4)
    const st = s.current
    // Objetivos según variante y energía
    const targetSpiky = variant === 'despertar' ? 1 : 0
    const live = energy === 'listening' ? levels.mic : energy === 'speaking' ? levels.out : 0
    const targetSpeed = energy === 'thinking' ? 5 : energy === 'speaking' ? 1.6 : 1
    const targetIntensity = variant === 'reposo' ? 0.55 : 1
    st.spiky += (targetSpiky - st.spiky) * k
    st.level += (live - st.level) * (1 - Math.exp(-dt * 18))
    st.speed += (targetSpeed - st.speed) * k
    st.orbit += ((energy === 'thinking' ? 0.9 : 0) - st.orbit) * k
    st.intensity += (targetIntensity - st.intensity) * k
    // px → unidades de mundo
    const pxToWorld = viewport.height / size.height
    st.x += (offsetX * pxToWorld - st.x) * k
    st.y += (offsetY * pxToWorld - st.y) * k
    st.scale += (scale - st.scale) * k

    // Intro: luz del núcleo, hueco en la oscuridad, ignición
    const io = introState()
    intro.cy = st.y
    // Latido: doble pulso cada 1.2 s, con origen en la ignición de la intro (a compás con su sonido)
    const ph = (((now() - intro.beatOrigin) % 1.2) + 1.2) % 1.2
    const beat = (Math.exp(-ph * 9) + 0.6 * Math.exp(-Math.max(0, ph - 0.22) * 9) * (ph > 0.22 ? 1 : 0)) * io.beat

    setColors(auraMat.uniforms, { uOuter: 'auraOuter', uInner: 'auraInner' })
    setColors(coreMat.uniforms, { uGlow: 'coreGlow', uEdge: 'coreEdge' })
    setColors(maskMat.uniforms, { uDark: 'maskDark', uGlow: 'coreGlow' })
    auraMat.uniforms.uTime.value = t
    auraMat.uniforms.uSpiky.value = st.spiky
    auraMat.uniforms.uLevel.value = Math.min(1, st.level * 1.6)
    auraMat.uniforms.uIntensity.value = st.intensity * io.aura
    auraMat.uniforms.uBeat.value = beat
    // Viaje estelar: el núcleo se carga de luz y late más fuerte mientras las estrellas pasan
    const ws = warpSpeed()
    coreMat.uniforms.uPulse.value = beat * 0.5 + st.level * 1.4 + io.flash * 2.2 + ws * (0.9 + 0.3 * Math.sin(t * 14))
    coreMat.uniforms.uLight.value = 0.05 + 0.95 * io.core
    if (mask.current) {
      mask.current.visible = io.maskA > 0.001 || io.rim > 0.001
      maskMat.uniforms.uR.value = io.maskR
      maskMat.uniforms.uA.value = io.maskA
      maskMat.uniforms.uRim.value = io.rim
    }

    if (group.current) {
      group.current.position.set(st.x, st.y, 0)
      group.current.scale.setScalar(st.scale * (1 + beat * 0.012 + st.level * 0.05 + io.flash * 0.05 + ws * 0.05))
    }
    if (core.current) core.current.scale.setScalar(1 + beat * 0.05 + st.level * 0.18)
    if (seg.current) seg.current.rotation.z += dt * 0.25 * st.speed
    if (coils.current) coils.current.rotation.z -= dt * 0.4 * st.speed
    if (dots.current) dots.current.rotation.z += dt * 0.08 * st.speed
    if (orbit.current) {
      orbit.current.rotation.z -= dt * 1.2
      ;(orbit.current.material as THREE.PointsMaterial).opacity = st.orbit
    }
  })

  return (
    <group ref={group}>
      <mesh material={auraMat}>
        <planeGeometry args={[4, 4]} />
      </mesh>
      <group ref={dots}><DottedRing radius={0.9} count={110} size={0.012} opacity={0.65} color={CYAN} /></group>
      <group ref={seg}><Segments inner={0.69} outer={0.78} count={10} gap={0.2} color={BLUE.clone().multiplyScalar(1.6)} /></group>
      <mesh>
        <ringGeometry args={[0.585, 0.597, 96]} />
        <meshBasicMaterial color={CYAN} transparent opacity={0.85} toneMapped={false} />
      </mesh>
      <group ref={coils}><Segments inner={0.47} outer={0.51} count={28} gap={0.1} color={CYAN} opacity={0.45} /></group>
      <mesh ref={core} material={coreMat}>
        <circleGeometry args={[0.34, 64]} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.18, 0.19, 64]} />
        <meshBasicMaterial color={BLUE} transparent opacity={0.8} toneMapped={false} />
      </mesh>
      <Orbiters refObj={orbit} color={CYAN} />
      <mesh ref={mask} material={maskMat} position={[0, 0, 0.05]} renderOrder={999}>
        <planeGeometry args={[MASK_SIZE, MASK_SIZE]} />
      </mesh>
    </group>
  )
}

/* ------------------------------------------------------------------ */
/*  Fondo: nebulosa + estrellas con parpadeo y parallax                */
/* ------------------------------------------------------------------ */
const nebulaFrag = /* glsl */ `
  uniform float uTime, uFade; uniform vec3 uA, uB, uC; varying vec2 vUv;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p*=2.03; a*=0.5; } return v; }
  void main(){
    vec2 p = vUv * 3.0;
    float t = uTime * 0.012;
    float f = fbm(p + vec2(t, -t) + fbm(p * 0.7 - t));
    vec3 blue = uA, violet = uB, teal = uC;
    vec3 col = mix(blue, violet, smoothstep(0.35, 0.8, fbm(p * 0.6 + 3.0)));
    col = mix(col, teal, smoothstep(0.5, 0.9, fbm(p * 0.8 - 5.0)) * 0.6);
    float center = 1.0 - smoothstep(0.0, 0.75, length(vUv - 0.5));
    float a = smoothstep(0.45, 1.0, f) * 0.16 * (0.25 + center);
    gl_FragColor = vec4(col * a * uFade, 1.0);
  }
`
const starVert = /* glsl */ `
  attribute float aSize; attribute float aPhase; uniform float uTime, uWave, uCy; varying float vTw;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vTw = 0.55 + 0.45 * sin(uTime * (0.6 + aPhase) + aPhase * 20.0);
    // Intro: cada estrella se enciende cuando le llega la oleada que sale del corazón (proyectada al plano del reactor).
    vec2 proj = mv.xy * (6.0 / -mv.z) - vec2(0.0, uCy);
    float lit = clamp((uWave - length(proj)) / (0.5 + aPhase * 1.8), 0.0, 1.0);
    // Al encenderse, un breve fogonazo por encima de su brillo normal
    vTw *= lit * (1.0 + 1.6 * lit * (1.0 - lit) * 4.0);
    gl_PointSize = aSize * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`
const starFrag = /* glsl */ `
  uniform vec3 uTint; varying float vTw;
  void main(){
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vTw;
    gl_FragColor = vec4(uTint * a, a);
  }
`

function Galaxy() {
  const stars = useRef<THREE.Points>(null)
  const group = useRef<THREE.Group>(null)
  const nebula = useMemo(() => new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: nebulaFrag, uniforms: { uTime: { value: 0 }, uFade: { value: 0 }, uA: { value: v3(theme().scene.nebulaA) }, uB: { value: v3(theme().scene.nebulaB) }, uC: { value: v3(theme().scene.nebulaC) } }, depthWrite: false }), [])
  const starMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: starVert, fragmentShader: starFrag, uniforms: { uTime: { value: 0 }, uWave: { value: 0 }, uCy: { value: 0 }, uTint: { value: v3(theme().scene.star) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }), [])
  const geo = useMemo(() => {
    const n = 2600
    const pos = new Float32Array(n * 3), size = new Float32Array(n), phase = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      pos.set([(Math.random() - 0.5) * 60, (Math.random() - 0.5) * 36, -6 - Math.random() * 24], i * 3)
      size[i] = Math.random() < 0.06 ? 0.16 + Math.random() * 0.12 : 0.04 + Math.random() * 0.07
      phase[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
    return g
  }, [])
  useFrame((state, dt) => {
    setColors(nebula.uniforms, { uA: 'nebulaA', uB: 'nebulaB', uC: 'nebulaC' })
    setColors(starMat.uniforms, { uTint: 'star' })
    nebula.uniforms.uTime.value = state.clock.elapsedTime
    starMat.uniforms.uTime.value = state.clock.elapsedTime
    const io = introState()
    starMat.uniforms.uWave.value = io.wave
    starMat.uniforms.uCy.value = intro.cy
    nebula.uniforms.uFade.value = Math.min(1, Math.max(0, (io.wave - 2) / 8))
    if (stars.current) stars.current.rotation.z += dt * 0.004
    if (group.current) {
      // Parallax suave con el ratón
      group.current.position.x += (-state.pointer.x * 0.6 - group.current.position.x) * 0.03
      group.current.position.y += (-state.pointer.y * 0.35 - group.current.position.y) * 0.03
    }
  })
  return (
    <group ref={group}>
      <mesh material={nebula} position={[0, 0, -32]}>
        <planeGeometry args={[110, 66]} />
      </mesh>
      <points ref={stars} geometry={geo} material={starMat} />
    </group>
  )
}

const WARP_N = 1100
/** Geometría y material del salto, creados una vez (fuera del render: son datos aleatorios y se mutan cada frame). */
function makeWarp() {
  const stars = new Float32Array(WARP_N * 3)
  for (let i = 0; i < WARP_N; i++) {
    // Un túnel alrededor de la cámara: nada justo delante, para que el centro quede limpio.
    const r = 1.2 + Math.pow(Math.random(), 0.6) * 16
    const a = Math.random() * Math.PI * 2
    stars.set([Math.cos(a) * r, Math.sin(a) * r * 0.62, -70 + Math.random() * 74], i * 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WARP_N * 6), 3))
  const col = new Float32Array(WARP_N * 6)
  for (let i = 0; i < WARP_N; i++) col.set([1, 1, 1, 0, 0, 0], i * 6) // cabeza brillante, cola que se apaga
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })
  const obj = new THREE.LineSegments(geo, mat)
  obj.frustumCulled = false
  obj.visible = false
  return { stars, geo, mat, obj }
}
const warpGfx = makeWarp()

function stepWarp(dt: number) {
  const speed = warpSpeed()
  const { stars, geo, mat, obj } = warpGfx
  obj.visible = speed > 0.001
  if (!obj.visible) return
  const s = theme().scene.star
  mat.color.setRGB(s[0], s[1], s[2])
  mat.opacity = Math.min(1, speed * 1.4)
  const pos = geo.attributes.position.array as Float32Array
  const v = speed * speed * 140 * Math.min(dt, 0.05)
  const len = 0.05 + speed * speed * 16
  for (let i = 0; i < WARP_N; i++) {
    const o = i * 3
    let z = stars[o + 2] + v
    if (z > 5) z -= 75
    stars[o + 2] = z
    const x = stars[o], y = stars[o + 1]
    pos.set([x, y, z, x, y, z - len], i * 6)
  }
  geo.attributes.position.needsUpdate = true
}

/**
 * Viaje estelar: estrellas que vienen hacia la cámara y se estiran en rayas según la velocidad.
 * Vistas de frente salen en abanico desde el centro, donde está Prometeo. En reposo no se dibuja nada.
 */
function Warp() {
  useFrame((_, dt) => stepWarp(dt))
  return <primitive object={warpGfx.obj} />
}

export default function Scene(props: ReactorProps) {
  const [{ scene: pal }] = useTheme()
  return (
    <div className="scene">
      <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 2]} gl={{ antialias: true }}>
        <color attach="background" args={[pal.background]} />
        <Galaxy />
        <Warp />
        <Reactor {...props} />
        <EffectComposer>
          <Bloom intensity={1.15} luminanceThreshold={0.18} luminanceSmoothing={0.3} mipmapBlur radius={0.75} />
        </EffectComposer>
      </Canvas>
    </div>
  )
}
