/**
 * Flow tracing — which wires carry current, and in which direction.
 *
 * A wire is electrically zero-length (it merges its two terminals into one
 * node), so direction cannot come from the nodes. It comes from the LOOP: current
 * runs the way it conventionally travels, L → loads → N.
 *
 * A wire CARRIES current iff it lies on some conducting path from L to N — the
 * classic s–t edge test: L reaches one end (without this wire) and N reaches the
 * other. That lights EVERY loop wire, including parallel returns and taps/branches
 * (a plain reachability walk would build a spanning tree and silently leave the
 * off-tree wires dark). A dead stub fails the test — its far end can only reach N
 * back through the stub itself — so stubs stay dark, correctly.
 *
 * Direction: a wire on a unique cut (a series link) is oriented L-side → N-side.
 * A wire on a parallel branch has current on it either way, so it is oriented by
 * BFS distance from L (upstream end is nearer L). Pure topology — no solver, so it
 * lives in the engine and M1+ reuse it.
 */

import type { Board, WireId } from './types'
import { terminalKey, SOURCE_TERMINAL, SOURCE_3PH_TERMINAL } from './types'
import {
  bridgedPairs,
  resistiveBranches,
  type ContactorEnergized,
  type RelayEnergized,
  type RuntimeContacts,
} from './conduction'
import { buildNodes } from './topology'
import { magnitude, sub, type Complex } from './phasor'
import type { ThreePhaseSolution } from './threePhase'

export interface WireFlow {
  /** +1: current runs wire.from → wire.to. -1: the reverse. 0: no current. */
  direction: 1 | -1 | 0
  onPath: boolean
}

export type FlowTrace = Record<WireId, WireFlow>

interface Edge {
  to: string // terminalKey
  wireId?: WireId
}

/** Two-terminal sources (not a tapped transformer): each one feeds its own loop (L3). */
function plainSourceIds(board: Board): string[] {
  return Object.values(board.components)
    .filter((component) => component.spec.kind === 'SOURCE' && !component.spec.transformer)
    .map((component) => component.id)
}

/**
 * Trace the conducting path from each source's L terminal (every source on the
 * board, L3). `energised` gates whether any wire is reported as carrying current,
 * so a solved-but-open circuit shows still arrows rather than motion.
 */
export function traceCurrentPath(
  board: Board,
  energised: boolean,
  relayEnergized: RelayEnergized = {},
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
): FlowTrace {
  const trace: FlowTrace = {}
  for (const wire of Object.values(board.wires)) {
    trace[wire.id] = { direction: 0, onPath: false }
  }
  if (!energised) return trace
  const sourceIds = plainSourceIds(board)
  for (const id of sourceIds) {
    // The traced source's body is not traversable; every OTHER source is, so two
    // supplies in series still close one loop.
    const others = sourceIds.filter((other) => other !== id)
    for (const [wireId, flow] of Object.entries(traceOneSource(board, id, others, relayEnergized, contactorEnergized, extra))) {
      if (!trace[wireId].onPath) trace[wireId] = flow
    }
  }
  return trace
}

