/**
 * Conduction rules — the single place that says, per component, which terminal
 * pairs are shorted together (conductive BRIDGES) and which are resistors
 * (resistive BRANCHES). Topology, the solver, flow tracing and wire colouring
 * all read from here, so the electrical meaning of a kind lives in one spot.
 *
 * Relay contacts depend on `relayEnergized`, which the solve↔relay fixpoint
 * supplies. A capacitor is neither: it blocks DC (open) yet is not a resistor.
 */

import type { ComponentId, McbCurve, OverloadSpec, PlacedComponent } from './types'
import { MCB_CURVE_MULTIPLIER, TIMER_TERMINAL } from './types'
import { relayConductingPairs } from './relayModels'

export type RelayEnergized = Record<ComponentId, boolean>

/** External mechanical state of contactors (M3-B1 seam): id → energized. NOT
 *  serialized, NOT computed here (coil pickup is B2); supplied by the caller. */
export type ContactorEnergized = Record<ComponentId, boolean>

/** Time-stepped timer runtime (M3-C2): id → elapsed since energize + whether the
 *  coil is energized. Advances ONLY in `tick`; a plain solve reads it frozen. */
export type TimerRuntime = Record<ComponentId, { elapsedMs: number; running: boolean }>

/** Time-stepped overload runtime (M3-C2): id → thermal accumulation + trip latch.
 *  Advances ONLY in `tick`; a plain solve reads it frozen. */
export type OverloadRuntime = Record<ComponentId, { thermalLevel: number; tripped: boolean }>

/** Why an MCB tripped (M3-C3), or null when it has not. */
export type McbTripReason = 'THERMAL' | 'INSTANTANEOUS' | null

/** Time-stepped MCB protection runtime (M3-C3): id → measured pole currents + thermal
 *  + trip latch. Advances ONLY in `tick`; a plain solve reads `tripped` frozen. */
export type McbRuntime = Record<
  ComponentId,
  { thermalLevel: number; tripped: boolean; tripReason: McbTripReason; poleCurrents: number[] }
>

/** Additive contact-position inputs beyond relay/contactor (M3-C2/C3). Default empty ⇒
 *  every earlier caller keeps its exact behaviour; TIMER/OVERLOAD/MCB read from here. */
export interface RuntimeContacts {
  timer?: TimerRuntime
  overload?: OverloadRuntime
  mcb?: McbRuntime
  /** Automatically derived product state (currently RM17TG20 input health).
   * It is runtime-only: the product output follows the wired input phases rather
   * than a persisted/manual UI toggle. */
  productActuated?: Record<ComponentId, boolean>
  /** M3-C3.1 conflict-check ONLY: treat every 1e-4 Ω sense-branch (a CLOSED MCB pole,
   *  an overload power pole) as a BRIDGE (node-merge), so a short through one is caught
   *  before the matrix instead of solving to ~1 MA. NEVER set on the solve view (that
   *  would zero the pole current). */
  senseAsBridge?: boolean
}

/** Sense resistance (Ω) of a CLOSED MCB pole (M3-C3). Small enough to be electrically
 *  negligible, large enough to keep the matrix well-conditioned — it exists ONLY so
 *  the solver yields a real per-pole current for the protection model, NOT a physical
 *  contact resistance. */
export const MCB_SENSE_OHMS = 1e-4

/** Is an MCB effectively CLOSED right now (M3-C3)? Manual `on` AND not tripped. */
export function mcbClosed(spec: { on: boolean }, id: ComponentId, mcb?: McbRuntime): boolean {
  return spec.on && !(mcb?.[id]?.tripped ?? false)
}

/**
 * One deterministic protection step for an MCB (M3-C3, EDUCATIONAL — not IEC). From
 * the MEASURED per-pole currents (sense-branches): accumulate a thermal level ∝
 * (I/rated)²−1 over rated (cools under it); an **instantaneous** trip fires at once
 * when a pole reaches `curveMultiplier × rated` (only if a curve is set); otherwise a
 * **thermal** trip latches at the threshold. A 3-pole MCB evaluates the MAX pole →
 * ONE common trip (all poles open). Clamped finite. Trips latch (reset is separate).
 */
