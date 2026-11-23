/**
 * Phasor arithmetic — the minimum complex-number algebra the 3-phase (M3) solver
 * needs, as pure functions with no external dependency.
 *
 * A phasor is an RMS magnitude at an angle: `phasor(230.94, -120)`. Internally it
 * is a Cartesian complex number { re, im }; magnitude/angle are derived. This is
 * why line-to-line voltage is NEVER a stored table — |V_RS| falls out of the
 * phasor difference V_RN − V_SN and equals √3·|V_LN| by construction.
 *
 * Deterministic (only trig/arithmetic — no clock, no randomness), so the solver
 * built on it stays as testable as the DC one.
 */

export interface Complex {
  re: number
  im: number
}

const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI

export const CZERO: Complex = { re: 0, im: 0 }

export function complex(re: number, im = 0): Complex {
  return { re, im }
}

/** An RMS magnitude at an angle in DEGREES → its Cartesian complex form. */
export function phasor(magnitude: number, angleDegrees: number): Complex {
  const radians = angleDegrees * DEG_TO_RAD
  return { re: magnitude * Math.cos(radians), im: magnitude * Math.sin(radians) }
}

export function add(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im }
}

export function sub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im }
}

export function mul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }
}

export function scale(a: Complex, k: number): Complex {
  return { re: a.re * k, im: a.im * k }
}

export function div(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im
  if (denom === 0) return { re: 0, im: 0 }
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  }
}

export function conjugate(a: Complex): Complex {
  return { re: a.re, im: -a.im }
}

/** RMS magnitude |z|. */
export function magnitude(a: Complex): number {
  return Math.hypot(a.re, a.im)
}

/** Angle in DEGREES, in (−180, 180]. */
export function angleDegrees(a: Complex): number {
  return Math.atan2(a.im, a.re) * RAD_TO_DEG
}
