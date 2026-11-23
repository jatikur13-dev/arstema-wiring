import { describe, expect, it } from 'vitest'
import type { Board } from './types'
import { terminalKey } from './types'
import { buildNodes } from './topology'
import {
  detectFixedSourceConflict,
  solveThreePhase,
  threePhaseSourcePhasors,
} from './threePhase'
import { magnitude, angleDegrees, sub } from './phasor'
import { solveCircuit, solveBoard } from './solve'

// --- builders ---------------------------------------------------------------

const t = (componentId: string, index: number) => ({ componentId, index })
const w = (id: string, from: { componentId: string; index: number }, to: { componentId: string; index: number }) => ({ id, from, to })
const SRC = { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } as const
const R = 23.094 // ~10 A per phase at 230.94 V
const load = (resistanceOhms: number) => ({ kind: 'LOAD', resistanceOhms, ratedCurrentAmps: 100 }) as const
const AC = 'ac-three-phase-balanced' as const

/** Balanced (or per-phase) 4-wire star: phase→load→N. */
function starWyeN(rr = R, rs = R, rt = R): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 2 }, spec: { ...SRC } },
      LR: { id: 'LR', cell: { x: 3, y: 0 }, spec: load(rr) },
      LS: { id: 'LS', cell: { x: 3, y: 2 }, spec: load(rs) },
      LT: { id: 'LT', cell: { x: 3, y: 4 }, spec: load(rt) },
    },
    wires: {
      r1: w('r1', t('Q', 0), t('LR', 0)), r2: w('r2', t('LR', 1), t('Q', 3)),
      s1: w('s1', t('Q', 1), t('LS', 0)), s2: w('s2', t('LS', 1), t('Q', 3)),
      t1: w('t1', t('Q', 2), t('LT', 0)), t2: w('t2', t('LT', 1), t('Q', 3)),
    },
  }
}

/** Floating star (no neutral): the three load returns tie together but NOT to N. */
function floatingWye(rr = R, rs = R, rt = R): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 2 }, spec: { ...SRC } },
      LR: { id: 'LR', cell: { x: 3, y: 0 }, spec: load(rr) },
      LS: { id: 'LS', cell: { x: 3, y: 2 }, spec: load(rs) },
      LT: { id: 'LT', cell: { x: 3, y: 4 }, spec: load(rt) },
    },
    wires: {
      r1: w('r1', t('Q', 0), t('LR', 0)),
      s1: w('s1', t('Q', 1), t('LS', 0)),
      t1: w('t1', t('Q', 2), t('LT', 0)),
      star1: w('star1', t('LR', 1), t('LS', 1)),
      star2: w('star2', t('LS', 1), t('LT', 1)),
    },
  }
}

/** Delta: three loads across R-S, S-T, T-R. No neutral involved. */
function delta(rab = 40, rbc = 40, rca = 40): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 2 }, spec: { ...SRC } },
      DAB: { id: 'DAB', cell: { x: 3, y: 0 }, spec: load(rab) },
      DBC: { id: 'DBC', cell: { x: 3, y: 2 }, spec: load(rbc) },
      DCA: { id: 'DCA', cell: { x: 3, y: 4 }, spec: load(rca) },
    },
    wires: {
      ab0: w('ab0', t('Q', 0), t('DAB', 0)), ab1: w('ab1', t('DAB', 1), t('Q', 1)),
      bc0: w('bc0', t('Q', 1), t('DBC', 0)), bc1: w('bc1', t('DBC', 1), t('Q', 2)),
      ca0: w('ca0', t('Q', 2), t('DCA', 0)), ca1: w('ca1', t('DCA', 1), t('Q', 0)),
    },
  }
}

const nodeOf = (board: Board, componentId: string, index: number) =>
  buildNodes(board).nodeOf.get(terminalKey({ componentId, index })) as string

// --- source phasors (V_LL from phasor difference) ---------------------------

