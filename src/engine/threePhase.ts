/**
 * Three-phase phasor solver (M3-A / A.5) — SEPARATE and ISOLATED from the DC
 * solver (BOS decision, Option C). It analyses a balanced steady-state 3-phase
 * network in the phasor domain: node voltages and conductor currents are complex
 * numbers; the display reads their RMS magnitudes.
 *
 * A board opts in with `domain: 'ac-three-phase-balanced'`; `solveCircuit`
 * dispatches here. The DC path (`solveBoard`/`solveCircuit` else-branch) is never
 * touched. `buildNodes` (topology) and `resistiveBranch` (conduction) are shared
 * and only READ here — never modified.
 *
 * A.5 adds, all inside this file / the AC path:
 *   (A) fixed-source conflict detection — run AFTER buildNodes, BEFORE the matrix.
 *       Two DIFFERENT source potentials collapsed onto one node = a short; report
 *       an enum fault and do NOT build/solve the matrix (no NaN, no fake current).
 *   (B) connectivity / island policy — a node is RESOLVED only if it has an
 *       admittance path to a fixed source node; otherwise UNREFERENCED (its
 *       absolute voltage is indeterminate, not a silent 0 V; passive-island branch
 *       currents are 0).
 *   (D) measurement contract — additive fields (branch V/I phasors, per-line RMS
 *       currents, source current phasors) with explicit sign conventions. The old
 *       `loadCurrent` (per-component phasor) and `neutralCurrent` keep their meaning.
 *
 * Line-to-line voltage is the √3 phasor difference of phase voltages, never a
 * stored table. Motors/contactors/delta-abstraction/safety are later (M3-B/C);
 * delta is already expressible by wiring three LOADs R-S/S-T/T-R.
 */

import type { Board, ComponentId } from './types'
import { CONTACTOR_TERMINAL, SOURCE_3PH_TERMINAL, terminalKey } from './types'
import { buildNodes, type NodeMap } from './topology'
import { resistiveBranches, type ContactorEnergized, type RuntimeContacts } from './conduction'
import { add, angleDegrees, complex, div, magnitude, mul, phasor, sub, type Complex } from './phasor'
import { anchorSourceGroups, groupSources, plainSources, type IdealSource, type SourcePin } from './sources'

/** The source's phasor set. |V_RN|=|V_SN|=|V_TN|=V_LL/√3; the line voltages are
 *  the phasor DIFFERENCES, so |V_RS| ≈ √3·|V_LN| ≈ V_LL by construction. */
export interface ThreePhaseSourcePhasors {
  vLineToLineVolts: number
  vLineToNeutralVolts: number
  VRN: Complex
  VSN: Complex
  VTN: Complex
  VN: Complex
  VRS: Complex
  VST: Complex
  VTR: Complex
}

/** Derive the full phasor set from the ONE base constant (line-to-line volts). */
export function threePhaseSourcePhasors(vLineToLineVolts: number): ThreePhaseSourcePhasors {
  const vLineToNeutralVolts = vLineToLineVolts / Math.sqrt(3)
  const VRN = phasor(vLineToNeutralVolts, 0)
  const VSN = phasor(vLineToNeutralVolts, -120)
  const VTN = phasor(vLineToNeutralVolts, 120)
  const VN = complex(0, 0)
  return {
    vLineToLineVolts,
    vLineToNeutralVolts,
    VRN,
    VSN,
    VTN,
    VN,
    // Line-to-line = phasor difference. |VRS| comes out ≈ V_LL naturally.
    VRS: sub(VRN, VSN),
    VST: sub(VSN, VTN),
    VTR: sub(VTN, VRN),
  }
}

// --- (A) fixed-source conflict detection ------------------------------------

export type ThreePhaseFaultCode =
  | 'PHASE_TO_PHASE_SHORT'
  | 'PHASE_TO_NEUTRAL_SHORT'
  | 'MULTIPLE_SOURCE_POTENTIAL_CONFLICT'

/** A detected wiring conflict at the source (enum + which source terminals), kept
 *  separate from any human sentence — the feature layer phrases it, like DC faults. */
export interface ThreePhaseFault {
  code: ThreePhaseFaultCode
  /** Source terminal labels (R/S/T/N, or L/N and +/− of a 1-phase supply) that
   *  collapsed onto one node. */
  labels: string[]
  /** The sources whose terminals collapsed (L3: a board can hold several). */
  sourceIds?: ComponentId[]
}

/** Two potentials within this magnitude count as "the same" — a valid merge, not a
 *  short. Explicit numeric tolerance, never a raw equality on floats. */
