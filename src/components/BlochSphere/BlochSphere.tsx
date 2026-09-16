import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, useCursor } from '@react-three/drei'
import * as THREE from 'three'
import { useQuantumStore } from '../../store/useQuantumStore'
import { ket, stateVectorKatex } from '../../sim/katexFormat'
import {
  blochRate,
  minusEnergyEigenstate,
  plusEnergyEigenstate,
} from '../../sim/hamiltonian'
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion'
import { KatexBlock } from '../Katex'
import { EnergyEigenvectorHint } from '../SectionHints'
import { MathLabel } from './MathLabel'
import {
  createStateVectorMaterial,
  createTipMaterial,
  createTipGlowMaterial,
  ROTATION_AXIS_COLOR,
} from './stateVectorMaterial'

const TRAIL_LENGTH = 160
const TRAIL_WIDTH = 0.012
const MAX_TRAIL_STEP = 0.06
const ARROW_HEAD_LENGTH = 0.018
const ARROW_HEAD_WIDTH = 0.011
const ARROW_SHAFT_WIDTH = 0.0045
const TIP_RADIUS = 0.014
const TIP_GLOW_RADIUS = 0.038
const TIP_HIT_RADIUS = 0.11
const TIP_POPOVER_GAP_PX = 16
const VIEW_MARGIN_PX = 8
const POPOVER_DURATION_MS = 400
const AXIS_LEN = 1.02
const AXIS_HEAD_LENGTH = 0.042
const AXIS_HEAD_WIDTH = 0.016
const AXIS_SHAFT_WIDTH = 0.0032
const SMOOTH_RATE = 14

const _dir = new THREE.Vector3()
const _displayed = new THREE.Vector3()
const _target = new THREE.Vector3()
const _tangent = new THREE.Vector3()
const _side = new THREE.Vector3()
const _toCam = new THREE.Vector3()
const _slerpAxis = new THREE.Vector3()
const _slerpQ = new THREE.Quaternion()
const _upZ = new THREE.Vector3(0, 0, 1)
const _yAxis = new THREE.Vector3(0, 1, 0)
const _projected = new THREE.Vector3()
const _energyPos = new THREE.Vector3()
const stateTipScreen = { x: 0, y: 0 }
const energyPlusTipScreen = { x: 0, y: 0 }
const energyMinusTipScreen = { x: 0, y: 0 }

type BlochMarker = 'state' | 'energyPlus' | 'energyMinus'

function positionTipPopover(panel: HTMLDivElement, x: number, y: number) {
  const inner = panel.firstElementChild as HTMLElement | null
  const height = inner?.offsetHeight ?? panel.offsetHeight
  const width = panel.offsetWidth
  if (width < 1 || height < 1) return

  let left = x - width / 2
  const maxLeft = window.innerWidth - width - VIEW_MARGIN_PX
  if (maxLeft <= VIEW_MARGIN_PX) {
    left = VIEW_MARGIN_PX
  } else {
    left = Math.min(Math.max(left, VIEW_MARGIN_PX), maxLeft)
  }

  let top = y - height - TIP_POPOVER_GAP_PX
  if (top < VIEW_MARGIN_PX) {
    top = y + TIP_POPOVER_GAP_PX
  }
  const maxTop = window.innerHeight - height - VIEW_MARGIN_PX
  if (maxTop <= VIEW_MARGIN_PX) {
    top = VIEW_MARGIN_PX
  } else {
    top = Math.min(Math.max(top, VIEW_MARGIN_PX), maxTop)
  }

  panel.style.top = `${top}px`
  panel.style.left = `${left}px`
}

function projectWorldToScreen(
  world: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  out: { x: number; y: number },
) {
  _projected.copy(world).project(camera)
  const rect = canvas.getBoundingClientRect()
  out.x = rect.left + (_projected.x * 0.5 + 0.5) * rect.width
  out.y = rect.top + (-_projected.y * 0.5 + 0.5) * rect.height
}

function BlochMarkerPopover({
  panelRef,
  screen,
  className,
  children,
}: {
  panelRef: RefObject<HTMLDivElement>
  screen: { x: number; y: number }
  className?: string
  children: ReactNode
}) {
  const reduceMotion = usePrefersReducedMotion()
  const [shown, setShown] = useState(false)

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (panel) positionTipPopover(panel, screen.x, screen.y)
  }, [panelRef, screen, children])

  useLayoutEffect(() => {
    if (reduceMotion) {
      setShown(true)
      return
    }
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [reduceMotion])

  useLayoutEffect(() => {
    const panel = panelRef.current
    const inner = panel?.firstElementChild
    if (!panel || !inner) return

    const observer = new ResizeObserver(() => {
      positionTipPopover(panel, screen.x, screen.y)
    })
    observer.observe(inner)
    return () => observer.disconnect()
  }, [panelRef, screen, children])

  return createPortal(
    <div
      ref={panelRef}
      role="tooltip"
      className={`popover-panel bloch-tip-popover${className ? ` ${className}` : ''}`}
      aria-hidden={!shown}
      style={{
        opacity: shown ? 1 : 0,
        pointerEvents: 'none',
        transition: reduceMotion ? 'none' : `opacity ${POPOVER_DURATION_MS}ms var(--ease)`,
      }}
    >
      <div className="popover-panel-inner">{children}</div>
    </div>,
    document.body,
  )
}

function BlochTipStatePopover({ panelRef }: { panelRef: RefObject<HTMLDivElement> }) {
  const psi = useQuantumStore((s) => s.psi)

  return (
    <BlochMarkerPopover panelRef={panelRef} screen={stateTipScreen}>
      <KatexBlock math={stateVectorKatex(psi[0], psi[1], true)} />
    </BlochMarkerPopover>
  )
}