describe('threePhaseSourcePhasors', () => {
  const p = threePhaseSourcePhasors(400)
  it('derives V_LN = V_LL/√3 ≈ 230.94 (single base constant, not two)', () => {
    expect(p.vLineToNeutralVolts).toBeCloseTo(230.94, 2)
    expect(p.vLineToNeutralVolts * Math.sqrt(3)).toBeCloseTo(400, 6)
  })
  it('phase magnitudes equal; angles 0 / -120 / +120', () => {
    expect(magnitude(p.VRN)).toBeCloseTo(230.94, 2)
    expect(angleDegrees(p.VRN)).toBeCloseTo(0, 6)
    expect(angleDegrees(p.VSN)).toBeCloseTo(-120, 6)
    expect(angleDegrees(p.VTN)).toBeCloseTo(120, 6)
  })
  it('|V_RS| ≈ 400 BORN from the phasor difference, not a table', () => {
    expect(magnitude(sub(p.VRN, p.VSN))).toBeCloseTo(400, 4)
    expect(p.VRS).toEqual(sub(p.VRN, p.VSN))
    expect(magnitude(p.VRS)).toBeCloseTo(400, 4)
  })
})

// --- (A) fixed-source conflict detection ------------------------------------

describe('(A) fixed-source conflict detection', () => {
  it('acceptance-10: direct R-S wire → PHASE_TO_PHASE_SHORT, matrix NOT solved', () => {
    const board = starWyeN()
    board.wires.short = w('short', t('Q', 0), t('Q', 1)) // R tied to S
    const sol = solveThreePhase(board)
    expect(sol.fault?.code).toBe('PHASE_TO_PHASE_SHORT')
    expect(Object.keys(sol.nodeVoltage)).toHaveLength(0) // no solve happened
    expect(Object.keys(sol.branchCurrentPhasor)).toHaveLength(0)
  })

  it('acceptance-11: direct R-N wire → PHASE_TO_NEUTRAL_SHORT, matrix NOT solved', () => {
    const board = starWyeN()
    board.wires.short = w('short', t('Q', 0), t('Q', 3)) // R tied to N
    const sol = solveThreePhase(board)
    expect(sol.fault?.code).toBe('PHASE_TO_NEUTRAL_SHORT')
    expect(Object.keys(sol.nodeVoltage)).toHaveLength(0)
  })

  it('>2 source potentials on one node → MULTIPLE_SOURCE_POTENTIAL_CONFLICT', () => {
    const board = starWyeN()
    board.wires.s1short = w('s1short', t('Q', 0), t('Q', 1)) // R,S,T all merged
    board.wires.s2short = w('s2short', t('Q', 1), t('Q', 2))
    const sol = solveThreePhase(board)
    expect(sol.fault?.code).toBe('MULTIPLE_SOURCE_POTENTIAL_CONFLICT')
  })

  it('acceptance-12: a valid node merge (no source short) → fault null, it solves', () => {
    const sol = solveThreePhase(starWyeN())
    expect(sol.fault).toBeUndefined()
    expect(Object.keys(sol.nodeVoltage).length).toBeGreaterThan(0)
  })

  it('classifier: two source terminals at SAME potential is not a conflict', () => {
    // A hand-built node map collapsing R onto a node whose only other member is R
    // itself (same potential) must return null.
    const src = threePhaseSourcePhasors(400)
    const nodes = buildNodes(starWyeN())
    expect(detectFixedSourceConflict('Q', nodes, src)).toBeNull()
  })
})

// --- (B) connectivity / island policy ---------------------------------------

describe('(B) connectivity / island policy', () => {
  it('acceptance-3: balanced FLOATING wye → star RESOLVED ≈ neutral, not an island', () => {
    const board = floatingWye()
    const sol = solveThreePhase(board)
    const star = nodeOf(board, 'LR', 1)
    expect(sol.nodeVoltage[star].status).toBe('RESOLVED')
    expect(sol.nodeVoltage[star].magnitudeRmsVolts).toBeCloseTo(0, 3) // ≈ neutral
  })

  it('acceptance-4: unbalanced FLOATING wye → star SHIFTS to V_RN/4 (analytic)', () => {
    const board = floatingWye(R / 2, R, R) // R-phase admittance doubled
    const sol = solveThreePhase(board)
    const star = nodeOf(board, 'LR', 1)
    expect(sol.nodeVoltage[star].status).toBe('RESOLVED')
    // Vstar = (2·VRN + VSN + VTN)/4 = VRN/4  →  |Vstar| = 230.94/4 ≈ 57.735
    expect(sol.nodeVoltage[star].magnitudeRmsVolts).toBeCloseTo(230.94 / 4, 2)
  })

  it('acceptance-9: disconnected passive island → UNREFERENCED, 0 A, no NaN/Inf', () => {
    const board = starWyeN()
    board.components.LX = { id: 'LX', cell: { x: 6, y: 0 }, spec: load(50) }
    board.components.LY = { id: 'LY', cell: { x: 6, y: 2 }, spec: load(50) }
    board.wires.ix0 = w('ix0', t('LX', 0), t('LY', 0))
    board.wires.ix1 = w('ix1', t('LX', 1), t('LY', 1))
    const sol = solveThreePhase(board)
    const islandNode = nodeOf(board, 'LX', 0)
    expect(sol.nodeVoltage[islandNode].status).toBe('UNREFERENCED')
    expect(magnitude(sol.branchCurrentPhasor.LX)).toBeLessThan(1e-9) // passive → 0 A
    expect(magnitude(sol.branchVoltage.LX)).toBeLessThan(1e-9) // differential 0
    for (const m of Object.values(sol.nodeVoltage)) {
      expect(Number.isFinite(m.magnitudeRmsVolts)).toBe(true) // no NaN/Inf
    }
    // The real (referenced) load still solved correctly alongside the island.
    expect(sol.lineCurrent.R).toBeCloseTo(10, 3)
  })
})

