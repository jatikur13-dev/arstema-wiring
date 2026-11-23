/**
 * Audit 21 Nov 2026 (docs/audits/2026-11-21-wiring-logika-berat.md in the arstema
 * repo), approved by BOS: L1 a palette 3-phase board runs, L2 a short trips the
 * protection on its path, L3 every source feeds its own circuit. Expected values are
 * hand-computed in the comments.
 */
import { describe, expect, it } from 'vitest'
import type { Board, ComponentSpec, Terminal } from './types'
import { boardDomain } from './types'
import { circuitRunRequirements } from './runRequirements'
import { solveCircuit } from './solve'
import { circuitReducer, initialCircuitState, type CircuitState } from './engine'
import { traceCurrentPath } from './flow'
import { classifyWires } from './wiring'
import { wirePresentation } from './wirePresentation'
import { magnitude } from './phasor'

const t = (componentId: string, index: number): Terminal => ({ componentId, index })
const part = (id: string, spec: ComponentSpec, x = 0, y = 0) => ({ id, cell: { x, y }, spec })
const wires = (...list: Array<[string, Terminal, Terminal]>): Board['wires'] =>
  Object.fromEntries(list.map(([id, from, to]) => [id, { id, from, to }]))
const ticks = (state: CircuitState, n: number, dtMs = 20): CircuitState => {
  let s = circuitReducer(state, { type: 'SET_RUNNING', running: true })
  for (let i = 0; i < n; i += 1) s = circuitReducer(s, { type: 'TICK', dtMs })
  return s
}

const SRC3: ComponentSpec = { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 32 }
const MAINS: ComponentSpec = { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 }
const PSU: ComponentSpec = { kind: 'SOURCE', emfVolts: 24, tripAmps: 1.5, sourceType: 'din_psu_24vdc' }
/** 23.094 Ω per winding in star on 400 V: 230.94 V / 23.094 Ω = 10.0 A line current. */
const MOTOR: ComponentSpec = { kind: 'MOTOR_3PH', windingResistanceOhms: 23.094010768, ratedCurrentAmps: 12 }
const MCB3: ComponentSpec = { kind: 'BREAKER_3P', on: true, ratedAmps: 16 } // palette MCB: no curve

const starMotorWires = (): Array<[string, Terminal, Terminal]> => [
  ['u', t('Q', 0), t('M', 0)],
  ['v', t('Q', 1), t('M', 2)],
  ['w', t('Q', 2), t('M', 4)],
  ['star1', t('M', 1), t('M', 3)],
  ['star2', t('M', 3), t('M', 5)],
]

describe('L1: the phasor solver is chosen from the parts on the board', () => {
  it('a palette 3-phase board without `domain` runs (10 A star motor)', () => {
    const board: Board = { components: { Q: part('Q', SRC3), M: part('M', MOTOR, 3) }, wires: wires(...starMotorWires()) }
    expect(board.domain).toBeUndefined()
    expect(boardDomain(board)).toBe('ac-three-phase-balanced')
    const s = initialCircuitState(board)
    expect(s.solution.hasSource).toBe(true)
    expect(s.threePhase?.lineCurrent.R).toBeCloseTo(10, 6)
    expect(s.solution.energised).toBe(true)
    expect(circuitRunRequirements(board)).toEqual([])
  })

  it('a tapped transformer or a 3-phase heater no longer demands a domain nobody can set', () => {
    const trafo: Board = { components: { TR: part('TR', { kind: 'SOURCE', emfVolts: 110, tripAmps: 10, transformer: { primaryVolts: 400, tapVolts: [110, 220] } }) }, wires: {} }
    const heater: Board = { components: { EH: part('EH', { kind: 'LOAD', resistanceOhms: 1, ratedCurrentAmps: 20, threePhase: { powerWatts: 3000, lineVolts: 400 } }) }, wires: {} }
    expect(circuitRunRequirements(trafo)).toEqual([])
    expect(circuitRunRequirements(heater)).toEqual([])
  })

  it('an explicit domain still wins, and a 1-phase board stays on the DC path', () => {
    expect(boardDomain({ components: { S: part('S', MAINS) }, wires: {} })).toBe('dc-resistive')
    expect(boardDomain({ domain: 'dc-resistive', components: { Q: part('Q', SRC3) }, wires: {} })).toBe('dc-resistive')
  })
})

