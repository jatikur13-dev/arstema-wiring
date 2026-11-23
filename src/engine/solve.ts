/**
 * Solver — steady-state currents and node voltages for a resistive network.
 *
 * General nodal analysis (BOS decision M0 #1, option B): it is correct for
 * series AND parallel from the start, so M1 reaps it unchanged. Method:
 *   - Wires and closed switches already collapsed terminals into nodes (topology).
 *   - Each source fixes its N node at 0 V and its L node at EMF; a second source in an
 *     island already fixed is solved as an extra row (see sources.ts, L3).
 *   - Every LOAD is a conductance between two nodes. KCL at each unknown node
 *     gives a linear system G·V = I, solved by Gaussian elimination.
 *
 * Two honest special cases:
 *   - No source, or no closed path → nothing flows (energised = false).
 *   - L and N collapsed into one node (L–N tied together with no load in the
 *     loop) → a dead short. There is no finite steady current; we flag `shorted`
 *     and let the tick layer ramp toward the trip threshold.
 */

import type { Board, ComponentId, PlacedComponent } from './types'
import { MOTOR_TERMINAL, CONTACTOR_TERMINAL, boardDomain, terminalKey } from './types'
import { buildNodes, type NodeMap } from './topology'
import {
  mcbClosed,
  resistiveBranches,
  type ContactorEnergized,
  type RelayEnergized,
  type RuntimeContacts,
} from './conduction'
import { magnitude } from './phasor'
import {
  solveThreePhase,
  solveThreePhaseWithContactors,
  contactorCoilParams, contactorNextState, enforceMechanicalInterlocks,
  type ThreePhaseSolution,
  type ThreePhaseFaultCode,
} from './threePhase'
import { anchorSourceGroups, groupSources, plainSources, type SourceConflict } from './sources'

/** A 1-phase motor's derived state (M1). */
export type MotorStatus = 'RUNNING' | 'HUMMING' | 'IDLE'

export interface Solution {
  hasSource: boolean
  shorted: boolean
  /** Present when `shorted`: which sources and which of their terminals are joined
   *  (labels R/S/T/N/L/+/−). The tick names them in the diagnosis (L2). */
  short?: SourceConflict
  energised: boolean
  /** Steady current magnitude the source delivers (amperes). */
  sourceCurrent: number
  /** Steady current magnitude through each resistive component (load, motor). */
  loadCurrent: Record<ComponentId, number>
  /** Node id -> volts (ground = 0). Empty when there is no source. */
  nodeVoltage: Record<string, number>
  /** Per motor: does a capacitor bridge its aux to a main node (can it start)? */
  motorRunning: Record<ComponentId, boolean>
  /** Per motor: RUNNING (cap + power), HUMMING (power, no cap), IDLE (no power). */
  motorStatus: Record<ComponentId, MotorStatus>
  /** Per component with a load branch: the nominal voltage of the source feeding its
   *  island, so a lamp on a 24 V supply is judged against 24 V, not the mains (L3). */
  supplyVolts?: Record<ComponentId, number>
}

const EPS = 1e-9
/** A motor drawing at least this much current counts as powered (not idle). */
const MOTOR_MIN_CURRENT = 1e-3

function emptySolution(hasSource: boolean): Solution {
  return {
    hasSource,
    shorted: false,
    energised: false,
    sourceCurrent: 0,
    loadCurrent: {},
    nodeVoltage: {},
    motorRunning: {},
    motorStatus: {},
  }
}

/**
 * Which motors can start: a motor runs iff a capacitor bridges its aux terminal
 * to one of its main-winding nodes (the start-capacitor wiring). Purely
 * topological — decided from the electrical nodes, before any current is solved.
 */
