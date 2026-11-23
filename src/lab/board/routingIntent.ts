/**
 * Stable schematic intent for the geometry router.
 *
 * Terminal designations describe device terminals, not permanent source phase.
 * In particular U2/V2/W2 are winding ends. They become a STAR common point only
 * when the persisted wiring says so, and become three distinct DELTA nodes when
 * cross-connected to the next winding start. This module derives those facts
 * from the wire-only topology; it never reads live relay/contactor state.
 */

import {
  BREAKER_3P_TERMINAL,
  CONTACTOR_TERMINAL,
  MOTOR_3PH_TERMINAL,
  OVERLOAD_TERMINAL,
  SOURCE_3PH_TERMINAL,
  buildPhysicalNodes,
  terminalKey,
  type Board,
  type NodeMap,
  type PlacedComponent,
  type Terminal,
  type Wire,
} from '../../engine/index'

export type StaticMotorTopology = 'STAR' | 'DELTA' | 'OPEN' | 'INVALID'

export type WireRoutingRole =
  | 'PHASE_BUNDLE'
  | 'MOTOR_WINDING_BUNDLE'
  | 'MOTOR_STAR_COMMON'
  | 'MOTOR_DELTA_LINK'
  | 'NEUTRAL'
  | 'PE'
  | 'ORDINARY'

export interface WireRoutingIntent {
  wireId: string
  role: WireRoutingRole
  /** A bundle is a visual ordering group, never an electrical identity. */
  bundleKey?: string
  bundleOrder?: number
  preferredSide?: 'top' | 'bottom' | 'left' | 'right'
}

export interface CommonNetTrunkPlan {
  role: 'MOTOR_STAR_POINT'
  nodeId: string
  ownerId: string
  /** This wire remains the physical trunk between two terminals. */
  targetWireId: string
  /** This wire is rendered as the third branch onto the target's midpoint. */
  branchWireId: string
  /** The branch endpoint that remains anchored to its real terminal. */
  branchTerminal: Terminal
  junctionFraction: number
  terminalKeys: [string, string, string]
}

function nodeOf(nodes: NodeMap, terminal: Terminal): string | undefined {
  return nodes.nodeOf.get(terminalKey(terminal))
}

function motorTerminals(motorId: string) {
  return {
    starts: [
      { componentId: motorId, index: MOTOR_3PH_TERMINAL.U1 },
      { componentId: motorId, index: MOTOR_3PH_TERMINAL.V1 },
      { componentId: motorId, index: MOTOR_3PH_TERMINAL.W1 },
    ] as [Terminal, Terminal, Terminal],
    ends: [
      { componentId: motorId, index: MOTOR_3PH_TERMINAL.U2 },
      { componentId: motorId, index: MOTOR_3PH_TERMINAL.V2 },
      { componentId: motorId, index: MOTOR_3PH_TERMINAL.W2 },
    ] as [Terminal, Terminal, Terminal],
  }
}

/** Static external motor connection. Dynamic contact bridges are intentionally absent. */
export function classifyStaticMotorTopology(
  board: Board,
  motorId: string,
  nodes: NodeMap = buildPhysicalNodes(board),
): StaticMotorTopology {
  const motor = board.components[motorId]
  if (!motor || motor.spec.kind !== 'MOTOR_3PH') return 'INVALID'
  const { starts, ends } = motorTerminals(motorId)
  const [u1, v1, w1] = starts.map((terminal) => nodeOf(nodes, terminal))
  const [u2, v2, w2] = ends.map((terminal) => nodeOf(nodes, terminal))
  if ([u1, v1, w1, u2, v2, w2].some((node) => node === undefined)) return 'INVALID'

  const star =
    u2 === v2 &&
    v2 === w2 &&
    u2 !== u1 &&
    u2 !== v1 &&
    u2 !== w1
  // Both cyclic delta terminal-board orientations are electrically DELTA. The
  // supplied examples use the clockwise Siemens-preferred U2-W1/V2-U1/W2-V1
  // arrangement; recognizing the reverse cycle keeps user-built boards honest.
  const deltaClockwise = u2 === w1 && v2 === u1 && w2 === v1
  const deltaReverse = u2 === v1 && v2 === w1 && w2 === u1
  const delta = deltaClockwise || deltaReverse
  if (star && delta) return 'INVALID'
  if (star) return 'STAR'
  if (delta) return 'DELTA'
  return 'OPEN'
}