function BlochTipEnergyPopover({
  panelRef,
  which,
  screen,
}: {
  panelRef: RefObject<HTMLDivElement>
  which: 'plus' | 'minus'
  screen: { x: number; y: number }
}) {
  const hamiltonian = useQuantumStore((s) => s.hamiltonian)
  const eigen = which === 'plus' ? plusEnergyEigenstate(hamiltonian) : minusEnergyEigenstate(hamiltonian)
  if (!eigen) return null

  return (
    <BlochMarkerPopover panelRef={panelRef} screen={screen} className="bloch-energy-popover">
      <EnergyEigenvectorHint
        alpha={eigen.psi[0]}
        beta={eigen.psi[1]}
        bloch={eigen.bloch}
        energy={eigen.energy}
        omegaR={eigen.omegaR}
        which={which}
        epsilon={hamiltonian.epsilon}
      />
    </BlochMarkerPopover>
  )
}

/** Unit Bloch vector in Three.js coords. Pure states live on the sphere. */
function blochTarget(bloch: { x: number; y: number; z: number }, out: THREE.Vector3) {
  out.set(bloch.x, bloch.z, bloch.y)
  const len = out.length()
  if (len > 1e-8) out.multiplyScalar(1 / len)
  return out
}

/** Spherical interpolation of unit vectors. Linear lerp would cut a chord inside the sphere. */
function slerpUnit(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number) {
  if (a.lengthSq() < 1e-12) {
    out.copy(b)
    return out
  }
  if (b.lengthSq() < 1e-12) {
    out.copy(a)
    return out
  }
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1)
  if (dot > 0.9995) {
    out.copy(a).lerp(b, t)
    const len = out.length()
    if (len > 1e-8) out.multiplyScalar(1 / len)
    return out
  }
  if (dot < -0.9995) {
    _slerpAxis.set(-a.y, a.x, 0)
    if (_slerpAxis.lengthSq() < 1e-12) _slerpAxis.set(0, -a.z, a.y)
    _slerpQ.setFromAxisAngle(_slerpAxis.normalize(), Math.PI * t)
    out.copy(a).applyQuaternion(_slerpQ)
    return out
  }
  const theta = Math.acos(dot)
  const sinTheta = Math.sin(theta)
  out.copy(a).multiplyScalar(Math.sin((1 - t) * theta) / sinTheta)
  out.addScaledVector(b, Math.sin(t * theta) / sinTheta)
  return out
}

function appendTrailPoint(points: THREE.Vector3[], next: THREE.Vector3) {
  const last = points[points.length - 1]
  if (!last) {
    points.push(next.clone())
    return
  }
  const angle = Math.acos(THREE.MathUtils.clamp(last.dot(next), -1, 1))
  const steps = Math.max(1, Math.ceil(angle / MAX_TRAIL_STEP))
  for (let s = 1; s <= steps; s++) {
    const p = new THREE.Vector3()
    slerpUnit(p, last, next, s / steps)
    points.push(p)
  }
  if (points.length > TRAIL_LENGTH) {
    points.splice(0, points.length - TRAIL_LENGTH)
  }
}

const COORDINATE_AXES: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
]

function blochToThree(x: number, y: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, z, y)
}

function createFacingFadeMaterial(options: {
  color: THREE.ColorRepresentation
  frontOpacity: number
  backOpacity: number
  wireframe?: boolean
  timeUniform?: boolean
}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(options.color) },
      uFrontOpacity: { value: options.frontOpacity },
      uBackOpacity: { value: options.backOpacity },
      uTime: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying float vFacing;

      void main() {
        vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
        vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 viewDir = normalize(cameraPosition - worldPos);
        vFacing = dot(worldNormal, viewDir);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: options.timeUniform
      ? /* glsl */ `
          uniform vec3 uColor;
          uniform float uFrontOpacity;
          uniform float uBackOpacity;
          uniform float uTime;
          uniform float uPulse;

          varying float vFacing;

          void main() {
            float t = smoothstep(0.0, 0.35, vFacing);
            float breathe = 1.0 + uPulse * (0.06 + 0.09 * 0.5 * (sin(uTime * 3.2) + 1.0));
            float alpha = mix(uBackOpacity, uFrontOpacity, t) * breathe;
            gl_FragColor = vec4(uColor, alpha);
          }
        `
      : /* glsl */ `
          uniform vec3 uColor;
          uniform float uFrontOpacity;
          uniform float uBackOpacity;
          varying float vFacing;

          void main() {
            float t = smoothstep(0.0, 0.35, vFacing);
            float alpha = mix(uBackOpacity, uFrontOpacity, t);
            gl_FragColor = vec4(uColor, alpha);
          }
        `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    wireframe: options.wireframe ?? false,
  })
}

const TRAIL_COLOR = 0xb45309
const TRAIL_OPACITY_NEAR = 0.88
const TRAIL_OPACITY_FAR = 0.0
const AXIS_INK_DURATION = 0.85
const AXIS_SOLID_DURATION = 0.55
const ORBIT_SEGMENTS = 96
const PERIOD_TICK_RADIUS = 0.026

function createTrailMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(TRAIL_COLOR) },
      uDust: { value: new THREE.Color('#c4a484') },
      uTime: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aOpacity;
      attribute float aAge;
      attribute float aSide;
      varying float vOpacity;
      varying float vAge;
      varying float vSide;
      varying vec3 vWorldPos;

      void main() {
        vOpacity = aOpacity;
        vAge = aAge;
        vSide = aSide;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uDust;
      uniform float uTime;
      uniform float uPulse;

      varying float vOpacity;
      varying float vAge;
      varying float vSide;
      varying vec3 vWorldPos;

      // Cheap value-noise for chalk grain (no texture fetch).
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }

      float chalkNoise(vec3 p) {
        vec2 g = p.xy * 38.0 + p.z * 17.0;
        float n =
          hash(floor(g)) * 0.55 +
          hash(floor(g * 2.1 + 3.7)) * 0.3 +
          hash(floor(g * 5.3 + 9.1)) * 0.15;
        return n;
      }

      void main() {
        float head = smoothstep(0.62, 1.0, vAge);
        float dustAge = 1.0 - vAge;
        // Soft ribbon edge + chalk speckles that intensify on older segments.
        float edge = 1.0 - smoothstep(0.35, 1.0, abs(vSide));
        float grain = chalkNoise(vWorldPos + vec3(0.0, uTime * 0.02, 0.0));
        float speck = mix(0.92, 1.08, grain);
        float dissolve = 1.0 - dustAge * dustAge * (0.55 + 0.45 * grain);
        vec3 color = mix(uDust, uColor, head * 0.85 + (1.0 - dustAge) * 0.15);
        float alpha = vOpacity * edge * speck * dissolve * (0.7 + head * 0.3);
        alpha *= 0.88 + uPulse * 0.12;
        if (alpha < 0.008) discard;
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  })
}

function createRotationAxisMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(ROTATION_AXIS_COLOR) },
      uReveal: { value: 1 },
      uDash: { value: 0 },
      uOpacity: { value: 0.72 },
    },
    vertexShader: /* glsl */ `
      varying float vAlong;

      void main() {
        // Cylinder along Y from -0.5..0.5 before scale; after scale spans ±AXIS_LEN.
        vAlong = position.y + 0.5;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uReveal;
      uniform float uDash;
      uniform float uOpacity;

      varying float vAlong;

      void main() {
        if (vAlong > uReveal + 1e-4) discard;
        // Pen-stroke ink: dashed early, solid as ink settles.
        float dashCell = fract(vAlong * 16.0);
        float dashMask = step(0.42, dashCell);
        float ink = mix(1.0, dashMask, clamp(uDash, 0.0, 1.0));
        if (ink < 0.5) discard;
        // Soft tip of the still-drawing stroke.
        float tip = 1.0 - smoothstep(uReveal - 0.06, uReveal, vAlong);
        float alpha = uOpacity * tip * (0.55 + 0.45 * (1.0 - uDash));
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
}

function createOrbitRingMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(ROTATION_AXIS_COLOR) },
      uOpacity: { value: 0.22 },
      uBreath: { value: 0 },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uBreath;

      void main() {
        float alpha = uOpacity * (0.65 + 0.35 * uBreath);
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
}

function createPeriodTickMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#a33200') },
      uBreath: { value: 0 },
    },
    vertexShader: /* glsl */ `
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uBreath;

      void main() {
        float alpha = 0.4 + 0.6 * uBreath;
        vec3 color = mix(uColor, vec3(1.0, 0.72, 0.45), uBreath * 0.55);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  })
}

function createAtmosphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color('#b45309') },
      uTime: { value: 0 },
      uPulse: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uPulse;

      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 viewDir = normalize(vViewPosition);
        float ndv = abs(dot(normalize(vNormal), viewDir));
        float fresnel = pow(1.0 - ndv, 3.2);
        float wave = 0.5 + 0.5 * sin(uTime * 2.8);
        float alpha = fresnel * (0.04 + uPulse * (0.035 + 0.055 * wave));
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  })
}

function trailOpacity(index: number, count: number): number {
  // Chalk dust: older segments dissolve faster than a linear fade.
  const age = (count - 1 - index) / Math.max(1, TRAIL_LENGTH - 1)
  const fade = Math.pow(1 - Math.min(1, age), 2.15)
  return TRAIL_OPACITY_FAR + (TRAIL_OPACITY_NEAR - TRAIL_OPACITY_FAR) * fade
}

function trailAge(index: number, count: number): number {
  if (count <= 1) return 1
  return index / (count - 1)
}

const _omegaAxis = new THREE.Vector3()
const _orbitCenter = new THREE.Vector3()
const _orbitRadial = new THREE.Vector3()
const _orbitU = new THREE.Vector3()
const _orbitV = new THREE.Vector3()
const _orbitPoint = new THREE.Vector3()
const _homePoint = new THREE.Vector3()
const _inkAxis = new THREE.Vector3()

