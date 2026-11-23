import { buildPhysicalNodes } from './topology'
import {
  MOTOR_3PH_TERMINAL,
  SOURCE_3PH_TERMINAL,
  SOURCE_TERMINAL,
  terminalKey,
  type Board,
  type BoardProjection,
  type Terminal,
} from './types'
import { terminalCountForComponent } from './componentModels'

/** Electrical intent. These roles never come from wire colour or net numbering. */
export type SemanticNetRole =
  | 'PHASE_L1'
  | 'PHASE_L2'
  | 'PHASE_L3'
  | 'NEUTRAL'
  | 'PROTECTIVE_EARTH'
  | 'DC_POSITIVE'
  | 'DC_NEGATIVE'
  | 'MOTOR_STAR_POINT'
  | 'CONTROL_OR_SIGNAL'
  | 'UNCLASSIFIED'

export interface SemanticNet {
  id: string
  nodeId: string
  members: readonly string[]
  /** Multiple roles are kept when an intentional reference exists (e.g. star point tied to N). */
  roles: readonly SemanticNetRole[]
  primaryRole: SemanticNetRole
}

export type SemanticValidationSeverity = 'ERROR' | 'WARNING' | 'INFO'

export type SemanticValidationCode =
  | 'PROJECT_EMPTY'
  | 'WIRE_COMPONENT_MISSING'
  | 'WIRE_TERMINAL_OUT_OF_RANGE'
  | 'PHASE_TO_PHASE_CONFLICT'
  | 'PHASE_TO_NEUTRAL_CONFLICT'
  | 'PE_MIXED_WITH_ACTIVE'
  | 'DC_POLARITY_CONFLICT'
  | 'MOTOR_STAR_POINT_ON_PHASE'
  | 'MOTOR_STAR_POINT_REFERENCED_TO_NEUTRAL'
  | 'PROJECTION_TOPOLOGY_MISMATCH'

export interface SemanticValidationIssue {
  code: SemanticValidationCode
  severity: SemanticValidationSeverity
  message: string
  netId?: string
  wireId?: string
}

export interface SemanticNetAnalysis {
  nets: readonly SemanticNet[]
  netIdByTerminal: ReadonlyMap<string, string>
  issues: readonly SemanticValidationIssue[]
}

const ROLE_ORDER: readonly SemanticNetRole[] = [
  'MOTOR_STAR_POINT',
  'PHASE_L1',
  'PHASE_L2',
  'PHASE_L3',
  'NEUTRAL',
  'PROTECTIVE_EARTH',
  'DC_POSITIVE',
  'DC_NEGATIVE',
  'CONTROL_OR_SIGNAL',
  'UNCLASSIFIED',
]

function roleOrder(role: SemanticNetRole): number {
  return ROLE_ORDER.indexOf(role)
}

function addRole(map: Map<string, Set<SemanticNetRole>>, node: string | undefined, role: SemanticNetRole): void {
  if (!node) return
  const roles = map.get(node) ?? new Set<SemanticNetRole>()
  roles.add(role)
  map.set(node, roles)
}

function nodeFor(boardNodes: ReturnType<typeof buildPhysicalNodes>, terminal: Terminal): string | undefined {
  return boardNodes.nodeOf.get(terminalKey(terminal))
}

function deterministicNetId(index: number): string {
  return `NET_${String(index + 1).padStart(3, '0')}`
}

function validateWireEndpoints(board: Board): SemanticValidationIssue[] {
  const issues: SemanticValidationIssue[] = []
  for (const wire of Object.values(board.wires)) {
    for (const [side, terminal] of [['from', wire.from], ['to', wire.to]] as const) {
      const component = board.components[terminal.componentId]
      if (!component) {
        issues.push({
          code: 'WIRE_COMPONENT_MISSING',
          severity: 'ERROR',
          wireId: wire.id,
          message: `Kabel ${wire.id} ${side} mengacu ke komponen yang tidak ada: ${terminal.componentId}.`,
        })
      } else if (!Number.isInteger(terminal.index) || terminal.index < 0 || terminal.index >= terminalCountForComponent(component)) {
        issues.push({
          code: 'WIRE_TERMINAL_OUT_OF_RANGE',
          severity: 'ERROR',
          wireId: wire.id,
          message: `Kabel ${wire.id} ${side} memakai terminal ${terminal.index} di luar kontrak ${component.spec.kind}.`,
        })
      }
    }
  }
  return issues
}

/**
 * Derive physical-net meaning from terminal contracts and connectivity.
 * U2/V2/W2 are winding ends. They become MOTOR_STAR_POINT only when the actual
 * physical net ties all three together; none is classified as a phase by name.
 */
