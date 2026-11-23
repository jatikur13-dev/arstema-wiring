/**
 * M3-B2 Gate A — voltage-driven contactor: coil A1–A2 RMS pickup with hysteresis,
 * resolved by a bounded deterministic fixpoint. No coil-current criterion, no fake
 * state injection. Self-holding and electrical interlock are proven end-to-end
 * through the reducer (real pushbutton presses).
 */
import { describe, expect, it } from 'vitest'
import type { Board, ContactorSpec } from './types'
import { CONTACTOR_TERMINAL, terminalKey } from './types'
import { buildNodes } from './topology'
import {
  contactorCoilParams,
  contactorCoilVoltage,
  contactorNextState,
  solveThreePhase,
  solveThreePhaseWithContactors,
} from './threePhase'
import { solveCircuit } from './solve'
import { circuitReducer, initialCircuitState } from './engine'

const t = (componentId: string, index: number) => ({ componentId, index })
const w = (id: string, from: { componentId: string; index: number }, to: { componentId: string; index: number }) => ({ id, from, to })
const SRC = { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } as const
const AC = 'ac-three-phase-balanced' as const
const VLN = 400 / Math.sqrt(3) // ≈ 230.94

/** Contactor coil wired directly across R–N ⇒ Vcoil ≈ 230.94 V. Spec is tunable so
 *  a FIXED board can be pushed into each pickup/dropout region. */
function coilBoard(spec: Partial<ContactorSpec> = {}): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC } },
      KM: { id: 'KM', cell: { x: 3, y: 0 }, spec: { kind: 'CONTACTOR', ...spec } },
    },
    wires: { a1: w('a1', t('Q', 0), t('KM', 0)), a2: w('a2', t('KM', 1), t('Q', 3)) },
  }
}

// === pure threshold logic (exact boundaries) ================================

describe('contactorCoilParams validation', () => {
  it('defaults are the educational set', () => {
    expect(contactorCoilParams({})).toEqual({ ratedCoilVolts: 230, pickupFraction: 0.85, dropoutFraction: 0.4 })
  })
  it('invalid values (pickup ≤ dropout, rated ≤ 0, non-finite) fall back to defaults as a SET', () => {
    expect(contactorCoilParams({ pickupFraction: 0.3, dropoutFraction: 0.5 })).toEqual(contactorCoilParams({}))
    expect(contactorCoilParams({ ratedCoilVolts: 0 })).toEqual(contactorCoilParams({}))
    expect(contactorCoilParams({ pickupFraction: Number.NaN })).toEqual(contactorCoilParams({}))
    expect(contactorCoilParams({ pickupFraction: 1.5 })).toEqual(contactorCoilParams({}))
  })
})

describe('contactorNextState hysteresis boundaries', () => {
  const p = contactorCoilParams({}) // pickup 195.5 V, dropout 92 V
  const pickupV = p.ratedCoilVolts * p.pickupFraction
  const dropoutV = p.ratedCoilVolts * p.dropoutFraction
  it('OFF→ pickup is inclusive (≥)', () => {
    expect(contactorNextState(pickupV, p, false)).toBe(true)
    expect(contactorNextState(pickupV - 1e-6, p, false)).toBe(false)
  })
  it('ON→ dropout is inclusive (≤)', () => {
    expect(contactorNextState(dropoutV, p, true)).toBe(false)
    expect(contactorNextState(dropoutV + 1e-6, p, true)).toBe(true)
  })
  it('band between dropout and pickup holds the previous state', () => {
    const mid = (pickupV + dropoutV) / 2
    expect(contactorNextState(mid, p, true)).toBe(true)
    expect(contactorNextState(mid, p, false)).toBe(false)
  })
  it('null voltage (indeterminate) forces OFF regardless of previous', () => {
    expect(contactorNextState(null, p, true)).toBe(false)
    expect(contactorNextState(null, p, false)).toBe(false)
  })
})

// === coil voltage measurement ==============================================