export function computeMotorRunning(
  board: Board,
  nodes: NodeMap,
): Record<ComponentId, boolean> {
  const running: Record<ComponentId, boolean> = {}
  const nodeOf = (id: ComponentId, index: number) =>
    nodes.nodeOf.get(terminalKey({ componentId: id, index }))
  const capacitors = Object.values(board.components).filter(
    (c) => c.spec.kind === 'CAPACITOR',
  )

  for (const motor of Object.values(board.components)) {
    if (motor.spec.kind !== 'MOTOR') continue
    const aux = nodeOf(motor.id, MOTOR_TERMINAL.AUX)
    const mainA = nodeOf(motor.id, MOTOR_TERMINAL.MAIN_A)
    const mainB = nodeOf(motor.id, MOTOR_TERMINAL.MAIN_B)
    const mains = new Set([mainA, mainB])
    running[motor.id] = capacitors.some((cap) => {
      const c0 = nodeOf(cap.id, 0)
      const c1 = nodeOf(cap.id, 1)
      return (
        (c0 === aux && c1 !== undefined && mains.has(c1)) ||
        (c1 === aux && c0 !== undefined && mains.has(c0))
      )
    })
  }
  return running
}

/**
 * Solve A·x = b for small dense systems. A floating variable (a zero pivot with
 * a zero right-hand side — an unconnected node) is resolved to 0 rather than
 * failing: an isolated node simply sits at 0 V and carries no current.
 */
export function solveLinearSystem(
  matrix: number[][],
  rhs: number[],
): number[] {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row, rhs[i]])

  for (let col = 0; col < n; col += 1) {
    let pivot = -1
    let best = EPS
    for (let row = col; row < n; row += 1) {
      const value = Math.abs(a[row][col])
      if (value > best) {
        best = value
        pivot = row
      }
    }
    if (pivot === -1) continue // Floating variable: leave it at 0.
    ;[a[col], a[pivot]] = [a[pivot], a[col]]

    const pivotValue = a[col][col]
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = a[row][col] / pivotValue
      if (factor === 0) continue
      for (let k = col; k <= n; k += 1) {
        a[row][k] -= factor * a[col][k]
      }
    }
  }

  const x = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i += 1) {
    const diag = a[i][i]
    x[i] = Math.abs(diag) > EPS ? a[i][n] / diag : 0
  }
  return x
}

