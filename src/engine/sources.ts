/**
 * Ideal sources as fixed potentials (audit 21 Nov 2026, L3: every source feeds its
 * own circuit, not only the first one on the board).
 *
 * Every SOURCE and SOURCE_3PH is an ideal voltage source: its terminals sit at fixed
 * potentials RELATIVE to its own reference terminal (N, or − on a DC supply).
 * Sources that share an electrical node form one group, propagated from the first
 * source's reference. Two different potentials forced onto one node is a short.
 *
 * Each galvanic island is fixed by its first group (one gauge per island, so an
 * isolated 24 V supply beside the mains is solved on its own). A further group that
 * only reaches that island through loads cannot be fixed independently; it becomes
 * modified-nodal-analysis rows V(pin) − V(reference) = EMF.
 *
 * Shared by the DC and phasor solvers. A 1-phase source has a zero imaginary part,
 * so the DC solver reads `.re` and a single-source board solves exactly as before.
 */

import type { Board, ComponentId } from './types'
import { SOURCE_TERMINAL, terminalKey } from './types'
import type { NodeMap } from './topology'
import { add, complex, magnitude, sub, type Complex } from './phasor'

export interface SourcePin {
  node: string
  /** Terminal name shown in a short-circuit diagnosis (R, S, T, N, L, +, −). */
  label: string
  /** Potential relative to the source's reference pin. */
  volts: Complex
}

/** One ideal source. `pins[0]` is its reference terminal (0 V relative). */
export interface IdealSource {
  id: ComponentId
  pins: SourcePin[]
}

export interface SourceConflict {
  sourceIds: ComponentId[]
  labels: string[]
}

export interface SourceGroup {
  sources: IdealSource[]
  reference: string
  /** Node → potential relative to `reference`. */
  potential: Map<string, Complex>
}

export interface SourceConstraint {
  id: string
  coefficients: Map<string, number>
  value: Complex
}

export interface AnchoredSources {
  fixed: Map<string, Complex>
  constraints: SourceConstraint[]
  /** Node → nominal voltage of the group that fixes its island (largest pin |V|). */
  nominalVolts: Map<string, number>
}

/** Two potentials within this magnitude are the same point, not a conflict. */
const SAME_POTENTIAL_TOL = 1e-6

/** Two-terminal sources (SOURCE without a tapped transformer) as ideal sources. A
 *  tapped transformer is not an EMF; the phasor solver models it as a constraint. */
export function plainSources(board: Board, nodes: NodeMap): IdealSource[] {
  const out: IdealSource[] = []
  for (const component of Object.values(board.components)) {
    const spec = component.spec
    if (spec.kind !== 'SOURCE' || spec.transformer) continue
    const nodeOf = (index: number) =>
      nodes.nodeOf.get(terminalKey({ componentId: component.id, index }))
    const live = nodeOf(SOURCE_TERMINAL.L)
    const neutral = nodeOf(SOURCE_TERMINAL.N)
    if (live === undefined || neutral === undefined) continue
    const dc = spec.sourceType === 'battery_dc' || spec.sourceType === 'din_psu_24vdc'
    out.push({
      id: component.id,
      pins: [
        { node: neutral, label: dc ? '−' : 'N', volts: complex(0, 0) },
        { node: live, label: dc ? '+' : 'L', volts: complex(spec.emfVolts, 0) },
      ],
    })
  }
  return out
}

function conflictAt(node: string, sources: IdealSource[]): SourceConflict {
  const pins = sources.flatMap((source) =>
    source.pins.filter((pin) => pin.node === node).map((pin) => ({ id: source.id, label: pin.label })),
  )
  return {
    sourceIds: [...new Set(pins.map((pin) => pin.id))],
    labels: [...new Set(pins.map((pin) => pin.label))],
  }
}

/** Group sources that share nodes and propagate each group's potentials. Groups keep
 *  the board order of their first source; the first conflict found is reported. */
export function groupSources(sources: IdealSource[]): {
  groups: SourceGroup[]
  conflict: SourceConflict | null
} {
  const parent = sources.map((_, index) => index)
  const find = (index: number): number =>
    parent[index] === index ? index : (parent[index] = find(parent[index]))
  const owner = new Map<string, number>()
  sources.forEach((source, index) => {
    for (const pin of source.pins) {
      const other = owner.get(pin.node)
      if (other === undefined) owner.set(pin.node, index)
      else parent[find(index)] = find(other)
    }
  })
  const members = new Map<number, IdealSource[]>()
  sources.forEach((source, index) => {
    const root = find(index)
    members.set(root, [...(members.get(root) ?? []), source])
  })

  let conflict: SourceConflict | null = null
  const groups: SourceGroup[] = []
  for (const list of members.values()) {
    const reference = list[0].pins[0].node
    const potential = new Map<string, Complex>([[reference, complex(0, 0)]])
    const placed = new Set<IdealSource>()
    let progress = true
    while (progress && placed.size < list.length) {
      progress = false
      for (const source of list) {
        if (placed.has(source)) continue
        const anchor = source.pins.find((pin) => potential.has(pin.node))
        if (!anchor) continue
        const offset = sub(potential.get(anchor.node) as Complex, anchor.volts)
        for (const pin of source.pins) {
          const volts = add(offset, pin.volts)
          const existing = potential.get(pin.node)
          if (existing === undefined) potential.set(pin.node, volts)
          else if (!conflict && magnitude(sub(existing, volts)) > SAME_POTENTIAL_TOL) {
            conflict = conflictAt(pin.node, list)
          }
        }
        placed.add(source)
        progress = true
      }
    }
    groups.push({ sources: list, reference, potential })
  }
  return { groups, conflict }
}

/** Fix the first group of every galvanic island; `links` are the node pairs that
 *  conduct (load branches, transformer windings). Later groups in an island already
 *  fixed become constraints. */
export function anchorSourceGroups(
  groups: SourceGroup[],
  links: ReadonlyArray<readonly [string, string]>,
): AnchoredSources {
  const parent = new Map<string, string>()
  const find = (node: string): string => {
    const up = parent.get(node)
    if (up === undefined || up === node) {
      parent.set(node, node)
      return node
    }
    const root = find(up)
    parent.set(node, root)
    return root
  }
  const union = (a: string, b: string) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  for (const [a, b] of links) union(a, b)
  for (const group of groups) for (const node of group.potential.keys()) union(group.reference, node)

  const fixed = new Map<string, Complex>()
  const constraints: SourceConstraint[] = []
  const islandVolts = new Map<string, number>()
  for (const group of groups) {
    const island = find(group.reference)
    const volts = Math.max(...[...group.potential.values()].map((value) => magnitude(value)))
    if (!islandVolts.has(island)) {
      islandVolts.set(island, volts)
      for (const [node, value] of group.potential) fixed.set(node, value)
      continue
    }
    for (const [node, value] of group.potential) {
      if (node === group.reference) continue
      constraints.push({
        id: `${group.sources[0].id}@${node}`,
        coefficients: new Map([[node, 1], [group.reference, -1]]),
        value,
      })
    }
  }
  const nominalVolts = new Map<string, number>()
  for (const node of parent.keys()) {
    const volts = islandVolts.get(find(node))
    if (volts !== undefined) nominalVolts.set(node, volts)
  }
  return { fixed, constraints, nominalVolts }
}