// --- (D) measurement contract -----------------------------------------------

describe('(D) measurement contract', () => {
  it('acceptance-1: balanced wye+N → equal line currents, neutral ≈ 0, correct angles', () => {
    const sol = solveThreePhase(starWyeN())
    expect(sol.lineCurrent.R).toBeCloseTo(10, 3)
    expect(sol.lineCurrent.S).toBeCloseTo(10, 3)
    expect(sol.lineCurrent.T).toBeCloseTo(10, 3)
    expect(magnitude(sol.neutralCurrent)).toBeLessThan(1e-6)
    expect(magnitude(sol.neutralCurrentPhasor)).toBeLessThan(1e-6)
    // Line-current angles track the phase voltages (0 / -120 / +120).
    expect(angleDegrees(sol.sourceCurrentPhasor.R)).toBeCloseTo(0, 3)
    expect(angleDegrees(sol.sourceCurrentPhasor.S)).toBeCloseTo(-120, 3)
    expect(angleDegrees(sol.sourceCurrentPhasor.T)).toBeCloseTo(120, 3)
  })

  it('acceptance-2: unbalanced wye+N → line currents differ, neutral ≠ 0', () => {
    const sol = solveThreePhase(starWyeN(R / 2, R, R)) // R draws 20 A, S/T 10 A
    expect(sol.lineCurrent.R).toBeCloseTo(20, 3)
    expect(sol.lineCurrent.S).toBeCloseTo(10, 3)
    expect(magnitude(sol.neutralCurrent)).toBeCloseTo(10, 3) // 20∠0 + 10∠-120 + 10∠120
  })

  it('branch current sign is + from local terminal a → b, RMS/angle derived', () => {
    const sol = solveThreePhase(starWyeN())
    // LR wired Q.R(=LR.0) → N(=LR.1): current flows a→b, magnitude 10 A.
    expect(magnitude(sol.branchCurrentPhasor.LR)).toBeCloseTo(10, 3)
    expect(sol.loadCurrent.LR).toEqual(sol.branchCurrentPhasor.LR) // retained field, same value
    // Node measurement RMS/angle are derived consistently from the phasor.
    const node = nodeOf(starWyeN(), 'LR', 0)
    const m = sol.nodeVoltage[node]
    expect(m.magnitudeRmsVolts).toBeCloseTo(magnitude(m.phasor), 9)
    expect(m.angleDeg).toBeCloseTo(angleDegrees(m.phasor), 9)
  })
})

// --- delta + open topologies ------------------------------------------------