export function solveBoard(
  board: Board,
  relayEnergized: RelayEnergized = {},
  extra: RuntimeContacts = {},
  contactorEnergized: ContactorEnergized = {},
): Solution {
  const nodes = buildNodes(board, relayEnergized, contactorEnergized, extra)
  // Every two-terminal source feeds its own circuit (L3); the first one stays the
  // board's reference for `sourceCurrent`, exactly as before.
  const sources = plainSources(board, nodes)
  if (sources.length === 0) return emptySolution(false)
  const nNode = sources[0].pins[0].node
  const lNode = sources[0].pins[1].node

  // Dead-short detection on the BRIDGE view (M3-C3.2, mirrors the 3-phase C3.1 guard):
  // a CLOSED MCB pole (and an overload power pole) is treated as a node-merge here, not
  // a 1e-4 Ω sense-branch, so a direct L–N short through one collapses L and N onto one
  // node. Without this the sense-branch would leave L≠N and the matrix would fabricate
  // emf/R_SENSE. This view is a superset — a bare wire L–N is caught here too — and is
  // used ONLY for detection; the SOLVE view (`nodes`) is unchanged, so a series MCB's
  // pole current stays observable. A source's own L and N on one node, or two sources
  // forced to different potentials on one node, is a dead short with no finite steady
  // state. Returning here suppresses every sense-branch: no emf/R_SENSE current.
  const detNodes = buildNodes(board, relayEnergized, contactorEnergized, { ...extra, senseAsBridge: true })
  const short = groupSources(plainSources(board, detNodes)).conflict
  if (short) {
    return {
      hasSource: true,
      shorted: true,
      short,
      energised: true,
      sourceCurrent: 0,
      loadCurrent: {},
      nodeVoltage: { [nNode]: 0 },
      motorRunning: {},
      motorStatus: {},
    }
  }

  const motorRunning = computeMotorRunning(board, nodes)

  interface Branch {
    id: ComponentId
    a: string
    b: string
    conductance: number
    resistance: number
  }
  const branches: Branch[] = []
  for (const component of Object.values(board.components)) {
    // Resistive branch: a load, an indicator, a relay coil, or a motor's main
    // winding (its resistance switched by the run-state). A capacitor blocks DC.
    const provided = resistiveBranches(component, motorRunning, extra)
    provided.forEach((branch, localIndex) => {
      if (!(branch.resistance > 0)) return
      const a = nodes.nodeOf.get(terminalKey({ componentId: component.id, index: branch.a }))
      const b = nodes.nodeOf.get(terminalKey({ componentId: component.id, index: branch.b }))
      if (a === undefined || b === undefined || a === b) return
      branches.push({
        id: provided.length === 1 ? component.id : `${component.id}#${localIndex}`,
        a,
        b,
        conductance: 1 / branch.resistance,
        resistance: branch.resistance,
      })
    })
  }

  // Fixed nodes: each island's first source sets its N = 0 V and L = EMF (a single
  // source gives exactly N = 0, L = EMF). A source that only reaches an island already
  // fixed through loads is solved with the rest (one extra row per terminal).
  const anchored = anchorSourceGroups(
    groupSources(sources).groups,
    branches.map((branch) => [branch.a, branch.b] as const),
  )
  const fixed = new Map<string, number>()
  for (const [node, value] of anchored.fixed) fixed.set(node, value.re)

  // Only unknown nodes that actually carry a branch (or a coupled source terminal)
  // enter the matrix; the rest sit at 0 V by definition.
  const unknownIndex = new Map<string, number>()
  const addUnknown = (node: string) => {
    if (!fixed.has(node) && !unknownIndex.has(node)) unknownIndex.set(node, unknownIndex.size)
  }
  for (const branch of branches) {
    addUnknown(branch.a)
    addUnknown(branch.b)
  }
  for (const constraint of anchored.constraints) {
    for (const node of constraint.coefficients.keys()) addUnknown(node)
  }

  const nodeCount = unknownIndex.size
  const size = nodeCount + anchored.constraints.length
  const g = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const i = new Array<number>(size).fill(0)

  for (const branch of branches) {
    const ai = unknownIndex.get(branch.a)
    const bi = unknownIndex.get(branch.b)
    const aFixed = fixed.get(branch.a)
    const bFixed = fixed.get(branch.b)

    if (ai !== undefined) g[ai][ai] += branch.conductance
    if (bi !== undefined) g[bi][bi] += branch.conductance
    if (ai !== undefined && bi !== undefined) {
      g[ai][bi] -= branch.conductance
      g[bi][ai] -= branch.conductance
    }
    // A branch touching a fixed node moves that term to the right-hand side.
    if (ai !== undefined && bFixed !== undefined) i[ai] += branch.conductance * bFixed
    if (bi !== undefined && aFixed !== undefined) i[bi] += branch.conductance * aFixed
  }
  // Modified nodal analysis for a coupled source: V(pin) − V(reference) = EMF, plus
  // its unknown current in the KCL rows of both nodes.
  anchored.constraints.forEach((constraint, offset) => {
    const row = nodeCount + offset
    for (const [node, coefficient] of constraint.coefficients) {
      const index = unknownIndex.get(node)
      if (index !== undefined) {
        g[row][index] += coefficient
        g[index][row] += coefficient
      } else {
        i[row] -= coefficient * (fixed.get(node) ?? 0)
      }
    }
    i[row] += constraint.value.re
  })

  const solved = solveLinearSystem(g, i)
  const nodeVoltage: Record<string, number> = {}
  for (const [node, value] of fixed) nodeVoltage[node] = value
  for (const [node, index] of unknownIndex) nodeVoltage[node] = solved[index]

  const loadCurrent: Record<ComponentId, number> = {}
  const supplyVolts: Record<ComponentId, number> = {}
  let sourceCurrent = 0
  let otherSourceCurrent = 0
  const otherLive = new Set(sources.slice(1).map((source) => source.pins[1].node))
  for (const branch of branches) {
    const va = nodeVoltage[branch.a] ?? 0
    const vb = nodeVoltage[branch.b] ?? 0
    const current = Math.abs(va - vb) / branch.resistance
    loadCurrent[branch.id] = current
    // Current leaving the L node is what the source delivers.
    if (branch.a === lNode || branch.b === lNode) sourceCurrent += current
    if (otherLive.has(branch.a) || otherLive.has(branch.b)) otherSourceCurrent += current
    const volts = anchored.nominalVolts.get(branch.a)
    const owner = branch.id.split('#')[0]
    if (volts !== undefined && supplyVolts[owner] === undefined) supplyVolts[owner] = volts
  }

  const motorStatus: Record<ComponentId, MotorStatus> = {}
  for (const component of Object.values(board.components)) {
    if (component.spec.kind !== 'MOTOR') continue
    const current = loadCurrent[component.id] ?? 0
    motorStatus[component.id] =
      current < MOTOR_MIN_CURRENT
        ? 'IDLE'
        : motorRunning[component.id]
          ? 'RUNNING'
          : 'HUMMING'
  }

  return {
    hasSource: true,
    shorted: false,
    energised: sourceCurrent > EPS || otherSourceCurrent > EPS,
    sourceCurrent,
    loadCurrent,
    nodeVoltage,
    motorRunning,
    motorStatus,
    supplyVolts,
  }
}