const CONFLICT_TOL = 1e-6

function classifyConflict(labels: string[]): ThreePhaseFault {
  const set = new Set(labels)
  // A 1-phase supply's L (or +) counts as a phase and its − as a neutral (L3).
  const phases = ['R', 'S', 'T', 'L', '+'].filter((l) => set.has(l))
  const hasNeutral = set.has('N') || set.has('−')
  // Order matches the directive: two-phase short, then phase-neutral, then ≥3.
  if (!hasNeutral && phases.length === 2 && set.size === 2) {
    return { code: 'PHASE_TO_PHASE_SHORT', labels: [...set] }
  }
  if (hasNeutral && phases.length >= 1) {
    return { code: 'PHASE_TO_NEUTRAL_SHORT', labels: [...set] }
  }
  return { code: 'MULTIPLE_SOURCE_POTENTIAL_CONFLICT', labels: [...set] }
}

/**
 * After buildNodes: if ≥2 source terminals with DIFFERENT fixed potentials landed
 * on one electrical node, that is a short. Same-potential merges (differ ≤ TOL)
 * are valid and return null. Reads the node map; never mutates it.
 */
export function detectFixedSourceConflict(
  sourceId: ComponentId,
  nodes: NodeMap,
  src: ThreePhaseSourcePhasors,
): ThreePhaseFault | null {
  const terminals: Array<{ label: string; index: number; phasor: Complex }> = [
    { label: 'R', index: SOURCE_3PH_TERMINAL.R, phasor: src.VRN },
    { label: 'S', index: SOURCE_3PH_TERMINAL.S, phasor: src.VSN },
    { label: 'T', index: SOURCE_3PH_TERMINAL.T, phasor: src.VTN },
    { label: 'N', index: SOURCE_3PH_TERMINAL.N, phasor: src.VN },
  ]
  const byNode = new Map<string, Array<{ label: string; phasor: Complex }>>()
  for (const t of terminals) {
    const nodeId = nodes.nodeOf.get(terminalKey({ componentId: sourceId, index: t.index }))
    if (nodeId === undefined) continue
    const list = byNode.get(nodeId) ?? []
    list.push({ label: t.label, phasor: t.phasor })
    byNode.set(nodeId, list)
  }
  for (const list of byNode.values()) {
    if (list.length < 2) continue
    let differs = false
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (magnitude(sub(list[i].phasor, list[j].phasor)) > CONFLICT_TOL) differs = true
      }
    }
    if (!differs) continue // same potential collapsed → valid merge, not a short
    return classifyConflict(list.map((entry) => entry.label))
  }
  return null
}

// --- solution contract (D: measurement) -------------------------------------

export type NodeStatus = 'RESOLVED' | 'UNREFERENCED'

/** One node's measured voltage. `phasor` is the source of truth; RMS magnitude and
 *  angle are derived. UNREFERENCED means the absolute value is indeterminate (no
 *  path to a source), reported as such rather than a silent 0 V. */
export interface NodeMeasurement {
  phasor: Complex
  magnitudeRmsVolts: number
  angleDeg: number
  status: NodeStatus
}

export interface ThreePhaseLineTriple {
  R: number
  S: number
  T: number
}

export interface ThreePhaseSolution {
  hasSource: boolean
  vLineToLineVolts: number
  vLineToNeutralVolts: number
  source: ThreePhaseSourcePhasors | null
  /** (A) Present only when a fixed-source conflict was detected (matrix NOT solved). */
  fault?: ThreePhaseFault
  /** (D) Node id → measurement (phasor + derived RMS/angle + referencing status). */
  nodeVoltage: Record<string, NodeMeasurement>
  /** (D) Component id → V(a) − V(b), local terminals a→b. */
  branchVoltage: Record<ComponentId, Complex>
  /** (D) Component id → phasor current, + from local terminal a → b. */
  branchCurrentPhasor: Record<ComponentId, Complex>
  /** Per-component phasor current, + a → b (unchanged since M3-A; = branchCurrentPhasor). */
  loadCurrent: Record<ComponentId, Complex>
  /** (D) Source phasor current per phase, + from source node → network. */
  sourceCurrentPhasor: { R: Complex; S: Complex; T: Complex }
  /** (D) RMS magnitude of each line current. */
  lineCurrent: ThreePhaseLineTriple
  /** Net phasor current into the neutral node (unchanged since M3-A). */
  neutralCurrent: Complex
  /** (D) KCL-consistent neutral current phasor (= neutralCurrent). */
  neutralCurrentPhasor: Complex
  /** Per component with a load branch: the nominal voltage (largest terminal |V| of
   *  the source group) of the source feeding its island (L3). */
  supplyVolts?: Record<ComponentId, number>
}

