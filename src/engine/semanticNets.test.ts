import { describe, expect, it } from 'vitest'
import {
  analyzeSemanticNets,
  projectionTopologySignature,
  type Board,
} from './index'

const source = { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 } as const
const motor = { kind: 'MOTOR_3PH', windingResistanceOhms: 20, ratedCurrentAmps: 10 } as const
const wire = (id: string, fromId: string, fromIndex: number, toId: string, toIndex: number) => ({
  id,
  from: { componentId: fromId, index: fromIndex },
  to: { componentId: toId, index: toIndex },
})

function floatingStarBoard(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: source },
      M: { id: 'M', cell: { x: 4, y: 0 }, spec: motor },
      PE: { id: 'PE', cell: { x: 4, y: 4 }, spec: { kind: 'GROUND' } },
    },
    wires: {
      l1: wire('l1', 'Q', 0, 'M', 0),
      l2: wire('l2', 'Q', 1, 'M', 2),
      l3: wire('l3', 'Q', 2, 'M', 4),
      starA: wire('starA', 'M', 1, 'M', 3),
      starB: wire('starB', 'M', 3, 'M', 5),
      pe: wire('pe', 'M', 6, 'PE', 0),
    },
  }
}

describe('semantic electrical nets', () => {
  it('classifies U2/V2/W2 as one star point, never as permanent L1/L2/L3 lanes', () => {
    const analysis = analyzeSemanticNets(floatingStarBoard())
    const star = analysis.nets.find((net) => net.roles.includes('MOTOR_STAR_POINT'))
    expect(star?.roles).toEqual(['MOTOR_STAR_POINT'])
    expect(star?.members).toEqual(expect.arrayContaining(['M:1', 'M:3', 'M:5']))
    expect(analysis.issues).toEqual([])
  })

  it('preserves star-point identity when intentionally referenced to neutral', () => {
    const board = floatingStarBoard()
    board.wires.neutral = wire('neutral', 'M', 5, 'Q', 3)
    const analysis = analyzeSemanticNets(board)
    const star = analysis.nets.find((net) => net.roles.includes('MOTOR_STAR_POINT'))
    expect(star?.roles).toEqual(['MOTOR_STAR_POINT', 'NEUTRAL'])
    expect(analysis.issues).toContainEqual(expect.objectContaining({
      code: 'MOTOR_STAR_POINT_REFERENCED_TO_NEUTRAL',
      severity: 'INFO',
    }))
  })

  it('reports destructive phase ties and PE/active mixing', () => {
    const board = floatingStarBoard()
    board.wires.badPhase = wire('badPhase', 'Q', 0, 'Q', 1)
    board.wires.badPe = wire('badPe', 'PE', 0, 'Q', 2)
    const codes = analyzeSemanticNets(board).issues.map((issue) => issue.code)
    expect(codes).toContain('PHASE_TO_PHASE_CONFLICT')
    expect(codes).toContain('PE_MIXED_WITH_ACTIVE')
  })

  it('keeps Virtual and IEC topology signatures equal while geometry may differ', () => {
    const board = floatingStarBoard()
    board.components.M.projectionCells = { virtual: { x: 4, y: 0 }, iec: { x: 9, y: 5 } }
    board.wires.starA.tap = { wireId: 'starB', projectionPositions: { virtual: 0.2, iec: 0.8 } }
    expect(projectionTopologySignature(board, 'virtual')).toBe(projectionTopologySignature(board, 'iec'))
  })
})
