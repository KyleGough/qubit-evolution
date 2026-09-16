import { memo, useLayoutEffect, useRef } from 'react'
import { useQuantumStore } from '../store/useQuantumStore'
import { INITIAL_STATE_PRESETS } from '../presets/hamiltonians'
import { C, type Complex } from '../sim/complex'
import { type HamiltonianParams } from '../sim/hamiltonian'
import { formatRealFixed } from '../sim/format'
import type { BlochVector } from '../sim/bloch'
import {
  blochVectorKatex,
  evolutionKatex,
  probKetKatex,
  stateVectorKatex,
} from '../sim/katexFormat'
import { KatexBlock, KatexInline, renderKatex } from './Katex'
import { Popover, PopoverGroup } from './Popover'
import { ProbabilityChart } from './ProbabilityChart'
import {
  BlochVectorHint,
  CurrentStateHint,
  EvolutionHint,
  InitialStateHint,
  ProbabilitiesHint,
} from './SectionHints'
import { morphDigits } from './digitMorph'

/** KaTeX renders TeX `-` as U+2212. Signs in live slots must match. */
const KATEX_MINUS = '\u2212'

function signedAxis(v: number, pos: string, neg: string): string {
  return v < 0 ? neg : pos
}

function TeachingNote({ hamiltonian }: { hamiltonian: HamiltonianParams }) {
  const { omega, OmegaX, OmegaY, epsilon } = hamiltonian
  const ax = Math.abs(OmegaX)
  const ay = Math.abs(OmegaY)
  const az = Math.abs(omega)
  const ae = Math.abs(epsilon)

  let body
  if (ax < 0.01 && ay < 0.01 && az < 0.01) {
    body =
      ae < 0.01 ? (
        <p>
          <KatexInline math="H = 0" />: the state is stationary.
        </p>
      ) : (
        <p>
          <KatexInline math={String.raw`H = \varepsilon I`} />: the Bloch vector is
          stationary. <KatexInline math="I" /> is a global energy, the spectrum is
          degenerate, <KatexInline math={String.raw`E = \varepsilon`} />.
        </p>
      )
  } else if (ax < 0.01 && ay < 0.01) {
    body = (
      <p>
        Dominant <KatexInline math={String.raw`\sigma_z`} /> term: the Bloch vector
        precesses around the <KatexInline math={signedAxis(omega, '+z', '-z')} /> axis
        at Larmor frequency <KatexInline math={String.raw`|\omega|`} />.
      </p>
    )
  } else if (az < 0.01 && ay < 0.01) {
    body = (
      <p>
        Dominant <KatexInline math={String.raw`\sigma_x`} /> term: the Bloch vector
        rotates around the <KatexInline math={signedAxis(OmegaX, '+x', '-x')} /> axis at
        Rabi frequency <KatexInline math={String.raw`|\Omega_x|`} />.
      </p>
    )
  } else if (az < 0.01 && ax < 0.01) {
    body = (
      <p>
        Dominant <KatexInline math={String.raw`\sigma_y`} /> term: the Bloch vector
        rotates around the <KatexInline math={signedAxis(OmegaY, '+y', '-y')} /> axis at
        Rabi frequency <KatexInline math={String.raw`|\Omega_y|`} />.
      </p>
    )
  } else {
    body = (
      <p>
        General Pauli Hamiltonian: rotation about axis{' '}
        <KatexInline math={String.raw`(\Omega_x, \Omega_y, \omega)`} /> with angular speed{' '}
        <KatexInline math={String.raw`\omega_R = \sqrt{\omega^2 + \Omega_x^2 + \Omega_y^2}`} />.
      </p>
    )
  }


  return body
}

function katexSign(n: number): string {
  return n >= 0 ? '+' : KATEX_MINUS
}

function setText(el: Element, value: string) {
  if (el.textContent !== value) el.textContent = value
}

function hideKatexMathml(host: HTMLElement) {
  host.querySelector('.katex-mathml')?.setAttribute('aria-hidden', 'true')
}

type AmplitudeSlots = {
  reSign: Element
  re: Element
  imSign: Element
  im: Element
}