function emptySolution(hasSource: boolean): ThreePhaseSolution {
  const zero = complex(0, 0)
  return {
    hasSource,
    vLineToLineVolts: 0,
    vLineToNeutralVolts: 0,
    source: null,
    nodeVoltage: {},
    branchVoltage: {},
    branchCurrentPhasor: {},
    loadCurrent: {},
    sourceCurrentPhasor: { R: zero, S: zero, T: zero },
    lineCurrent: { R: 0, S: 0, T: 0 },
    neutralCurrent: zero,
    neutralCurrentPhasor: zero,
  }
}

// --- complex nodal solve ----------------------------------------------------

/**
 * Solve A·x = b over the complex field (partial pivoting by magnitude). Mirrors
 * the DC `solveLinearSystem`: a floating variable (zero pivot) resolves to 0.
 * Island nodes never reach this — they are removed before the matrix (see B).
 */
export function solveComplexSystem(matrix: Complex[][], rhs: Complex[]): Complex[] {
  const n = rhs.length
  const a = matrix.map((row, i) => [...row.map((c) => ({ ...c })), { ...rhs[i] }])

  for (let col = 0; col < n; col += 1) {
    let pivot = -1
    let best = 1e-12
    for (let row = col; row < n; row += 1) {
      const value = magnitude(a[row][col])
      if (value > best) {
        best = value
        pivot = row
      }
    }
    if (pivot === -1) continue
    ;[a[col], a[pivot]] = [a[pivot], a[col]]

    const pivotValue = a[col][col]
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue
      const factor = div(a[row][col], pivotValue)
      if (factor.re === 0 && factor.im === 0) continue
      for (let k = col; k <= n; k += 1) {
        a[row][k] = sub(a[row][k], mul(factor, a[col][k]))
      }
    }
  }

  const x = new Array<Complex>(n).fill(complex(0, 0))
  for (let i = 0; i < n; i += 1) {
    const diag = a[i][i]
    x[i] = magnitude(diag) > 1e-12 ? div(a[i][n], diag) : complex(0, 0)
  }
  return x
}

interface Branch {
  id: ComponentId
  a: string
  b: string
  admittance: Complex
}

/** (B) Nodes reachable from a fixed source node through admittance branches. */
function referencedNodes(fixed: Set<string>, branches: Branch[]): Set<string> {
  const adjacency = new Map<string, string[]>()
  const link = (x: string, y: string) => {
    const list = adjacency.get(x) ?? []
    list.push(y)
    adjacency.set(x, list)
  }
  for (const branch of branches) {
    link(branch.a, branch.b)
    link(branch.b, branch.a)
  }
  const seen = new Set<string>(fixed)
  const queue = [...fixed]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of adjacency.get(current) ?? []) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return seen
}

/**
 * Solve a balanced 3-phase board in the phasor domain.
 *
 * SIGN CONVENTIONS:
 *   - branch current / branchVoltage: + from a component's LOCAL terminal a → b.
 *   - source current: + from the source phase node INTO the network.
 *   - neutral current: net phasor current INTO the neutral node = Σ phase returns
 *     (KCL); ≈ 0 when balanced.
 *
 * `contactorEnergized` is an ADDITIVE, backward-compatible seam (M3-B1): external
 * mechanical state (id → energized) that flows into topology so a closed/open
 * contact can change the network. It is NOT stored on the Board, NOT a UI toggle,
 * NOT derived from coil pickup (that is B2); the default is every contactor
 * de-energized, so `solveThreePhase(board)` behaves exactly as before.
 */
