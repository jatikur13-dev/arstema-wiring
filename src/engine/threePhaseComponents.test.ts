import { describe, expect, it } from 'vitest'
import type { Board, PlacedComponent } from './types'
import {
  TERMINAL_COUNT,
  SOURCE_3PH_TERMINAL,
  MOTOR_3PH_TERMINAL,
  CONTACTOR_TERMINAL,
  terminalKey,
} from './types'
import { buildNodes } from './topology'
import { DEFAULT_CONTACTOR_COIL_OHMS, bridgedPairs, resistiveBranch, resistiveBranches } from './conduction'

const at = (id: string, spec: PlacedComponent['spec']): PlacedComponent => ({
  id,
  cell: { x: 0, y: 0 },
  spec,
})

// === (A) terminal contract (permanent) ======================================

describe('(A) terminal contract', () => {
  it('terminal counts: SOURCE_3PH=4, MOTOR_3PH=7 including PE, CONTACTOR=12', () => {
    expect(TERMINAL_COUNT.SOURCE_3PH).toBe(4)
    expect(TERMINAL_COUNT.MOTOR_3PH).toBe(7)
    expect(TERMINAL_COUNT.CONTACTOR).toBe(12)
  })

  it('SOURCE_3PH index ↔ semantic (R,S,T,N) — locked to the engine order', () => {
    expect(SOURCE_3PH_TERMINAL).toEqual({ R: 0, S: 1, T: 2, N: 3 })
  })

  it('MOTOR_3PH index ↔ semantic 0=U1..5=W2, 6=PE — locked', () => {
    expect(MOTOR_3PH_TERMINAL).toEqual({ U1: 0, U2: 1, V1: 2, V2: 3, W1: 4, W2: 5, PE: 6 })
  })

  it('CONTACTOR index ↔ semantic A1..22 — locked', () => {
    expect(CONTACTOR_TERMINAL).toEqual({
      A1: 0,
      A2: 1,
      L1: 2,
      T1: 3,
      L2: 4,
      T2: 5,
      L3: 6,
      T3: 7,
      NO_13: 8,
      NO_14: 9,
      NC_21: 10,
      NC_22: 11,
    })
  })
})

// === (D) motor branch provider (real-only, additive) ========================

describe('(D) resistiveBranches — motor windings', () => {
  const motor = at('M3', { kind: 'MOTOR_3PH', windingResistanceOhms: 23.094, ratedCurrentAmps: 12 })

  it('MOTOR_3PH gives EXACTLY three branches: 0–1, 2–3, 4–5 (ordering locked)', () => {
    const branches = resistiveBranches(motor, {})
    expect(branches).toHaveLength(3)
    expect(branches.map((b) => [b.a, b.b])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ])
  })

  it('every winding resistance is finite and > 0', () => {
    for (const branch of resistiveBranches(motor, {})) {
      expect(Number.isFinite(branch.resistance)).toBe(true)
      expect(branch.resistance).toBeGreaterThan(0)
    }
  })

  it('invalid resistance (0) stays finite (no Infinity/NaN) — validated downstream like existing', () => {
    const zero = at('M3', { kind: 'MOTOR_3PH', windingResistanceOhms: 0, ratedCurrentAmps: 12 })
    for (const branch of resistiveBranches(zero, {})) {
      expect(Number.isFinite(branch.resistance)).toBe(true)
      expect(branch.resistance).toBe(0) // solver's `resistance > 0` guard skips it
    }
  })

  it('existing kinds are unchanged: one branch, identical to resistiveBranch', () => {
    const load = at('L1', { kind: 'LOAD', resistanceOhms: 100, ratedCurrentAmps: 5 })
    expect(resistiveBranches(load, {})).toEqual([resistiveBranch(load, {})])
    // Non-resistive kinds → no branch.
    expect(resistiveBranches(at('SW', { kind: 'SWITCH', closed: true }), {})).toEqual([])
    // A contactor now presents its COIL A1(0)–A2(1) as a branch (M3-B2), so its
    // node voltage is defined; a bare spec uses the educational default resistance.
    expect(resistiveBranches(at('KM', { kind: 'CONTACTOR' }), {})).toEqual([
      { a: 0, b: 1, resistance: DEFAULT_CONTACTOR_COIL_OHMS },
    ])
  })
})

// === (E) contactor mechanical-state seam (derived) ==========================

describe('(E) contactor state seam', () => {
  const km = at('KM', { kind: 'CONTACTOR' })

  it('default (de-energized) → NC 21–22 closed; main & NO open', () => {
    expect(bridgedPairs(km, {})).toEqual([[10, 11]])
  })

  it('energized → main L–T (2–3,4–5,6–7) & NO 13–14 (8–9) closed; NC open', () => {
    expect(bridgedPairs(km, {}, { KM: true })).toEqual([
      [2, 3],
      [4, 5],
      [6, 7],
      [8, 9],
    ])
  })

  it('main poles and aux follow ONE state', () => {
    const energized = bridgedPairs(km, {}, { KM: true })
    // all three main poles present, and NO present, NC absent
    expect(energized).toContainEqual([2, 3])
    expect(energized).toContainEqual([6, 7])
    expect(energized).toContainEqual([8, 9])
    expect(energized).not.toContainEqual([10, 11])
  })

  it('a missing entry (reset / default) is de-energized', () => {
    expect(bridgedPairs(km, {}, {})).toEqual([[10, 11]])
    expect(bridgedPairs(km, {}, { OTHER: true })).toEqual([[10, 11]])
  })

  it('feeds topology: energized closes L1–T1 into one node; default keeps them apart', () => {
    const board: Board = {
      components: { KM: { id: 'KM', cell: { x: 0, y: 0 }, spec: { kind: 'CONTACTOR' } } },
      wires: {},
    }
    const l1 = terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.L1 })
    const t1 = terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.T1 })
    const open = buildNodes(board, {}, {})
    expect(open.nodeOf.get(l1)).not.toBe(open.nodeOf.get(t1))
    const closed = buildNodes(board, {}, { KM: true })
    expect(closed.nodeOf.get(l1)).toBe(closed.nodeOf.get(t1))
  })

  it('the seam is NOT part of the Board (never serialized)', () => {
    const board: Board = {
      components: { KM: { id: 'KM', cell: { x: 0, y: 0 }, spec: { kind: 'CONTACTOR' } } },
      wires: {},
    }
    expect('contactorEnergized' in board).toBe(false)
    expect(board.components.KM.spec).toEqual({ kind: 'CONTACTOR' }) // no energized field
  })
})