describe('delta and open-branch topologies', () => {
  it('acceptance-5: balanced delta → equal line currents, no neutral current', () => {
    const sol = solveThreePhase(delta())
    expect(magnitude(sol.branchCurrentPhasor.DAB)).toBeCloseTo(400 / 40, 3) // V_LL/R
    expect(sol.lineCurrent.R).toBeCloseTo(sol.lineCurrent.S, 3)
    expect(sol.lineCurrent.S).toBeCloseTo(sol.lineCurrent.T, 3)
    expect(sol.lineCurrent.R).toBeGreaterThan(0)
    expect(magnitude(sol.neutralCurrent)).toBeLessThan(1e-6) // no branch touches N
  })

  it('acceptance-6: unbalanced delta → line currents differ', () => {
    const sol = solveThreePhase(delta(20, 40, 40))
    expect(sol.lineCurrent.R).not.toBeCloseTo(sol.lineCurrent.T, 2)
  })

  it('acceptance-7: open branch (phase-T load removed) → line T current 0', () => {
    const board = starWyeN()
    delete board.components.LT
    delete board.wires.t1
    delete board.wires.t2
    const sol = solveThreePhase(board)
    expect(sol.lineCurrent.T).toBeCloseTo(0, 6)
    expect(sol.lineCurrent.R).toBeCloseTo(10, 3)
  })

  it('acceptance-8: open phase (T conductor removed) → line T current 0', () => {
    const board = starWyeN()
    delete board.wires.t1 // Q.T no longer feeds LT
    const sol = solveThreePhase(board)
    expect(sol.lineCurrent.T).toBeCloseTo(0, 6) // nothing leaves the T node
    expect(sol.lineCurrent.R).toBeCloseTo(10, 3)
  })
})

// --- (F) adapter layer: solveCircuit → CircuitSolution ----------------------

describe('(F) adapter: solveCircuit → CircuitSolution preserves the phasor contract', () => {
  it('F1 RESOLVED node: magnitude on both projections, status on .threePhase', () => {
    const board = starWyeN()
    const node = nodeOf(board, 'LR', 0) // = phase-R node, |V| = 230.94
    const result = solveCircuit(board)
    // Rich contract on .threePhase keeps the status + phasor.
    expect(result.threePhase?.nodeVoltage[node].status).toBe('RESOLVED')
    expect(result.threePhase?.nodeVoltage[node].magnitudeRmsVolts).toBeCloseTo(230.94, 2)
    // DC-shaped projection carries the derived magnitude (no wrapper leak).
    expect(result.solution.nodeVoltage[node]).toBeCloseTo(230.94, 2)
  })

  it('F2 disconnected island: UNREFERENCED survives; NOT a resolved 0 V', () => {
    const board = starWyeN()
    board.components.LX = { id: 'LX', cell: { x: 6, y: 0 }, spec: load(50) }
    board.components.LY = { id: 'LY', cell: { x: 6, y: 2 }, spec: load(50) }
    board.wires.ix0 = w('ix0', t('LX', 0), t('LY', 0))
    board.wires.ix1 = w('ix1', t('LX', 1), t('LY', 1))
    const islandNode = nodeOf(board, 'LX', 0)
    const result = solveCircuit(board)
    // The authoritative contract flags it UNREFERENCED (indeterminate), not 0 V.
    expect(result.threePhase?.nodeVoltage[islandNode].status).toBe('UNREFERENCED')
    expect(magnitude(result.threePhase!.branchCurrentPhasor.LX)).toBeLessThan(1e-9)
  })

  it('F3 direct R-S short: PHASE_TO_PHASE_SHORT reaches CircuitSolution, no fake current', () => {
    const board = starWyeN()
    board.wires.short = w('short', t('Q', 0), t('Q', 1))
    const result = solveCircuit(board)
    expect(result.threePhase?.fault?.code).toBe('PHASE_TO_PHASE_SHORT')
    expect(result.threePhase?.fault?.labels).toEqual(expect.arrayContaining(['R', 'S']))
    // Generic short state true; not healthy, no fabricated current.
    expect(result.solution.shorted).toBe(true)
    expect(result.solution.energised).toBe(false)
    expect(result.solution.sourceCurrent).toBe(0)
    expect(Object.keys(result.threePhase!.branchCurrentPhasor)).toHaveLength(0)
  })

  it('F4 direct R-N short: PHASE_TO_NEUTRAL_SHORT reaches CircuitSolution, shorted true', () => {
    const board = starWyeN()
    board.wires.short = w('short', t('Q', 0), t('Q', 3))
    const result = solveCircuit(board)
    expect(result.threePhase?.fault?.code).toBe('PHASE_TO_NEUTRAL_SHORT')
    expect(result.solution.shorted).toBe(true)
    expect(result.solution.energised).toBe(false)
    expect(result.solution.sourceCurrent).toBe(0)
  })

  it('F5 multiple source conflict: classification survives; mapped to shorted true', () => {
    const board = starWyeN()
    board.wires.s1short = w('s1short', t('Q', 0), t('Q', 1))
    board.wires.s2short = w('s2short', t('Q', 1), t('Q', 2))
    const result = solveCircuit(board)
    expect(result.threePhase?.fault?.code).toBe('MULTIPLE_SOURCE_POTENTIAL_CONFLICT')
    expect(result.solution.shorted).toBe(true)
    expect(result.solution.energised).toBe(false)
  })

  it('F6 balanced 3-phase: line + neutral currents mapped correctly, shorted false', () => {
    const result = solveCircuit(starWyeN())
    expect(result.threePhase?.lineCurrent).toEqual({
      R: expect.closeTo(10, 3),
      S: expect.closeTo(10, 3),
      T: expect.closeTo(10, 3),
    })
    expect(magnitude(result.threePhase!.neutralCurrentPhasor)).toBeLessThan(1e-6)
    expect(result.solution.shorted).toBe(false)
    // Star: line current == phase current, so the representative scalar is 10.
    expect(result.solution.sourceCurrent).toBeCloseTo(10, 3)
  })

  it('F8 balanced delta: solution.sourceCurrent follows LINE current (√3·branch), not branch', () => {
    const result = solveCircuit(delta()) // R = 40 Ω per branch
    // Branch current = V_LL/R = 400/40 = 10 A.
    expect(magnitude(result.threePhase!.branchCurrentPhasor.DAB)).toBeCloseTo(10, 3)
    // Line current = √3 × branch = 17.32 A.
    expect(result.threePhase!.lineCurrent.R).toBeCloseTo(Math.sqrt(3) * 10, 2)
    // The DC-shaped scalar must track the LINE current, NOT the branch alias (10).
    expect(result.solution.sourceCurrent).toBeCloseTo(Math.sqrt(3) * 10, 2)
    expect(result.solution.shorted).toBe(false)
  })

  it('F7 normal DC board: identical to solveBoard, threePhase absent', () => {
    const dc: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
        L1: { id: 'L1', cell: { x: 2, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 220, ratedCurrentAmps: 5 } },
      },
      wires: {
        w1: { id: 'w1', from: { componentId: 'S', index: 0 }, to: { componentId: 'L1', index: 0 } },
        w2: { id: 'w2', from: { componentId: 'L1', index: 1 }, to: { componentId: 'S', index: 1 } },
      },
    }
    const viaDispatch = solveCircuit(dc)
    const direct = solveBoard(dc)
    expect(viaDispatch.threePhase).toBeUndefined()
    expect(viaDispatch.solution.sourceCurrent).toBeCloseTo(direct.sourceCurrent, 9)
    expect(viaDispatch.solution.loadCurrent).toEqual(direct.loadCurrent)
    expect(viaDispatch.solution.nodeVoltage).toEqual(direct.nodeVoltage)
  })
})