export function solveThreePhase(
  board: Board,
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
  relayEnergized: Record<string, boolean> = {},
): ThreePhaseSolution {
  const source = Object.values(board.components).find(
    (component) => component.spec.kind === 'SOURCE_3PH',
  )
  const src =
    source && source.spec.kind === 'SOURCE_3PH'
      ? threePhaseSourcePhasors(source.spec.vLineToLineVolts)
      : null
  // No relays in the 3-phase foundation, so relayEnergized stays {}; the contactor
  // seam + timer/overload runtime are threaded through to topology.
  const nodes = buildNodes(board, relayEnergized, contactorEnergized, extra)
  const nodeOf = (index: number) =>
    source ? nodes.nodeOf.get(terminalKey({ componentId: source.id, index })) : undefined
  const nodeR = nodeOf(SOURCE_3PH_TERMINAL.R)
  const nodeS = nodeOf(SOURCE_3PH_TERMINAL.S)
  const nodeT = nodeOf(SOURCE_3PH_TERMINAL.T)
  const nodeN = nodeOf(SOURCE_3PH_TERMINAL.N)
  const withSource = src
    ? { source: src, vLineToLineVolts: src.vLineToLineVolts, vLineToNeutralVolts: src.vLineToNeutralVolts }
    : {}
  if (
    source &&
    (nodeR === undefined || nodeS === undefined || nodeT === undefined || nodeN === undefined)
  ) {
    return { ...emptySolution(true), ...withSource }
  }
  // The 3-phase source first (its N is the board's 0 V), then every 1-phase supply on
  // the board, e.g. a 24 VAC control transformer that was ignored before (L3).
  const idealSources = (map: NodeMap): IdealSource[] => {
    const list = plainSources(board, map)
    if (!source || !src) return list
    const pin = (index: number, label: string, volts: Complex): SourcePin => ({
      node: map.nodeOf.get(terminalKey({ componentId: source.id, index })) as string,
      label,
      volts,
    })
    return [
      {
        id: source.id,
        pins: [
          pin(SOURCE_3PH_TERMINAL.N, 'N', src.VN),
          pin(SOURCE_3PH_TERMINAL.R, 'R', src.VRN),
          pin(SOURCE_3PH_TERMINAL.S, 'S', src.VSN),
          pin(SOURCE_3PH_TERMINAL.T, 'T', src.VTN),
        ],
      },
      ...list,
    ]
  }
  const sources = idealSources(nodes)
  if (sources.length === 0) return emptySolution(false)

  // (A) Conflict BEFORE any matrix work. A short → report the fault, solve nothing.
  // M3-C3.1 dual-view: detect on the BRIDGE view where a CLOSED MCB pole (and an
  // overload power pole) is a node merge, not a 1e-4 Ω sense-branch. Without this, a
  // pole shorting two source potentials (e.g. L–N) would leave the nodes distinct and
  // the matrix would fabricate a huge ΔV/R_SENSE current. This view is a superset —
  // direct wire ties are caught here too — and it is used ONLY for detection; the
  // SOLVE view (`nodes`) is unchanged, so per-pole current stays observable for
  // non-conflict boards. After the 3-phase source's own check, a 1-phase supply
  // shorted on itself or tied to a different potential is a conflict too (L3).
  const conflictNodes = buildNodes(board, relayEnergized, contactorEnergized, { ...extra, senseAsBridge: true })
  const ownFault = source && src ? detectFixedSourceConflict(source.id, conflictNodes, src) : null
  const crossConflict = ownFault ? null : groupSources(idealSources(conflictNodes)).conflict
  const fault: ThreePhaseFault | null = ownFault && source
    ? { ...ownFault, sourceIds: [source.id] }
    : crossConflict
      ? { ...classifyConflict(crossConflict.labels), sourceIds: crossConflict.sourceIds }
      : null
  if (fault) {
    // Returning here suppresses every sense-branch: the matrix never runs, so no MCB
    // pole current is fabricated. The tick trips the protection on the short's path.
    return { ...emptySolution(true), ...withSource, fault }
  }

  const branches: Branch[] = []
  for (const component of Object.values(board.components)) {
    // Iterate the FULL provider: existing kinds yield exactly one branch (identical
    // to the old `resistiveBranch`), a 3-phase motor yields its three windings.
    const provided = resistiveBranches(component, {}, extra)
    provided.forEach((branch, localIndex) => {
      if (!(branch.resistance > 0)) return
      const a = nodes.nodeOf.get(terminalKey({ componentId: component.id, index: branch.a }))
      const b = nodes.nodeOf.get(terminalKey({ componentId: component.id, index: branch.b }))
      if (a === undefined || b === undefined || a === b) return
      // One report key PER branch. A single-branch kind keeps the bare component id
      // (measurement contract unchanged); a multi-branch provider (motor windings
      // U/V/W, ordering locked) gets `${id}#0..2` so the three winding results are
      // never collapsed onto one id. Source/neutral accounting is by NODE, unaffected.
      const id = provided.length === 1 ? component.id : `${component.id}#${localIndex}`
      branches.push({ id, a, b, admittance: complex(1 / branch.resistance, 0) })
    })
  }

  // (B) Only nodes with a path to a fixed source node are RESOLVED. Unreferenced
  // island nodes are kept OUT of the matrix (their absolute voltage is
  // indeterminate — not forced silently to 0).
  // Modified nodal analysis for ideal isolated tapped transformers. Each tap
  // adds one voltage constraint and an unknown current. The SAME coefficients
  // in KCL reflect secondary current into the primary (energy conservation).
  const constraints: { id: string; coefficients: Map<string, number>; value?: Complex }[] = []
  const transformerLinks: Branch[] = []
  for (const c of Object.values(board.components)) {
    if (c.spec.kind !== 'SOURCE' || !c.spec.transformer) continue
    const spec = c.spec.transformer
    if (!(spec.primaryVolts > 0) || !spec.tapVolts.every((v) => Number.isFinite(v) && v > 0)) continue
    const pins = [0, 1, 2, 3, 4].map((index) => nodes.nodeOf.get(terminalKey({ componentId: c.id, index }))!)
    transformerLinks.push({ id: c.id + ':primary', a: pins[0], b: pins[1], admittance: complex(0, 0) })
    spec.tapVolts.forEach((volts, i) => {
      const coefficients = new Map<string, number>()
      const ratio = volts / spec.primaryVolts
      for (const [pin, value] of [[pins[i + 3], 1], [pins[2], -1], [pins[0], -ratio], [pins[1], ratio]] as [string, number][]) {
        coefficients.set(pin, (coefficients.get(pin) ?? 0) + value)
      }
      constraints.push({ id: `${c.id}#${i}`, coefficients })
      transformerLinks.push({ id: `${c.id}:tap${i}`, a: pins[2], b: pins[i + 3], admittance: complex(0, 0) })
    })
  }
  // Fixed potentials: the first source group of every island (the 3-phase source's
  // four terminals when there is one). A group that reaches an island already fixed
  // only through loads adds V(pin) − V(reference) = EMF rows instead (L3, sources.ts).
  const anchored = anchorSourceGroups(
    groupSources(sources).groups,
    [...branches, ...transformerLinks].map((branch) => [branch.a, branch.b] as const),
  )
  const fixed = anchored.fixed
  const sourceLinks: Branch[] = anchored.constraints.map((constraint) => {
    const [pinNode, reference] = [...constraint.coefficients.keys()]
    return { id: constraint.id, a: reference, b: pinNode, admittance: complex(0, 0) }
  })
  constraints.push(...anchored.constraints)
  const links = [...branches, ...transformerLinks, ...sourceLinks]
  // One numerical gauge per floating galvanic island; this is NOT a wire to N
  // or PE. Keep primary and secondary separate. Transformer voltage/current
  // constraints couple the islands without merging any physical terminals.
  if (constraints.length) {
    const remaining = new Set(links.flatMap((b) => [b.a, b.b]))
    while (remaining.size) {
      const first = remaining.values().next().value as string
      const island = referencedNodes(new Set([first]), links)
      if (![...island].some((n) => fixed.has(n))) fixed.set(first, complex(0, 0))
      for (const n of island) remaining.delete(n)
    }
  }
  const fixedSet = new Set<string>(fixed.keys())
  const referenced = referencedNodes(fixedSet, links)

  const unknownIndex = new Map<string, number>()
  for (const branch of links) {
    for (const node of [branch.a, branch.b]) {
      if (!fixed.has(node) && referenced.has(node) && !unknownIndex.has(node)) {
        unknownIndex.set(node, unknownIndex.size)
      }
    }
  }

  const nodeCount = unknownIndex.size
  const size = nodeCount + constraints.length
  const y: Complex[][] = Array.from({ length: size }, () =>
    new Array<Complex>(size).fill(complex(0, 0)),
  )
  const inj = new Array<Complex>(size).fill(complex(0, 0))
  for (const branch of branches) {
    const ai = unknownIndex.get(branch.a)
    const bi = unknownIndex.get(branch.b)
    const aFixed = fixed.get(branch.a)
    const bFixed = fixed.get(branch.b)
    // An island branch (neither endpoint referenced) contributes nothing.
    if (ai === undefined && bi === undefined && aFixed === undefined && bFixed === undefined) {
      continue
    }
    if (ai !== undefined) y[ai][ai] = add(y[ai][ai], branch.admittance)
    if (bi !== undefined) y[bi][bi] = add(y[bi][bi], branch.admittance)
    if (ai !== undefined && bi !== undefined) {
      y[ai][bi] = sub(y[ai][bi], branch.admittance)
      y[bi][ai] = sub(y[bi][ai], branch.admittance)
    }
    if (ai !== undefined && bFixed !== undefined) inj[ai] = add(inj[ai], mul(branch.admittance, bFixed))
    if (bi !== undefined && aFixed !== undefined) inj[bi] = add(inj[bi], mul(branch.admittance, aFixed))
  }
  let constraintConflict = false
  constraints.forEach((constraint, offset) => {
    const row = nodeCount + offset
    let variable = false
    for (const [node, coefficient] of constraint.coefficients) {
      if (Math.abs(coefficient) < 1e-12) continue
      const index = unknownIndex.get(node)
      if (index !== undefined) {
        variable = true
        y[row][index] = add(y[row][index], complex(coefficient, 0))
        y[index][row] = add(y[index][row], complex(coefficient, 0))
      } else if (fixed.has(node)) {
        inj[row] = sub(inj[row], mul(complex(coefficient, 0), fixed.get(node)!))
      }
    }
    if (constraint.value) inj[row] = add(inj[row], constraint.value)
    if (!variable) {
      if (magnitude(inj[row]) > 1e-6) constraintConflict = true
      else y[row][row] = complex(1, 0) // redundant zero-voltage source: zero current gauge
    }
  })
  if (constraintConflict) return { ...emptySolution(true), ...withSource,
    fault: { code: 'MULTIPLE_SOURCE_POTENTIAL_CONFLICT', labels: ['Transformer'] } }
  const solved = solveComplexSystem(y, inj)

  // Phasor per node + referencing status (D). Nodes that are neither fixed nor
  // referenced are UNREFERENCED: value indeterminate, reported as 0∠0 with status.
  const phasorByNode = new Map<string, Complex>()
  const statusByNode = new Map<string, NodeStatus>()
  for (const [node, value] of fixed) {
    phasorByNode.set(node, value)
    statusByNode.set(node, 'RESOLVED')
  }
  for (const [node, index] of unknownIndex) {
    phasorByNode.set(node, solved[index])
    statusByNode.set(node, 'RESOLVED')
  }
  const reportedNodes = new Set<string>([...fixed.keys()])
  for (const branch of links) {
    reportedNodes.add(branch.a)
    reportedNodes.add(branch.b)
  }
  const nodeVoltage: Record<string, NodeMeasurement> = {}
  for (const node of reportedNodes) {
    const status: NodeStatus = statusByNode.get(node) ?? 'UNREFERENCED'
    const value = phasorByNode.get(node) ?? complex(0, 0)
    nodeVoltage[node] = {
      phasor: value,
      magnitudeRmsVolts: magnitude(value),
      angleDeg: angleDegrees(value),
      status,
    }
  }
  const voltageOf = (node: string): Complex => nodeVoltage[node]?.phasor ?? complex(0, 0)

  // Branch voltage & current (+ a→b). Passive-island branches read 0 V across → 0 A.
  const branchVoltage: Record<ComponentId, Complex> = {}
  const branchCurrentPhasor: Record<ComponentId, Complex> = {}
  const loadCurrent: Record<ComponentId, Complex> = {}
  const supplyVolts: Record<ComponentId, number> = {}
  let currentOutR = complex(0, 0)
  let currentOutS = complex(0, 0)
  let currentOutT = complex(0, 0)
  let neutralIn = complex(0, 0)
  for (const branch of branches) {
    const drop = sub(voltageOf(branch.a), voltageOf(branch.b))
    const current = mul(drop, branch.admittance) // + a → b
    branchVoltage[branch.id] = drop
    branchCurrentPhasor[branch.id] = current
    loadCurrent[branch.id] = current
    const owner = branch.id.split('#')[0]
    const volts = anchored.nominalVolts.get(branch.a)
    if (volts !== undefined && supplyVolts[owner] === undefined) supplyVolts[owner] = volts
    // Net current leaving each source phase node = + when a==node, − when b==node.
    if (branch.a === nodeR) currentOutR = add(currentOutR, current)
    if (branch.b === nodeR) currentOutR = sub(currentOutR, current)
    if (branch.a === nodeS) currentOutS = add(currentOutS, current)
    if (branch.b === nodeS) currentOutS = sub(currentOutS, current)
    if (branch.a === nodeT) currentOutT = add(currentOutT, current)
    if (branch.b === nodeT) currentOutT = sub(currentOutT, current)
    // Net current INTO the neutral node.
    if (branch.b === nodeN) neutralIn = add(neutralIn, current)
    if (branch.a === nodeN) neutralIn = sub(neutralIn, current)
  }

  constraints.forEach((constraint, offset) => {
    const current = solved[nodeCount + offset]
    branchCurrentPhasor[constraint.id] = current
    for (const [node, coefficient] of constraint.coefficients) {
      const contribution = mul(complex(coefficient, 0), current)
      if (node === nodeR) currentOutR = add(currentOutR, contribution)
      if (node === nodeS) currentOutS = add(currentOutS, contribution)
      if (node === nodeT) currentOutT = add(currentOutT, contribution)
      if (node === nodeN) neutralIn = sub(neutralIn, contribution)
    }
  })
  const sourceCurrentPhasor = { R: currentOutR, S: currentOutS, T: currentOutT }
  const lineCurrent: ThreePhaseLineTriple = {
    R: magnitude(currentOutR),
    S: magnitude(currentOutS),
    T: magnitude(currentOutT),
  }

  return {
    hasSource: true,
    vLineToLineVolts: src?.vLineToLineVolts ?? 0,
    vLineToNeutralVolts: src?.vLineToNeutralVolts ?? 0,
    source: src,
    supplyVolts,
    nodeVoltage,
    branchVoltage,
    branchCurrentPhasor,
    loadCurrent,
    sourceCurrentPhasor,
    lineCurrent,
    neutralCurrent: neutralIn,
    neutralCurrentPhasor: neutralIn,
  }
}