/** Relay contacts change the topology, so solving is a fixpoint. */
const MAX_RELAY_ITER = 20

export interface CircuitSolution {
  solution: Solution
  relayEnergized: RelayEnergized
  /** Resolved contactor mechanical state (M3-B2 voltage-driven). `{}` for DC boards
   *  and for AC boards with no contactor. NOT stored on the Board. */
  contactorEnergized: ContactorEnergized
  /** Per-contactor coil RMS voltage at the converged solve (diagnostic; `{}` for DC). */
  coilVoltage: Record<ComponentId, number>
  /** Did the contactor closure↔voltage fixpoint settle? True for DC / no contactor. */
  contactorConverged: boolean
  /** Present ONLY for `ac-three-phase-balanced` boards: the full phasor result.
   *  Undefined for every DC (M0–M2) board, so the DC path is unchanged. */
  threePhase?: ThreePhaseSolution
}

/**
 * Ideal-topology phase monitor evaluation for RM17TG20.
 *
 * This intentionally models only the behaviour the simulator can prove: all
 * three input terminals must be connected to the matching L1/L2/L3 source nodes
 * through the currently conductive topology. It detects a missing or swapped
 * phase, but does not pretend to model the product's analogue voltage threshold,
 * imbalance tolerance, or response time.
 */
export function deriveAutomaticProductActuation(
  board: Board,
  relayEnergized: RelayEnergized = {},
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
): Record<ComponentId, boolean> {
  const result: Record<ComponentId, boolean> = {}
  const source = Object.values(board.components).find(
    (component) => component.spec.kind === 'SOURCE_3PH',
  )
  const monitors = Object.values(board.components).filter(
    (component) => component.modelId === 'PHASE_MONITOR_RM17TG20',
  )
  for (const monitor of monitors) result[monitor.id] = false
  if (!source || monitors.length === 0) return result

  // Seed the monitor outputs fault/de-energized while finding the input nodes.
  // Output contacts are electrically independent from L1/L2/L3, so their seed
  // cannot create a healthy input; it merely avoids reading stale manual state.
  const nodes = buildNodes(board, relayEnergized, contactorEnergized, {
    ...extra,
    productActuated: Object.fromEntries(monitors.map((item) => [item.id, false])),
  })
  const sourceNodes = [0, 1, 2].map((index) =>
    nodes.nodeOf.get(terminalKey({ componentId: source.id, index })),
  )
  const sourceDistinct = sourceNodes.every(Boolean) && new Set(sourceNodes).size === 3

  for (const monitor of monitors) {
    const inputNodes = [0, 1, 2].map((index) =>
      nodes.nodeOf.get(terminalKey({ componentId: monitor.id, index })),
    )
    result[monitor.id] = sourceDistinct && inputNodes.every(
      (node, index) => node !== undefined && node === sourceNodes[index],
    )
  }
  return result
}