describe('contactorCoilVoltage measurement', () => {
  it('measures |V(A1)−V(A2)| ≈ 230.94 across R–N', () => {
    const board = coilBoard()
    const tp = solveThreePhase(board)
    const nodes = buildNodes(board)
    expect(contactorCoilVoltage(tp, nodes, 'KM')).toBeCloseTo(VLN, 2)
  })
  it('A1/A2 reversed → identical magnitude (polarity irrelevant in AC)', () => {
    const rev: Board = {
      domain: AC,
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC } },
        KM: { id: 'KM', cell: { x: 3, y: 0 }, spec: { kind: 'CONTACTOR' } },
      },
      wires: { a1: w('a1', t('Q', 3), t('KM', 0)), a2: w('a2', t('KM', 1), t('Q', 0)) }, // N→A1, A2→R
    }
    const straight = solveThreePhaseWithContactors(coilBoard())
    const reversed = solveThreePhaseWithContactors(rev)
    expect(reversed.coilVoltage.KM).toBeCloseTo(straight.coilVoltage.KM, 6)
  })
  it('A1/A2 UNREFERENCED (isolated coil) → null', () => {
    const board: Board = {
      domain: AC,
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC } },
        KM: { id: 'KM', cell: { x: 3, y: 0 }, spec: { kind: 'CONTACTOR' } },
      },
      wires: {}, // coil not connected to the source at all
    }
    const tp = solveThreePhase(board)
    expect(contactorCoilVoltage(tp, buildNodes(board), 'KM')).toBeNull()
  })
  it('structured source conflict → null (fault present)', () => {
    const board = coilBoard()
    board.wires.short = w('short', t('Q', 0), t('Q', 1)) // R tied to S
    const tp = solveThreePhase(board)
    expect(tp.fault).toBeDefined()
    expect(contactorCoilVoltage(tp, buildNodes(board), 'KM')).toBeNull()
  })
})

// === fixpoint: pickup / dropout regions ====================================

describe('solveThreePhaseWithContactors pickup regions', () => {
  it('coil 0 V (A1,A2 both on N) → OFF', () => {
    const board: Board = {
      domain: AC,
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC } },
        KM: { id: 'KM', cell: { x: 3, y: 0 }, spec: { kind: 'CONTACTOR' } },
      },
      wires: { a1: w('a1', t('Q', 3), t('KM', 0)), a2: w('a2', t('KM', 1), t('Q', 3)) },
    }
    const r = solveThreePhaseWithContactors(board)
    expect(r.contactorEnergized.KM).toBe(false)
    expect(r.converged).toBe(true)
  })
  it('below pickup → OFF (rated raised so 230.94 < pickup)', () => {
    const r = solveThreePhaseWithContactors(coilBoard({ ratedCoilVolts: 400 })) // pickup 340 V
    expect(r.contactorEnergized.KM).toBe(false)
  })
  it('above pickup → ON', () => {
    const r = solveThreePhaseWithContactors(coilBoard()) // pickup 195.5 V, Vcoil 230.94
    expect(r.contactorEnergized.KM).toBe(true)
    expect(r.converged).toBe(true)
  })
  it('previously ON, voltage in hysteresis band → stays ON', () => {
    const board = coilBoard({ ratedCoilVolts: 300 }) // pickup 255, dropout 120, Vcoil 230.94 (band)
    expect(solveThreePhaseWithContactors(board, { KM: true }).contactorEnergized.KM).toBe(true)
    expect(solveThreePhaseWithContactors(board, { KM: false }).contactorEnergized.KM).toBe(false)
  })
  it('previously ON, voltage below dropout → OFF', () => {
    const r = solveThreePhaseWithContactors(coilBoard({ ratedCoilVolts: 700 }), { KM: true }) // dropout 280 > 230.94
    expect(r.contactorEnergized.KM).toBe(false)
  })
  it('structured source conflict → OFF', () => {
    const board = coilBoard()
    board.wires.short = w('short', t('Q', 0), t('Q', 1))
    expect(solveThreePhaseWithContactors(board, { KM: true }).contactorEnergized.KM).toBe(false)
  })
})

// === contact mapping follows the resolved state ============================

