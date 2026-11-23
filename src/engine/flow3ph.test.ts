/**
 * Three-phase wire classification (Bug Hunt Pack 2A) — colour comes from a node's
 * ACTUAL phase identity/voltage; animation from real line current. Never component
 * status; never a fake phase on an ambiguous node.
 */
import { describe, expect, it } from 'vitest'
import type { Board } from './types'
import { solveThreePhase } from './threePhase'
import { classifyThreePhaseWires, isMotor3phRunning } from './flow'

const SRC3 = { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } as const
const MOT = { kind: 'MOTOR_3PH', windingResistanceOhms: 20, ratedCurrentAmps: 100 } as const
const w = (id: string, fc: string, fi: number, tc: string, ti: number) => ({
  id,
  from: { componentId: fc, index: fi },
  to: { componentId: tc, index: ti },
})

describe('classifyThreePhaseWires (Pack 2A)', () => {
  it('colours each wire by the ACTUAL phase of its node (R/S/T/N) and animates on current', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        M: { id: 'M', cell: { x: 2, y: 0 }, spec: { ...MOT } },
      },
      wires: {
        r: w('r', 'Q', 0, 'M', 0),
        s: w('s', 'Q', 1, 'M', 2),
        t: w('t', 'Q', 2, 'M', 4),
        n1: w('n1', 'M', 1, 'Q', 3),
        n2: w('n2', 'M', 3, 'Q', 3),
        n3: w('n3', 'M', 5, 'Q', 3),
      },
    }
    const c = classifyThreePhaseWires(board, solveThreePhase(board))
    expect(c.r.phase).toBe('R')
    expect(c.s.phase).toBe('S')
    expect(c.t.phase).toBe('T')
    expect(c.n1.phase).toBe('N')
    expect(c.r.flowing).toBe(true) // motor draws → phase wires flow
    // Viz-consistency fix #3: a balanced star-N motor has a NET neutral current of ~0,
    // yet the neutral/return wires carry winding current — so EVERY conductive segment
    // animates uniformly (previously the neutral wires read still).
    expect(c.n1.flowing).toBe(true)
    expect(c.n2.flowing).toBe(true)
    expect(c.n3.flowing).toBe(true)
  })

  it('a floating star point reads `energized` — never a fake single phase', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        M: { id: 'M', cell: { x: 2, y: 0 }, spec: { ...MOT } },
      },
      wires: {
        r: w('r', 'Q', 0, 'M', 0),
        s: w('s', 'Q', 1, 'M', 2),
        t: w('t', 'Q', 2, 'M', 4),
        star1: w('star1', 'M', 1, 'M', 3),
        star2: w('star2', 'M', 3, 'M', 5),
      },
    }
    const c = classifyThreePhaseWires(board, solveThreePhase(board))
    expect(c.r.phase).toBe('R')
    expect(c.star1.phase).toBe('energized') // floating star, NOT a fabricated phase
    expect(c.star1.flowing).toBe(true)
    expect(c.star2.flowing).toBe(true)
  })

  it('does not animate a dead phase stub while another branch draws current', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        M: { id: 'M', cell: { x: 2, y: 0 }, spec: { ...MOT } },
        SW: { id: 'SW', cell: { x: 4, y: 0 }, spec: { kind: 'SWITCH', closed: false } },
      },
      wires: {
        r: w('r', 'Q', 0, 'M', 0),
        s: w('s', 'Q', 1, 'M', 2),
        t: w('t', 'Q', 2, 'M', 4),
        star1: w('star1', 'M', 1, 'M', 3),
        star2: w('star2', 'M', 3, 'M', 5),
        dead: w('dead', 'Q', 0, 'SW', 0),
      },
    }
    const c = classifyThreePhaseWires(board, solveThreePhase(board))
    expect(c.r.flowing).toBe(true)
    expect(c.dead.phase).toBe('R')
    expect(c.dead.flowing).toBe(false)
  })

  it('animates every conducting contactor route only after all main poles close', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        K: { id: 'K', cell: { x: 2, y: 0 }, spec: { kind: 'CONTACTOR' } },
        M: { id: 'M', cell: { x: 5, y: 0 }, spec: { ...MOT } },
      },
      wires: {
        rIn: w('rIn', 'Q', 0, 'K', 2), rOut: w('rOut', 'K', 3, 'M', 0),
        sIn: w('sIn', 'Q', 1, 'K', 4), sOut: w('sOut', 'K', 5, 'M', 2),
        tIn: w('tIn', 'Q', 2, 'K', 6), tOut: w('tOut', 'K', 7, 'M', 4),
        star1: w('star1', 'M', 1, 'M', 3), star2: w('star2', 'M', 3, 'M', 5),
      },
    }
    const off = classifyThreePhaseWires(board, solveThreePhase(board, { K: false }), { K: false })
    expect(Object.values(off).every((wire) => !wire.flowing)).toBe(true)

    const on = classifyThreePhaseWires(board, solveThreePhase(board, { K: true }), { K: true })
    expect(Object.values(on).every((wire) => wire.flowing)).toBe(true)
  })

  it('an energized wire with NO current is coloured but does NOT animate', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        SW: { id: 'SW', cell: { x: 2, y: 0 }, spec: { kind: 'SWITCH', closed: false } },
      },
      wires: { r: w('r', 'Q', 0, 'SW', 0) },
    }
    const c = classifyThreePhaseWires(board, solveThreePhase(board))
    expect(c.r.phase).toBe('R') // Q.R is a live phase node…
    expect(c.r.flowing).toBe(false) // …but nothing draws current → still
  })

  it('an UNREFERENCED node reads `inactive`, not energized', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        L: { id: 'L', cell: { x: 2, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 100, ratedCurrentAmps: 5 } },
      },
      wires: { iso: w('iso', 'L', 0, 'L', 1) }, // load island, no source tie
    }
    const c = classifyThreePhaseWires(board, solveThreePhase(board))
    expect(c.iso.phase).toBe('inactive')
  })

  it('a structured source conflict marks source wires `fault`, none flowing', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: { Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } } },
      wires: { bad: w('bad', 'Q', 0, 'Q', 1) }, // R–S tie → PHASE_TO_PHASE_SHORT
    }
    const c = classifyThreePhaseWires(board, solveThreePhase(board))
    expect(c.bad.phase).toBe('fault')
    expect(c.bad.flowing).toBe(false)
  })
})