function traceOneSource(
  board: Board,
  sourceId: string,
  throughSources: string[],
  relayEnergized: RelayEnergized,
  contactorEnergized: ContactorEnergized,
  extra: RuntimeContacts,
): FlowTrace {
  const trace: FlowTrace = {}
  const source = board.components[sourceId]

  // Adjacency: wires (both directions, tagged with their id so one can be
  // excluded) + component through-edges (load and closed switch). The source body
  // is NOT traversable, so a walk goes out of L, around the loop, and arrives at N
  // from the outside.
  const adjacency = new Map<string, Edge[]>()
  const link = (a: string, b: string, wireId?: WireId) => {
    const list = adjacency.get(a) ?? []
    list.push({ to: b, wireId })
    adjacency.set(a, list)
  }

  for (const wire of Object.values(board.wires)) {
    const from = terminalKey(wire.from)
    const to = terminalKey(wire.to)
    link(from, to, wire.id)
    link(to, from, wire.id)
  }
  for (const component of Object.values(board.components)) {
    // Current flows through every conductive bridge (switch/button/contact) and
    // every resistive branch (load, motor main, indicator, relay coil). A
    // capacitor carries no DC and the motor's aux pin (index 2) none.
    const edges: Array<[number, number]> = [...bridgedPairs(component, relayEnergized, contactorEnergized, extra)]
    for (const branch of resistiveBranches(component, {}, extra)) edges.push([branch.a, branch.b])
    if (throughSources.includes(component.id)) edges.push([SOURCE_TERMINAL.L, SOURCE_TERMINAL.N])
    for (const [i, j] of edges) {
      const a = terminalKey({ componentId: component.id, index: i })
      const b = terminalKey({ componentId: component.id, index: j })
      link(a, b)
      link(b, a)
    }
  }

  // Reachable terminal keys from `start`, optionally skipping one wire's edges.
  const reach = (start: string, excludeWire?: WireId): Set<string> => {
    const seen = new Set<string>([start])
    const queue: string[] = [start]
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const edge of adjacency.get(current) ?? []) {
        if (edge.wireId !== undefined && edge.wireId === excludeWire) continue
        if (seen.has(edge.to)) continue
        seen.add(edge.to)
        queue.push(edge.to)
      }
    }
    return seen
  }

  // BFS distance from L (full graph) — only used to orient parallel branches,
  // where both ends carry current and the cut test alone cannot decide.
  const distFromL = new Map<string, number>()
  {
    const L = terminalKey({ componentId: source.id, index: SOURCE_TERMINAL.L })
    distFromL.set(L, 0)
    const queue: string[] = [L]
    while (queue.length > 0) {
      const current = queue.shift() as string
      const d = distFromL.get(current) as number
      for (const edge of adjacency.get(current) ?? []) {
        if (!distFromL.has(edge.to)) {
          distFromL.set(edge.to, d + 1)
          queue.push(edge.to)
        }
      }
    }
  }

  const L = terminalKey({ componentId: source.id, index: SOURCE_TERMINAL.L })
  const N = terminalKey({ componentId: source.id, index: SOURCE_TERMINAL.N })

  for (const wire of Object.values(board.wires)) {
    const u = terminalKey(wire.from)
    const v = terminalKey(wire.to)
    // With THIS wire removed: can L reach one end while N reaches the other?
    const fromL = reach(L, wire.id)
    const fromN = reach(N, wire.id)
    const uUpstream = fromL.has(u) && fromN.has(v) // current would run u → v
    const vUpstream = fromL.has(v) && fromN.has(u) // current would run v → u
    if (!uUpstream && !vUpstream) continue // dead stub / not on any L–N path

    let fromEndIsUpstream: boolean
    if (uUpstream && !vUpstream) {
      fromEndIsUpstream = true // u === wire.from is the L-side end
    } else if (vUpstream && !uUpstream) {
      fromEndIsUpstream = false
    } else {
      // Parallel branch: current flows either way through the cut, so orient by
      // distance from L — the end nearer L is upstream.
      const du = distFromL.get(u) ?? Infinity
      const dv = distFromL.get(v) ?? Infinity
      fromEndIsUpstream = du <= dv
    }
    trace[wire.id] = { direction: fromEndIsUpstream ? 1 : -1, onPath: true }
  }

  return trace
}

// --- Bug Hunt Pack 2A: three-phase energized/flow classification ------------

/** How a wire reads on a 3-phase board (Pack 2A). Phase comes from the node's
 *  ACTUAL identity/voltage, `flowing` from real line/neutral current — never from a
 *  component's on/off status. */
export type WirePhase = 'R' | 'S' | 'T' | 'N' | 'energized' | 'inactive' | 'fault'
export interface WirePhaseClass {
  phase: WirePhase
  flowing: boolean
}

/** A node within this fraction of a line-to-neutral phasor counts as that phase. */
const PHASE_V_TOL_FRAC = 0.1
/** Current below this (A) is treated as none (no animation). */
const FLOW_EPS_A = 1e-6

/**
 * Wires that belong to at least one complete conducting path between two
 * different 3-phase source terminals. This is deliberately topology-aware:
 * voltage on a node is not proof that every dangling branch on that node carries
 * current. Conversely, shared STAR trunks remain active because they connect
 * winding returns belonging to different source phases.
 */
