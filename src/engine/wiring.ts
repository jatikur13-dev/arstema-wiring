/**
 * Wiring classification — the SNI-style side of each conductor, decided by
 * CONNECTIVITY from the source, never by voltage or by "which terminal was
 * touched".
 *
 * Two floods run from the source terminals, travelling ONLY through wires and
 * CLOSED switches and STOPPING at loads — a load is what separates the phase side
 * from the neutral side:
 *   - reachable from L  → LIVE     (red)
 *   - reachable from N  → NEUTRAL   (blue)
 *   - reachable from neither (past an open switch, or with no source) → AMBIGUOUS
 *
 * Because it is pure connectivity, `L → switch → lamp` is one unbroken LIVE run
 * (the flood halts at the lamp) and `lamp → N` is one unbroken NEUTRAL run; open
 * the switch and everything past it drops to AMBIGUOUS.
 */

import type { Board, WireId } from './types'
import { terminalKey, SOURCE_TERMINAL } from './types'
import { buildNodes } from './topology'
import { bridgedPairs, type RelayEnergized, type ContactorEnergized, type RuntimeContacts } from './conduction'

export type WireClass = 'LIVE' | 'NEUTRAL' | 'AMBIGUOUS'

/**
 * The electrical node id each wire sits on (both its ends share one node). Used
 * for the crossing test — are two crossing wires actually connected?
 */
export function wireNodeMap(
  board: Board,
  relayEnergized: RelayEnergized = {},
): Record<WireId, string> {
  const nodes = buildNodes(board, relayEnergized)
  const out: Record<WireId, string> = {}
  for (const wire of Object.values(board.wires)) {
    const node = nodes.nodeOf.get(terminalKey(wire.from))
    if (node !== undefined) out[wire.id] = node
  }
  return out
}

/**
 * Flood the conductive graph from one terminal, travelling through wires and
 * closed switches but NEVER through a load or an open switch. Returns the set of
 * terminal keys reached.
 */
function floodConductive(
  board: Board,
  startKey: string,
  relayEnergized: RelayEnergized,
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
): Set<string> {
  const adjacency = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    const list = adjacency.get(a) ?? []
    list.push(b)
    adjacency.set(a, list)
  }
  for (const wire of Object.values(board.wires)) {
    const from = terminalKey(wire.from)
    const to = terminalKey(wire.to)
    link(from, to)
    link(to, from)
  }
  for (const component of Object.values(board.components)) {
    // Conductive bridges carry the flood; loads/coils/caps/motors stop it.
    for (const [i, j] of bridgedPairs(component, relayEnergized, contactorEnergized, extra)) {
      const a = terminalKey({ componentId: component.id, index: i })
      const b = terminalKey({ componentId: component.id, index: j })
      link(a, b)
      link(b, a)
    }
  }

  const visited = new Set<string>([startKey])
  const queue = [startKey]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of adjacency.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next)
        queue.push(next)
      }
    }
  }
  return visited
}

export function classifyWires(
  board: Board,
  relayEnergized: RelayEnergized = {},
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
): Record<WireId, WireClass> {
  // Every two-terminal source floods its own L and N (L3), not only the first one.
  const sources = Object.values(board.components).filter(
    (component) => component.spec.kind === 'SOURCE' && !component.spec.transformer,
  )
  const out: Record<WireId, WireClass> = {}
  if (sources.length === 0) {
    for (const wire of Object.values(board.wires)) out[wire.id] = 'AMBIGUOUS'
    return out
  }

  const flood = (index: number) => {
    const reached = new Set<string>()
    for (const source of sources) {
      const start = terminalKey({ componentId: source.id, index })
      if (reached.has(start)) continue
      for (const key of floodConductive(board, start, relayEnergized, contactorEnergized, extra)) reached.add(key)
    }
    return reached
  }
  const live = flood(SOURCE_TERMINAL.L)
  const neutral = flood(SOURCE_TERMINAL.N)

  for (const wire of Object.values(board.wires)) {
    // Both ends share one node, so testing one end is enough.
    const key = terminalKey(wire.from)
    out[wire.id] = live.has(key)
      ? 'LIVE'
      : neutral.has(key)
        ? 'NEUTRAL'
        : 'AMBIGUOUS'
  }
  return out
}
