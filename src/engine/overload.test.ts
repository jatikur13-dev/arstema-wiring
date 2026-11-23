/**
 * Thermal overload (M3-C2) — EDUCATIONAL first-order model (NOT IEC I²t). Heats ∝
 * (I/rated)²−1 over rated, cools linearly under it, trips (latching) at the
 * normalised threshold, and is clamped finite. It is accumulation-based, so a brief
 * overcurrent does NOT trip.
 */
import { describe, expect, it } from 'vitest'
import type { OverloadSpec } from './types'
import { overloadThermalStep } from './conduction'

const OL: OverloadSpec = {
  kind: 'OVERLOAD_RELAY',
  ratedCurrentAmps: 10,
  tripMultiplier: 1,
  heatingRate: 0.001,
  coolingRate: 0.0005,
  resetThreshold: 0.2,
}

describe('overloadThermalStep (pure)', () => {
  it('under rated: cools toward 0 and never goes negative', () => {
    let st = overloadThermalStep({ thermalLevel: 0.5, tripped: false }, OL, 5, 100)
    expect(st.thermalLevel).toBeCloseTo(0.45, 6) // 0.5 − 0.0005·100
    st = overloadThermalStep({ thermalLevel: 0.01, tripped: false }, OL, 0, 1000)
    expect(st.thermalLevel).toBe(0) // clamped at 0
  })

  it('over rated: heats ∝ (I/rated)²−1 and trips (latching) at the threshold', () => {
    let st = overloadThermalStep({ thermalLevel: 0, tripped: false }, OL, 20, 100)
    expect(st.thermalLevel).toBeCloseTo(0.3, 6) // (2²−1)·0.001·100
    expect(st.tripped).toBe(false)
    for (let i = 0; i < 3; i += 1) st = overloadThermalStep(st, OL, 20, 100) // → 1.2 ≥ 1
    expect(st.tripped).toBe(true)
  })

  it('a brief overcurrent does NOT trip (accumulation, not instantaneous)', () => {
    let st = overloadThermalStep({ thermalLevel: 0, tripped: false }, OL, 30, 100)
    expect(st.tripped).toBe(false)
    st = overloadThermalStep(st, OL, 0, 100) // current gone → cools back down
    expect(st.thermalLevel).toBeLessThan(0.8)
    expect(st.tripped).toBe(false)
  })

  it('the trip latches through cooling (reset is a separate, gated action)', () => {
    const st = overloadThermalStep({ thermalLevel: 1.2, tripped: true }, OL, 0, 100)
    expect(st.tripped).toBe(true) // still tripped…
    expect(st.thermalLevel).toBeLessThan(1.2) // …though cooling
  })

  it('stays finite for absurd inputs (no NaN/Infinity)', () => {
    for (const i of [Infinity, -5, NaN]) {
      const st = overloadThermalStep({ thermalLevel: 0.3, tripped: false }, OL, i, 100)
      expect(Number.isFinite(st.thermalLevel)).toBe(true)
    }
  })
})