export function traceThreePhaseCurrentPaths(
  board: Board,
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
  relayEnergized: RelayEnergized = {},
): Set<WireId> {
  const source = Object.values(board.components).find(
    (component) => component.spec.kind === 'SOURCE_3PH',
  )
  // Every 1-phase supply on the board is a source too (L3). A path counts when it joins
  // two different terminals of the SAME source, so a bond between two neutrals is not
  // a loop by itself.
  const sourceTerminals: Array<{ key: string; owner: string }> = [
    ...(source
      ? [SOURCE_3PH_TERMINAL.R, SOURCE_3PH_TERMINAL.S, SOURCE_3PH_TERMINAL.T, SOURCE_3PH_TERMINAL.N].map(
          (index) => ({ key: terminalKey({ componentId: source.id, index }), owner: source.id }),
        )
      : []),
    ...plainSourceIds(board).flatMap((id) => [
      { key: terminalKey({ componentId: id, index: SOURCE_TERMINAL.L }), owner: id },
      { key: terminalKey({ componentId: id, index: SOURCE_TERMINAL.N }), owner: id },
    ]),
  ]
  if (sourceTerminals.length === 0) return new Set()

  const adjacency = new Map<string, Edge[]>()
  const link = (a: string, b: string, wireId?: WireId) => {
    adjacency.set(a, [...(adjacency.get(a) ?? []), { to: b, wireId }])
  }
  for (const wire of Object.values(board.wires)) {
    const a = terminalKey(wire.from)
    const b = terminalKey(wire.to)
    link(a, b, wire.id)
    link(b, a, wire.id)
  }
  for (const component of Object.values(board.components)) {
    const pairs: Array<[number, number]> = [
      ...bridgedPairs(component, relayEnergized, contactorEnergized, extra),
      ...resistiveBranches(component, {}, extra).map(
        (branch): [number, number] => [branch.a, branch.b],
      ),
    ]
    for (const [aIndex, bIndex] of pairs) {
      const a = terminalKey({ componentId: component.id, index: aIndex })
      const b = terminalKey({ componentId: component.id, index: bIndex })
      link(a, b)
      link(b, a)
    }
  }

  const sourceIndex = new Map(sourceTerminals.map(({ key }, index) => [key, index]))

  const reachableSources = (start: string, excludeWire: WireId): Set<number> => {
    const found = new Set<number>()
    const seen = new Set<string>([start])
    const queue = [start]
    while (queue.length > 0) {
      const current = queue.shift() as string
      const identity = sourceIndex.get(current)
      if (identity !== undefined) found.add(identity)
      for (const edge of adjacency.get(current) ?? []) {
        if (edge.wireId === excludeWire || seen.has(edge.to)) continue
        seen.add(edge.to)
        queue.push(edge.to)
      }
    }
    return found
  }

  const active = new Set<WireId>()
  for (const wire of Object.values(board.wires)) {
    const fromSources = reachableSources(terminalKey(wire.from), wire.id)
    const toSources = reachableSources(terminalKey(wire.to), wire.id)
    const joinsDistinctSources = [...fromSources].some((from) =>
      [...toSources].some(
        (to) => to !== from && sourceTerminals[to].owner === sourceTerminals[from].owner,
      ),
    )
    if (joinsDistinctSources) active.add(wire.id)
  }
  return active
}

/**
 * Classify every wire on a 3-phase board (Pack 2A) by the phase identity of its
 * electrical node and whether real current flows on it. The node map is the SAME
 * one the solver used (sense-branch view), so a node's voltage phasor decides its
 * phase: galvanically tied to R/S/T/N, or sitting at a single line potential. A
 * RESOLVED node that is NOT a single phase (a floating star point, a delta mesh) is
 * `energized` — never a fake single phase. UNREFERENCED ⇒ `inactive`. A structured
 * source conflict ⇒ `fault` on the source-adjacent wires. Animation gates on the
 * measured line/neutral current, so an energized-but-currentless wire is coloured
 * yet still. Pure read of the solution — no solver, no component status.
 */