function queryAmplitudeRows(host: HTMLElement): AmplitudeSlots[] | null {
  const html = host.querySelector('.katex-html')
  if (!html) return null
  const rows = [...html.querySelectorAll('.mtable .vlist > span')].filter((row) =>
    row.querySelector('.mathtt'),
  )
  if (rows.length !== 2) return null

  const slots: AmplitudeSlots[] = []
  for (const row of rows) {
    const matt = row.querySelectorAll('.mord.mathtt')
    const reSign = [...row.querySelectorAll('.mord')].find((el) => {
      const text = el.textContent
      return text === '+' || text === KATEX_MINUS
    })
    const imSign = row.querySelector('.mbin')
    if (matt.length !== 2 || !reSign || !imSign) return null
    slots.push({ reSign, re: matt[0], imSign, im: matt[1] })
  }
  return slots
}

function writeAmplitude(slots: AmplitudeSlots, c: Complex) {
  setText(slots.reSign, katexSign(c.re))
  morphDigits(slots.re, Math.abs(c.re).toFixed(2))
  setText(slots.imSign, katexSign(c.im))
  morphDigits(slots.im, `${Math.abs(c.im).toFixed(2)}i`)
}

type BlochSlots = { sign: Element; mag: Element }[]

function queryBlochSlots(host: HTMLElement): BlochSlots | null {
  const html = host.querySelector('.katex-html')
  if (!html) return null
  const bases = html.querySelectorAll('.base')
  const tuple = bases[bases.length - 1]
  if (!tuple) return null
  const mords = [...tuple.querySelectorAll(':scope > .mord')]
  if (mords.length !== 6) return null
  return [
    { sign: mords[0], mag: mords[1] },
    { sign: mords[2], mag: mords[3] },
    { sign: mords[4], mag: mords[5] },
  ]
}

function writeBlochSlots(slots: BlochSlots, bloch: BlochVector) {
  const components = [bloch.x, bloch.y, bloch.z]
  for (let i = 0; i < 3; i++) {
    const value = components[i]
    setText(slots[i].sign, katexSign(value))
    setText(slots[i].mag, Math.abs(value).toFixed(2))
  }
}

/**
 * Live |ψ⟩ readout. Subscribes to the store without React: KaTeX chrome is
 * painted once, then only the amplitude text nodes are updated.
 */
const CurrentStateReadout = memo(function CurrentStateReadout() {
  const hostRef = useRef<HTMLDivElement>(null)
  const psi = useQuantumStore.getState().psi
  const initialHtml = renderKatex(stateVectorKatex(psi[0], psi[1]), true)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    host.setAttribute('role', 'math')
    hideKatexMathml(host)

    let slots = queryAmplitudeRows(host)
    let lastKey = ''

    const apply = () => {
      const next = useQuantumStore.getState().psi
      const a = C.formatFixed(next[0])
      const b = C.formatFixed(next[1])
      const key = `${a}|${b}`
      if (key === lastKey) return
      lastKey = key
      host.setAttribute('aria-label', `psi = (${a}, ${b})`)

      if (slots) {
        writeAmplitude(slots[0], next[0])
        writeAmplitude(slots[1], next[1])
        return
      }

      host.innerHTML = renderKatex(stateVectorKatex(next[0], next[1]), true)
      hideKatexMathml(host)
      slots = queryAmplitudeRows(host)
    }

    apply()
    return useQuantumStore.subscribe(apply)
  }, [])

  return <div ref={hostRef} className="math-katex-block" dangerouslySetInnerHTML={{ __html: initialHtml }} />
})

/**
 * Live Bloch vector readout. Same pattern as CurrentStateReadout: static
 * KaTeX chrome, text-node updates at display precision.
 */
const BlochReadout = memo(function BlochReadout() {
  const hostRef = useRef<HTMLDivElement>(null)
  const bloch = useQuantumStore.getState().bloch
  const initialHtml = renderKatex(blochVectorKatex(bloch.x, bloch.y, bloch.z), true)

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return

    host.setAttribute('role', 'math')
    hideKatexMathml(host)

    let slots = queryBlochSlots(host)
    let lastKey = ''

    const apply = () => {
      const next = useQuantumStore.getState().bloch
      const x = formatRealFixed(next.x)
      const y = formatRealFixed(next.y)
      const z = formatRealFixed(next.z)
      const key = `${x}|${y}|${z}`
      if (key === lastKey) return
      lastKey = key
      host.setAttribute('aria-label', `Bloch vector = (${x}, ${y}, ${z})`)

      if (slots) {
        writeBlochSlots(slots, next)
        return
      }

      host.innerHTML = renderKatex(blochVectorKatex(next.x, next.y, next.z), true)
      hideKatexMathml(host)
      slots = queryBlochSlots(host)
    }

    apply()
    return useQuantumStore.subscribe(apply)
  }, [])

  return <div ref={hostRef} className="math-katex-block" dangerouslySetInnerHTML={{ __html: initialHtml }} />
})