export function mcbProtectionStep(
  prev: { thermalLevel: number; tripped: boolean; tripReason: McbTripReason },
  rated: number,
  prot: { heatingRate: number; coolingRate: number; thermalTripThreshold: number; curve: McbCurve | null },
  poleCurrents: number[],
  dtMs: number,
): { thermalLevel: number; tripped: boolean; tripReason: McbTripReason; poleCurrents: number[] } {
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0
  const clean = poleCurrents.map((c) => (Number.isFinite(c) && c > 0 ? c : 0))
  const maxI = clean.length > 0 ? Math.max(...clean) : 0
  const r = rated > 0 ? rated : 1
  let level = Number.isFinite(prev.thermalLevel) ? prev.thermalLevel : 0
  if (maxI > r) {
    level += Math.max(0, prot.heatingRate) * ((maxI / r) ** 2 - 1) * dt
  } else {
    level -= Math.max(0, prot.coolingRate) * dt
  }
  level = Math.min(Math.max(level, 0), 100) // clamp: no runaway, no NaN/∞
  let tripped = prev.tripped
  let tripReason = prev.tripReason
  if (!tripped && prot.curve && maxI >= MCB_CURVE_MULTIPLIER[prot.curve] * r) {
    tripped = true
    tripReason = 'INSTANTANEOUS'
  }
  if (!tripped && level >= prot.thermalTripThreshold) {
    tripped = true
    tripReason = 'THERMAL'
  }
  return { thermalLevel: level, tripped, tripReason, poleCurrents: clean }
}

/** Educational timer coil resistance (Ω) so its A1–A2 node voltage is DEFINED. */
export const TIMER_COIL_OHMS = 2300

/** Tiny series resistance used only to expose each overload power-pole current. */
export const OVERLOAD_SENSE_OHMS = 0.0001

/** Which timed phase a running star–delta timer is in, from elapsed + spec. Pure. */
export function timerPhase(
  elapsedMs: number,
  spec: { starDurationMs: number; transitionDelayMs: number },
): 'STAR' | 'OPEN' | 'DELTA' {
  const starEnd = Math.max(0, spec.starDurationMs)
  const deltaStart = starEnd + Math.max(0, spec.transitionDelayMs)
  if (elapsedMs < starEnd) return 'STAR'
  if (elapsedMs < deltaStart) return 'OPEN' // neither STAR nor DELTA command NO is closed
  return 'DELTA'
}

/** Deterministic H3CR-A8 contact state for the supported teaching modes. The
 * duration field is the selected time range value; analog tolerance is outside
 * the simulator. */
export function multifunctionTimerOutputOn(
  elapsedMs: number,
  spec: { starDurationMs: number; mode?: 'A' | 'B' | 'B2' | 'E' | 'J' },
): boolean {
  const delay = Math.max(1, spec.starDurationMs)
  const mode = spec.mode ?? 'A'
  const cycle = Math.floor(Math.max(0, elapsedMs) / delay)
  if (mode === 'A') return elapsedMs >= delay
  if (mode === 'B') return cycle % 2 === 1
  if (mode === 'B2') return cycle % 2 === 0
  if (mode === 'E') return elapsedMs < delay
  return elapsedMs >= delay && elapsedMs < delay * 2
}

/** One deterministic thermal step for an overload relay (EDUCATIONAL first-order
 *  model, not IEC I²t). Heats ∝ (I/rated)²−1 over rated, cools linearly under it,
 *  trips (latching) at the normalised threshold. Clamped finite — never NaN/∞. */
