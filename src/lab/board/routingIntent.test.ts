import { describe, expect, it } from 'vitest'
import {
  MOTOR_3PH_TERMINAL,
  SOURCE_3PH_TERMINAL,
  buildNodes,
  buildPhysicalNodes,
  terminalKey,
  type Board,
} from '../../engine/index'
import { CIRCUIT_TEST_FIXTURES } from '../examples/circuitBoards'
import {
  buildCommonNetTrunkPlans,
  classifyStaticMotorTopology,
  deriveWireRoutingIntents,
} from './routingIntent'

const t = (componentId: string, index: number) => ({ componentId, index })

function directDeltaBoard(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: {
        id: 'Q',
        cell: { x: 0, y: 0 },
        spec: { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 100 },
      },
      M: {
        id: 'M',
        cell: { x: 4, y: 0 },
        spec: { kind: 'MOTOR_3PH', windingResistanceOhms: 20, ratedCurrentAmps: 12 },
      },
    },
    wires: {
      l1: { id: 'l1', from: t('Q', 0), to: t('M', MOTOR_3PH_TERMINAL.U1) },
      l2: { id: 'l2', from: t('Q', 1), to: t('M', MOTOR_3PH_TERMINAL.V1) },
      l3: { id: 'l3', from: t('Q', 2), to: t('M', MOTOR_3PH_TERMINAL.W1) },
      d1: { id: 'd1', from: t('M', MOTOR_3PH_TERMINAL.U2), to: t('M', MOTOR_3PH_TERMINAL.W1) },
      d2: { id: 'd2', from: t('M', MOTOR_3PH_TERMINAL.V2), to: t('M', MOTOR_3PH_TERMINAL.U1) },
      d3: { id: 'd3', from: t('M', MOTOR_3PH_TERMINAL.W2), to: t('M', MOTOR_3PH_TERMINAL.V1) },
    },
  }
}

describe('schematic routing intent', () => {
  it('classifies floating U2/V2/W2 as one STAR point, never Neutral or a phase bundle', () => {
    const board = CIRCUIT_TEST_FIXTURES['breaker-3f-motor']()
    const nodes = buildPhysicalNodes(board)
    const u2 = nodes.nodeOf.get(terminalKey(t('M3', MOTOR_3PH_TERMINAL.U2)))
    const v2 = nodes.nodeOf.get(terminalKey(t('M3', MOTOR_3PH_TERMINAL.V2)))
    const w2 = nodes.nodeOf.get(terminalKey(t('M3', MOTOR_3PH_TERMINAL.W2)))
    const neutral = nodes.nodeOf.get(terminalKey(t('Q', SOURCE_3PH_TERMINAL.N)))

    expect(classifyStaticMotorTopology(board, 'M3', nodes)).toBe('STAR')
    expect(u2).toBe(v2)
    expect(v2).toBe(w2)
    expect(u2).not.toBe(neutral)

    const intents = deriveWireRoutingIntents(board, nodes)
    for (const id of ['star1', 'star2']) {
      expect(intents.get(id)?.role).toBe('MOTOR_STAR_COMMON')
      expect(intents.get(id)?.bundleKey).not.toContain('phase')
    }
    expect(intents.get('star1')?.bundleKey).not.toBe(intents.get('star2')?.bundleKey)
  })

  it('turns a direct three-terminal STAR chain into one trunk plus one branch', () => {
    const board = CIRCUIT_TEST_FIXTURES['breaker-3f-motor']()
    const plans = buildCommonNetTrunkPlans(board)
    const plan = plans.find((candidate) => candidate.ownerId === 'M3')

    expect(plan).toMatchObject({
      role: 'MOTOR_STAR_POINT',
      targetWireId: 'star2',
      branchWireId: 'star1',
      branchTerminal: t('M3', MOTOR_3PH_TERMINAL.U2),
      junctionFraction: 0.5,
    })
    expect(new Set(plan?.terminalKeys)).toEqual(
      new Set([
        terminalKey(t('M3', MOTOR_3PH_TERMINAL.U2)),
        terminalKey(t('M3', MOTOR_3PH_TERMINAL.V2)),
        terminalKey(t('M3', MOTOR_3PH_TERMINAL.W2)),
      ]),
    )
  })

  it('keeps the direct motor example as a floating STAR point, not Neutral', () => {
    const board = CIRCUIT_TEST_FIXTURES['motor-3f-langsung']()
    const intents = deriveWireRoutingIntents(board)
    for (const id of ['star1', 'star2']) {
      expect(intents.get(id)?.role).toBe('MOTOR_STAR_COMMON')
      expect(intents.get(id)?.bundleKey).not.toContain('phase')
    }
  })

  it('classifies direct DELTA by connection and never treats U2/V2/W2 links as phase lanes', () => {
    const board = directDeltaBoard()
    expect(classifyStaticMotorTopology(board, 'M')).toBe('DELTA')
    const intents = deriveWireRoutingIntents(board)
    for (const id of ['d1', 'd2', 'd3']) {
      expect(intents.get(id)?.role).toBe('MOTOR_DELTA_LINK')
      expect(intents.get(id)?.bundleKey).not.toContain('phase')
    }
  })

  it('recognises the stable common output trunk of a STAR contactor', () => {
    const board = CIRCUIT_TEST_FIXTURES['star-delta-manual']()
    const plan = buildCommonNetTrunkPlans(board).find(
      (candidate) => candidate.targetWireId === 'ystar2',
    )
    expect(plan).toMatchObject({
      ownerId: 'M1',
      targetWireId: 'ystar2',
      branchWireId: 'ystar1',
    })
  })

  it('keeps physical routing topology unchanged when the STAR contactor operates', () => {
    const board = CIRCUIT_TEST_FIXTURES['star-delta-manual']()
    const physicalBefore = buildPhysicalNodes(board)
    const physicalAfter = buildPhysicalNodes(board)
    const dynamicOpen = buildNodes(board, {}, { KMY: false })
    const dynamicClosed = buildNodes(board, {}, { KMY: true })

    expect([...physicalAfter.nodeOf]).toEqual([...physicalBefore.nodeOf])
    expect(dynamicOpen.nodeOf.get('M1:1')).not.toBe(dynamicOpen.nodeOf.get('M1:3'))
    expect(dynamicClosed.nodeOf.get('M1:1')).toBe(dynamicClosed.nodeOf.get('M1:3'))
    expect(buildCommonNetTrunkPlans(board, physicalBefore)).toEqual(
      buildCommonNetTrunkPlans(board, physicalAfter),
    )
  })
})
