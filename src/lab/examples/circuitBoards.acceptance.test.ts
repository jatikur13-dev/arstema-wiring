/**
 * Safety acceptance for every shipped worked example.
 *
 * These checks intentionally reference examples by public key. They lock the
 * electrical intent learners see, rather than merely proving that a generic
 * engine primitive works in isolation.
 *
 * Technical bases used by the corrected motor-control examples:
 * - Siemens clockwise star–delta terminal arrangement:
 *   https://cache.industry.siemens.com/dl/files/345/24499345/att_1039101/v1/CD_FE_III_001_V20_EN.pdf
 * - Schneider DOL overload/control convention and mechanical interlock:
 *   https://www.se.com/nl/en/faqs/FA139744/
 *   https://www.se.com/uk/en/faqs/FA136856/
 * - Omron H3DT-G terminal and selector table:
 *   https://www.ia.omron.com/data_pdf/cat/h3dt_m090-e1_4_8_csm1050135.pdf?id=3490
 */
import { describe, expect, it } from 'vitest'
import {
  MOTOR_3PH_TERMINAL,
  SOURCE_3PH_TERMINAL,
  buildNodes,
  buildPhysicalNodes,
  circuitReducer,
  initialCircuitState,
  solveCircuit,
  solveThreePhase,
  terminalCountForSpec,
  terminalKey,
  type Board,
  type Terminal,
} from '../../engine/index'
import { CIRCUIT_TEST_FIXTURES, type CircuitTestFixtureKey } from './circuitBoards'

const t = (componentId: string, index: number): Terminal => ({ componentId, index })
const root = (board: Board, terminal: Terminal, dynamic = false, contactors: Record<string, boolean> = {}) =>
  (dynamic ? buildNodes(board, {}, contactors) : buildPhysicalNodes(board)).nodeOf.get(terminalKey(terminal))

function expectFixedStarWithSeparatePe(board: Board, motorId: string, sourceId = 'Q') {
  const u2 = root(board, t(motorId, MOTOR_3PH_TERMINAL.U2))
  expect(u2).toBe(root(board, t(motorId, MOTOR_3PH_TERMINAL.V2)))
  expect(u2).toBe(root(board, t(motorId, MOTOR_3PH_TERMINAL.W2)))
  expect(u2).not.toBe(root(board, t(sourceId, SOURCE_3PH_TERMINAL.N)))
  const peWire = Object.values(board.wires).find(
    (wire) =>
      (wire.from.componentId === motorId && wire.from.index === MOTOR_3PH_TERMINAL.PE) ||
      (wire.to.componentId === motorId && wire.to.index === MOTOR_3PH_TERMINAL.PE),
  )
  expect(peWire).toBeDefined()
  expect(root(board, t(motorId, MOTOR_3PH_TERMINAL.PE))).not.toBe(
    root(board, t(sourceId, SOURCE_3PH_TERMINAL.N)),
  )
}

function expectPreferredDelta(board: Board, motorId: string, deltaId: string) {
  const nodes = buildNodes(board, {}, { [deltaId]: true })
  const node = (index: number) => nodes.nodeOf.get(terminalKey(t(motorId, index)))
  expect(node(MOTOR_3PH_TERMINAL.U2)).toBe(node(MOTOR_3PH_TERMINAL.W1))
  expect(node(MOTOR_3PH_TERMINAL.V2)).toBe(node(MOTOR_3PH_TERMINAL.U1))
  expect(node(MOTOR_3PH_TERMINAL.W2)).toBe(node(MOTOR_3PH_TERMINAL.V1))
}