function terminalOrder(
  component: PlacedComponent,
  index: number,
): { order: number; semantic: 'phase' | 'winding' } | null {
  const isOneOf = (...values: number[]) => values.includes(index)
  switch (component.spec.kind) {
    case 'SOURCE_3PH':
      if (index === SOURCE_3PH_TERMINAL.R) return { order: 0, semantic: 'phase' }
      if (index === SOURCE_3PH_TERMINAL.S) return { order: 1, semantic: 'phase' }
      if (index === SOURCE_3PH_TERMINAL.T) return { order: 2, semantic: 'phase' }
      return null
    case 'BREAKER_3P':
      if (isOneOf(BREAKER_3P_TERMINAL.R_IN, BREAKER_3P_TERMINAL.R_OUT)) return { order: 0, semantic: 'phase' }
      if (isOneOf(BREAKER_3P_TERMINAL.S_IN, BREAKER_3P_TERMINAL.S_OUT)) return { order: 1, semantic: 'phase' }
      if (isOneOf(BREAKER_3P_TERMINAL.T_IN, BREAKER_3P_TERMINAL.T_OUT)) return { order: 2, semantic: 'phase' }
      return null
    case 'CONTACTOR':
      if (isOneOf(CONTACTOR_TERMINAL.L1, CONTACTOR_TERMINAL.T1)) return { order: 0, semantic: 'phase' }
      if (isOneOf(CONTACTOR_TERMINAL.L2, CONTACTOR_TERMINAL.T2)) return { order: 1, semantic: 'phase' }
      if (isOneOf(CONTACTOR_TERMINAL.L3, CONTACTOR_TERMINAL.T3)) return { order: 2, semantic: 'phase' }
      return null
    case 'OVERLOAD_RELAY':
      if (isOneOf(OVERLOAD_TERMINAL.L1, OVERLOAD_TERMINAL.T1)) return { order: 0, semantic: 'phase' }
      if (isOneOf(OVERLOAD_TERMINAL.L2, OVERLOAD_TERMINAL.T2)) return { order: 1, semantic: 'phase' }
      if (isOneOf(OVERLOAD_TERMINAL.L3, OVERLOAD_TERMINAL.T3)) return { order: 2, semantic: 'phase' }
      return null
    case 'MOTOR_3PH':
      // Winding order is useful for a compact U/V/W bundle, but it is NOT a
      // permanent L1/L2/L3 identity. Context decides STAR versus DELTA.
      if (isOneOf(MOTOR_3PH_TERMINAL.U1, MOTOR_3PH_TERMINAL.U2)) return { order: 0, semantic: 'winding' }
      if (isOneOf(MOTOR_3PH_TERMINAL.V1, MOTOR_3PH_TERMINAL.V2)) return { order: 1, semantic: 'winding' }
      if (isOneOf(MOTOR_3PH_TERMINAL.W1, MOTOR_3PH_TERMINAL.W2)) return { order: 2, semantic: 'winding' }
      return null
    default:
      return null
  }
}

function terminalRootsForKinds(
  board: Board,
  nodes: NodeMap,
  match: (component: PlacedComponent, index: number) => boolean,
): Set<string> {
  const roots = new Set<string>()
  for (const component of Object.values(board.components)) {
    const count = component.spec.kind === 'SOURCE_3PH' ? 4 : component.spec.kind === 'SOURCE' ? 2 : component.spec.kind === 'GROUND' ? 1 : 0
    for (let index = 0; index < count; index += 1) {
      if (!match(component, index)) continue
      const root = nodeOf(nodes, { componentId: component.id, index })
      if (root) roots.add(root)
    }
  }
  return roots
}

export function motorStarNodeIds(board: Board, nodes: NodeMap = buildPhysicalNodes(board)): Set<string> {
  const roots = new Set<string>()
  for (const motor of Object.values(board.components)) {
    if (motor.spec.kind !== 'MOTOR_3PH') continue
    if (classifyStaticMotorTopology(board, motor.id, nodes) !== 'STAR') continue
    const root = nodeOf(nodes, motorTerminals(motor.id).ends[0])
    if (root) roots.add(root)
  }
  return roots
}

