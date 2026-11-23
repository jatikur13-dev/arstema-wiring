/**
 * Topology — turning the placement graph into electrical nodes.
 *
 * Wires are ideal, so the two terminals a wire joins are electrically the SAME
 * point. A closed switch is a piece of wire too: it joins its two terminals. An
 * open switch joins nothing. Union-find collapses every terminal into the set of
 * electrical nodes the solver then reasons about.
 */

import type { Board, PlacedComponent, Terminal } from './types'
import { terminalKey } from './types'
import { terminalCountForComponent } from './componentModels'
import {
  bridgedPairs,
  type ContactorEnergized,
  type RelayEnergized,
  type RuntimeContacts,
} from './conduction'

/** The resolved electrical nodes of a board. */
export interface NodeMap {
  /** terminalKey -> electrical node id (a representative terminalKey). */
  nodeOf: Map<string, string>
  /** electrical node id -> the terminalKeys that collapsed into it. */
  members: Map<string, string[]>
}

class UnionFind {
  private parent = new Map<string, string>()

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key)
  }

  find(key: string): string {
    this.add(key)
    let root = key
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root) as string
    }
    // Path compression keeps repeated lookups flat.
    let cursor = key
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor) as string
      this.parent.set(cursor, root)
      cursor = next
    }
    return root
  }

  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

function materializeNodes(board: Board, uf: UnionFind): NodeMap {
  const nodeOf = new Map<string, string>()
  const members = new Map<string, string[]>()
  for (const component of Object.values(board.components)) {
    for (const terminal of terminalsOf(component)) {
      const key = terminalKey(terminal)
      const root = uf.find(key)
      nodeOf.set(key, root)
      const list = members.get(root) ?? []
      list.push(key)
      members.set(root, list)
    }
  }
  return { nodeOf, members }
}

/**
 * Stable drawing topology: ideal WIRES only.
 *
 * Unlike `buildNodes`, this deliberately ignores switch/relay/contactor state.
 * A schematic must not re-route or re-number itself when a contact operates; the
 * dynamic electrical solve and the persisted physical drawing are two different
 * layers. Routing, junction placement and net labels consume this map.
 */
export function buildPhysicalNodes(board: Board): NodeMap {
  const uf = new UnionFind()

  for (const component of Object.values(board.components)) {
    for (const terminal of terminalsOf(component)) {
      uf.add(terminalKey(terminal))
    }
  }
  for (const wire of Object.values(board.wires)) {
    uf.union(terminalKey(wire.from), terminalKey(wire.to))
  }

  return materializeNodes(board, uf)
}

/** All terminal keys a component exposes. */
export function terminalsOf(component: PlacedComponent): Terminal[] {
  const out: Terminal[] = []
  for (let index = 0; index < terminalCountForComponent(component); index += 1) {
    out.push({ componentId: component.id, index })
  }
  return out
}

export function buildNodes(
  board: Board,
  relayEnergized: RelayEnergized = {},
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
): NodeMap {
  const uf = new UnionFind()

  // Seed every terminal so isolated pins still become their own node.
  for (const component of Object.values(board.components)) {
    for (const terminal of terminalsOf(component)) {
      uf.add(terminalKey(terminal))
    }
    // Conductive bridges (closed switch, pressed button, closed relay contact,
    // timed timer contact, overload aux) merge their pins into one electrical point.
    for (const [i, j] of bridgedPairs(component, relayEnergized, contactorEnergized, extra)) {
      uf.union(
        terminalKey({ componentId: component.id, index: i }),
        terminalKey({ componentId: component.id, index: j }),
      )
    }
  }

  // Wires merge whatever they touch.
  for (const wire of Object.values(board.wires)) {
    uf.union(terminalKey(wire.from), terminalKey(wire.to))
  }

  return materializeNodes(board, uf)
}