export function overloadThermalStep(
  prev: { thermalLevel: number; tripped: boolean },
  spec: OverloadSpec,
  current: number,
  dtMs: number,
): { thermalLevel: number; tripped: boolean } {
  const rated = spec.ratedCurrentAmps > 0 ? spec.ratedCurrentAmps : 1
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0
  const i = Number.isFinite(current) && current > 0 ? current : 0
  let level = Number.isFinite(prev.thermalLevel) ? prev.thermalLevel : 0
  if (i > rated) {
    level += Math.max(0, spec.heatingRate) * ((i / rated) ** 2 - 1) * dt
  } else {
    level -= Math.max(0, spec.coolingRate) * dt
  }
  level = Math.min(Math.max(level, 0), 100) // clamp: no runaway, no NaN/∞
  const threshold = spec.tripMultiplier > 0 ? spec.tripMultiplier : 1
  return { thermalLevel: level, tripped: prev.tripped || level >= threshold }
}

/** Terminal-index pairs the component shorts together right now. Contactor closure
 *  is DERIVED from the external `contactorEnergized` seam (default de-energized). */
export function bridgedPairs(
  component: PlacedComponent,
  relayEnergized: RelayEnergized,
  contactorEnergized: ContactorEnergized = {},
  extra: RuntimeContacts = {},
): Array<[number, number]> {
  const spec = component.spec
  switch (spec.kind) {
    case 'SWITCH':
      return spec.closed ? [[0, 1]] : []
    case 'SWITCH_2WAY':
      // SPDT changeover: COM(0) bridges to L1(1) or L2(2) by position (never both).
      return spec.toL2 ? [[0, 2]] : [[0, 1]]
    case 'SWITCH_CROSS':
      // Intermediate switch: straight (0-2,1-3) or crossed (0-3,1-2).
      return spec.crossed ? [[0, 3], [1, 2]] : [[0, 2], [1, 3]]
    case 'CONTACT_2STATE':
      if (spec.drivenBy) {
        const on = spec.drivenBy.kind === 'relay' ? relayEnergized[spec.drivenBy.id] : contactorEnergized[spec.drivenBy.id]
        return on ? [[0, 2]] : [[0, 1]]
      }
      if (component.modelId === 'AUX_CONTACT_LADN22') {
        // Schneider LADN22: 53-54 / 83-84 are NO; 61-62 / 71-72 are NC.
        // `actuated` is the linked contactor's mechanical state.
        return spec.actuated
          ? [[0, 1], [6, 7]]
          : [[2, 3], [4, 5]]
      }
      if (component.modelId === 'PHASE_MONITOR_RM17TG20') {
        // Inputs L1/L2/L3 (0..2) are monitoring inputs, not conductive bridges.
        // The two CO outputs operate together: 11-12/14 and 21-22/24.
        return (extra.productActuated?.[component.id] ?? spec.actuated)
          ? [[3, 5], [6, 8]]
          : [[3, 4], [6, 7]]
      }
      if (component.modelId === 'FLOAT_SWITCH_9037HG33') {
        // Square D 9037HG33RZ20 is DPST, not changeover. The official product
        // sheet states both contacts open on liquid rise; `actuated` represents
        // that high-level state.
        return spec.actuated ? [] : [[0, 1], [2, 3]]
      }
      if (component.modelId === 'PRESSURE_SWITCH_XMLB004') {
        // XMLB004A2S11 terminal model: 13-14 NO and 11-12 NC, mechanically
        // linked by the pressure actuator.
        return spec.actuated ? [[0, 1]] : [[2, 3]]
      }
      if (component.modelId === 'THERMOSTAT_NSYCCOTHC') {
        // NSYCCOTHC is a single NC contact that opens on rising temperature.
        return spec.actuated ? [] : [[0, 1]]
      }
      // COM(0)-NC(1) when normal, COM(0)-NO(2) when actuated.
      return spec.actuated ? [[0, 2]] : [[0, 1]]
    case 'LIMIT_SWITCH':
      if (component.modelId === 'PUSHBUTTON_STATION_XB5AL73415') {
        // Two distinct spring-return heads: STOP operates only 21-22 NC and
        // START operates only 13-14 NO. Pressing one must never mechanically
        // change the other contact block.
        const pairs: Array<[number, number]> = []
        if (!spec.stopPressed) pairs.push([0, 1])
        if (spec.startPressed) pairs.push([2, 3])
        return pairs
      }
      if (component.modelId === 'ILLUMINATED_PB_XB5AW33B5') {
        // One spring-return operator mechanically links 21-22 NC and 13-14 NO.
        // The integral LED is a separate X1-X2 resistive branch below.
        return spec.actuated ? [[2, 3]] : [[0, 1]]
      }
      // D4N 1NC/1NO slow-action contact: 11-12 normal, 33-34 actuated.
      // Never bridge both pairs at once; direct-opening certification is outside
      // this educational electrical model.
      return spec.actuated ? [[2, 3]] : [[0, 1]]
    case 'SENSOR_3WIRE': {
      const conducts = spec.normallyOpen ? spec.actuated : !spec.actuated
      if (!conducts) return []
      // IEC DC 3-wire convention: PNP sources +V (brown pin 1) to OUT (black
      // pin 4); NPN sinks OUT to 0 V (blue pin 3).
      return spec.output === 'PNP' ? [[0, 2]] : [[1, 2]]
    }
    case 'TERMINAL_BLOCK': {
      const model = spec.model ?? 'FEED_THROUGH'
      if (model === 'PHOENIX_UT4_HESI' && (spec.open || spec.fuseBlown)) return []
      if (model === 'PHOENIX_UT4_MT' && spec.open) return []
      // TWIN/QUATTRO are one potential with three/four clamping points. The
      // PE/L/L multilevel block deliberately keeps its three levels isolated:
      // PE, L, L are separate potentials even though one housing contains them.
      if (model === 'PHOENIX_UT25_TWIN') return [[0, 1], [0, 2]]
      if (model === 'PHOENIX_UT25_QUATTRO') return [[0, 1], [0, 2], [0, 3]]
      if (model === 'PHOENIX_UT25_PE_L_L') return [[0, 1], [2, 3], [4, 5]]
      return [[0, 1]]
    }
    case 'SELECTOR_3POS':
      // COM(0)-LEFT(1) / OFF / COM(0)-RIGHT(2).
      return spec.pos === 0 ? [[0, 1]] : spec.pos === 2 ? [[0, 2]] : []
    case 'FUSE':
      return spec.blown ? [] : [[0, 1]]
    case 'ESTOP':
      return spec.pressed ? [] : [[0, 1]]
    case 'BREAKER_1P':
    case 'BREAKER_3P':
      // M3-C3: an MCB pole is NO LONGER an ideal bridge — a closed pole is a
      // micro-resistance SENSE-BRANCH (see resistiveBranches) so its current is
      // observable; conduction normally merges nothing here.
      // M3-C3.1: on the CONFLICT-CHECK view only, a CLOSED pole is treated as a bridge
      // so a pole shorting two source potentials is detected before the matrix.
      if (!extra.senseAsBridge || !mcbClosed(spec, component.id, extra.mcb)) return []
      return spec.kind === 'BREAKER_3P'
        ? [
            [0, 1],
            [2, 3],
            [4, 5],
          ]
        : [[0, 1]]
    case 'PUSHBUTTON': {
      const conducts = spec.normallyOpen ? spec.pressed : !spec.pressed
      return conducts ? [[0, 1]] : []
    }
    case 'RELAY': {
      const energized = relayEnergized[component.id] ?? false
      return relayConductingPairs(spec, energized)
    }
    case 'CONTACTOR': {
      const energized = contactorEnergized[component.id] ?? false
      // Main poles L1-T1/L2-T2/L3-T3 and aux NO 13-14 close together when
      // energized; aux NC 21-22 closes when de-energized. ONE state drives all.
      return energized
        ? [
            [2, 3],
            [4, 5],
            [6, 7],
            [8, 9],
          ]
        : [[10, 11]]
    }
    case 'TIMER': {
      // Omron H3DT-G changeover contacts. The two physical SPDT groups always rest
      // on an NC throw when their NO output is not selected. The OPEN phase means
      // neither STAR-command NO (15-18) nor DELTA-command NO (25-28) is closed; it
      // does not mean that all six physical contact screws float.
      const rt = extra.timer?.[component.id]
      const restingPairs: Array<[number, number]> = [
        [TIMER_TERMINAL.STAR_COMMON_15, TIMER_TERMINAL.STAR_NC_16],
        [TIMER_TERMINAL.DELTA_COMMON_25, TIMER_TERMINAL.DELTA_NC_26],
      ]
      if (!rt?.running) return restingPairs
      if (spec.model === 'OMRON_H3CR_A8' || spec.model === 'GENERIC_CONFIGURABLE') {
        const outputOn = multifunctionTimerOutputOn(rt.elapsedMs, spec)
        return outputOn
          ? [
              [TIMER_TERMINAL.CONTACT_1_COMMON, TIMER_TERMINAL.CONTACT_1_NO],
              [TIMER_TERMINAL.CONTACT_2_COMMON, TIMER_TERMINAL.CONTACT_2_NO],
            ]
          : [
              [TIMER_TERMINAL.CONTACT_1_COMMON, TIMER_TERMINAL.CONTACT_1_NC],
              [TIMER_TERMINAL.CONTACT_2_COMMON, TIMER_TERMINAL.CONTACT_2_NC],
            ]
      }
      const phase = timerPhase(rt.elapsedMs, spec)
      if (phase === 'STAR')
        return [
          [TIMER_TERMINAL.STAR_COMMON_15, TIMER_TERMINAL.STAR_NO_18],
          [TIMER_TERMINAL.DELTA_COMMON_25, TIMER_TERMINAL.DELTA_NC_26],
        ]
      if (phase === 'DELTA')
        return [
          [TIMER_TERMINAL.STAR_COMMON_15, TIMER_TERMINAL.STAR_NC_16],
          [TIMER_TERMINAL.DELTA_COMMON_25, TIMER_TERMINAL.DELTA_NO_28],
        ]
      return restingPairs
    }
    case 'OVERLOAD_RELAY': {
      // Power poles are small sense-branches (see resistiveBranches), not ideal
      // topology bridges. A trip opens 95–96 and closes 97–98.
      const tripped = extra.overload?.[component.id]?.tripped ?? false
      const aux: [number, number] = tripped ? [8, 9] : [6, 7]
      return extra.senseAsBridge ? [[0, 1], [2, 3], [4, 5], aux] : [aux]
    }
    default:
      return []
  }
}