describe('L2: a short trips the protection on its path', () => {
  const shortAfterMcb = (): Board => ({
    components: { Q: part('Q', SRC3), QF: part('QF', MCB3, 3) },
    wires: wires(['r', t('Q', 0), t('QF', 0)], ['s', t('Q', 1), t('QF', 2)], ['tt', t('Q', 2), t('QF', 4)], ['short', t('QF', 1), t('QF', 3)]),
  })

  it('R–S after a palette MCB: the current climbs for two ticks, then the MCB trips instantly', () => {
    let s = initialCircuitState(shortAfterMcb())
    expect(s.threePhase?.fault?.code).toBe('PHASE_TO_PHASE_SHORT')
    // Ramp toward 2.5 × 32 A with k = 20/90: 17.8 A, 31.6 A (< 32 A), then 42.3 A.
    s = ticks(s, 2)
    expect(s.status).toBe('RUNNING')
    expect(s.display.sourceCurrent).toBeGreaterThan(0)
    expect(s.display.sourceCurrent).toBeLessThan(32)
    s = circuitReducer(s, { type: 'TICK', dtMs: 20 })
    expect(s.status).toBe('FAULTED')
    expect(s.fault?.code).toBe('SHORT_CIRCUIT_TRIPPED')
    expect(s.fault?.devices).toEqual([{ id: 'QF', kind: 'MCB' }])
    expect([...(s.fault?.conductors ?? [])].sort()).toEqual(['R', 'S'])
    expect(s.fault?.measured.ratedAmps).toBe(16)
    expect(s.mcbRuntime.QF.tripped).toBe(true)
    expect(s.mcbRuntime.QF.tripReason).toBe('INSTANTANEOUS') // not "thermal"
    expect(s.threePhase?.fault).toBeUndefined()
  })

  it('a short at the source terminals has nothing on its path: the source protection trips', () => {
    const board: Board = { components: { Q: part('Q', SRC3) }, wires: wires(['bad', t('Q', 0), t('Q', 1)]) }
    const s = ticks(initialCircuitState(board), 3)
    expect(s.status).toBe('FAULTED') // before: a 3-phase short never left RUNNING
    expect(s.fault?.code).toBe('SHORT_CIRCUIT_NO_LOAD')
    expect(s.fault?.measured.limitAmps).toBe(32)
  })

  it('a short behind a contactor no longer reads "unstable"; the MCB clears it', () => {
    const board: Board = {
      components: {
        Q: part('Q', SRC3),
        QF: part('QF', MCB3, 3),
        KM: part('KM', { kind: 'CONTACTOR', coilResistanceOhms: 2300, ratedCoilVolts: 230 }, 6),
      },
      wires: wires(
        ['r', t('Q', 0), t('QF', 0)], ['s', t('Q', 1), t('QF', 2)], ['tt', t('Q', 2), t('QF', 4)],
        ['k1', t('QF', 1), t('KM', 2)], ['k2', t('QF', 3), t('KM', 4)], ['k3', t('QF', 5), t('KM', 6)],
        ['a1', t('Q', 0), t('KM', 0)], ['a2', t('KM', 1), t('Q', 3)], // coil 230.94 V straight from the source
        ['short', t('KM', 3), t('KM', 5)], // T1–T2 shorted below the main poles
      ),
    }
    let s = initialCircuitState(board)
    expect(s.contactorConverged).toBe(true) // before: KM chattered and read "tidak stabil"
    expect(s.contactorEnergized.KM).toBe(true)
    expect(s.threePhase?.fault?.code).toBe('PHASE_TO_PHASE_SHORT')
    s = ticks(s, 3)
    expect(s.fault?.code).toBe('SHORT_CIRCUIT_TRIPPED')
    expect(s.mcbRuntime.QF.tripped).toBe(true)
    expect(s.contactorEnergized.KM).toBe(true) // its coil is not behind QF
    expect(s.threePhase?.fault).toBeUndefined()
  })

  it('a short behind an overload relay is a short, not a 1 MA solve with a "thermal" trip', () => {
    const board: Board = {
      components: {
        Q: part('Q', SRC3),
        QF: part('QF', MCB3, 3),
        OL: part('OL', { kind: 'OVERLOAD_RELAY', ratedCurrentAmps: 10, tripMultiplier: 1, heatingRate: 0.0001, coolingRate: 0.00005, resetThreshold: 0.2 }, 6),
      },
      wires: wires(
        ['r', t('Q', 0), t('QF', 0)], ['s', t('Q', 1), t('QF', 2)], ['tt', t('Q', 2), t('QF', 4)],
        ['o1', t('QF', 1), t('OL', 0)], ['o2', t('QF', 3), t('OL', 2)], ['o3', t('QF', 5), t('OL', 4)],
        ['short', t('OL', 1), t('OL', 3)],
      ),
    }
    let s = initialCircuitState(board)
    expect(s.threePhase?.fault?.code).toBe('PHASE_TO_PHASE_SHORT')
    expect(Object.keys(s.threePhase?.branchCurrentPhasor ?? {})).toHaveLength(0)
    s = ticks(s, 3)
    expect(s.mcbRuntime.QF.tripReason).toBe('INSTANTANEOUS')
    expect(s.overloadRuntime.OL?.tripped ?? false).toBe(false) // a thermal relay is not short protection
  })

  it('1-phase: a short behind a contactor settles with the contactor closed, then the MCB trips', () => {
    const board: Board = {
      components: {
        S: part('S', MAINS),
        QF: part('QF', { kind: 'BREAKER_1P', on: true, ratedAmps: 10 }, 3),
        KM: part('KM', { kind: 'CONTACTOR', coilResistanceOhms: 2300, ratedCoilVolts: 220 }, 6),
      },
      wires: wires(
        ['a', t('S', 0), t('QF', 0)], ['b', t('QF', 1), t('KM', 2)], ['short', t('KM', 3), t('S', 1)],
        ['a1', t('S', 0), t('KM', 0)], ['a2', t('KM', 1), t('S', 1)],
      ),
    }
    let s = initialCircuitState(board)
    expect(s.contactorConverged).toBe(true) // before: KM chattered (20 iterations, unstable)
    expect(s.contactorEnergized.KM).toBe(true)
    expect(s.solution.shorted).toBe(true)
    s = ticks(s, 3)
    expect(s.fault?.devices).toEqual([{ id: 'QF', kind: 'MCB' }])
    expect(s.solution.shorted).toBe(false)
  })

  it('a short at the source still drops a contactor, as before', () => {
    const board: Board = {
      components: { S: part('S', MAINS), KM: part('KM', { kind: 'CONTACTOR', coilResistanceOhms: 2300, ratedCoilVolts: 220 }, 3) },
      wires: wires(['a1', t('S', 0), t('KM', 0)], ['a2', t('KM', 1), t('S', 1)], ['bad', t('S', 0), t('S', 1)]),
    }
    expect(solveCircuit(board, {}, { KM: true }).contactorEnergized.KM).toBe(false)
  })

  it('1-phase: a fuse on the path blows instead of the source tripping', () => {
    const board: Board = {
      components: { S: part('S', MAINS), F: part('F', { kind: 'FUSE', blown: false }, 3) },
      wires: wires(['a', t('S', 0), t('F', 0)], ['b', t('F', 1), t('S', 1)]),
    }
    const s = ticks(initialCircuitState(board), 3)
    expect(s.fault?.code).toBe('SHORT_CIRCUIT_TRIPPED')
    expect(s.fault?.devices).toEqual([{ id: 'F', kind: 'FUSE' }])
    expect(s.board.components.F.spec).toEqual({ kind: 'FUSE', blown: true })
    expect(s.solution.shorted).toBe(false)
  })
})