// --- (M3-B2) voltage-driven contactor: coil measurement + hysteresis fixpoint --

/** Educational coil defaults; NOT universal law — overridable per contactor spec. */
export const CONTACTOR_COIL_DEFAULTS = {
  ratedCoilVolts: 230,
  pickupFraction: 0.85,
  dropoutFraction: 0.4,
} as const

export interface ContactorCoilParams {
  ratedCoilVolts: number
  pickupFraction: number
  dropoutFraction: number
}

/** Read + validate the coil thresholds. Any invalid value (non-finite, rated ≤ 0,
 *  or not 0 < dropout < pickup ≤ 1) falls back to the educational defaults as a SET
 *  — never a NaN/Infinity threshold. */
export function contactorCoilParams(spec: {
  ratedCoilVolts?: number
  pickupFraction?: number
  dropoutFraction?: number
}): ContactorCoilParams {
  const rated = spec.ratedCoilVolts ?? CONTACTOR_COIL_DEFAULTS.ratedCoilVolts
  const pickup = spec.pickupFraction ?? CONTACTOR_COIL_DEFAULTS.pickupFraction
  const dropout = spec.dropoutFraction ?? CONTACTOR_COIL_DEFAULTS.dropoutFraction
  const valid =
    Number.isFinite(rated) &&
    rated > 0 &&
    Number.isFinite(pickup) &&
    Number.isFinite(dropout) &&
    dropout > 0 &&
    pickup > dropout &&
    pickup <= 1
  return valid
    ? { ratedCoilVolts: rated, pickupFraction: pickup, dropoutFraction: dropout }
    : { ...CONTACTOR_COIL_DEFAULTS }
}