// --- dispatcher / regression gate -------------------------------------------

describe('solveCircuit domain dispatch', () => {
  it('routes an ac-three-phase-balanced board to the phasor solver', () => {
    const result = solveCircuit(starWyeN())
    expect(result.threePhase).toBeDefined()
    expect(result.solution.sourceCurrent).toBeGreaterThan(0)
  })

  it('a board with no domain stays on the DC solver (threePhase absent)', () => {
    const dc: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
        L1: { id: 'L1', cell: { x: 2, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 220, ratedCurrentAmps: 5 } },
      },
      wires: {
        w1: { id: 'w1', from: { componentId: 'S', index: 0 }, to: { componentId: 'L1', index: 0 } },
        w2: { id: 'w2', from: { componentId: 'L1', index: 1 }, to: { componentId: 'S', index: 1 } },
      },
    }
    const result = solveCircuit(dc)
    expect(result.threePhase).toBeUndefined()
    expect(result.solution.sourceCurrent).toBeCloseTo(1, 6) // 220 V / 220 Ω
  })
})

// --- (G) MOTOR_3PH through the actual solver (M3-B1 electrical-path) ---------
// These pass through solveThreePhase (the real solve path), NOT resistiveBranches()
// in isolation — proving the three windings reach the admittance matrix.

const MOTOR = (windingResistanceOhms: number) =>
  ({ kind: 'MOTOR_3PH', windingResistanceOhms, ratedCurrentAmps: 12 }) as const