export function classifyThreePhaseWires(
  board: Board,
  tp: ThreePhaseSolution,
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
  relayEnergized: RelayEnergized = {},
): Record<WireId, WirePhaseClass> {
  const out: Record<WireId, WirePhaseClass> = {}
  for (const wire of Object.values(board.wires)) out[wire.id] = { phase: 'inactive', flowing: false }

  const source = Object.values(board.components).find((c) => c.spec.kind === 'SOURCE_3PH')
  if (!source || !tp.source) return out

  const nodes = buildNodes(board, relayEnergized, contactorEnergized, extra)
  const nodeAt = (index: number) =>
    nodes.nodeOf.get(terminalKey({ componentId: source.id, index }))
  const nodeR = nodeAt(SOURCE_3PH_TERMINAL.R)
  const nodeS = nodeAt(SOURCE_3PH_TERMINAL.S)
  const nodeT = nodeAt(SOURCE_3PH_TERMINAL.T)
  const nodeN = nodeAt(SOURCE_3PH_TERMINAL.N)
  // A 1-phase supply on the same board (L3): its N reads as a neutral, its L as an
  // energized conductor. A short marks only the terminals of the sources it involves.
  const plainIds = plainSourceIds(board)
  const plainNode = (ids: string[], index: number) =>
    ids.map((id) => nodes.nodeOf.get(terminalKey({ componentId: id, index })))
  const plainNeutral = new Set(plainNode(plainIds, SOURCE_TERMINAL.N))
  const faultIds = tp.fault?.sourceIds ?? [source.id]
  const faultPlain = plainIds.filter((id) => faultIds.includes(id))
  const faultTerminals = new Set([
    ...(faultIds.includes(source.id) ? [nodeR, nodeS, nodeT, nodeN] : []),
    ...plainNode(faultPlain, SOURCE_TERMINAL.N),
    ...plainNode(faultPlain, SOURCE_TERMINAL.L),
  ])

  const src = tp.source
  const vTol = magnitude(src.VRN) * PHASE_V_TOL_FRAC
  const phaseOfPhasor = (p: Complex): 'R' | 'S' | 'T' | null => {
    const dR = magnitude(sub(p, src.VRN))
    const dS = magnitude(sub(p, src.VSN))
    const dT = magnitude(sub(p, src.VTN))
    const min = Math.min(dR, dS, dT)
    if (min > vTol) return null
    return dR === min ? 'R' : dS === min ? 'S' : 'T'
  }
  const lineOf = (phase: 'R' | 'S' | 'T') =>
    phase === 'R' ? tp.lineCurrent.R : phase === 'S' ? tp.lineCurrent.S : tp.lineCurrent.T
  const anyLine = Math.max(tp.lineCurrent.R, tp.lineCurrent.S, tp.lineCurrent.T)
  // Winding (branch) current — the SAME "does real current flow" test, extended to the
  // segments a line-current view misses: the star tie and the neutral/return of a
  // balanced star-N motor carry winding current even though the NET neutral current is
  // ~0. So those conductive segments animate too, uniformly with the phase lines.
  const anyWinding = Math.max(0, ...Object.values(tp.branchCurrentPhasor).map((c) => magnitude(c)))
  const currentPathWires = traceThreePhaseCurrentPaths(board, contactorEnergized, extra, relayEnergized)

  for (const wire of Object.values(board.wires)) {
    const node = nodes.nodeOf.get(terminalKey(wire.from))
    if (node === undefined) continue

    if (tp.fault) {
      out[wire.id] = { phase: faultTerminals.has(node) ? 'fault' : 'inactive', flowing: false }
      continue
    }
    if (node === nodeN || plainNeutral.has(node)) {
      out[wire.id] = {
        phase: 'N',
        flowing:
          currentPathWires.has(wire.id) &&
          (magnitude(tp.neutralCurrent) > FLOW_EPS_A || anyWinding > FLOW_EPS_A),
      }
      continue
    }
    const m = tp.nodeVoltage[node]
    if (!m || m.status !== 'RESOLVED') {
      out[wire.id] = { phase: 'inactive', flowing: false }
      continue
    }
    let phase: WirePhase
    if (node === nodeR) phase = 'R'
    else if (node === nodeS) phase = 'S'
    else if (node === nodeT) phase = 'T'
    else phase = phaseOfPhasor(m.phasor) ?? 'energized'

    const hasMeasuredCurrent =
      phase === 'R' || phase === 'S' || phase === 'T'
        ? lineOf(phase) > FLOW_EPS_A // per-phase fidelity: a dead phase line stays still
        : anyLine > FLOW_EPS_A || anyWinding > FLOW_EPS_A // star point / mesh: flows when the motor draws
    const flowing = currentPathWires.has(wire.id) && hasMeasuredCurrent
    out[wire.id] = { phase, flowing }
  }
  return out
}

/** Winding-current threshold (A) for "the 3-phase motor is turning". */
const MOTOR3PH_RUN_EPS_A = 1e-3
/** A running motor's three windings are roughly balanced; the weakest must be at least
 *  this fraction of the strongest (a lost/open phase drops well below and reads idle). */
const MOTOR3PH_BALANCE_FRAC = 0.5

/**
 * Is a 3-phase motor actually turning? DERIVED purely from the solved winding currents
 * (`branchCurrentPhasor[`${motorId}#0..2`]`): all three finite (> epsilon) AND roughly
 * balanced. A de-energized motor draws ~0 (idle); single-phasing is unbalanced (idle,
 * not "running"). A read of the solution only — no solver, no mutation. This is the
 * 3-phase analogue of `computeMotorRunning` for the visual running indicator.
 */
export function isMotor3phRunning(tp: ThreePhaseSolution, motorId: string): boolean {
  const mags = [0, 1, 2].map((k) => {
    const c = tp.branchCurrentPhasor[`${motorId}#${k}`]
    return c ? magnitude(c) : 0
  })
  const max = Math.max(...mags)
  if (max < MOTOR3PH_RUN_EPS_A) return false
  return Math.min(...mags) >= max * MOTOR3PH_BALANCE_FRAC
}
