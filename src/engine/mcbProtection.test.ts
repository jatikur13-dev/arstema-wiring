/**
 * MCB protection (M3-C3) — EDUCATIONAL. A closed pole is a sense-branch, so its
 * current is measured; a thermal model accumulates and trips (latching), an optional
 * curve gives an instantaneous trip, a 3-pole MCB trips all poles in common, and a
 * trip is reset only when the handle is OFF and the element has cooled. Time-stepped:
 * thermal/trip advance ONLY in `tick`.
 */
import { describe, expect, it } from 'vitest'
import type { Board } from './types'
import { mcbProtectionStep } from './conduction'
import { circuitReducer, initialCircuitState, type CircuitState } from './engine'

const prot = (over: Partial<Parameters<typeof mcbProtectionStep>[2]> = {}) => ({
  heatingRate: 0.002,
  coolingRate: 0.001,
  thermalTripThreshold: 1,
  curve: null,
  ...over,
})
const fresh = { thermalLevel: 0, tripped: false, tripReason: null }

describe('mcbProtectionStep (pure)', () => {
  it('under rated: cools toward 0, never trips', () => {
    const st = mcbProtectionStep({ thermalLevel: 0.5, tripped: false, tripReason: null }, 10, prot(), [5], 100)
    expect(st.thermalLevel).toBeCloseTo(0.4, 6) // 0.5 − 0.001·100
    expect(st.tripped).toBe(false)
  })

  it('sustained over-current → THERMAL trip (accumulation, latching)', () => {
    let st = mcbProtectionStep(fresh, 10, prot(), [15], 100) // (1.5²−1)=1.25 → +0.25
    expect(st.thermalLevel).toBeCloseTo(0.25, 6)
    expect(st.tripped).toBe(false)
    for (let i = 0; i < 3; i += 1) st = mcbProtectionStep(st, 10, prot(), [15], 100) // → 1.0
    expect(st.tripped).toBe(true)
    expect(st.tripReason).toBe('THERMAL')
  })

  it('a brief over-current does NOT trip', () => {
    let st = mcbProtectionStep(fresh, 10, prot(), [20], 100)
    expect(st.tripped).toBe(false)
    st = mcbProtectionStep(st, 10, prot(), [0], 100)
    expect(st.tripped).toBe(false)
  })

  it('a curve gives an INSTANTANEOUS trip at curveMultiplier × rated (B=4×)', () => {
    const st = mcbProtectionStep(fresh, 10, prot({ curve: 'B' }), [45], 100) // 45 ≥ 4·10
    expect(st.tripped).toBe(true)
    expect(st.tripReason).toBe('INSTANTANEOUS')
    // Without a curve, the same current only heats (no instantaneous trip yet).
    expect(mcbProtectionStep(fresh, 10, prot(), [45], 1).tripped).toBe(false)
  })

  it('3-pole: evaluates the MAX pole (common trip)', () => {
    const st = mcbProtectionStep(fresh, 10, prot({ curve: 'B' }), [2, 50, 3], 100)
    expect(st.tripped).toBe(true) // one pole ≥ 40 trips the whole device
  })

  it('stays finite for absurd inputs', () => {
    const st = mcbProtectionStep(fresh, 10, prot(), [Infinity, NaN, -5], 100)
    expect(Number.isFinite(st.thermalLevel)).toBe(true)
  })
})

// === integration through the reducer (time-stepped) =========================

function overloadBoard(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
      QF: {
        id: 'QF',
        cell: { x: 2, y: 0 },
        spec: {
          kind: 'BREAKER_1P',
          on: true,
          ratedAmps: 10,
          heatingRate: 0.002,
          coolingRate: 0.0005, // gradual, so a just-tripped MCB is still "hot" for a while
          thermalTripThreshold: 1,
          resetThreshold: 0.2,
        },
      },
      // ~15 A (finite over-current, NOT a short); rated high so the LOAD itself never faults.
      RL: { id: 'RL', cell: { x: 4, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 14.7, ratedCurrentAmps: 50 } },
    },
    wires: {
      w1: { id: 'w1', from: { componentId: 'S', index: 0 }, to: { componentId: 'QF', index: 0 } },
      w2: { id: 'w2', from: { componentId: 'QF', index: 1 }, to: { componentId: 'RL', index: 0 } },
      w3: { id: 'w3', from: { componentId: 'RL', index: 1 }, to: { componentId: 'S', index: 1 } },
    },
  }
}
const runTicks = (s: CircuitState, n: number, dt = 100): CircuitState => {
  for (let i = 0; i < n; i += 1) s = circuitReducer(s, { type: 'TICK', dtMs: dt })
  return s
}