/** Real star-to-neutral wiring: R→U1,U2→N | S→V1,V2→N | T→W1,W2→N. */
function motorWyeN(rw = R): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 2 }, spec: { ...SRC } },
      M: { id: 'M', cell: { x: 3, y: 2 }, spec: MOTOR(rw) },
    },
    wires: {
      u1: w('u1', t('Q', 0), t('M', 0)), u2: w('u2', t('M', 1), t('Q', 3)),
      v1: w('v1', t('Q', 1), t('M', 2)), v2: w('v2', t('M', 3), t('Q', 3)),
      w1: w('w1', t('Q', 2), t('M', 4)), w2: w('w2', t('M', 5), t('Q', 3)),
    },
  }
}

describe('(G) MOTOR_3PH balanced wye-to-neutral through solveThreePhase', () => {
  it('each winding draws V_LN/Rwinding, three windings equal, neutral ≈ 0, all RESOLVED', () => {
    const sol = solveThreePhase(motorWyeN())
    const iu = magnitude(sol.branchCurrentPhasor['M#0'])
    const iv = magnitude(sol.branchCurrentPhasor['M#1'])
    const iw = magnitude(sol.branchCurrentPhasor['M#2'])
    for (const i of [iu, iv, iw]) {
      expect(Number.isFinite(i)).toBe(true)
      expect(i).toBeCloseTo(230.94 / R, 3) // V_LN / Rwinding = 10 A
    }
    expect(iu).toBeCloseTo(iv, 6)
    expect(iv).toBeCloseTo(iw, 6)
    // Line currents equal; neutral ≈ 0 (balanced star).
    expect(sol.lineCurrent.R).toBeCloseTo(10, 3)
    expect(sol.lineCurrent.S).toBeCloseTo(10, 3)
    expect(sol.lineCurrent.T).toBeCloseTo(10, 3)
    expect(magnitude(sol.neutralCurrent)).toBeLessThan(1e-6)
    // Every winding terminal resolves; nothing is NaN/Infinity.
    const board = motorWyeN()
    for (const idx of [0, 1, 2, 3, 4, 5]) {
      const node = nodeOf(board, 'M', idx)
      expect(sol.nodeVoltage[node].status).toBe('RESOLVED')
    }
    for (const m of Object.values(sol.nodeVoltage)) {
      expect(Number.isFinite(m.magnitudeRmsVolts)).toBe(true)
    }
    for (const c of Object.values(sol.branchCurrentPhasor)) {
      expect(Number.isFinite(magnitude(c))).toBe(true)
    }
  })

  it('open winding (its return cut) → that winding 0 A, other two correct, no fabricated fault', () => {
    const board = motorWyeN()
    delete board.wires.u2 // U winding return to N removed → U open
    const sol = solveThreePhase(board)
    expect(sol.fault).toBeUndefined() // no fabricated fault
    expect(magnitude(sol.branchCurrentPhasor['M#0'])).toBeCloseTo(0, 6) // U open → 0 A
    expect(magnitude(sol.branchCurrentPhasor['M#1'])).toBeCloseTo(10, 3) // V unaffected
    expect(magnitude(sol.branchCurrentPhasor['M#2'])).toBeCloseTo(10, 3) // W unaffected
    for (const m of Object.values(sol.nodeVoltage)) {
      expect(Number.isFinite(m.magnitudeRmsVolts)).toBe(true)
    }
  })

  it('cross-winding absence: no internal star/delta tie — U isolated from V and W', () => {
    // Bare motor: all six winding terminals stay DISTINCT nodes (no internal tie).
    const bare: Board = {
      domain: AC,
      components: { M: { id: 'M', cell: { x: 0, y: 0 }, spec: MOTOR(R) } },
      wires: {},
    }
    const nodes = buildNodes(bare)
    const ids = [0, 1, 2, 3, 4, 5].map((i) =>
      nodes.nodeOf.get(terminalKey({ componentId: 'M', index: i })),
    )
    expect(new Set(ids).size).toBe(6) // U1,U2,V1,V2,W1,W2 six separate nodes

    // Through the solver: feed ONLY the U winding; V and W carry no current (no tie).
    const board: Board = {
      domain: AC,
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 2 }, spec: { ...SRC } },
        M: { id: 'M', cell: { x: 3, y: 2 }, spec: MOTOR(R) },
      },
      wires: {
        u1: w('u1', t('Q', 0), t('M', 0)),
        u2: w('u2', t('M', 1), t('Q', 3)),
      },
    }
    const sol = solveThreePhase(board)
    expect(magnitude(sol.branchCurrentPhasor['M#0'])).toBeCloseTo(10, 3) // U fed
    expect(magnitude(sol.branchCurrentPhasor['M#1'])).toBeLessThan(1e-9) // V no path
    expect(magnitude(sol.branchCurrentPhasor['M#2'])).toBeLessThan(1e-9) // W no path
  })
})