/**
 * Map a structured 3-phase fault code onto the generic DC `Solution.shorted` flag.
 * EXHAUSTIVE by design: a NEW fault code must be classified here consciously — the
 * `never` guard makes an unhandled code a COMPILE error, and the runtime default is
 * `false` (not-a-short), so future faults are never silently treated as shorts.
 */
function faultImpliesShortCircuit(code: ThreePhaseFaultCode): boolean {
  switch (code) {
    // A collapsed pair/triple of source potentials is a short in the generic view.
    case 'PHASE_TO_PHASE_SHORT':
    case 'PHASE_TO_NEUTRAL_SHORT':
    case 'MULTIPLE_SOURCE_POTENTIAL_CONFLICT':
      return true
    default: {
      const _exhaustive: never = code
      void _exhaustive
      return false // an unclassified fault is NOT assumed to be a short
    }
  }
}

/**
 * Adapt a phasor solution to the CircuitSolution contract: node voltages and
 * currents become their RMS magnitudes for display, and the rich phasor result
 * rides along in `threePhase`. No relays in the 3-phase foundation.
 */
function threePhaseCircuitSolution(
  board: Board,
  previousContactor: ContactorEnergized = {},
  extra: RuntimeContacts = {},
  previousRelay: RelayEnergized = {},
): CircuitSolution {
  // Voltage-driven contactor fixpoint (M3-B2): seed from the previous state so a
  // self-holding contactor stays latched, then solve→measure A1–A2→recompute. The
  // timer/overload runtime (M3-C2) rides in `extra` as FROZEN contact positions.
  const {
    solution: tp,
    contactorEnergized,
    coilVoltage,
    converged,
    relayEnergized,
  } = solveThreePhaseWithContactors(board, previousContactor, extra, previousRelay)
  const loadCurrent: Record<ComponentId, number> = {}
  for (const [id, current] of Object.entries(tp.loadCurrent)) {
    loadCurrent[id] = magnitude(current)
  }
  // Multi-branch heaters have no single phasor current: expose maximum RMS branch
  // current to the generic indicator, retaining every branch in the AC solution.
  for (const c of Object.values(board.components)) {
    if (c.spec.kind === 'LOAD' && c.spec.threePhase) loadCurrent[c.id] = Math.max(...[0, 1, 2].map((i) => loadCurrent[`${c.id}#${i}`] ?? 0))
  }
  const nodeVoltage: Record<string, number> = {}
  for (const [node, measurement] of Object.entries(tp.nodeVoltage)) {
    // nodeVoltage entries are now rich NodeMeasurement; the DC-shaped display
    // reads the derived RMS magnitude.
    nodeVoltage[node] = measurement.magnitudeRmsVolts
  }
  // The STRUCTURED fault (code + labels) always stays on `.threePhase`. The generic
  // DC-shaped `shorted` is mapped PER FAULT CODE (not "any fault") so a future
  // 3-phase fault is not automatically a short. `shorted` is read only by the DC
  // tick, which cannot find a `SOURCE_3PH`, so it never fabricates DC current and
  // never touches an M0–M2 board (those never reach this adapter).
  const fault = tp.fault
  const shorted = fault !== undefined && faultImpliesShortCircuit(fault.code)
  // Any fault ⇒ no energy and no current: fault-current MAGNITUDE is not modelled.
  // Otherwise the representative source current is a LINE current — for a delta load
  // I_line ≠ I_branch (= √3·I_branch), so it comes from `lineCurrent`, NOT the
  // branch-current alias `loadCurrent`. Finite/default guard keeps it a real number.
  const lineCurrents = [tp.lineCurrent.R, tp.lineCurrent.S, tp.lineCurrent.T].filter((value) =>
    Number.isFinite(value),
  )
  const sourceCurrent =
    fault !== undefined || lineCurrents.length === 0 ? 0 : Math.max(...lineCurrents)
  // A 1-phase supply on the same board (a 24 VAC control transformer) also energises
  // the board when the 3-phase lines carry nothing (L3).
  const anyBranchCurrent = Object.values(tp.loadCurrent).some((current) => magnitude(current) > EPS)
  const solution: Solution = {
    hasSource: tp.hasSource,
    shorted,
    ...(shorted && fault ? { short: { sourceIds: fault.sourceIds ?? [], labels: fault.labels } } : {}),
    energised: fault === undefined && (sourceCurrent > EPS || anyBranchCurrent),
    sourceCurrent,
    loadCurrent,
    nodeVoltage,
    motorRunning: {},
    motorStatus: {},
    ...(tp.supplyVolts ? { supplyVolts: tp.supplyVolts } : {}),
  }
  return {
    solution,
    relayEnergized,
    contactorEnergized,
    coilVoltage,
    contactorConverged: converged,
    threePhase: tp,
  }
}

