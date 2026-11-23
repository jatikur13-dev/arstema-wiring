import { bridgedPairs, resistiveBranches } from '../../engine/conduction'
import { runtimeContacts, type CircuitState } from '../../engine/engine'
import { deriveAutomaticProductActuation } from '../../engine/solve'
import { isMotor3phRunning } from '../../engine/flow'
import { resolvedTerminalDefinitions, terminalCountForComponent } from '../../engine/componentModels'
import type { PlacedComponent } from '../../engine/types'

export interface OperatingVisual { active: boolean; rotor: boolean; actuator: number; trip: boolean; text: string; measured: string; contacts: [number,number][]; branches: [number,number][] }

/** Same threshold the operating checks below use for "is anything flowing". */
const NO_FLOW = 1e-6

/** What the solve already measured for one component, with its unit.
 *  Returns '' when the engine holds no measurement for it — an absent reading is
 *  reported as absent, never as a measured zero. */
export function measuredReadout(state: CircuitState, c: PlacedComponent): string {
  if (c.spec.kind === 'CONTACTOR') {
    const volts = state.coilVoltage[c.id]            // `{}` on DC boards, so undefined is normal
    return volts === undefined ? '' : `${volts.toFixed(0)} V`
  }
  const amps = c.spec.kind === 'SOURCE' ? state.solution.sourceCurrent : state.solution.loadCurrent[c.id]
  if (amps === undefined || Math.abs(amps) < NO_FLOW) return ''
  return `${Math.abs(amps).toFixed(2)} A`
}
export function terminalLabels(c: PlacedComponent): string[] {
  const defs = resolvedTerminalDefinitions(c)
  return Array.from({ length: terminalCountForComponent(c) }, (_,i) => defs?.[i]?.designation ?? `#${i}`)
}
export function operatingVisuals(state: CircuitState): Record<string, OperatingVisual> {
  const extra = runtimeContacts(state)
  extra.productActuated = deriveAutomaticProductActuation(state.board, state.relayEnergized, state.contactorEnergized, extra)
  return Object.fromEntries(Object.values(state.board.components).map(c => {
    const spec = c.spec, kind = spec.kind
    const contacts = bridgedPairs(c, state.relayEnergized, state.contactorEnergized, extra)
    const trip = !!state.mcbRuntime[c.id]?.tripped || !!state.overloadRuntime[c.id]?.tripped || (kind === 'FUSE' && spec.blown)
    const rotor = kind === 'MOTOR' ? state.solution.motorStatus[c.id] === 'RUNNING' : kind === 'MOTOR_3PH' ? !!state.threePhase && isMotor3phRunning(state.threePhase,c.id) : kind === 'LOAD' && spec.symbol === 'fan' && Math.abs(state.solution.loadCurrent[c.id] ?? 0) > 1e-6
    const active = !trip && (kind === 'RELAY' ? !!state.relayEnergized[c.id] : kind === 'CONTACTOR' ? !!state.contactorEnergized[c.id] : kind === 'TIMER' ? !!state.timerRuntime[c.id]?.running : rotor || Math.abs(state.solution.loadCurrent[c.id] ?? 0) > 1e-6)
    let actuator = active ? 1 : 0
    if ('closed' in spec) actuator = spec.closed ? 1 : 0
    if ('on' in spec) actuator = spec.on && !trip ? 1 : 0
    if ('pressed' in spec) actuator = spec.pressed ? 1 : 0
    if ('actuated' in spec) actuator = (extra.productActuated?.[c.id] ?? spec.actuated) ? 1 : 0
    if ('toL2' in spec) actuator = spec.toL2 ? 1 : 0
    if ('crossed' in spec) actuator = spec.crossed ? 1 : 0
    if ('pos' in spec) actuator = spec.pos / 2
    if (kind === 'CONTACT_2STATE' && spec.drivenBy) actuator = contacts.some(([a,b]) => a===0 && b===2) ? 1 : 0
    const text = trip ? 'TRIP' : kind === 'MOTOR' ? state.solution.motorStatus[c.id] ?? 'IDLE' : kind === 'MOTOR_3PH' ? rotor ? 'BERPUTAR' : 'DIAM' : kind === 'TIMER' ? `${state.timerRuntime[c.id]?.elapsedMs ?? 0} ms · ${contacts.map(p=>p.join('–')).join(', ')}` : active ? 'AKTIF' : contacts.length ? 'Kontak terhubung' : 'Tidak aktif / terbuka'
    // Branch endpoints come from the same conduction contract, not decorative routing.
    const branches = resistiveBranches(c, state.solution.motorRunning, extra).map(b => [b.a,b.b] as [number,number])
    return [c.id,{ active, rotor, actuator, trip, text, measured: measuredReadout(state,c), contacts, branches }]
  }))
}

/** Logical breakout anchors. Explicitly NOT manufacturer terminal coordinates. */
export function terminalPoint(index: number, count: number): [number,number,number] {
  const row = Math.floor(index / 2), rows = Math.ceil(count / 2)
  return [index % 2 ? 1.65 : -1.65, rows === 1 ? 0 : 1.3 - 2.6 * row/(rows-1), .35]
}