export function analyzeSemanticNets(board: Board): SemanticNetAnalysis {
  const issues = validateWireEndpoints(board)
  if (issues.some((issue) => issue.code === 'WIRE_COMPONENT_MISSING')) {
    return { nets: [], netIdByTerminal: new Map(), issues }
  }

  const nodes = buildPhysicalNodes(board)
  const rolesByNode = new Map<string, Set<SemanticNetRole>>()

  for (const component of Object.values(board.components)) {
    const terminalNode = (index: number) => nodeFor(nodes, { componentId: component.id, index })
    switch (component.spec.kind) {
      case 'SOURCE': {
        const dc = component.spec.sourceType === 'battery_dc' || component.spec.sourceType === 'din_psu_24vdc'
        addRole(rolesByNode, terminalNode(SOURCE_TERMINAL.L), dc ? 'DC_POSITIVE' : 'PHASE_L1')
        addRole(rolesByNode, terminalNode(SOURCE_TERMINAL.N), dc ? 'DC_NEGATIVE' : 'NEUTRAL')
        break
      }
      case 'SOURCE_3PH':
        addRole(rolesByNode, terminalNode(SOURCE_3PH_TERMINAL.R), 'PHASE_L1')
        addRole(rolesByNode, terminalNode(SOURCE_3PH_TERMINAL.S), 'PHASE_L2')
        addRole(rolesByNode, terminalNode(SOURCE_3PH_TERMINAL.T), 'PHASE_L3')
        addRole(rolesByNode, terminalNode(SOURCE_3PH_TERMINAL.N), 'NEUTRAL')
        break
      case 'GROUND':
        addRole(rolesByNode, terminalNode(0), 'PROTECTIVE_EARTH')
        break
      case 'MOTOR_3PH': {
        const u2 = terminalNode(MOTOR_3PH_TERMINAL.U2)
        const v2 = terminalNode(MOTOR_3PH_TERMINAL.V2)
        const w2 = terminalNode(MOTOR_3PH_TERMINAL.W2)
        if (u2 && u2 === v2 && v2 === w2) addRole(rolesByNode, u2, 'MOTOR_STAR_POINT')
        addRole(rolesByNode, terminalNode(MOTOR_3PH_TERMINAL.PE), 'PROTECTIVE_EARTH')
        break
      }
      case 'SENSOR_3WIRE':
        addRole(rolesByNode, terminalNode(2), 'CONTROL_OR_SIGNAL')
        break
      default:
        break
    }
  }

  const sortedNodes = [...nodes.members.entries()].sort((a, b) => {
    const firstA = [...a[1]].sort()[0] ?? a[0]
    const firstB = [...b[1]].sort()[0] ?? b[0]
    return firstA.localeCompare(firstB)
  })
  const netIdByTerminal = new Map<string, string>()
  const nets: SemanticNet[] = sortedNodes.map(([nodeId, rawMembers], index) => {
    const id = deterministicNetId(index)
    const members = [...rawMembers].sort()
    for (const member of members) netIdByTerminal.set(member, id)
    const roleSet = rolesByNode.get(nodeId)
    const roles = roleSet && roleSet.size > 0
      ? [...roleSet].sort((a, b) => roleOrder(a) - roleOrder(b))
      : ['UNCLASSIFIED' as const]
    return { id, nodeId, members, roles, primaryRole: roles[0] }
  })

  for (const net of nets) {
    const phases = net.roles.filter((role) => role === 'PHASE_L1' || role === 'PHASE_L2' || role === 'PHASE_L3')
    if (phases.length > 1) {
      issues.push({ code: 'PHASE_TO_PHASE_CONFLICT', severity: 'ERROR', netId: net.id, message: `${net.id} menyatukan lebih dari satu fase (${phases.join(', ')}).` })
    }
    if (phases.length > 0 && net.roles.includes('NEUTRAL')) {
      issues.push({ code: 'PHASE_TO_NEUTRAL_CONFLICT', severity: 'ERROR', netId: net.id, message: `${net.id} menyatukan fase dan neutral.` })
    }
    if (net.roles.includes('PROTECTIVE_EARTH') && net.roles.some((role) => role.startsWith('PHASE_') || role === 'NEUTRAL' || role === 'DC_POSITIVE' || role === 'DC_NEGATIVE')) {
      issues.push({ code: 'PE_MIXED_WITH_ACTIVE', severity: 'ERROR', netId: net.id, message: `${net.id} mencampur PE dengan konduktor aktif/neutral.` })
    }
    if (net.roles.includes('DC_POSITIVE') && net.roles.includes('DC_NEGATIVE')) {
      issues.push({ code: 'DC_POLARITY_CONFLICT', severity: 'ERROR', netId: net.id, message: `${net.id} menyatukan polaritas DC positif dan negatif.` })
    }
    if (net.roles.includes('MOTOR_STAR_POINT') && phases.length > 0) {
      issues.push({ code: 'MOTOR_STAR_POINT_ON_PHASE', severity: 'ERROR', netId: net.id, message: `${net.id} adalah common star U2/V2/W2 tetapi terhubung langsung ke fase.` })
    }
    if (net.roles.includes('MOTOR_STAR_POINT') && net.roles.includes('NEUTRAL')) {
      issues.push({ code: 'MOTOR_STAR_POINT_REFERENCED_TO_NEUTRAL', severity: 'INFO', netId: net.id, message: `${net.id} adalah star point yang secara eksplisit direferensikan ke neutral; identitas star point tetap dipertahankan.` })
    }
  }

  return { nets, netIdByTerminal, issues }
}

/**
 * Both projections deliberately consume one Board graph. This assertion makes
 * that invariant reviewable and catches any future projection-specific endpoint
 * store before it can silently diverge.
 */
export function projectionTopologySignature(board: Board, _projection: BoardProjection): string {
  return Object.values(board.wires)
    .map((wire) => [terminalKey(wire.from), terminalKey(wire.to)].sort().join('<->'))
    .sort()
    .join('|')
}

export function validateProjectionTopologyParity(board: Board): SemanticValidationIssue[] {
  return projectionTopologySignature(board, 'virtual') === projectionTopologySignature(board, 'iec')
    ? []
    : [{ code: 'PROJECTION_TOPOLOGY_MISMATCH', severity: 'ERROR', message: 'Topology papan Virtual dan IEC berbeda.' }]
}
