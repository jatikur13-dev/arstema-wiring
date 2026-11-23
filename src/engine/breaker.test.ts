/**
 * Breaker (M3-B1.5) — manual ON/OFF poles that reach the ACTUAL topology/solve.
 * Headless: contract (index/count), topology (buildNodes used by solve), and the
 * ON/OFF state driving both the DC solver (preset A shape) and the AC solver.
 * These cases isolate manual pole topology. Thermal/instantaneous trip behavior is
 * covered separately in mcbProtection.test.ts.
 */
import { describe, expect, it } from 'vitest'
import type { Board, PlacedComponent } from './types'
import { BREAKER_1P_TERMINAL, BREAKER_3P_TERMINAL, TERMINAL_COUNT, terminalKey } from './types'
import { bridgedPairs, resistiveBranch, resistiveBranches, MCB_SENSE_OHMS } from './conduction'
import { buildNodes } from './topology'
import { solveBoard } from './solve'
import { solveThreePhase } from './threePhase'
import { magnitude } from './phasor'
import { circuitReducer, initialCircuitState } from './engine'

const at = (id: string, spec: PlacedComponent['spec']): PlacedComponent => ({
  id,
  cell: { x: 0, y: 0 },
  spec,
})

// === contract ===============================================================

describe('breaker contract (index/count locked)', () => {
  it('terminal counts: BREAKER_1P=2, BREAKER_3P=6', () => {
    expect(TERMINAL_COUNT.BREAKER_1P).toBe(2)
    expect(TERMINAL_COUNT.BREAKER_3P).toBe(6)
  })

  it('index ↔ semantic locked', () => {
    expect(BREAKER_1P_TERMINAL).toEqual({ L_IN: 0, L_OUT: 1 })
    expect(BREAKER_3P_TERMINAL).toEqual({ R_IN: 0, R_OUT: 1, S_IN: 2, S_OUT: 3, T_IN: 4, T_OUT: 5 })
  })

  it('M3-C3: an MCB no longer BRIDGES (node-merges) — bridgedPairs is always []', () => {
    expect(bridgedPairs(at('QF', { kind: 'BREAKER_1P', on: true }), {})).toEqual([])
    expect(bridgedPairs(at('QF3', { kind: 'BREAKER_3P', on: true }), {})).toEqual([])
  })

  it('1P closed pole = ONE sense-branch L_IN↔L_OUT; open → none', () => {
    expect(resistiveBranch(at('QF', { kind: 'BREAKER_1P', on: true }), {})).toEqual({
      a: 0,
      b: 1,
      resistance: MCB_SENSE_OHMS,
    })
    expect(resistiveBranch(at('QF', { kind: 'BREAKER_1P', on: false }), {})).toBeNull()
  })

  it('3P closed = three sense-branches (R/S/T), off → none', () => {
    expect(resistiveBranches(at('QF3', { kind: 'BREAKER_3P', on: true }), {})).toEqual([
      { a: 0, b: 1, resistance: MCB_SENSE_OHMS },
      { a: 2, b: 3, resistance: MCB_SENSE_OHMS },
      { a: 4, b: 5, resistance: MCB_SENSE_OHMS },
    ])
    expect(resistiveBranches(at('QF3', { kind: 'BREAKER_3P', on: false }), {})).toEqual([])
  })

  it('closure reads spec.on AND the MCB trip runtime — a tripped pole opens', () => {
    const on = at('QF', { kind: 'BREAKER_1P', on: true })
    // on + not tripped → sense-branch; on + tripped → no branch (effective open).
    expect(resistiveBranch(on, {}, {})).not.toBeNull()
    const tripped = { mcb: { QF: { thermalLevel: 1, tripped: true, tripReason: 'THERMAL' as const, poleCurrents: [] } } }
    expect(resistiveBranch(on, {}, tripped)).toBeNull()
  })
})

// === topology (the SAME buildNodes the solver uses) =========================