/**
 * RMS coil voltage |V(A1) − V(A2)| for one contactor, or `null` when it must NOT
 * pick up: a structured source conflict, a missing coil node, or either A1/A2 not
 * a RESOLVED phasor (UNREFERENCED / indeterminate). A1/A2 polarity is irrelevant —
 * the magnitude of the phasor DIFFERENCE is symmetric.
 */
export function contactorCoilVoltage(
  tp: ThreePhaseSolution,
  nodes: NodeMap,
  contactorId: ComponentId,
): number | null {
  if (tp.fault) return null
  const nA1 = nodes.nodeOf.get(terminalKey({ componentId: contactorId, index: CONTACTOR_TERMINAL.A1 }))
  const nA2 = nodes.nodeOf.get(terminalKey({ componentId: contactorId, index: CONTACTOR_TERMINAL.A2 }))
  if (nA1 === undefined || nA2 === undefined) return null
  const mA1 = tp.nodeVoltage[nA1]
  const mA2 = tp.nodeVoltage[nA2]
  if (!mA1 || !mA2 || mA1.status !== 'RESOLVED' || mA2.status !== 'RESOLVED') return null
  return magnitude(sub(mA1.phasor, mA2.phasor))
}

/** Next energized state for ONE contactor given its coil voltage + previous state.
 *  Boundaries are inclusive on BOTH ends (≥ pickup, ≤ dropout); the band between
 *  holds the previous state. `null` voltage ⇒ forced OFF. */
