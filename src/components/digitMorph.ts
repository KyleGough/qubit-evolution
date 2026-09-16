/** Mechanical-counter digit morph for live KaTeX amplitude slots. */

const DIGIT_CHARS = '0123456789'
const ROLL_MS = 280

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function buildRollCell(digit: string): HTMLSpanElement {
  const cell = document.createElement('span')
  cell.className = 'digit-roll'
  cell.setAttribute('aria-hidden', 'true')

  const track = document.createElement('span')
  track.className = 'digit-roll-track'
  for (const d of DIGIT_CHARS) {
    const face = document.createElement('span')
    face.className = 'digit-roll-face'
    face.textContent = d
    track.appendChild(face)
  }
  cell.appendChild(track)
  setRollOffset(track, digit, false)
  return cell
}

function setRollOffset(track: HTMLElement, digit: string, animate: boolean) {
  const idx = DIGIT_CHARS.indexOf(digit)
  if (idx < 0) return
  if (!animate) {
    track.style.transition = 'none'
  } else {
    track.style.transition = `transform ${ROLL_MS}ms var(--spring, cubic-bezier(0.34, 1.35, 0.64, 1))`
  }
  track.style.transform = `translateY(${-idx}em)`
  if (!animate) {
    // Force reflow so the next animated change still transitions.
    void track.offsetHeight
    track.style.transition = `transform ${ROLL_MS}ms var(--spring, cubic-bezier(0.34, 1.35, 0.64, 1))`
  }
}

function clearMorph(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild)
}

/**
 * Set `el` to `next`, rolling digit columns when a displayed digit changes.
 * Non-digit characters (`.`, `i`, …) stay static. Snaps under reduced motion.
 */
export function morphDigits(el: Element, next: string) {
  const host = el as HTMLElement
  if (prefersReducedMotion()) {
    clearMorph(host)
    host.textContent = next
    host.removeAttribute('data-digit-morph')
    return
  }

  const prev = host.getAttribute('data-digit-morph')
  if (prev === next) return

  const reuse =
    host.getAttribute('data-digit-morph') !== null &&
    host.childNodes.length > 0 &&
    prev !== null &&
    prev.length === next.length

  if (!reuse) {
    clearMorph(host)
    host.setAttribute('data-digit-morph', next)
    for (const ch of next) {
      if (isDigit(ch)) {
        host.appendChild(buildRollCell(ch))
      } else {
        const lit = document.createElement('span')
        lit.className = 'digit-roll-static'
        lit.textContent = ch
        lit.setAttribute('aria-hidden', 'true')
        host.appendChild(lit)
      }
    }
    return
  }

  host.setAttribute('data-digit-morph', next)
  const nodes = [...host.childNodes]
  for (let i = 0; i < next.length; i++) {
    const ch = next[i]
    const node = nodes[i] as HTMLElement | undefined
    if (!node) continue

    if (isDigit(ch)) {
      if (!node.classList.contains('digit-roll')) {
        const cell = buildRollCell(ch)
        host.replaceChild(cell, node)
        continue
      }
      const track = node.querySelector('.digit-roll-track') as HTMLElement | null
      if (track) setRollOffset(track, ch, true)
    } else {
      if (node.classList.contains('digit-roll-static')) {
        if (node.textContent !== ch) node.textContent = ch
      } else {
        const lit = document.createElement('span')
        lit.className = 'digit-roll-static'
        lit.textContent = ch
        lit.setAttribute('aria-hidden', 'true')
        host.replaceChild(lit, node)
      }
    }
  }
}