function StateVector({
  hovered,
  isPlaying,
  onHover,
  panelRef,
}: {
  hovered: boolean
  isPlaying: boolean
  onHover: (hovered: boolean) => void
  panelRef: RefObject<HTMLDivElement>
}) {
  const rootRef = useRef<THREE.Group>(null)
  const shaftRef = useRef<THREE.Mesh>(null)
  const headRef = useRef<THREE.Mesh>(null)
  const tipRef = useRef<THREE.Mesh>(null)
  const tipGlowRef = useRef<THREE.Mesh>(null)
  const hitRef = useRef<THREE.Mesh>(null)
  const initialized = useRef(false)
  const lastTime = useRef(-1)
  const lastInitialId = useRef(useQuantumStore.getState().initialStateId)
  const settling = useRef(false)

  const vectorMaterial = useMemo(() => createStateVectorMaterial(), [])
  const tipMaterial = useMemo(() => createTipMaterial(), [])
  const tipGlowMaterial = useMemo(() => createTipGlowMaterial(), [])

  useCursor(hovered && !isPlaying)

  useFrame((state, delta) => {
    const { bloch, time, isPlaying: playing, initialStateId } = useQuantumStore.getState()
    blochTarget(bloch, _target)

    const jumped = Math.abs(time - lastTime.current) > 0.02
    lastTime.current = time

    if (initialStateId !== lastInitialId.current) {
      lastInitialId.current = initialStateId
      settling.current = true
    }
    if (playing) settling.current = false

    if (!initialized.current) {
      _displayed.copy(_target)
      initialized.current = true
    } else if (playing || settling.current) {
      const t = 1 - Math.exp(-SMOOTH_RATE * delta)
      slerpUnit(_displayed, _displayed, _target, t)
      if (settling.current && _displayed.distanceToSquared(_target) < 1e-8) {
        _displayed.copy(_target)
        settling.current = false
      }
    } else if (jumped) {
      _displayed.copy(_target)
    }

    const len = _displayed.length()
    const visible = len > 1e-6
    const pulse = playing ? 1 : 0
    const clock = state.clock.elapsedTime

    vectorMaterial.uniforms.uTime.value = clock
    vectorMaterial.uniforms.uPulse.value = pulse
    tipMaterial.uniforms.uTime.value = clock
    tipMaterial.uniforms.uPulse.value = pulse
    tipGlowMaterial.uniforms.uTime.value = clock
    tipGlowMaterial.uniforms.uPulse.value = pulse

    if (rootRef.current) rootRef.current.visible = visible
    if (tipRef.current) tipRef.current.visible = visible
    if (tipGlowRef.current) tipGlowRef.current.visible = visible
    if (hitRef.current) hitRef.current.visible = visible
    if (!visible) return

    _dir.copy(_displayed)
    const shaftLen = Math.max(0.02, 1 - ARROW_HEAD_LENGTH * 0.75)

    if (rootRef.current) {
      rootRef.current.quaternion.setFromUnitVectors(_yAxis, _dir)
    }
    if (shaftRef.current) {
      shaftRef.current.scale.y = shaftLen
      shaftRef.current.position.y = shaftLen / 2
    }
    if (headRef.current) {
      headRef.current.position.y = shaftLen + ARROW_HEAD_LENGTH * 0.45
    }
    if (tipRef.current) {
      tipRef.current.position.copy(_displayed)
    }
    if (tipGlowRef.current) {
      tipGlowRef.current.position.copy(_displayed)
      const glowScale = 1 + pulse * 0.12 * Math.sin(clock * 5.5)
      tipGlowRef.current.scale.setScalar(glowScale)
    }
    if (hitRef.current) {
      hitRef.current.position.copy(_displayed)
    }

    projectWorldToScreen(_displayed, state.camera, state.gl.domElement, stateTipScreen)
    const panel = panelRef.current
    if (panel) positionTipPopover(panel, stateTipScreen.x, stateTipScreen.y)
  })

  return (
    <>
      <group ref={rootRef}>
        <mesh ref={shaftRef} material={vectorMaterial} renderOrder={1}>
          <cylinderGeometry args={[ARROW_SHAFT_WIDTH, ARROW_SHAFT_WIDTH, 1, 16]} />
        </mesh>
        <mesh ref={headRef} material={vectorMaterial} renderOrder={1}>
          <coneGeometry args={[ARROW_HEAD_WIDTH, ARROW_HEAD_LENGTH, 16]} />
        </mesh>
      </group>
      <mesh ref={tipGlowRef} material={tipGlowMaterial} renderOrder={2}>
        <sphereGeometry args={[TIP_GLOW_RADIUS, 24, 24]} />
      </mesh>
      <mesh ref={tipRef} material={tipMaterial} renderOrder={3}>
        <sphereGeometry args={[TIP_RADIUS, 24, 24]} />
      </mesh>
      <mesh
        ref={hitRef}
        renderOrder={4}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHover(true)
        }}
        onPointerOut={() => onHover(false)}
      >
        <sphereGeometry args={[TIP_HIT_RADIUS, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </>
  )
}

function CoordinateAxis({
  blochDir,
  material,
}: {
  blochDir: [number, number, number]
  material: THREE.Material
}) {
  const quaternion = useMemo(() => {
    const dir = blochToThree(...blochDir).normalize()
    return new THREE.Quaternion().setFromUnitVectors(_yAxis, dir)
  }, [blochDir])

  const fwdLen = AXIS_LEN - AXIS_HEAD_LENGTH * 0.55

  return (
    <group quaternion={quaternion}>
      <mesh material={material} position={[0, fwdLen / 2, 0]} scale={[1, fwdLen, 1]} renderOrder={1}>
        <cylinderGeometry args={[AXIS_SHAFT_WIDTH, AXIS_SHAFT_WIDTH, 1, 8]} />
      </mesh>
      <mesh material={material} position={[0, -AXIS_LEN / 2, 0]} scale={[1, AXIS_LEN, 1]} renderOrder={1}>
        <cylinderGeometry args={[AXIS_SHAFT_WIDTH, AXIS_SHAFT_WIDTH, 1, 8]} />
      </mesh>
      <mesh material={material} position={[0, fwdLen + AXIS_HEAD_LENGTH * 0.45, 0]} renderOrder={1}>
        <coneGeometry args={[AXIS_HEAD_WIDTH, AXIS_HEAD_LENGTH, 8]} />
      </mesh>
    </group>
  )
}