describe('contacts follow the resolved contactor state', () => {
  it('main poles close and drive a load when the coil picks up (fixpoint)', () => {
    const board: Board = {
      domain: AC,
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC } },
        KM: { id: 'KM', cell: { x: 3, y: 0 }, spec: { kind: 'CONTACTOR' } },
        L: { id: 'L', cell: { x: 6, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 50, ratedCurrentAmps: 100 } },
      },
      wires: {
        a1: w('a1', t('Q', 0), t('KM', 0)), a2: w('a2', t('KM', 1), t('Q', 3)), // coil R–N → pickup
        p1: w('p1', t('Q', 0), t('KM', 2)), p2: w('p2', t('KM', 3), t('L', 0)), p3: w('p3', t('L', 1), t('Q', 3)), // R→L1,T1→load→N
      },
    }
    const r = solveThreePhaseWithContactors(board)
    expect(r.contactorEnergized.KM).toBe(true)
    expect(r.converged).toBe(true)
    // Main pole closed ⇒ load carries V_LN/R.
    const nodes = buildNodes(board, {}, r.contactorEnergized)
    const l1 = nodes.nodeOf.get(terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.L1 }))
    const t1 = nodes.nodeOf.get(terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.T1 }))
    expect(l1).toBe(t1) // L1–T1 closed
    // Aux NO closed, NC open when energized.
    const no13 = nodes.nodeOf.get(terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.NO_13 }))
    const no14 = nodes.nodeOf.get(terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.NO_14 }))
    const nc21 = nodes.nodeOf.get(terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.NC_21 }))
    const nc22 = nodes.nodeOf.get(terminalKey({ componentId: 'KM', index: CONTACTOR_TERMINAL.NC_22 }))
    expect(no13).toBe(no14)
    expect(nc21).not.toBe(nc22)
  })
})

// === backward compatibility & regression ===================================

describe('backward compatibility', () => {
  it('solveThreePhase(board) with no contactor arg still solves', () => {
    const sol = solveThreePhase(coilBoard())
    expect(sol.hasSource).toBe(true)
  })
  it('solveCircuit(board) with no contactor arg exposes the resolved state', () => {
    const result = solveCircuit(coilBoard())
    expect(result.contactorEnergized.KM).toBe(true)
    expect(result.contactorConverged).toBe(true)
    expect(result.coilVoltage.KM).toBeCloseTo(VLN, 1)
  })
  it('M2 relay pickup is unchanged (DC path untouched)', () => {
    const dc: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
        K: { id: 'K', cell: { x: 2, y: 0 }, spec: { kind: 'RELAY', coilResistanceOhms: 2200, pickupAmps: 0.05 } },
      },
      wires: {
        c1: { id: 'c1', from: { componentId: 'S', index: 0 }, to: { componentId: 'K', index: 0 } },
        c2: { id: 'c2', from: { componentId: 'K', index: 1 }, to: { componentId: 'S', index: 1 } },
      },
    }
    const result = solveCircuit(dc)
    expect(result.relayEnergized.K).toBe(true) // 0.1 A > 0.05 A pickup
    expect(result.contactorEnergized).toEqual({})
  })
})

// === end-to-end through the reducer (no fake injection) ====================

/** Full DOL control: R → STOP(NC) → node → START(NO) → KM.A1 ; KM.A2 → N ;
 *  aux NO 13–14 parallel with START (seal-in). */
function selfHoldingContactor(): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC } },
      STOP: { id: 'STOP', cell: { x: 3, y: 0 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: false } },
      START: { id: 'START', cell: { x: 5, y: 0 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true } },
      KM: { id: 'KM', cell: { x: 7, y: 0 }, spec: { kind: 'CONTACTOR' } },
    },
    wires: {
      w1: w('w1', t('Q', 0), t('STOP', 0)), // R → STOP
      w2: w('w2', t('STOP', 1), t('START', 0)), // STOP → node
      w3: w('w3', t('START', 1), t('KM', 0)), // START → A1
      s1: w('s1', t('STOP', 1), t('KM', 8)), // node → aux 13
      s2: w('s2', t('KM', 9), t('KM', 0)), // aux 14 → A1 (seal-in parallel to START)
      w4: w('w4', t('KM', 1), t('Q', 3)), // A2 → N
    },
  }
}