/**
 * Context-aware wire grouping. U2/V2/W2 may retain U/V/W drawing order when
 * travelling to another three-pole device, but a common STAR node is never
 * classified as a phase bundle.
 */
export function deriveWireRoutingIntents(
  board: Board,
  nodes: NodeMap = buildPhysicalNodes(board),
): Map<string, WireRoutingIntent> {
  const neutralRoots = terminalRootsForKinds(
    board,
    nodes,
    (component, index) =>
      (component.spec.kind === 'SOURCE_3PH' && index === SOURCE_3PH_TERMINAL.N) ||
      (component.spec.kind === 'SOURCE' && index === 1),
  )
  const peRoots = terminalRootsForKinds(
    board,
    nodes,
    (component) => component.spec.kind === 'GROUND',
  )
  const starRoots = motorStarNodeIds(board, nodes)
  const directDeltaWireIds = new Set<string>()
  for (const motor of Object.values(board.components)) {
    if (
      motor.spec.kind !== 'MOTOR_3PH' ||
      classifyStaticMotorTopology(board, motor.id, nodes) !== 'DELTA'
    ) {
      continue
    }
    for (const wire of Object.values(board.wires)) {
      if (
        wire.from.componentId === motor.id &&
        wire.to.componentId === motor.id
      ) {
        directDeltaWireIds.add(wire.id)
      }
    }
  }
  const intents = new Map<string, WireRoutingIntent>()

  for (const wire of Object.values(board.wires)) {
    const fromComponent = board.components[wire.from.componentId]
    const toComponent = board.components[wire.to.componentId]
    const root = nodeOf(nodes, wire.from)
    if (!fromComponent || !toComponent || !root) {
      intents.set(wire.id, { wireId: wire.id, role: 'ORDINARY' })
      continue
    }
    if (peRoots.has(root)) {
      intents.set(wire.id, { wireId: wire.id, role: 'PE' })
      continue
    }
    if (directDeltaWireIds.has(wire.id)) {
      intents.set(wire.id, {
        wireId: wire.id,
        role: 'MOTOR_DELTA_LINK',
        bundleKey: `delta-link:${wire.id}`,
      })
      continue
    }
    if (neutralRoots.has(root)) {
      const pair = [fromComponent.id, toComponent.id].sort().join('<->')
      intents.set(wire.id, {
        wireId: wire.id,
        role: 'NEUTRAL',
        bundleKey: `neutral:${pair}`,
        bundleOrder: wire.from.index * 100 + wire.to.index,
        preferredSide: 'bottom',
      })
      continue
    }
    if (starRoots.has(root)) {
      // Unique bundle key prevents the old pair-based fallback from spreading
      // U2/V2/W2 into independent phase lanes.
      intents.set(wire.id, {
        wireId: wire.id,
        role: 'MOTOR_STAR_COMMON',
        bundleKey: `star-common:${root}:${wire.id}`,
      })
      continue
    }
    const fromOrder = terminalOrder(fromComponent, wire.from.index)
    const toOrder = terminalOrder(toComponent, wire.to.index)
    const distinctDevices = fromComponent.id !== toComponent.id
    if (distinctDevices && fromOrder && toOrder) {
      const pair = [fromComponent.id, toComponent.id].sort().join('<->')
      const motorOrder =
        fromOrder.semantic === 'winding'
          ? fromOrder.order
          : toOrder.semantic === 'winding'
            ? toOrder.order
            : null
      const role: WireRoutingRole =
        motorOrder === null ? 'PHASE_BUNDLE' : 'MOTOR_WINDING_BUNDLE'
      const sourceBreakerPair =
        (fromComponent.spec.kind === 'SOURCE_3PH' && toComponent.spec.kind === 'BREAKER_3P') ||
        (fromComponent.spec.kind === 'BREAKER_3P' && toComponent.spec.kind === 'SOURCE_3PH')
      intents.set(wire.id, {
        wireId: wire.id,
        role,
        bundleKey: `${role === 'PHASE_BUNDLE' ? 'phase' : 'motor-winding'}:${pair}`,
        bundleOrder: motorOrder ?? fromOrder.order,
        preferredSide: sourceBreakerPair ? 'top' : undefined,
      })
      continue
    }
    intents.set(wire.id, { wireId: wire.id, role: 'ORDINARY' })
  }

  return intents
}