function CoordinateAxes() {
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#6f6a62',
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
      }),
    [],
  )

  return (
    <>
      {COORDINATE_AXES.map((blochDir) => (
        <CoordinateAxis key={blochDir.join(',')} blochDir={blochDir} material={material} />
      ))}
    </>
  )
}

function EnergyEigenstateTip({
  sign,
  screen,
  hovered,
  onHover,
  panelRef,
}: {
  sign: 1 | -1
  screen: { x: number; y: number }
  hovered: boolean
  onHover: (hovered: boolean) => void
  panelRef: RefObject<HTMLDivElement>
}) {
  const tipRef = useRef<THREE.Mesh>(null)
  const tipGlowRef = useRef<THREE.Mesh>(null)
  const hitRef = useRef<THREE.Mesh>(null)
  const tipMaterial = useMemo(() => createTipMaterial(ROTATION_AXIS_COLOR), [])
  const tipGlowMaterial = useMemo(() => createTipGlowMaterial(ROTATION_AXIS_COLOR), [])

  const onHoverRef = useRef(onHover)
  onHoverRef.current = onHover
  const hoveredRef = useRef(hovered)
  hoveredRef.current = hovered

  useCursor(hovered)

  useFrame((state) => {
    const { hamiltonian, isPlaying } = useQuantumStore.getState()
    const len = Math.hypot(hamiltonian.OmegaX, hamiltonian.OmegaY, hamiltonian.omega)
    const visible = len >= 1e-6
    const pulse = isPlaying ? 1 : 0
    const clock = state.clock.elapsedTime

    tipMaterial.uniforms.uTime.value = clock
    tipMaterial.uniforms.uPulse.value = pulse
    tipGlowMaterial.uniforms.uTime.value = clock
    tipGlowMaterial.uniforms.uPulse.value = pulse

    if (!visible) {
      if (hitRef.current) hitRef.current.visible = false
      if (tipRef.current) tipRef.current.visible = false
      if (tipGlowRef.current) tipGlowRef.current.visible = false
      if (hoveredRef.current) onHoverRef.current(false)
      return
    }

    _energyPos.set(
      (sign * hamiltonian.OmegaX) / len,
      (sign * hamiltonian.omega) / len,
      (sign * hamiltonian.OmegaY) / len,
    )

    if (tipRef.current) {
      tipRef.current.visible = true
      tipRef.current.position.copy(_energyPos)
    }
    if (tipGlowRef.current) {
      tipGlowRef.current.visible = true
      tipGlowRef.current.position.copy(_energyPos)
      const glowScale = 1 + pulse * 0.12 * Math.sin(clock * 5.5)
      tipGlowRef.current.scale.setScalar(glowScale)
    }
    if (hitRef.current) {
      hitRef.current.visible = true
      hitRef.current.position.copy(_energyPos)
    }

    projectWorldToScreen(_energyPos, state.camera, state.gl.domElement, screen)
    const panel = panelRef.current
    if (panel) positionTipPopover(panel, screen.x, screen.y)
  })

  return (
    <>
      <mesh ref={tipGlowRef} material={tipGlowMaterial} renderOrder={2}>
        <sphereGeometry args={[TIP_GLOW_RADIUS, 24, 24]} />
      </mesh>
      <mesh ref={tipRef} material={tipMaterial} renderOrder={3}>
        <sphereGeometry args={[TIP_RADIUS, 24, 24]} />
      </mesh>
      <mesh
        ref={hitRef}
        renderOrder={4}
        onPointerOver={(event) => {
          event.stopPropagation()
          onHover(true)
        }}
        onPointerOut={() => onHover(false)}
      >
        <sphereGeometry args={[TIP_HIT_RADIUS, 16, 16]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
    </>
  )
}

function createTrailRibbon() {
  const geometry = new THREE.BufferGeometry()
  const vertCount = TRAIL_LENGTH * 2
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3))
  geometry.setAttribute('aOpacity', new THREE.BufferAttribute(new Float32Array(vertCount), 1))
  geometry.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(vertCount), 1))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array(vertCount), 1))

  const indices = new Uint16Array((TRAIL_LENGTH - 1) * 6)
  for (let i = 0; i < TRAIL_LENGTH - 1; i++) {
    const a = i * 2
    const o = i * 6
    indices[o] = a
    indices[o + 1] = a + 1
    indices[o + 2] = a + 2
    indices[o + 3] = a + 1
    indices[o + 4] = a + 3
    indices[o + 5] = a + 2
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.setDrawRange(0, 0)

  const mesh = new THREE.Mesh(geometry, createTrailMaterial())
  mesh.frustumCulled = false
  mesh.renderOrder = 1
  return mesh
}