export function contactorNextState(
  voltage: number | null,
  params: ContactorCoilParams,
  previouslyOn: boolean,
): boolean {
  if (voltage === null) return false
  const pickupV = params.ratedCoilVolts * params.pickupFraction
  const dropoutV = params.ratedCoilVolts * params.dropoutFraction
  return previouslyOn ? !(voltage <= dropoutV) : voltage >= pickupV
}

/** Explicit iteration cap for the closure↔voltage fixpoint (deterministic stop). */
export const MAX_CONTACTOR_ITER = 24

export interface ThreePhaseWithContactors {
  relayEnergized: Record<string, boolean>
  solution: ThreePhaseSolution
  /** Resolved mechanical state per contactor id (NOT stored on the Board). */
  contactorEnergized: ContactorEnergized
  /** RMS coil voltage measured per contactor at the converged solve (diagnostic). */
  coilVoltage: Record<ComponentId, number>
  /** Did the fixpoint settle within the cap? False ⇒ last state returned as-is. */
  converged: boolean
}

function contactorIds(board: Board): ComponentId[] {
  return Object.values(board.components)
    .filter((c) => c.spec.kind === 'CONTACTOR')
    .map((c) => c.id)
}

function sameState(ids: ComponentId[], a: ContactorEnergized, b: ContactorEnergized): boolean {
  return ids.every((id) => (a[id] ?? false) === (b[id] ?? false))
}