describe('self-holding contactor (end-to-end reducer)', () => {
  const press = (state: ReturnType<typeof initialCircuitState>, id: string, pressed: boolean) =>
    circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id, pressed })

  it('START latches, release holds via 13–14, STOP drops', () => {
    let s = initialCircuitState(selfHoldingContactor())
    expect(s.contactorEnergized.KM ?? false).toBe(false)
    s = press(s, 'START', true)
    expect(s.contactorEnergized.KM).toBe(true) // pickup
    s = press(s, 'START', false)
    expect(s.contactorEnergized.KM).toBe(true) // held by seal-in aux
    s = press(s, 'STOP', true)
    expect(s.contactorEnergized.KM).toBe(false) // dropped
    s = press(s, 'STOP', false)
    expect(s.contactorEnergized.KM).toBe(false) // stays off
  })

  it('RESET drops the seal-in latch (START already released)', () => {
    let s = initialCircuitState(selfHoldingContactor())
    s = press(s, 'START', true)
    s = press(s, 'START', false) // held only by the seal-in aux now
    expect(s.contactorEnergized.KM).toBe(true)
    // RESET seeds every contactor OFF → the aux opens → the coil de-energizes and,
    // with START no longer pressed, nothing re-latches it.
    s = circuitReducer(s, { type: 'RESET' })
    expect(s.contactorEnergized.KM ?? false).toBe(false)
  })
})

// === electrical interlock (each coil through the other's NC) ================

/** KM1 coil: R → START1(NO) [∥ KM1 13–14] → KM2 NC(21–22) → KM1.A1 ; A2 → N.
 *  KM2 coil: R → START2(NO) [∥ KM2 13–14] → KM1 NC(21–22) → KM2.A1 ; A2 → N. */
function interlockedContactors(): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC } },
      S1: { id: 'S1', cell: { x: 3, y: 0 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true } },
      S2: { id: 'S2', cell: { x: 3, y: 3 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true } },
      KM1: { id: 'KM1', cell: { x: 6, y: 0 }, spec: { kind: 'CONTACTOR' } },
      KM2: { id: 'KM2', cell: { x: 9, y: 0 }, spec: { kind: 'CONTACTOR' } },
    },
    wires: {
      // KM1 coil path through KM2's NC.
      a1: w('a1', t('Q', 0), t('S1', 0)), // R → START1
      a2: w('a2', t('S1', 1), t('KM2', 10)), // START1 → KM2 NC_21
      a3: w('a3', t('KM2', 11), t('KM1', 0)), // KM2 NC_22 → KM1.A1
      a4: w('a4', t('KM1', 1), t('Q', 3)), // KM1.A2 → N
      a5: w('a5', t('Q', 0), t('KM1', 8)), // seal-in: R → KM1 13
      a6: w('a6', t('KM1', 9), t('KM2', 10)), // KM1 14 → KM2 NC_21 (parallel with START1)
      // KM2 coil path through KM1's NC.
      b1: w('b1', t('Q', 0), t('S2', 0)), // R → START2
      b2: w('b2', t('S2', 1), t('KM1', 10)), // START2 → KM1 NC_21
      b3: w('b3', t('KM1', 11), t('KM2', 0)), // KM1 NC_22 → KM2.A1
      b4: w('b4', t('KM2', 1), t('Q', 3)), // KM2.A2 → N
      b5: w('b5', t('Q', 0), t('KM2', 8)), // seal-in: R → KM2 13
      b6: w('b6', t('KM2', 9), t('KM1', 10)), // KM2 14 → KM1 NC_21 (parallel with START2)
    },
  }
}

describe('electrical interlock (NC aux of each on the other coil path)', () => {
  const press = (state: ReturnType<typeof initialCircuitState>, id: string, pressed: boolean) =>
    circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id, pressed })

  it('KM1 ON ⇒ KM2 cannot pick up', () => {
    let s = initialCircuitState(interlockedContactors())
    s = press(s, 'S1', true)
    expect(s.contactorEnergized.KM1).toBe(true)
    s = press(s, 'S1', false) // sealed in
    s = press(s, 'S2', true) // try to start KM2 while KM1 holds
    expect(s.contactorEnergized.KM1).toBe(true)
    expect(s.contactorEnergized.KM2 ?? false).toBe(false)
  })

  it('KM2 ON ⇒ KM1 cannot pick up', () => {
    let s = initialCircuitState(interlockedContactors())
    s = press(s, 'S2', true)
    expect(s.contactorEnergized.KM2).toBe(true)
    s = press(s, 'S2', false)
    s = press(s, 'S1', true)
    expect(s.contactorEnergized.KM2).toBe(true)
    expect(s.contactorEnergized.KM1 ?? false).toBe(false)
  })
})