function writeTrailRibbon(mesh: THREE.Mesh, points: THREE.Vector3[], cameraPos: THREE.Vector3) {
  const count = points.length
  if (count < 2) {
    mesh.geometry.setDrawRange(0, 0)
    return
  }

  const positions = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const opacities = mesh.geometry.getAttribute('aOpacity') as THREE.BufferAttribute
  const ages = mesh.geometry.getAttribute('aAge') as THREE.BufferAttribute
  const sides = mesh.geometry.getAttribute('aSide') as THREE.BufferAttribute
  // Older chalk is slightly wider and softer.
  const baseHalf = TRAIL_WIDTH / 2
  const lift = 1.004

  for (let i = 0; i < count; i++) {
    const p = points[i]
    if (i < count - 1) _tangent.subVectors(points[i + 1], p)
    else _tangent.subVectors(p, points[i - 1])
    if (_tangent.lengthSq() < 1e-12) _tangent.set(0, 1, 0)
    else _tangent.normalize()

    _toCam.subVectors(cameraPos, p)
    _side.crossVectors(_tangent, _toCam)
    if (_side.lengthSq() < 1e-12) {
      _side.crossVectors(_tangent, _upZ)
      if (_side.lengthSq() < 1e-12) _side.set(1, 0, 0)
    }
    const age = trailAge(i, count)
    const half = baseHalf * (1.15 - age * 0.35)
    _side.normalize().multiplyScalar(half)

    positions.setXYZ(i * 2, p.x * lift + _side.x, p.y * lift + _side.y, p.z * lift + _side.z)
    positions.setXYZ(i * 2 + 1, p.x * lift - _side.x, p.y * lift - _side.y, p.z * lift - _side.z)

    const opacity = trailOpacity(i, count)
    opacities.setX(i * 2, opacity)
    opacities.setX(i * 2 + 1, opacity)
    ages.setX(i * 2, age)
    ages.setX(i * 2 + 1, age)
    sides.setX(i * 2, 1)
    sides.setX(i * 2 + 1, -1)
  }

  positions.needsUpdate = true
  opacities.needsUpdate = true
  ages.needsUpdate = true
  sides.needsUpdate = true
  mesh.geometry.setDrawRange(0, (count - 1) * 6)
}

function RotationAxis() {
  const groupRef = useRef<THREE.Group>(null)
  const shaftRef = useRef<THREE.Mesh>(null)
  const material = useMemo(() => createRotationAxisMaterial(), [])
  const reduceMotion = usePrefersReducedMotion()
  const lastKey = useRef('')
  const reveal = useRef(1)
  const dash = useRef(0)
  const opacity = useRef(0.72)

  useFrame((_, delta) => {
    const { hamiltonian, isPlaying } = useQuantumStore.getState()
    const len = Math.hypot(hamiltonian.OmegaX, hamiltonian.OmegaY, hamiltonian.omega)
    const visible = len >= 1e-6
    const group = groupRef.current
    const shaft = shaftRef.current
    if (!group || !shaft) return

    group.visible = visible
    if (!visible) return

    _inkAxis.set(hamiltonian.OmegaX / len, hamiltonian.omega / len, hamiltonian.OmegaY / len)
    group.quaternion.setFromUnitVectors(_yAxis, _inkAxis)

    const key = `${hamiltonian.omega.toFixed(4)}|${hamiltonian.OmegaX.toFixed(4)}|${hamiltonian.OmegaY.toFixed(4)}`
    if (key !== lastKey.current) {
      lastKey.current = key
      if (reduceMotion) {
        reveal.current = 1
        dash.current = 0
      } else {
        reveal.current = 0
        dash.current = 1
      }
    }

    if (reduceMotion) {
      reveal.current = 1
      dash.current = 0
    } else {
      const revealSpeed = 1 / AXIS_INK_DURATION
      reveal.current = Math.min(1, reveal.current + delta * revealSpeed)
      if (reveal.current > 0.82) {
        const solidSpeed = 1 / AXIS_SOLID_DURATION
        dash.current = Math.max(0, dash.current - delta * solidSpeed)
      }
    }

    const softTarget = isPlaying ? 0.32 : 0.72
    opacity.current += (softTarget - opacity.current) * Math.min(1, delta * 4)

    material.uniforms.uReveal.value = reveal.current
    material.uniforms.uDash.value = dash.current
    material.uniforms.uOpacity.value = opacity.current
  })

  const shaftLen = AXIS_LEN * 2

  return (
    <group ref={groupRef} renderOrder={1}>
      <mesh ref={shaftRef} material={material} scale={[1, shaftLen, 1]} renderOrder={1}>
        <cylinderGeometry args={[AXIS_SHAFT_WIDTH * 1.15, AXIS_SHAFT_WIDTH * 1.15, 1, 10]} />
      </mesh>
    </group>
  )
}

