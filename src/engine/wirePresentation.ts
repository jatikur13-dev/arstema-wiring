import type { CircuitState } from './engine'
import { runtimeContacts } from './engine'
import { deriveAutomaticProductActuation } from './solve'
import { traceCurrentPath, classifyThreePhaseWires, type WirePhase } from './flow'
import { buildNodes } from './topology'
import { boardDomain, terminalKey } from './types'
import { classifyWires, type WireClass } from './wiring'

export interface WirePresentation {
  connected: boolean
  energized: boolean
  flowing: boolean
  phase: WirePhase
  direction: -1 | 0 | 1
  signal: 'dc-direction' | 'ac-trace'
  conductor: WireClass
}

/** Shared electrical readout; projection and animation clocks never change topology. */
export function wirePresentation(state: CircuitState): Record<string, WirePresentation> {
  const { board } = state
  const extra = runtimeContacts(state)
  extra.productActuated = deriveAutomaticProductActuation(board, state.relayEnergized, state.contactorEnergized, extra)
  const ac = boardDomain(board) === 'ac-three-phase-balanced'
  const acSignal = ac || Object.values(board.components).some(c => c.spec.kind === 'SOURCE' && !['battery_dc', 'din_psu_24vdc'].includes(c.spec.sourceType ?? 'ac_1ph'))
  // Phase colours need a 3-phase source; an AC board fed only by 1-phase supplies (a
  // transformer on a 230 V source) reads like a 1-phase board (L1, L3).
  const phases = ac && state.threePhase?.source ? classifyThreePhaseWires(board, state.threePhase, state.contactorEnergized, extra, state.relayEnergized) : undefined
  const trace = traceCurrentPath(board, state.solution.energised && !state.solution.shorted, state.relayEnergized, state.contactorEnergized, extra)
  const nodes = buildNodes(board, state.relayEnergized, state.contactorEnergized, extra)
  const conductors = classifyWires(board, state.relayEnergized, state.contactorEnergized, extra)
  return Object.fromEntries(Object.values(board.wires).map(w => {
    const node = nodes.nodeOf.get(terminalKey(w.from))
    const phase = phases?.[w.id]
    const energized = phase ? !['inactive', 'N', 'fault'].includes(phase.phase) : node !== undefined && Math.abs(state.solution.nodeVoltage[node] ?? 0) > 1e-6
    return [w.id, { connected: nodes.nodeOf.has(terminalKey(w.from)) && nodes.nodeOf.has(terminalKey(w.to)), energized, flowing: phase?.flowing ?? trace[w.id]?.onPath ?? false, phase: phase?.phase ?? (energized ? 'energized' : conductors[w.id]==='NEUTRAL'?'N':'inactive'), direction: acSignal ? 0 : trace[w.id]?.direction ?? 0, signal: acSignal ? 'ac-trace' : 'dc-direction', conductor: conductors[w.id] }]
  }))
}