describe('isMotor3phRunning (viz-consistency running indicator)', () => {
  const starN = (): Board => ({
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
      M: { id: 'M', cell: { x: 2, y: 0 }, spec: { ...MOT } },
    },
    wires: {
      r: w('r', 'Q', 0, 'M', 0),
      s: w('s', 'Q', 1, 'M', 2),
      t: w('t', 'Q', 2, 'M', 4),
      n1: w('n1', 'M', 1, 'Q', 3),
      n2: w('n2', 'M', 3, 'Q', 3),
      n3: w('n3', 'M', 5, 'Q', 3),
    },
  })

  it('balanced winding current → running', () => {
    expect(isMotor3phRunning(solveThreePhase(starN()), 'M')).toBe(true)
  })

  it('a de-energized motor (no source path) → idle', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        M: { id: 'M', cell: { x: 2, y: 0 }, spec: { ...MOT } },
      },
      wires: {}, // motor not connected → no winding current
    }
    expect(isMotor3phRunning(solveThreePhase(board), 'M')).toBe(false)
  })

  it('single-phasing (only R + star tied) is unbalanced → idle, not running', () => {
    const board: Board = {
      domain: 'ac-three-phase-balanced',
      components: {
        Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
        M: { id: 'M', cell: { x: 2, y: 0 }, spec: { ...MOT } },
      },
      wires: {
        r: w('r', 'Q', 0, 'M', 0),
        n1: w('n1', 'M', 1, 'Q', 3),
        n2: w('n2', 'M', 3, 'Q', 3),
        n3: w('n3', 'M', 5, 'Q', 3),
        // S and T lines absent → V/W windings carry ~0 → unbalanced.
      },
    }
    expect(isMotor3phRunning(solveThreePhase(board), 'M')).toBe(false)
  })
})