/**
 * Solve with relays: iterate solve → recompute each relay's energized state
 * from its coil current → re-solve, until the contact states stop changing (or
 * a hard iteration cap stops a physical oscillator). Seeded from the PREVIOUS
 * energized state so a self-holding latch keeps itself on.
 */
export function solveCircuit(
  board: Board,
  previousEnergized: RelayEnergized = {},
  previousContactor: ContactorEnergized = {},
  extra: RuntimeContacts = {},
): CircuitSolution {
  const runtime: RuntimeContacts = {
    ...extra,
    productActuated: {
      ...extra.productActuated,
      ...deriveAutomaticProductActuation(
        board,
        previousEnergized,
        previousContactor,
        extra,
      ),
    },
  }
  // Domain dispatch (BOS Option C). `boardDomain`: an explicit domain wins; a board
  // without one goes to the phasor solver only when it holds 3-phase parts or a
  // tapped transformer (L1), otherwise the exact DC path below. The two solvers never
  // share state. `extra` (M3-C2 timer/overload frozen contacts) is threaded
  // ADDITIVELY; default {} keeps every earlier caller.
  if (boardDomain(board) === 'ac-three-phase-balanced') {
    return threePhaseCircuitSolution(board, previousContactor, runtime, previousEnergized)
  }

  const relays = Object.values(board.components).filter(
    (component) => component.spec.kind === 'RELAY',
  )
  let energized: RelayEnergized = { ...previousEnergized }
  const contactors = Object.values(board.components).filter(c => c.spec.kind === 'CONTACTOR')
  let contacts: ContactorEnergized = { ...previousContactor }
  let coilVoltage: Record<string, number> = {}
  const solveWith = (relayState: RelayEnergized, contactorState: ContactorEnergized) => {
    runtime.productActuated = { ...extra.productActuated, ...deriveAutomaticProductActuation(board, relayState, contactorState, extra) }
    return solveBoard(board, relayState, runtime, contactorState)
  }
  let solution = solveWith(energized, contacts)
  const measureCoils = () => {
    const nodes = buildNodes(board, energized, contacts, runtime)
    const measured: Record<string, number> = {}
    for (const c of contactors) {
      const a = nodes.nodeOf.get(terminalKey({ componentId: c.id, index: CONTACTOR_TERMINAL.A1 }))
      const b = nodes.nodeOf.get(terminalKey({ componentId: c.id, index: CONTACTOR_TERMINAL.A2 }))
      const va = a === undefined ? undefined : solution.nodeVoltage[a]
      const vb = b === undefined ? undefined : solution.nodeVoltage[b]
      measured[c.id] = !solution.shorted && va !== undefined && vb !== undefined ? Math.abs(va - vb) : 0
    }
    return measured
  }

  for (let iteration = 0; iteration < MAX_RELAY_ITER; iteration += 1) {
    coilVoltage = measureCoils()
    const next: RelayEnergized = {}
    const requested: ContactorEnergized = {}
    for (const c of contactors) {
      if (c.spec.kind === 'CONTACTOR') requested[c.id] = contactorNextState(coilVoltage[c.id], contactorCoilParams(c.spec), contacts[c.id] ?? false)
    }
    const nextContacts = enforceMechanicalInterlocks(board, contacts, requested)
    let changed = contactors.some(c => (contacts[c.id] ?? false) !== nextContacts[c.id])
    for (const relay of relays) {
      if (relay.spec.kind !== 'RELAY') continue
      const on = (solution.loadCurrent[relay.id] ?? 0) > relay.spec.pickupAmps
      next[relay.id] = on
      if (on !== (energized[relay.id] ?? false)) changed = true
    }
    if (!changed) {
      return { solution, relayEnergized: next, contactorEnergized: nextContacts, coilVoltage, contactorConverged: true }
    }
    const after = solveWith(next, nextContacts)
    // A short that exists only while these contacts are closed (one behind a
    // contactor) stays in place so the tick's protection can clear it (L2). Releasing
    // them made the contacts chatter and the board read "unstable" instead of
    // "short". A short that survives the release (at the source) drops them as before.
    if (solution.shorted && !after.shorted) {
      return { solution, relayEnergized: energized, contactorEnergized: contacts, coilVoltage, contactorConverged: true }
    }
    energized = next
    contacts = nextContacts
    solution = after
  }
  // Did not settle (oscillator) — return the last computed state deterministically.
  return { solution, relayEnergized: energized, contactorEnergized: contacts, coilVoltage: measureCoils(), contactorConverged: false }
}