const checks: Record<CircuitTestFixtureKey, (board: Board) => void> = {
  seri: (board) => {
    expect(Object.keys(board.components).sort()).toEqual(['L1', 'L2', 'S'])
    expect(root(board, t('L1', 1))).toBe(root(board, t('L2', 0)))
  },
  paralel: (board) => {
    expect(root(board, t('L1', 0))).toBe(root(board, t('L2', 0)))
    expect(root(board, t('L1', 1))).toBe(root(board, t('L2', 1)))
  },
  'breaker-1p': (board) => {
    expect(board.components.QF.spec.kind).toBe('BREAKER_1P')
    expect(board.wires.w1.to).toEqual(t('QF', 0))
    expect(board.wires.w2.from).toEqual(t('QF', 1))
  },
  'motor-tanpa-kapasitor': (board) => {
    expect(board.components.M.spec.kind).toBe('MOTOR')
    expect(Object.values(board.components).some((component) => component.spec.kind === 'CAPACITOR')).toBe(false)
  },
  'motor-kapasitor': (board) => {
    expect(board.components.C.spec.kind).toBe('CAPACITOR')
    expect(root(board, t('M', 2))).toBe(root(board, t('C', 0)))
  },
  'relay-dasar': (board) => {
    expect(board.wires.w2.to).toEqual(t('K', 0))
    expect(board.wires.w5.from).toEqual(t('K', 3))
  },
  'self-holding': (board) => {
    expect(board.wires.w3.to).toEqual(t('K', 2))
    expect(board.wires.w5).toMatchObject({ from: t('K', 3), to: t('K', 0) })
  },
  'relay-selfhold-breaker': (board) => {
    expect(board.components.QF.spec.kind).toBe('BREAKER_1P')
    expect(board.wires.w1.from).toEqual(t('QF', 1))
  },
  'motor-3f-langsung': (board) => expectFixedStarWithSeparatePe(board, 'M3'),
  'breaker-3f-motor': (board) => {
    expect(board.components.QF3.spec.kind).toBe('BREAKER_3P')
    expectFixedStarWithSeparatePe(board, 'M3')
  },
  'dol-power': (board) => {
    expect(board.components.OL.spec.kind).toBe('OVERLOAD_RELAY')
    expect(board.wires.r3.to).toEqual(t('OL', 0))
    expect(board.wires.r4.from).toEqual(t('OL', 1))
    expectFixedStarWithSeparatePe(board, 'M3')
  },
  'dol-driven': (board) => {
    expect(board.wires.c2.to).toEqual(t('OL', 6))
    expect(board.wires.c3.from).toEqual(t('OL', 7))
    expectFixedStarWithSeparatePe(board, 'M3')
  },
  'dol-full': (board) => {
    expect(board.wires.k3.to).toEqual(t('OL', 6))
    expect(board.wires.k4.from).toEqual(t('OL', 7))
    expect(board.wires.tl1.to).toEqual(t('OL', 8))
    expect(board.wires.tl2.from).toEqual(t('OL', 9))
    expectFixedStarWithSeparatePe(board, 'M3')
  },
  'interlock-2km': (board) => {
    expect(board.mechanicalInterlocks).toContainEqual({ contactorA: 'KM1', contactorB: 'KM2' })
    expect(board.wires.k1a.to).toEqual(t('KM2', 10))
    expect(board.wires.k2a.to).toEqual(t('KM1', 10))
  },
  'star-delta-manual': (board) => {
    expect(board.components.OL.spec.kind).toBe('OVERLOAD_RELAY')
    expect(board.mechanicalInterlocks).toContainEqual({ contactorA: 'KMY', contactorB: 'KMD' })
    expectPreferredDelta(board, 'M1', 'KMD')
    expect(root(board, t('M1', MOTOR_3PH_TERMINAL.PE))).not.toBe(root(board, t('Q', SOURCE_3PH_TERMINAL.N)))
  },
  'star-delta-auto': (board) => {
    expect(board.mechanicalInterlocks).toContainEqual({ contactorA: 'KMY', contactorB: 'KMD' })
    expect(board.wires.ky1.to).toEqual(t('KT', 2))
    expect(board.wires.ky2.from).toEqual(t('KT', 6))
    expect(board.wires.kd1.to).toEqual(t('KT', 4))
    expect(board.wires.kd2.from).toEqual(t('KT', 5))
    expectPreferredDelta(board, 'M1', 'KMD')
  },
  'mcb-overload-trip': (board) => {
    const qf = board.components.QF.spec
    expect(qf.kind).toBe('BREAKER_1P')
    expect(qf.kind === 'BREAKER_1P' && qf.ratedAmps).toBe(10)
    expect(board.components.RL.spec.kind).toBe('LOAD')
  },
  'simbol-baru': (board) => {
    expect(board.components.PE.spec.kind).toBe('GROUND')
    expect(Object.values(board.wires).some((wire) => wire.from.componentId === 'PE' || wire.to.componentId === 'PE')).toBe(false)
  },
}