const ProbabilityBars = memo(function ProbabilityBars() {
  const fill0Ref = useRef<HTMLDivElement>(null)
  const fill1Ref = useRef<HTMLDivElement>(null)
  const val0Ref = useRef<HTMLSpanElement>(null)
  const val1Ref = useRef<HTMLSpanElement>(null)

  const psi = useQuantumStore.getState().psi
  const p0 = C.abs2(psi[0]) * 100
  const p1 = C.abs2(psi[1]) * 100

  useLayoutEffect(() => {
    let last0 = ''
    let last1 = ''

    const apply = () => {
      const next = useQuantumStore.getState().psi
      const next0 = C.abs2(next[0]) * 100
      const next1 = C.abs2(next[1]) * 100
      if (fill0Ref.current) fill0Ref.current.style.width = `${next0}%`
      if (fill1Ref.current) fill1Ref.current.style.width = `${next1}%`
      const t0 = `${next0.toFixed(1)}%`
      const t1 = `${next1.toFixed(1)}%`
      if (val0Ref.current && t0 !== last0) {
        val0Ref.current.textContent = t0
        last0 = t0
      }
      if (val1Ref.current && t1 !== last1) {
        val1Ref.current.textContent = t1
        last1 = t1
      }
    }

    apply()
    return useQuantumStore.subscribe(apply)
  }, [])

  return (
    <div className="prob-bars">
      <div className="prob-row">
        <span className="prob-label">
          <KatexInline math={probKetKatex(0)} />
        </span>
        <div className="prob-track">
          <div ref={fill0Ref} className="prob-fill prob-fill-0" style={{ width: `${p0}%` }} />
        </div>
        <span ref={val0Ref} className="prob-value">
          {p0.toFixed(1)}%
        </span>
      </div>
      <div className="prob-row">
        <span className="prob-label">
          <KatexInline math={probKetKatex(1)} />
        </span>
        <div className="prob-track">
          <div ref={fill1Ref} className="prob-fill prob-fill-1" style={{ width: `${p1}%` }} />
        </div>
        <span ref={val1Ref} className="prob-value">
          {p1.toFixed(1)}%
        </span>
      </div>
    </div>
  )
})

export function DiracPanel() {
  const hamiltonian = useQuantumStore((s) => s.hamiltonian)
  const initialStateId = useQuantumStore((s) => s.initialStateId)
  const setInitialState = useQuantumStore((s) => s.setInitialState)

  return (
    <div className="dirac-panel">
      <div className="panel-header">
        <span className="panel-label">State &amp; Notation</span>
      </div>

      <PopoverGroup>
        <Popover content={<InitialStateHint />}>
          <section className="dirac-section">
            <h3 className="section-title">Initial state</h3>
            <div className="state-preset-row">
              {INITIAL_STATE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`btn btn-ghost state-btn ${initialStateId === preset.id ? 'active' : ''}`}
                  onClick={() => setInitialState(preset.id)}
                  title={preset.label}
                >
                  <KatexInline math={preset.name} />
                </button>
              ))}
            </div>
          </section>
        </Popover>

        <Popover content={<EvolutionHint />}>
          <section className="dirac-section dirac-evolution">
            <h3 className="section-title">Evolution</h3>
            <KatexBlock math={evolutionKatex()} />
          </section>
        </Popover>

        <Popover content={<CurrentStateHint />}>
          <section className="dirac-section dirac-divided">
            <h3 className="section-title">Current state</h3>
            <CurrentStateReadout />
          </section>
        </Popover>

        <Popover content={<ProbabilitiesHint />}>
          <section className="dirac-section dirac-divided">
            <h3 className="section-title">Probabilities</h3>
            <ProbabilityBars />
            <ProbabilityChart />
          </section>
        </Popover>

        <Popover content={<BlochVectorHint />}>
          <section className="dirac-section dirac-bloch">
            <h3 className="section-title">Bloch vector</h3>
            <BlochReadout />
          </section>
        </Popover>
      </PopoverGroup>

      <section className="dirac-section teaching-box">
        <h3 className="section-title">What's happening?</h3>
        <TeachingNote hamiltonian={hamiltonian} />
      </section>
    </div>
  )
}