// --- (H) contactor mechanical-state seam through the actual solver -----------
// These pass external state INTO solveThreePhase, which threads it to the real
// topology — NOT a direct bridgedPairs() call.

/** SOURCE.R → KM main pole L1–T1 → LOAD → SOURCE.N. Current only when KM closes. */
function contactorMainPole(): Board {
  return {
    domain: AC,
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 2 }, spec: { ...SRC } },
      KM: { id: 'KM', cell: { x: 3, y: 2 }, spec: { kind: 'CONTACTOR' } },
      L: { id: 'L', cell: { x: 6, y: 2 }, spec: load(R) },
    },
    wires: {
      a: w('a', t('Q', 0), t('KM', 2)), // Q.R → KM.L1
      b: w('b', t('KM', 3), t('L', 0)), // KM.T1 → L.0
      c: w('c', t('L', 1), t('Q', 3)), // L.1 → Q.N
    },
  }
}

describe('(H) contactor state seam through solveThreePhase', () => {
  it('CONTACTOR FALSE (default de-energized): main pole open → branch current 0', () => {
    const sol = solveThreePhase(contactorMainPole()) // default: every contactor open
    expect(magnitude(sol.branchCurrentPhasor.L)).toBeLessThan(1e-9)
  })

  it('CONTACTOR TRUE: L1–T1 closed → branch current finite ≈ V_LN/R', () => {
    const sol = solveThreePhase(contactorMainPole(), { KM: true })
    expect(magnitude(sol.branchCurrentPhasor.L)).toBeCloseTo(230.94 / R, 3) // ≈ 10 A
  })

  it('existing solveThreePhase(board) with NO state arg stays valid (de-energized)', () => {
    const noArg = solveThreePhase(contactorMainPole())
    const emptyArg = solveThreePhase(contactorMainPole(), {})
    expect(magnitude(noArg.branchCurrentPhasor.L)).toBeLessThan(1e-9)
    expect(magnitude(emptyArg.branchCurrentPhasor.L)).toBeLessThan(1e-9)
  })

  it('AUXILIARY contacts follow the SAME state through the solve topology', () => {
    // R → NO(13-14) → LNO → N ;  S → NC(21-22) → LNC → N
    const board: Board = {
      domain: AC,
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 2 }, spec: { ...SRC } },
        KM: { id: 'KM', cell: { x: 3, y: 2 }, spec: { kind: 'CONTACTOR' } },
        LNO: { id: 'LNO', cell: { x: 6, y: 0 }, spec: load(R) },
        LNC: { id: 'LNC', cell: { x: 6, y: 4 }, spec: load(R) },
      },
      wires: {
        no0: w('no0', t('Q', 0), t('KM', 8)), no1: w('no1', t('KM', 9), t('LNO', 0)), no2: w('no2', t('LNO', 1), t('Q', 3)),
        nc0: w('nc0', t('Q', 1), t('KM', 10)), nc1: w('nc1', t('KM', 11), t('LNC', 0)), nc2: w('nc2', t('LNC', 1), t('Q', 3)),
      },
    }
    // De-energized: NC 21–22 closed → LNC conducts; NO 13–14 open → LNO dead.
    const off = solveThreePhase(board)
    expect(magnitude(off.branchCurrentPhasor.LNC)).toBeCloseTo(230.94 / R, 3)
    expect(magnitude(off.branchCurrentPhasor.LNO)).toBeLessThan(1e-9)
    // Energized: mirror image — NO closes, NC opens.
    const on = solveThreePhase(board, { KM: true })
    expect(magnitude(on.branchCurrentPhasor.LNO)).toBeCloseTo(230.94 / R, 3)
    expect(magnitude(on.branchCurrentPhasor.LNC)).toBeLessThan(1e-9)
  })
})