/** Precession orbit ring + home tick that breathes once per Rabi period T = 2π/ω_R. */
function PeriodBreath() {
  const ringRef = useRef<THREE.LineLoop>(null)
  const tickRef = useRef<THREE.Mesh>(null)
  const ringMaterial = useMemo(() => createOrbitRingMaterial(), [])
  const tickMaterial = useMemo(() => createPeriodTickMaterial(), [])
  const reduceMotion = usePrefersReducedMotion()
  const homeAzimuth = useRef<number | null>(null)
  const lastPlaying = useRef(false)
  const lastHKey = useRef('')
  const lastInitial = useRef(useQuantumStore.getState().initialStateId)

  const ringPositions = useMemo(() => {
    const arr = new Float32Array((ORBIT_SEGMENTS + 1) * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return { geometry, arr }
  }, [])

  useFrame(() => {
    const { bloch, hamiltonian, isPlaying, initialStateId } = useQuantumStore.getState()
    const ring = ringRef.current
    const tick = tickRef.current
    if (!ring || !tick) return

    const rate = blochRate(hamiltonian)
    blochTarget(bloch, _target)
    const hKey = `${hamiltonian.omega}|${hamiltonian.OmegaX}|${hamiltonian.OmegaY}`

    if (hKey !== lastHKey.current || initialStateId !== lastInitial.current) {
      lastHKey.current = hKey
      lastInitial.current = initialStateId
      homeAzimuth.current = null
    }
    if (isPlaying && !lastPlaying.current) {
      homeAzimuth.current = null
    }
    lastPlaying.current = isPlaying

    if (rate < 1e-6 || _target.lengthSq() < 1e-8) {
      ring.visible = false
      tick.visible = false
      return
    }

    _omegaAxis.set(hamiltonian.OmegaX / rate, hamiltonian.omega / rate, hamiltonian.OmegaY / rate)
    const parallel = _target.dot(_omegaAxis)
    _orbitCenter.copy(_omegaAxis).multiplyScalar(parallel)
    _orbitRadial.subVectors(_target, _orbitCenter)
    const radius = _orbitRadial.length()
    if (radius < 0.04) {
      ring.visible = false
      tick.visible = false
      return
    }

    _orbitRadial.multiplyScalar(1 / radius)
    // Orthonormal frame in the precession plane.
    _orbitU.copy(_orbitRadial)
    _orbitV.crossVectors(_omegaAxis, _orbitU)
    if (_orbitV.lengthSq() < 1e-12) {
      _orbitV.set(0, 1, 0).cross(_omegaAxis)
    }
    _orbitV.normalize()

    const azimuth = Math.atan2(_target.dot(_orbitV), _target.dot(_orbitU))
    if (homeAzimuth.current === null) {
      homeAzimuth.current = azimuth
    }

    const lift = 1.003
    const positions = ringPositions.arr
    for (let i = 0; i <= ORBIT_SEGMENTS; i++) {
      const theta = (i / ORBIT_SEGMENTS) * Math.PI * 2
      _orbitPoint
        .copy(_orbitCenter)
        .addScaledVector(_orbitU, Math.cos(theta) * radius)
        .addScaledVector(_orbitV, Math.sin(theta) * radius)
        .multiplyScalar(lift)
      positions[i * 3] = _orbitPoint.x
      positions[i * 3 + 1] = _orbitPoint.y
      positions[i * 3 + 2] = _orbitPoint.z
    }
    ringPositions.geometry.attributes.position.needsUpdate = true
    ring.visible = true

    // Home tick sits at the period-return azimuth on the orbit.
    const home = homeAzimuth.current
    _homePoint
      .copy(_orbitCenter)
      .addScaledVector(_orbitU, Math.cos(home) * radius)
      .addScaledVector(_orbitV, Math.sin(home) * radius)
      .multiplyScalar(lift)
    tick.position.copy(_homePoint)
    tick.visible = true

    // Breath peaks each time the state returns to the home azimuth (once per T).
    let breath = 0
    if (!reduceMotion) {
      let dAz = azimuth - home
      while (dAz > Math.PI) dAz -= Math.PI * 2
      while (dAz < -Math.PI) dAz += Math.PI * 2
      const wrap = Math.abs(dAz)
      breath = isPlaying ? Math.exp(-4.2 * wrap) : 0.12
    }

    ringMaterial.uniforms.uOpacity.value = 0.18 + breath * 0.35
    ringMaterial.uniforms.uBreath.value = breath
    tickMaterial.uniforms.uBreath.value = breath
    const tickScale = 1 + breath * 1.1
    tick.scale.setScalar(tickScale)
  })

  return (
    <>
      <lineLoop ref={ringRef} geometry={ringPositions.geometry} material={ringMaterial} renderOrder={1} />
      <mesh ref={tickRef} material={tickMaterial} renderOrder={2}>
        <sphereGeometry args={[PERIOD_TICK_RADIUS, 12, 12]} />
      </mesh>
    </>
  )
}

function BlochScene({
  hoveredMarker,
  isPlaying,
  onMarkerHover,
  statePanelRef,
  energyPlusPanelRef,
  energyMinusPanelRef,
}: {
  hoveredMarker: BlochMarker | null
  isPlaying: boolean
  onMarkerHover: (id: BlochMarker, hovered: boolean) => void
  statePanelRef: RefObject<HTMLDivElement>
  energyPlusPanelRef: RefObject<HTMLDivElement>
  energyMinusPanelRef: RefObject<HTMLDivElement>
}) {
  const trailPoints = useRef<THREE.Vector3[]>([])
  const trailMesh = useMemo(() => createTrailRibbon(), [])
  const lastTime = useRef(-1)
  const lastInitialId = useRef(useQuantumStore.getState().initialStateId)
  const smoothTrail = useRef(new THREE.Vector3())

  const wireframeMaterial = useMemo(
    () =>
      createFacingFadeMaterial({
        color: '#e4dfd8',
        frontOpacity: 0.2,
        backOpacity: 0.01,
        wireframe: true,
        timeUniform: true,
      }),
    [],
  )
  const ringMaterial = useMemo(
    () =>
      createFacingFadeMaterial({
        color: '#d8d2c8',
        frontOpacity: 0.34,
        backOpacity: 0.03,
        timeUniform: true,
      }),
    [],
  )
  const atmosphereMaterial = useMemo(() => createAtmosphereMaterial(), [])

  useFrame((state, delta) => {
    const { bloch, time, isPlaying, initialStateId } = useQuantumStore.getState()
    const clock = state.clock.elapsedTime
    const pulse = isPlaying ? 1 : 0

    blochTarget(bloch, _target)

    const prevTime = lastTime.current
    lastTime.current = time
    const initialChanged = initialStateId !== lastInitialId.current
    lastInitialId.current = initialStateId
    // Reset / Hamiltonian / initial-state snap time back to 0. A pause does not:
    // playback and this useFrame are separate rAF loops, so time can still tick
    // forward by a frame (often > 20ms) after the last trail write.
    const timeRewound = time < prevTime - 1e-6

    if (isPlaying) {
      if (smoothTrail.current.lengthSq() < 1e-12) {
        smoothTrail.current.copy(_target)
      } else {
        const t = 1 - Math.exp(-SMOOTH_RATE * delta)
        slerpUnit(smoothTrail.current, smoothTrail.current, _target, t)
      }
    } else if (timeRewound || initialChanged) {
      trailPoints.current = []
      trailMesh.geometry.setDrawRange(0, 0)
      smoothTrail.current.copy(_target)
    }

    wireframeMaterial.uniforms.uTime.value = clock
    wireframeMaterial.uniforms.uPulse.value = pulse
    ringMaterial.uniforms.uTime.value = clock
    ringMaterial.uniforms.uPulse.value = pulse
    atmosphereMaterial.uniforms.uTime.value = clock
    atmosphereMaterial.uniforms.uPulse.value = pulse

    const trailMat = trailMesh.material as THREE.ShaderMaterial
    trailMat.uniforms.uTime.value = clock
    trailMat.uniforms.uPulse.value = pulse

    if (isPlaying) {
      appendTrailPoint(trailPoints.current, smoothTrail.current)
    }

    writeTrailRibbon(trailMesh, trailPoints.current, state.camera.position)
  })

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 2]} intensity={0.45} />

      <mesh material={atmosphereMaterial} renderOrder={0}>
        <sphereGeometry args={[1.06, 48, 48]} />
      </mesh>

      <mesh>
        <sphereGeometry args={[0.995, 48, 48]} />
        <meshBasicMaterial color="#faf8f5" transparent opacity={0.055} depthWrite={false} />
      </mesh>

      <mesh material={wireframeMaterial}>
        <sphereGeometry args={[1, 36, 36]} />
      </mesh>

      <mesh rotation={[Math.PI / 2, 0, 0]} material={ringMaterial}>
        <torusGeometry args={[1.001, 0.0025, 4, 72]} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} material={ringMaterial}>
        <torusGeometry args={[1.001, 0.0025, 4, 72]} />
      </mesh>
      <mesh rotation={[0, Math.PI / 2, 0]} material={ringMaterial}>
        <torusGeometry args={[1.001, 0.002, 4, 72]} />
      </mesh>

      <MathLabel position={[0, 1.18, 0]} math={ket('0')} distanceFactor={10} />
      <MathLabel position={[0, -1.18, 0]} math={ket('1')} distanceFactor={10} />
      <MathLabel position={[1.14, 0, 0]} math={ket('{+}')} distanceFactor={10} />
      <MathLabel position={[-1.14, 0, 0]} math={ket('{-}')} distanceFactor={10} />
      <MathLabel position={[0, 0, 1.14]} math={ket('{+i}')} distanceFactor={10} />
      <MathLabel position={[0, 0, -1.14]} math={ket('{-i}')} distanceFactor={10} />

      <CoordinateAxes />
      <RotationAxis />
      <PeriodBreath />
      <primitive object={trailMesh} />
      <StateVector
        hovered={hoveredMarker === 'state'}
        isPlaying={isPlaying}
        onHover={(hovered) => onMarkerHover('state', hovered)}
        panelRef={statePanelRef}
      />
      <EnergyEigenstateTip
        sign={1}
        screen={energyPlusTipScreen}
        hovered={hoveredMarker === 'energyPlus'}
        onHover={(hovered) => onMarkerHover('energyPlus', hovered)}
        panelRef={energyPlusPanelRef}
      />
      <EnergyEigenstateTip
        sign={-1}
        screen={energyMinusTipScreen}
        hovered={hoveredMarker === 'energyMinus'}
        onHover={(hovered) => onMarkerHover('energyMinus', hovered)}
        panelRef={energyMinusPanelRef}
      />
      <OrbitControls enablePan={false} minDistance={2.4} maxDistance={4.5} />
    </>
  )
}