describe('breaker topology via buildNodes', () => {
  const board1p = (on: boolean): Board => ({
    components: { QF: { id: 'QF', cell: { x: 0, y: 0 }, spec: { kind: 'BREAKER_1P', on } } },
    wires: {},
  })

  it('M3-C3: a pole is a sense-branch, NOT a node-merge — in↔out stay distinct nodes', () => {
    const inK = terminalKey({ componentId: 'QF', index: 0 })
    const outK = terminalKey({ componentId: 'QF', index: 1 })
    // ON or OFF, buildNodes never collapses the pole (the sense resistor connects them
    // in the SOLVER, not in the union-find topology).
    const on = buildNodes(board1p(true))
    expect(on.nodeOf.get(inK)).not.toBe(on.nodeOf.get(outK))
    const off = buildNodes(board1p(false))
    expect(off.nodeOf.get(inK)).not.toBe(off.nodeOf.get(outK))
  })

  it('3P poles never tie DIFFERENT poles together (no cross-phase merge)', () => {
    const board: Board = {
      components: { QF3: { id: 'QF3', cell: { x: 0, y: 0 }, spec: { kind: 'BREAKER_3P', on: true } } },
      wires: {},
    }
    const nodes = buildNodes(board)
    const k = (i: number) => nodes.nodeOf.get(terminalKey({ componentId: 'QF3', index: i }))
    expect(k(0)).not.toBe(k(2)) // R in not tied to S in
    expect(k(1)).not.toBe(k(3)) // R out not tied to S out
    expect(k(3)).not.toBe(k(5)) // S not tied to T
  })
})

// === ON/OFF drives the DC solve (preset A shape) ============================

describe('breaker ON/OFF drives the DC solve (SOURCE→BREAKER_1P→lamp→N)', () => {
  const board = (on: boolean): Board => ({
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
      QF: { id: 'QF', cell: { x: 2, y: 0 }, spec: { kind: 'BREAKER_1P', on } },
      L1: { id: 'L1', cell: { x: 4, y: 1 }, spec: { kind: 'LOAD', resistanceOhms: 529, ratedCurrentAmps: 0.5 } },
    },
    wires: {
      w1: { id: 'w1', from: { componentId: 'S', index: 0 }, to: { componentId: 'QF', index: 0 } },
      w2: { id: 'w2', from: { componentId: 'QF', index: 1 }, to: { componentId: 'L1', index: 0 } },
      w3: { id: 'w3', from: { componentId: 'L1', index: 1 }, to: { componentId: 'S', index: 1 } },
    },
  })

  it('ON: lamp lit (~0.42 A)', () => {
    const sol = solveBoard(board(true))
    expect(sol.loadCurrent.L1).toBeCloseTo(220 / 529, 3)
  })

  it('OFF: pole open → lamp current 0', () => {
    const sol = solveBoard(board(false))
    expect(sol.loadCurrent.L1 ?? 0).toBeLessThan(1e-9)
  })
})

// === ON/OFF drives the AC solve ============================================