describe('L3: every source feeds its own circuit', () => {
  const mainsAndPsu = (): Board => ({
    components: {
      S: part('S', MAINS),
      LAMP: part('LAMP', { kind: 'LOAD', resistanceOhms: 529, ratedCurrentAmps: 0.5 }, 3),
      PS: part('PS', PSU, 0, 3),
      YV: part('YV', { kind: 'LOAD', resistanceOhms: 384, ratedCurrentAmps: 0.2, symbol: 'solenoid_valve' }, 3, 3),
    },
    wires: wires(
      ['l1', t('S', 0), t('LAMP', 0)], ['l2', t('LAMP', 1), t('S', 1)],
      ['p1', t('PS', 0), t('YV', 0)], ['p2', t('YV', 1), t('PS', 1)],
    ),
  })

  it('DC: a 24 V supply beside the 220 V mains drives its own load (24 / 384 = 0.0625 A)', () => {
    const { solution } = solveCircuit(mainsAndPsu())
    expect(solution.loadCurrent.LAMP).toBeCloseTo(220 / 529, 12)
    expect(solution.loadCurrent.YV).toBeCloseTo(0.0625, 12) // before: 0 A
    expect(solution.sourceCurrent).toBeCloseTo(220 / 529, 12) // still the first source
    expect(solution.supplyVolts).toEqual({ LAMP: 220, YV: 24 })
  })

  it('DC: the second supply alone still energises the board and its wires', () => {
    const board = mainsAndPsu()
    delete board.wires.l1
    const s = initialCircuitState(board)
    expect(s.solution.energised).toBe(true)
    const trace = traceCurrentPath(board, true)
    expect(trace.p1.onPath).toBe(true)
    expect(trace.p2.onPath).toBe(true)
    const classes = classifyWires(board)
    expect(classes.p1).toBe('LIVE')
    expect(classes.p2).toBe('NEUTRAL')
    expect(wirePresentation(s).p1.flowing).toBe(true)
  })

  it('DC: a relay coil on the 24 V supply picks up (24 / 288 = 0.083 A > 0.04 A)', () => {
    const board: Board = {
      components: { S: part('S', MAINS), PS: part('PS', PSU, 0, 3), K1: part('K1', { kind: 'RELAY', coilResistanceOhms: 288, pickupAmps: 0.04 }, 3, 3) },
      wires: wires(['c1', t('PS', 0), t('K1', 0)], ['c2', t('K1', 1), t('PS', 1)]),
    }
    expect(solveCircuit(board).relayEnergized.K1).toBe(true)
  })

  it('DC: two supplies coupled through loads are solved together (36 V / 20 Ω = 1.8 A)', () => {
    const battery = (emfVolts: number): ComponentSpec => ({ kind: 'SOURCE', emfVolts, tripAmps: 10, sourceType: 'battery_dc' })
    const board: Board = {
      components: {
        B1: part('B1', battery(12)), B2: part('B2', battery(24), 0, 3),
        R1: part('R1', { kind: 'LOAD', resistanceOhms: 10, ratedCurrentAmps: 5, symbol: 'resistor' }, 3),
        R2: part('R2', { kind: 'LOAD', resistanceOhms: 10, ratedCurrentAmps: 5, symbol: 'resistor' }, 3, 3),
      },
      wires: wires(['a', t('B1', 0), t('R1', 0)], ['b', t('R1', 1), t('B2', 1)], ['c', t('B2', 0), t('R2', 0)], ['d', t('R2', 1), t('B1', 1)]),
    }
    const { solution } = solveCircuit(board)
    // Fixing each supply's − at 0 V on its own would give 1.2 A and 2.4 A (KCL broken).
    expect(solution.loadCurrent.R1).toBeCloseTo(1.8, 9)
    expect(solution.loadCurrent.R2).toBeCloseTo(1.8, 9)
  })

  it('DC: two supplies forced to different voltages on one node is a short between them', () => {
    const board: Board = {
      components: { S: part('S', MAINS), PS: part('PS', PSU, 0, 3) },
      wires: wires(['plus', t('PS', 0), t('S', 0)], ['minus', t('PS', 1), t('S', 1)]),
    }
    const { solution } = solveCircuit(board)
    expect(solution.shorted).toBe(true)
    expect(solution.short).toEqual({ sourceIds: ['S', 'PS'], labels: ['L', '+'] })
  })

  it('AC: a 24 VAC control transformer on a 3-phase board feeds its pilot lamp (24 / 480 = 0.05 A)', () => {
    const board: Board = {
      components: {
        Q: part('Q', SRC3), M: part('M', MOTOR, 3),
        T1: part('T1', { kind: 'SOURCE', emfVolts: 24, tripAmps: 10, sourceType: 'control_transformer_24vac' }, 0, 4),
        H1: part('H1', { kind: 'INDICATOR', resistanceOhms: 480, ratedCurrentAmps: 0.1 }, 3, 4),
      },
      wires: wires(...starMotorWires(), ['h1', t('T1', 0), t('H1', 0)], ['h2', t('H1', 1), t('T1', 1)]),
    }
    const s = initialCircuitState(board)
    expect(s.solution.loadCurrent.H1).toBeCloseTo(0.05, 12) // before: 0 A
    expect(s.threePhase?.lineCurrent.R).toBeCloseTo(10, 6) // the motor is unchanged
    expect(s.solution.supplyVolts?.H1).toBe(24)
    expect(s.solution.supplyVolts?.M).toBeCloseTo(400 / Math.sqrt(3), 9)
    const view = wirePresentation(s)
    expect(view.h1.phase).toBe('energized')
    expect(view.h2.phase).toBe('N')
    expect(view.h1.flowing).toBe(true)
  })

  it('AC without a 3-phase source: a 400 V supply feeds a tapped transformer (110 V / 110 Ω = 1 A)', () => {
    const board: Board = {
      components: {
        S: part('S', { kind: 'SOURCE', emfVolts: 400, tripAmps: 16 }),
        TR: part('TR', { kind: 'SOURCE', emfVolts: 110, tripAmps: 10, transformer: { primaryVolts: 400, tapVolts: [110, 220] } }, 3),
        LAMP: part('LAMP', { kind: 'LOAD', resistanceOhms: 110, ratedCurrentAmps: 2 }, 6),
      },
      wires: wires(['p1', t('S', 0), t('TR', 0)], ['p2', t('S', 1), t('TR', 1)], ['s1', t('TR', 3), t('LAMP', 0)], ['s2', t('LAMP', 1), t('TR', 2)]),
    }
    expect(boardDomain(board)).toBe('ac-three-phase-balanced')
    const s = initialCircuitState(board)
    expect(s.solution.hasSource).toBe(true) // before: "no source"
    expect(magnitude(s.threePhase!.loadCurrent.LAMP)).toBeCloseTo(1, 9)
    expect(s.solution.energised).toBe(true)
    // Not checked: wire animation across the transformer (not traced on any board yet).
  })
})