export function BlochSphere() {
  const isPlaying = useQuantumStore((s) => s.isPlaying)
  const [hoveredMarker, setHoveredMarker] = useState<BlochMarker | null>(null)
  const statePanelRef = useRef<HTMLDivElement>(null)
  const energyPlusPanelRef = useRef<HTMLDivElement>(null)
  const energyMinusPanelRef = useRef<HTMLDivElement>(null)

  const onMarkerHover = (id: BlochMarker, hovered: boolean) => {
    setHoveredMarker((current) => {
      if (hovered) return id
      return current === id ? null : current
    })
  }

  return (
    <div className="bloch-sphere-wrap">
      <div
        className="bloch-sphere"
        onPointerLeave={() => setHoveredMarker(null)}
      >
        <Canvas
          camera={{ position: [2.6, 1.4, 2.6], fov: 42 }}
          gl={{
            antialias: true,
            alpha: true,
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.05,
          }}
        >
          <BlochScene
            hoveredMarker={hoveredMarker}
            isPlaying={isPlaying}
            onMarkerHover={onMarkerHover}
            statePanelRef={statePanelRef}
            energyPlusPanelRef={energyPlusPanelRef}
            energyMinusPanelRef={energyMinusPanelRef}
          />
        </Canvas>
      </div>
      {hoveredMarker === 'state' && !isPlaying && (
        <BlochTipStatePopover panelRef={statePanelRef} />
      )}
      {hoveredMarker === 'energyPlus' && (
        <BlochTipEnergyPopover panelRef={energyPlusPanelRef} which="plus" screen={energyPlusTipScreen} />
      )}
      {hoveredMarker === 'energyMinus' && (
        <BlochTipEnergyPopover panelRef={energyMinusPanelRef} which="minus" screen={energyMinusTipScreen} />
      )}
    </div>
  )
}