/** Educational default coil resistance (Ω) for a contactor with no explicit value:
 *  ~0.1 A at 230 V, like a relay coil. */
export const DEFAULT_CONTACTOR_COIL_OHMS = 2300

/** The contactor's coil resistance, defaulting when absent/invalid (finite & > 0). */
export function contactorCoilOhms(spec: { coilResistanceOhms?: number }): number {
  const r = spec.coilResistanceOhms
  return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : DEFAULT_CONTACTOR_COIL_OHMS
}

/** The resistor a component presents, or null if it presents none. */
export function resistiveBranch(
  component: PlacedComponent,
  motorRunning: Record<ComponentId, boolean>,
  extra: RuntimeContacts = {},
): { a: number; b: number; resistance: number } | null {
  const spec = component.spec
  switch (spec.kind) {
    case 'LOAD':
    case 'INDICATOR':
      return { a: 0, b: 1, resistance: spec.resistanceOhms }
    case 'SENSOR_3WIRE':
      // Small supply current keeps both supply nodes defined. Output switching
      // remains an ideal topology bridge above; this is not a semiconductor model.
      return { a: 0, b: 1, resistance: spec.supplyResistanceOhms }
    case 'BREAKER_1P':
      // M3-C3: a closed pole is a micro-resistance sense-branch (current observable);
      // open (off or tripped) presents no branch.
      return mcbClosed(spec, component.id, extra.mcb)
        ? { a: 0, b: 1, resistance: MCB_SENSE_OHMS }
        : null
    case 'RELAY':
      return { a: 0, b: 1, resistance: spec.coilResistanceOhms }
    case 'CONTACTOR':
      // The coil A1(0)–A2(1) is a resistor so its node voltage is defined; pickup is
      // decided from that VOLTAGE (M3-B2), never from this current.
      return { a: 0, b: 1, resistance: contactorCoilOhms(spec) }
    case 'TIMER':
      // The timer coil A1(0)–A2(1) draws a small current so its node voltage is
      // DEFINED; "running" is decided from that voltage in `tick` (M3-C2).
      return { a: 0, b: 1, resistance: TIMER_COIL_OHMS }
    case 'MOTOR':
      return {
        a: 0,
        b: 1,
        resistance: motorRunning[component.id]
          ? spec.runResistanceOhms
          : spec.lockedResistanceOhms,
      }
    default:
      return null
  }
}