describe('worked-example electrical acceptance by public key', () => {
  it('has one explicit acceptance check for every shipped example', () => {
    expect(Object.keys(checks).sort()).toEqual(Object.keys(CIRCUIT_TEST_FIXTURES).sort())
  })

  it.each(Object.keys(CIRCUIT_TEST_FIXTURES) as CircuitTestFixtureKey[])(
    '%s preserves its declared teaching intent',
    (key) => checks[key](CIRCUIT_TEST_FIXTURES[key]()),
  )

  it.each(Object.keys(CIRCUIT_TEST_FIXTURES) as CircuitTestFixtureKey[])(
    '%s never references a terminal outside the component contract',
    (key) => {
      const board = CIRCUIT_TEST_FIXTURES[key]()
      for (const wire of Object.values(board.wires)) {
        for (const terminal of [wire.from, wire.to]) {
          const component = board.components[terminal.componentId]
          expect(component, `${key}/${wire.id}/${terminal.componentId}`).toBeDefined()
          expect(terminal.index).toBeGreaterThanOrEqual(0)
          expect(terminal.index).toBeLessThan(terminalCountForSpec(component.spec))
        }
      }
    },
  )

  it('never joins a PE symbol or motor frame bond to a load-side neutral', () => {
    for (const [key, build] of Object.entries(CIRCUIT_TEST_FIXTURES)) {
      const board = build()
      const source = Object.values(board.components).find(
        (component) => component.spec.kind === 'SOURCE' || component.spec.kind === 'SOURCE_3PH',
      )
      if (!source) continue
      const neutralIndex = source.spec.kind === 'SOURCE_3PH' ? SOURCE_3PH_TERMINAL.N : 1
      const neutral = root(board, t(source.id, neutralIndex))
      for (const component of Object.values(board.components)) {
        if (component.spec.kind === 'GROUND') {
          expect(root(board, t(component.id, 0)), `${key}/${component.id}`).not.toBe(neutral)
        }
        if (component.spec.kind === 'MOTOR_3PH') {
          expect(root(board, t(component.id, MOTOR_3PH_TERMINAL.PE)), `${key}/${component.id}`).not.toBe(neutral)
        }
      }
    }
  })

  it('physical interlock prevents simultaneous contactor closure', () => {
    const board = CIRCUIT_TEST_FIXTURES['interlock-2km']()
    board.components.QF1 = {
      ...board.components.QF1,
      spec: { kind: 'BREAKER_1P', on: true, ratedAmps: 10 },
    }
    for (const id of ['S1', 'S2']) {
      const component = board.components[id]
      board.components[id] = {
        ...component,
        spec: { kind: 'PUSHBUTTON', normallyOpen: true, pressed: true },
      }
    }
    const result = solveCircuit(board)
    expect(result.contactorConverged).toBe(true)
    expect(result.contactorEnergized.KM1 && result.contactorEnergized.KM2).toBe(false)
  })

  it('removing an interlocked contactor preserves the AC domain and removes stale metadata', () => {
    const board = CIRCUIT_TEST_FIXTURES['star-delta-auto']()
    const state = circuitReducer(initialCircuitState(board), { type: 'REMOVE_COMPONENT', id: 'KMY' })
    expect(state.board.domain).toBe('ac-three-phase-balanced')
    expect(state.board.mechanicalInterlocks).toEqual([])
  })

  it('complete DOL default starts, holds, and stops through its real control chain', () => {
    const board = CIRCUIT_TEST_FIXTURES['dol-full']()
    board.components.QF3 = {
      ...board.components.QF3,
      spec: { kind: 'BREAKER_3P', on: true, ratedAmps: 16 },
    }
    board.components.QF1 = {
      ...board.components.QF1,
      spec: { kind: 'BREAKER_1P', on: true, ratedAmps: 10 },
    }
    let state = initialCircuitState(board)
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: true })
    state = circuitReducer(state, { type: 'TICK', dtMs: 100 })
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: false })
    expect(state.contactorEnergized.KM).toBe(true)
    const olPhaseR = state.threePhase?.branchCurrentPhasor['OL#0']
    expect(olPhaseR && Math.hypot(olPhaseR.re, olPhaseR.im)).toBeCloseTo(10, 2)
    state = circuitReducer(state, { type: 'TICK', dtMs: 1_000 })
    expect(state.overloadRuntime.OL?.thermalLevel).toBe(0)
    expect(state.overloadRuntime.OL?.tripped ?? false).toBe(false)

    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'STOP', pressed: true })
    expect(state.contactorEnergized.KM).toBe(false)
  })

  it('400/690 V star–delta example produces ~4 A STAR and ~12 A DELTA', () => {
    const board = CIRCUIT_TEST_FIXTURES['star-delta-auto']()
    board.components.QF3 = {
      ...board.components.QF3,
      spec: { kind: 'BREAKER_3P', on: true, ratedAmps: 16 },
    }
    const star = solveThreePhase(board, { KM1: true, KMY: true, KMD: false })
    const delta = solveThreePhase(board, { KM1: true, KMY: false, KMD: true })
    expect(star.fault).toBeUndefined()
    expect(delta.fault).toBeUndefined()
    expect(star.lineCurrent.R).toBeCloseTo(4, 2)
    expect(delta.lineCurrent.R).toBeCloseTo(12, 2)
  })

  it('runs the automatic default through STAR, transfer, and DELTA without overlap', () => {
    const board = CIRCUIT_TEST_FIXTURES['star-delta-auto']()
    board.components.QF3 = {
      ...board.components.QF3,
      spec: { kind: 'BREAKER_3P', on: true, ratedAmps: 16 },
    }
    board.components.QF1 = {
      ...board.components.QF1,
      spec: { kind: 'BREAKER_1P', on: true, ratedAmps: 10 },
    }
    let state = initialCircuitState(board)
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: true })
    state = circuitReducer(state, { type: 'TICK', dtMs: 100 })
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: false })
    expect(state.contactorEnergized.KM1).toBe(true)
    expect(state.contactorEnergized.KMY).toBe(true)
    expect(state.contactorEnergized.KMD).toBe(false)

    state = circuitReducer(state, { type: 'TICK', dtMs: 5_000 })
    expect(state.contactorEnergized.KMY).toBe(false)
    expect(state.contactorEnergized.KMD).toBe(false)

    state = circuitReducer(state, { type: 'TICK', dtMs: 500 })
    expect(state.contactorEnergized.KMY).toBe(false)
    expect(state.contactorEnergized.KMD).toBe(true)
    expect(state.contactorEnergized.KMY && state.contactorEnergized.KMD).toBe(false)
  })

  it('draws automatic STAR–DELTA control returns as branches of one Q.N trunk', () => {
    const board = CIRCUIT_TEST_FIXTURES['star-delta-auto']()
    for (const id of ['kt2', 'ky4', 'kd4', 'tl3']) {
      expect(board.wires[id].tap?.wireId).toBe('m1e')
      expect(board.wires[id].to).toEqual({ componentId: 'Q', index: 3 })
    }
    const physical = buildPhysicalNodes(board)
    const neutralNode = physical.nodeOf.get('Q:3')
    for (const terminal of ['KM1:1', 'KT:1', 'KMY:1', 'KMD:1', 'TRIP:1']) {
      expect(physical.nodeOf.get(terminal)).toBe(neutralNode)
    }
  })
})