/** A protective device that a short-circuit opened. */
export interface ShortCircuitDevice {
  id: ComponentId
  kind: 'MCB' | 'FUSE'
}

/** The same fuse with its element blown (a FUSE, or a UT4-HESI fuse terminal). */
export function blownFuse(component: PlacedComponent): PlacedComponent {
  const spec = component.spec
  if (spec.kind === 'FUSE') return { ...component, spec: { ...spec, blown: true } }
  if (spec.kind === 'TERMINAL_BLOCK') return { ...component, spec: { ...spec, fuseBlown: true } }
  return component
}

/**
 * The protection on a short's path (L2): every closed MCB with an over-current
 * release and every intact fuse whose opening ALONE clears the short. Each carries
 * the whole fault current, so its instantaneous release or fuse element operates
 * before the source protection; MCBs in series all see it and all open (no
 * selectivity is modelled). Contact positions are the ones the shorted solve held.
 * An empty list means nothing on the path can clear it: the source protection trips.
 */
export function shortCircuitProtection(
  board: Board,
  relayEnergized: RelayEnergized,
  contactorEnergized: ContactorEnergized,
  extra: RuntimeContacts,
): ShortCircuitDevice[] {
  const ac = boardDomain(board) === 'ac-three-phase-balanced'
  const stillShorted = (candidate: Board, runtime: RuntimeContacts): boolean => {
    const contacts: RuntimeContacts = {
      ...runtime,
      productActuated: {
        ...runtime.productActuated,
        ...deriveAutomaticProductActuation(candidate, relayEnergized, contactorEnergized, runtime),
      },
    }
    if (!ac) return solveBoard(candidate, relayEnergized, contacts, contactorEnergized).shorted
    const fault = solveThreePhase(candidate, contactorEnergized, contacts, relayEnergized).fault
    return fault !== undefined && faultImpliesShortCircuit(fault.code)
  }
  const devices: ShortCircuitDevice[] = []
  for (const component of Object.values(board.components)) {
    const spec = component.spec
    if (spec.kind === 'BREAKER_1P' || spec.kind === 'BREAKER_3P') {
      if (spec.protectionDisabled || !mcbClosed(spec, component.id, extra.mcb)) continue
      const mcb = {
        ...extra.mcb,
        [component.id]: { thermalLevel: 0, tripped: true, tripReason: 'INSTANTANEOUS' as const, poleCurrents: [] },
      }
      if (!stillShorted(board, { ...extra, mcb })) devices.push({ id: component.id, kind: 'MCB' })
      continue
    }
    const intactFuse =
      (spec.kind === 'FUSE' && !spec.blown) ||
      (spec.kind === 'TERMINAL_BLOCK' && spec.model === 'PHOENIX_UT4_HESI' && !spec.open && !spec.fuseBlown)
    if (!intactFuse) continue
    const opened = { ...board, components: { ...board.components, [component.id]: blownFuse(component) } }
    if (!stillShorted(opened, extra)) devices.push({ id: component.id, kind: 'FUSE' })
  }
  return devices
}