describe('breaker ON/OFF drives the AC solve (SOURCE_3PH→BREAKER_3P→motor)', () => {
  const board = (on: boolean): Board => ({
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } },
      QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { kind: 'BREAKER_3P', on } },
      M3: { id: 'M3', cell: { x: 5, y: 0 }, spec: { kind: 'MOTOR_3PH', windingResistanceOhms: 23.094, ratedCurrentAmps: 12 } },
    },
    wires: {
      r1: { id: 'r1', from: { componentId: 'Q', index: 0 }, to: { componentId: 'QF3', index: 0 } },
      r2: { id: 'r2', from: { componentId: 'QF3', index: 1 }, to: { componentId: 'M3', index: 0 } },
      r3: { id: 'r3', from: { componentId: 'M3', index: 1 }, to: { componentId: 'Q', index: 3 } },
      s1: { id: 's1', from: { componentId: 'Q', index: 1 }, to: { componentId: 'QF3', index: 2 } },
      s2: { id: 's2', from: { componentId: 'QF3', index: 3 }, to: { componentId: 'M3', index: 2 } },
      s3: { id: 's3', from: { componentId: 'M3', index: 3 }, to: { componentId: 'Q', index: 3 } },
      t1: { id: 't1', from: { componentId: 'Q', index: 2 }, to: { componentId: 'QF3', index: 4 } },
      t2: { id: 't2', from: { componentId: 'QF3', index: 5 }, to: { componentId: 'M3', index: 4 } },
      t3: { id: 't3', from: { componentId: 'M3', index: 5 }, to: { componentId: 'Q', index: 3 } },
    },
  })

  it('ON: all three windings energized (~10 A each)', () => {
    const sol = solveThreePhase(board(true))
    expect(magnitude(sol.branchCurrentPhasor['M3#0'])).toBeCloseTo(10, 2)
    expect(magnitude(sol.branchCurrentPhasor['M3#1'])).toBeCloseTo(10, 2)
    expect(magnitude(sol.branchCurrentPhasor['M3#2'])).toBeCloseTo(10, 2)
    expect(sol.fault).toBeUndefined()
  })

  it('OFF: all poles open → windings 0 A, no fabricated fault', () => {
    const sol = solveThreePhase(board(false))
    expect(magnitude(sol.branchCurrentPhasor['M3#0'])).toBeLessThan(1e-9)
    expect(magnitude(sol.branchCurrentPhasor['M3#1'])).toBeLessThan(1e-9)
    expect(magnitude(sol.branchCurrentPhasor['M3#2'])).toBeLessThan(1e-9)
    expect(sol.fault).toBeUndefined()
  })
})

// === breaker state ownership: persisted, toggleable, undoable, snapshot-safe =

describe('breaker state ownership', () => {
  const on1p = (on: boolean): Board => ({
    components: { QF: { id: 'QF', cell: { x: 0, y: 0 }, spec: { kind: 'BREAKER_1P', on } } },
    wires: {},
  })
  const specOn = (s: ReturnType<typeof initialCircuitState>, id: string): boolean => {
    const spec = s.board.components[id].spec
    return spec.kind === 'BREAKER_1P' || spec.kind === 'BREAKER_3P' ? spec.on : false
  }

  it('TOGGLE_SWITCH flips BREAKER_1P.on (manual, like a SWITCH)', () => {
    let s = initialCircuitState(on1p(false))
    s = circuitReducer(s, { type: 'TOGGLE_SWITCH', id: 'QF' })
    expect(specOn(s, 'QF')).toBe(true)
    s = circuitReducer(s, { type: 'TOGGLE_SWITCH', id: 'QF' })
    expect(specOn(s, 'QF')).toBe(false)
  })

  it('TOGGLE_SWITCH flips BREAKER_3P.on (one handle → all poles)', () => {
    let s = initialCircuitState({
      components: { QF3: { id: 'QF3', cell: { x: 0, y: 0 }, spec: { kind: 'BREAKER_3P', on: false } } },
      wires: {},
    })
    s = circuitReducer(s, { type: 'TOGGLE_SWITCH', id: 'QF3' })
    expect(specOn(s, 'QF3')).toBe(true)
  })

  it('placement is undoable and redo restores the breaker WITH its on-state', () => {
    let s = initialCircuitState()
    s = circuitReducer(s, { type: 'PLACE_COMPONENT', id: 'QF', cell: { x: 0, y: 0 }, spec: { kind: 'BREAKER_1P', on: true } })
    expect(s.board.components.QF).toBeDefined()
    s = circuitReducer(s, { type: 'UNDO' })
    expect(s.board.components.QF).toBeUndefined()
    s = circuitReducer(s, { type: 'REDO' })
    expect(specOn(s, 'QF')).toBe(true)
  })

  it('LOAD_BOARD snapshot preserves the persisted on-state', () => {
    const s = circuitReducer(initialCircuitState(), { type: 'LOAD_BOARD', board: on1p(true) })
    expect(specOn(s, 'QF')).toBe(true)
  })
})