/** Apply the board's physical contactor interlocks after electrical pickup is
 * evaluated. An already-closed contactor owns the mechanism; simultaneous pickup
 * from rest is rejected safely instead of inventing a winner. */
export function enforceMechanicalInterlocks(
  board: Board,
  previous: ContactorEnergized,
  requested: ContactorEnergized,
): ContactorEnergized {
  const next = { ...requested }
  for (const interlock of board.mechanicalInterlocks ?? []) {
    const { contactorA: a, contactorB: b } = interlock
    if (!next[a] || !next[b]) continue
    const aWasClosed = previous[a] ?? false
    const bWasClosed = previous[b] ?? false
    if (aWasClosed && !bWasClosed) next[b] = false
    else if (bWasClosed && !aWasClosed) next[a] = false
    else {
      next[a] = false
      next[b] = false
    }
  }
  return next
}

/**
 * Bounded, deterministic fixpoint: contact closure changes topology → topology
 * changes coil voltage → coil voltage changes closure. Seed from `previous` (so a
 * self-holding contactor stays latched), solve, measure each A1–A2, recompute with
 * hysteresis, repeat until stable or the cap is hit. NEVER classifies non-convergence
 * as a short and NEVER fabricates a stable state — it reports `converged: false`.
 */
export function solveThreePhaseWithContactors(
  board: Board,
  previous: ContactorEnergized = {},
  extra: RuntimeContacts = {},
  previousRelay: Record<string, boolean> = {},
): ThreePhaseWithContactors {
  const ids = contactorIds(board)
  let state: ContactorEnergized = {}
  for (const id of ids) state[id] = previous[id] ?? false

  const relays = Object.values(board.components).filter((c) => c.spec.kind === 'RELAY')
  let relayState = { ...previousRelay }
  let tp = solveThreePhase(board, state, extra, relayState)
  let converged = ids.length === 0 && relays.length === 0
  const coilVoltage: Record<ComponentId, number> = {}

  for (let iter = 0; iter < MAX_CONTACTOR_ITER; iter += 1) {
    const nodes = buildNodes(board, relayState, state, extra)
    const requested: ContactorEnergized = {}
    for (const id of ids) {
      const component = board.components[id]
      const spec = component.spec.kind === 'CONTACTOR' ? component.spec : {}
      const v = contactorCoilVoltage(tp, nodes, id)
      coilVoltage[id] = v ?? 0
      requested[id] = contactorNextState(v, contactorCoilParams(spec), state[id] ?? false)
    }
    const next = enforceMechanicalInterlocks(board, state, requested)
    const nextRelay: Record<string, boolean> = {}
    for (const relay of relays) {
      if (relay.spec.kind === 'RELAY') nextRelay[relay.id] = magnitude(tp.loadCurrent[relay.id] ?? complex(0, 0)) > relay.spec.pickupAmps
    }
    if (sameState(ids, next, state) && sameState(relays.map((c) => c.id), nextRelay, relayState)) {
      converged = true
      break
    }
    const after = solveThreePhase(board, next, extra, nextRelay)
    // A short that exists only while these contacts are closed (one behind a
    // contactor) stays in place so the tick's protection can clear it (L2). Releasing
    // them made the contacts chatter and the board read "unstable" instead of
    // "short". A short that survives the release (at the source) drops them as before.
    if (tp.fault && !after.fault) {
      converged = true
      break
    }
    state = next
    relayState = nextRelay
    tp = after
  }

  return { solution: tp, relayEnergized: relayState, contactorEnergized: state, coilVoltage, converged }
}