describe('MCB protection integration (time-stepped)', () => {
  it('carries current when closed; a sustained overload trips → contacts open → reset gated', () => {
    let s = initialCircuitState(overloadBoard())
    expect(s.solution.loadCurrent.RL).toBeGreaterThan(10) // ~15 A flows while closed
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 6) // accumulate thermal → trip
    expect(s.mcbRuntime.QF.tripped).toBe(true)
    expect(s.mcbRuntime.QF.tripReason).toBe('THERMAL')
    expect(s.solution.loadCurrent.RL ?? 0).toBeLessThan(1e-6) // pole open → no current

    // Handle ON but TRIPPED → still open (reset rejected: handle must go OFF first).
    let rejected = circuitReducer(s, { type: 'RESET_MCB', id: 'QF' })
    expect(rejected.mcbRuntime.QF.tripped).toBe(true)

    // Turn the handle OFF; still hot → reset rejected.
    s = circuitReducer(s, { type: 'TOGGLE_SWITCH', id: 'QF' })
    expect(s.mcbRuntime.QF.thermalLevel).toBeGreaterThan(0.2)
    rejected = circuitReducer(s, { type: 'RESET_MCB', id: 'QF' })
    expect(rejected.mcbRuntime.QF.tripped).toBe(true)

    // Cool down (open → no current) then reset SUCCEEDS; MCB stays OFF.
    s = runTicks(s, 60)
    expect(s.mcbRuntime.QF.thermalLevel).toBeLessThanOrEqual(0.2)
    s = circuitReducer(s, { type: 'RESET_MCB', id: 'QF' })
    expect(s.mcbRuntime.QF.tripped).toBe(false)
    const spec = s.board.components.QF.spec
    expect(spec.kind === 'BREAKER_1P' && spec.on).toBe(false) // stays OFF after reset
  })

  it('3-pole: an over-current on the poles trips ALL three in common (poles open together)', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } },
        QF3: {
          id: 'QF3',
          cell: { x: 2, y: 0 },
          spec: { kind: 'BREAKER_3P', on: true, ratedAmps: 10, heatingRate: 0.01, coolingRate: 0.0005, thermalTripThreshold: 1, resetThreshold: 0.2 },
        },
        // Low-resistance star to neutral → ~46 A/line ≫ 10 A rated.
        M: { id: 'M', cell: { x: 4, y: 0 }, spec: { kind: 'MOTOR_3PH', windingResistanceOhms: 5, ratedCurrentAmps: 100 } },
      },
      wires: {
        r1: { id: 'r1', from: { componentId: 'Q', index: 0 }, to: { componentId: 'QF3', index: 0 } },
        r2: { id: 'r2', from: { componentId: 'QF3', index: 1 }, to: { componentId: 'M', index: 0 } },
        s1: { id: 's1', from: { componentId: 'Q', index: 1 }, to: { componentId: 'QF3', index: 2 } },
        s2: { id: 's2', from: { componentId: 'QF3', index: 3 }, to: { componentId: 'M', index: 2 } },
        t1: { id: 't1', from: { componentId: 'Q', index: 2 }, to: { componentId: 'QF3', index: 4 } },
        t2: { id: 't2', from: { componentId: 'QF3', index: 5 }, to: { componentId: 'M', index: 4 } },
        n1: { id: 'n1', from: { componentId: 'M', index: 1 }, to: { componentId: 'Q', index: 3 } },
        n2: { id: 'n2', from: { componentId: 'M', index: 3 }, to: { componentId: 'Q', index: 3 } },
        n3: { id: 'n3', from: { componentId: 'M', index: 5 }, to: { componentId: 'Q', index: 3 } },
      },
    }
    let s = initialCircuitState(board)
    expect(s.threePhase!.lineCurrent.R).toBeGreaterThan(10) // all three poles carry ~46 A
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 2)
    expect(s.mcbRuntime.QF3.tripped).toBe(true)
    expect(s.mcbRuntime.QF3.poleCurrents).toHaveLength(3) // sensed R/S/T separately
    // Common trip: EVERY pole is now open → no line current on any phase.
    expect(s.threePhase!.lineCurrent.R).toBeLessThan(1e-6)
    expect(s.threePhase!.lineCurrent.S).toBeLessThan(1e-6)
    expect(s.threePhase!.lineCurrent.T).toBeLessThan(1e-6)
  })

  it('a structured source conflict yields NO current → MCB does not trip (fault not modelled)', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } },
        // A curve MCB would instantaneous-trip IF a current existed — but a conflict has none.
        QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { kind: 'BREAKER_3P', on: true, ratedAmps: 10, curve: 'B' } },
      },
      wires: {
        r: { id: 'r', from: { componentId: 'Q', index: 0 }, to: { componentId: 'QF3', index: 0 } },
        s: { id: 's', from: { componentId: 'Q', index: 1 }, to: { componentId: 'QF3', index: 2 } },
        // Tie two source phases directly → PHASE_TO_PHASE_SHORT (structured, no magnitude).
        bad: { id: 'bad', from: { componentId: 'Q', index: 0 }, to: { componentId: 'Q', index: 1 } },
      },
    }
    let s = initialCircuitState(board)
    expect(s.threePhase?.fault?.code).toBe('PHASE_TO_PHASE_SHORT')
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 5)
    expect(s.mcbRuntime.QF3.tripped).toBe(false) // no fabricated fault current → no trip
    expect(s.threePhase?.fault?.code).toBe('PHASE_TO_PHASE_SHORT') // still a structured fault
  })

  // === M3-C3.1 direct-source guard =========================================
  const SRC3 = { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } as const

  it('MCB_1P pole directly across a phase and neutral → PHASE_TO_NEUTRAL_SHORT, the MCB trips (L2)', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        // curve B WOULD instantaneous-trip on a real current — but a conflict has none.
        QF: { id: 'QF', cell: { x: 2, y: 0 }, spec: { kind: 'BREAKER_1P', on: true, ratedAmps: 10, curve: 'B' } },
      },
      wires: {
        a: { id: 'a', from: { componentId: 'QF', index: 0 }, to: { componentId: 'Q', index: 0 } }, // L_IN → R
        b: { id: 'b', from: { componentId: 'QF', index: 1 }, to: { componentId: 'Q', index: 3 } }, // L_OUT → N
      },
    }
    let s = initialCircuitState(board)
    expect(s.threePhase?.fault?.code).toBe('PHASE_TO_NEUTRAL_SHORT')
    // Matrix never ran → NO fabricated ΔV/R_SENSE current, all finite.
    expect(Object.keys(s.threePhase!.branchCurrentPhasor)).toHaveLength(0)
    expect(Number.isFinite(s.threePhase!.lineCurrent.R)).toBe(true)
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 5)
    // Audit 21 Nov 2026, L2: the MCB carries the whole short, so its instantaneous
    // release opens it (before: the lever stayed ON and nothing tripped).
    expect(s.mcbRuntime.QF.tripped).toBe(true)
    expect(s.mcbRuntime.QF.tripReason).toBe('INSTANTANEOUS')
    expect(s.status).toBe('FAULTED')
    expect(s.fault?.code).toBe('SHORT_CIRCUIT_TRIPPED')
    expect(s.fault?.devices).toEqual([{ id: 'QF', kind: 'MCB' }])
    expect([...(s.fault?.conductors ?? [])].sort()).toEqual(['N', 'R'])
    expect(s.threePhase?.fault).toBeUndefined() // the open pole cleared the short
  })

  it('MCB_3P pole directly across R–S → PHASE_TO_PHASE_SHORT (guard, no fabricated current)', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { kind: 'BREAKER_3P', on: true, ratedAmps: 10 } },
      },
      wires: {
        a: { id: 'a', from: { componentId: 'QF3', index: 0 }, to: { componentId: 'Q', index: 0 } }, // R_IN → R
        b: { id: 'b', from: { componentId: 'QF3', index: 1 }, to: { componentId: 'Q', index: 1 } }, // R_OUT → S
      },
    }
    const s = initialCircuitState(board)
    expect(s.threePhase?.fault?.code).toBe('PHASE_TO_PHASE_SHORT')
    expect(Object.keys(s.threePhase!.branchCurrentPhasor)).toHaveLength(0)
    expect(s.mcbRuntime.QF3?.tripped ?? false).toBe(false)
  })

  it('an MCB in series with a real load is NOT flagged — the sense-branch current is measured', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        QF: { id: 'QF', cell: { x: 2, y: 0 }, spec: { kind: 'BREAKER_1P', on: true, ratedAmps: 10 } },
        M: { id: 'M', cell: { x: 4, y: 0 }, spec: { kind: 'MOTOR_3PH', windingResistanceOhms: 20, ratedCurrentAmps: 100 } },
      },
      wires: {
        a: { id: 'a', from: { componentId: 'Q', index: 0 }, to: { componentId: 'QF', index: 0 } }, // R → L_IN
        b: { id: 'b', from: { componentId: 'QF', index: 1 }, to: { componentId: 'M', index: 0 } }, // L_OUT → U1
        n: { id: 'n', from: { componentId: 'M', index: 1 }, to: { componentId: 'Q', index: 3 } }, // U2 → N
      },
    }
    const s = initialCircuitState(board)
    expect(s.threePhase?.fault).toBeUndefined() // NOT a conflict — one source terminal per node
    const c = s.threePhase!.branchCurrentPhasor.QF
    expect(c && Math.hypot(c.re, c.im)).toBeGreaterThan(1) // ~11.5 A observed through the pole
  })

  // === M3-C3.2 DC / 1-phase direct-source guard ============================
  const dcBoard = (on: boolean, load?: number): Board => ({
    components: {
      S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
      QF: { id: 'QF', cell: { x: 2, y: 0 }, spec: { kind: 'BREAKER_1P', on, ratedAmps: 10, curve: 'B' } },
      ...(load !== undefined
        ? { RL: { id: 'RL', cell: { x: 4, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: load, ratedCurrentAmps: 50 } } }
        : {}),
    },
    wires:
      load !== undefined
        ? {
            a: { id: 'a', from: { componentId: 'S', index: 0 }, to: { componentId: 'QF', index: 0 } },
            b: { id: 'b', from: { componentId: 'QF', index: 1 }, to: { componentId: 'RL', index: 0 } },
            c: { id: 'c', from: { componentId: 'RL', index: 1 }, to: { componentId: 'S', index: 1 } },
          }
        : {
            a: { id: 'a', from: { componentId: 'S', index: 0 }, to: { componentId: 'QF', index: 0 } }, // L → L_IN
            b: { id: 'b', from: { componentId: 'QF', index: 1 }, to: { componentId: 'S', index: 1 } }, // L_OUT → N
          },
  })

  it('DC: MCB_1P ON directly across L–N → shorted, no fabricated current, then the MCB trips (L2)', () => {
    let s = initialCircuitState(dcBoard(true))
    expect(s.solution.shorted).toBe(true) // as a bare wire L–N would be
    expect(s.solution.sourceCurrent).toBe(0) // no emf/R_SENSE fabricated
    expect(Object.keys(s.solution.loadCurrent)).toHaveLength(0)
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 5)
    expect(s.mcbRuntime.QF?.tripped).toBe(true)
    expect(s.mcbRuntime.QF?.tripReason).toBe('INSTANTANEOUS')
    expect(s.fault?.code).toBe('SHORT_CIRCUIT_TRIPPED')
    expect(s.fault?.measured.ratedAmps).toBe(10)
    expect(s.solution.shorted).toBe(false)
  })

  it('DC: MCB_1P OFF across L–N → open, not shorted, no current', () => {
    const s = initialCircuitState(dcBoard(false))
    expect(s.solution.shorted).toBe(false)
    expect(s.solution.sourceCurrent).toBe(0)
  })

  it('DC: MCB_1P ON in series with a load → not shorted, finite pole current observable', () => {
    const s = initialCircuitState(dcBoard(true, 529))
    expect(s.solution.shorted).toBe(false)
    expect(s.solution.loadCurrent.RL).toBeGreaterThan(0)
    expect(s.solution.loadCurrent.QF).toBeGreaterThan(0) // MCB sense-branch current measured
  })

  it('DC: a bare wire L–N (no MCB) still shorts — policy unchanged', () => {
    const board: Board = {
      components: { S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } } },
      wires: { w: { id: 'w', from: { componentId: 'S', index: 0 }, to: { componentId: 'S', index: 1 } } },
    }
    expect(initialCircuitState(board).solution.shorted).toBe(true)
  })

  it('SEPARATION: thermal advances only under TICK', () => {
    let s = initialCircuitState(overloadBoard())
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 2)
    const level = s.mcbRuntime.QF.thermalLevel
    expect(level).toBeGreaterThan(0)
    s = circuitReducer(s, { type: 'SET_RUNNING', running: false })
    s = circuitReducer(s, { type: 'TICK', dtMs: 100 }) // ignored while paused
    expect(s.mcbRuntime.QF.thermalLevel).toBe(level) // frozen
  })
})