function planThreeTerminalTree(
  board: Board,
  nodes: NodeMap,
  ownerId: string,
  terminals: [Terminal, Terminal, Terminal],
): CommonNetTrunkPlan | null {
  const keys = terminals.map(terminalKey) as [string, string, string]
  const roots = terminals.map((terminal) => nodeOf(nodes, terminal))
  if (!roots[0] || roots.some((root) => root !== roots[0])) return null
  const keySet = new Set(keys)
  const internal = Object.values(board.wires).filter(
    (wire) => keySet.has(terminalKey(wire.from)) && keySet.has(terminalKey(wire.to)) && !wire.tap,
  )
  if (internal.length !== 2) return null

  const candidates: Array<{
    target: Wire
    branch: Wire
    branchTerminal: Terminal
    preferred: boolean
  }> = []
  for (const target of internal) {
    const branch = internal.find((wire) => wire.id !== target.id) as Wire
    const targetKeys = new Set([terminalKey(target.from), terminalKey(target.to)])
    const external = [branch.from, branch.to].find(
      (terminal) => !targetKeys.has(terminalKey(terminal)),
    )
    if (!external) continue
    candidates.push({
      target,
      branch,
      branchTerminal: external,
      preferred: terminalKey(external) === terminalKey(branch.from),
    })
  }
  const selected = candidates.sort(
    (a, b) => Number(b.preferred) - Number(a.preferred) || a.target.id.localeCompare(b.target.id),
  )[0]
  if (!selected) return null
  return {
    role: 'MOTOR_STAR_POINT',
    nodeId: roots[0],
    ownerId,
    targetWireId: selected.target.id,
    branchWireId: selected.branch.id,
    branchTerminal: selected.branchTerminal,
    junctionFraction: 0.5,
    terminalKeys: keys,
  }
}

/**
 * Compact shared-trunk plans for physical STAR common points. Direct motor ties
 * and the common output side of a correctly wired STAR contactor are supported.
 */
export function buildCommonNetTrunkPlans(
  board: Board,
  nodes: NodeMap = buildPhysicalNodes(board),
): CommonNetTrunkPlan[] {
  const plans: CommonNetTrunkPlan[] = []
  const motors = Object.values(board.components).filter(
    (component) => component.spec.kind === 'MOTOR_3PH',
  )

  for (const motor of motors) {
    if (classifyStaticMotorTopology(board, motor.id, nodes) !== 'STAR') continue
    const plan = planThreeTerminalTree(board, nodes, motor.id, motorTerminals(motor.id).ends)
    if (plan) plans.push(plan)
  }

  // STAR contactor: L1/L2/L3 each lead to U2/V2/W2 of one motor, while its
  // T1/T2/T3 outputs are physically tied into the stable common trunk.
  for (const contactor of Object.values(board.components)) {
    if (contactor.spec.kind !== 'CONTACTOR') continue
    const inputTerminals: [Terminal, Terminal, Terminal] = [
      { componentId: contactor.id, index: CONTACTOR_TERMINAL.L1 },
      { componentId: contactor.id, index: CONTACTOR_TERMINAL.L2 },
      { componentId: contactor.id, index: CONTACTOR_TERMINAL.L3 },
    ]
    const inputRoots = inputTerminals.map((terminal) => nodeOf(nodes, terminal))
    const owner = motors.find((motor) => {
      const endRoots = motorTerminals(motor.id).ends.map((terminal) => nodeOf(nodes, terminal))
      return inputRoots.every((root) => root !== undefined) &&
        new Set(inputRoots).size === 3 &&
        inputRoots.every((root) => endRoots.includes(root))
    })
    if (!owner) continue
    const outputs: [Terminal, Terminal, Terminal] = [
      { componentId: contactor.id, index: CONTACTOR_TERMINAL.T1 },
      { componentId: contactor.id, index: CONTACTOR_TERMINAL.T2 },
      { componentId: contactor.id, index: CONTACTOR_TERMINAL.T3 },
    ]
    const plan = planThreeTerminalTree(board, nodes, owner.id, outputs)
    if (plan && !plans.some((candidate) => candidate.nodeId === plan.nodeId)) plans.push(plan)
  }

  return plans
}