/**
 * ALL resistive branches a component presents (M3-B1 additive extension). Existing
 * kinds keep exactly one branch (identical to `resistiveBranch`); a 3-phase motor
 * presents THREE separate windings U(0-1), V(2-3), W(4-5) — balanced, real-only,
 * no cross-winding. Ordering is fixed (U, V, W).
 */
export function resistiveBranches(
  component: PlacedComponent,
  motorRunning: Record<ComponentId, boolean>,
  extra: RuntimeContacts = {},
): Array<{ a: number; b: number; resistance: number }> {
  if (component.spec.kind === 'LOAD' && component.spec.threePhase) {
    const { lineVolts, powerWatts } = component.spec.threePhase
    const resistance = 3 * lineVolts ** 2 / powerWatts
    return [{ a: 0, b: 1, resistance }, { a: 1, b: 2, resistance }, { a: 2, b: 0, resistance }]
  }
  if (
    component.modelId === 'ILLUMINATED_PB_XB5AW33B5' &&
    component.spec.kind === 'LIMIT_SWITCH'
  ) {
    const resistance = component.spec.lampResistanceOhms
    return typeof resistance === 'number' && Number.isFinite(resistance) && resistance > 0
      ? [{ a: 4, b: 5, resistance }]
      : []
  }
  if (component.spec.kind === 'MOTOR_3PH') {
    const resistance = component.spec.windingResistanceOhms
    return [
      { a: 0, b: 1, resistance },
      { a: 2, b: 3, resistance },
      { a: 4, b: 5, resistance },
    ]
  }
  if (component.spec.kind === 'OVERLOAD_RELAY') {
    return [
      { a: 0, b: 1, resistance: OVERLOAD_SENSE_OHMS },
      { a: 2, b: 3, resistance: OVERLOAD_SENSE_OHMS },
      { a: 4, b: 5, resistance: OVERLOAD_SENSE_OHMS },
    ]
  }
  if (component.spec.kind === 'BREAKER_3P') {
    // M3-C3: three sense-branches (R/S/T) when closed, keyed `${id}#0..2` downstream so
    // each pole current is measured separately; ONE common trip opens all three.
    if (!mcbClosed(component.spec, component.id, extra.mcb)) return []
    return [
      { a: 0, b: 1, resistance: MCB_SENSE_OHMS },
      { a: 2, b: 3, resistance: MCB_SENSE_OHMS },
      { a: 4, b: 5, resistance: MCB_SENSE_OHMS },
    ]
  }
  const single = resistiveBranch(component, motorRunning, extra)
  return single ? [single] : []
}
