/**
 * Circuit engine — data model (M0 core engine).
 *
 * This is the shared foundation every simulation phase (M0–M5) builds on: one
 * engine, more component kinds added on top later. It is deliberately small and
 * framework-free — no React, no browser API, no wall clock — so it can be tested
 * as plain functions and driven by any surface.
 *
 * M0 component set ONLY: SOURCE (1-phase L/N), LOAD (a resistor, e.g. a lamp),
 * SWITCH. Wires are ideal (0 Ω) connections, modelled as `Wire` rather than as a
 * placed component. Nothing here knows about series/parallel, motors, relays, or
 * 3-phase — those arrive in M1+.
 */

export type ComponentId = string
import type { Board3DView, PanelPlacement3D } from './board3d'
export type WireId = string

/**
 * The electrical graph is shared, but each drawing owns its own placement.
 * Keeping this neutral type in the engine prevents either UI projection from
 * becoming the source of truth for the other one.
 */
export type BoardProjection = 'virtual' | 'iec'

/**
 * The component kinds the board understands.
 * M0: SOURCE, LOAD, SWITCH. M1 adds MOTOR + CAPACITOR.
 */
export type ComponentKind =
  | 'SOURCE'
  | 'GROUND'
  | 'LOAD'
  | 'SWITCH'
  | 'MOTOR'
  | 'CAPACITOR'
  | 'PUSHBUTTON'
  | 'RELAY'
  | 'INDICATOR'
  | 'SOURCE_3PH'
  | 'MOTOR_3PH'
  | 'CONTACTOR'
  | 'BREAKER_1P'
  | 'BREAKER_3P'
  | 'TIMER'
  | 'OVERLOAD_RELAY'
  | 'SWITCH_2WAY'
  | 'SWITCH_CROSS'
  | 'CONTACT_2STATE'
  | 'LIMIT_SWITCH'
  | 'SENSOR_3WIRE'
  | 'TERMINAL_BLOCK'
  | 'SELECTOR_3POS'
  | 'FUSE'
  | 'ESTOP'

/**
 * Which solver a board is analysed by. Absent means `dc-resistive` — so every
 * existing M0–M2 board keeps its exact behaviour with no field added. M3 boards
 * opt in to the phasor solver by setting `ac-three-phase-balanced`.
 */
export type CircuitDomain = 'dc-resistive' | 'ac-three-phase-balanced'

/** A snap-grid cell. The board is a grid; components occupy one cell. */
export interface Cell {
  x: number
  y: number
}

/** One electrical pin of a component. `index` is stable per kind. */
export interface Terminal {
  componentId: ComponentId
  index: number
}

/** A 1-phase source. Terminal 0 = L (live), terminal 1 = N (neutral, 0 V). */
export interface SourceSpec {
  kind: 'SOURCE'
  /** EMF in volts between L (terminal 0) and N (terminal 1). */
  emfVolts: number
  /** Current at which the source's protection trips → fault (amperes). */
  tripAmps: number
  /** Ideal isolated transformer: P1/P2=0/1, secondary 0/110/220=2/3/4.
   * emfVolts is retained for legacy serialization; the AC solve uses the ratio. */
  transformer?: { primaryVolts: number; tapVolts: [number, number] }
  /** Physical source presentation. The electrical model remains one ideal
   *  two-terminal source; battery_dc changes polarity labels and rendering. */
  sourceType?: 'ac_1ph' | 'battery_dc' | 'din_psu_24vdc' | 'control_transformer_24vac'
}

/** A resistive load (a lamp, in Topic 1a). Terminals 0 and 1. */
export interface LoadSpec {
  kind: 'LOAD'
  resistanceOhms: number
  /** Above this current the load itself is destroyed (amperes). */
  ratedCurrentAmps: number
  /** Balanced delta equivalent; U/V/W/PE=0/1/2/3. Not a factory winding claim. */
  threePhase?: { powerWatts: number; lineVolts: number }
  /** Wiring-symbol variant. Same resistive behaviour; only the glyph differs. Default 'lamp'. */
  symbol?: 'lamp' | 'resistor' | 'heater' | 'bell' | 'solenoid_valve' | 'fan'
}

/** A simple on/off switch in series. Terminals 0 and 1. */
export interface SwitchSpec {
  kind: 'SWITCH'
  closed: boolean
}

/** Two-way (SPDT changeover) switch — saklar tukar/hotel. COM(0) connects to L1(1)
 *  when `toL2` is false, to L2(2) when true. Two of these control one lamp from two
 *  points; combined with SWITCH_CROSS, from any number of points. */
export interface SwitchTwoWaySpec {
  kind: 'SWITCH_2WAY'
  toL2: boolean
}

/** Cross / intermediate switch (saklar silang) — 4 terminals. Placed BETWEEN two
 *  SWITCH_2WAY units to control one lamp from 3+ points. Straight: 0-2,1-3; crossed: 0-3,1-2. */
export interface SwitchCrossSpec {
  kind: 'SWITCH_CROSS'
  crossed: boolean
}

/** Generic 2-state COM/NO/NC contact (0=COM,1=NC,2=NO). Backs limit, float, pressure,
 *  flow, thermostat, photocell, PIR, door interlock, process permissives — one electrical
 *  behaviour, many user-facing presets. Normal: COM-NC; actuated: COM-NO. */
export interface Contact2StateSpec {
  kind: 'CONTACT_2STATE'
  actuated: boolean
  /** Remote drawing of a contact belonging to an actual coil on this board. */
  drivenBy?: { id: string; kind: 'relay' | 'contactor' }
}

/** Omron D4N-style slow-action safety limit switch, 1NC/1NO.
 *  Terminal 0=11, 1=12 (NC with direct-opening mechanism), 2=33, 3=34 (NO).
 *  Normal: 11-12; actuated: 33-34. Certification/mechanical fault coverage is
 *  intentionally NOT simulated, so this educational model cannot validate a
 *  real machine safety function. */
export interface LimitSwitchSpec {
  kind: 'LIMIT_SWITCH'
  actuated: boolean
  /** XB5AL73415 has two mechanically independent spring-return operators. These
   * optional fields keep legacy D4N/illuminated-button boards compatible while
   * allowing START (13-14 NO) and STOP (21-22 NC) to be held independently. */
  startPressed?: boolean
  stopPressed?: boolean
  /** Optional integral pilot-light branch (for example XB5AW33B5 X1-X2).
   * This is an explicit educational electrical load, never a hidden animation. */
  lampResistanceOhms?: number
}

/** Industrial DC 3-wire sensor. Manufacturer pin convention used by the E2E,
 *  E2K and E3Z families: terminal 0=pin 1 brown (+V), terminal 1=pin 3 blue
 *  (0 V), terminal 2=pin 4 black (OUT). A PNP output connects +V to OUT while
 *  conducting; NPN connects 0 V to OUT. */
export interface Sensor3WireSpec {
  kind: 'SENSOR_3WIRE'
  technology: 'inductive' | 'capacitive' | 'photoelectric'
  output: 'PNP' | 'NPN'
  normallyOpen: boolean
  /** Optical operating sense. Electrical switching still follows
   * `normallyOpen` + `actuated`; this records the real selector position so the
   * UI never calls a Dark-ON device Light-ON (or vice versa). */
  operationMode?: 'LIGHT_ON' | 'DARK_ON'
  actuated: boolean
  /** Educational internal supply draw between pins 1 and 3. */
  supplyResistanceOhms: number
}

/** One-position feed-through terminal block: two clamping points share one
 *  potential through the internal current bar. */
export interface TerminalBlockSpec {
  kind: 'TERMINAL_BLOCK'
  /** Exact terminal family. Missing preserves every saved two-clamp board. */
  model?: TerminalBlockModel
  /** User-operable disconnect state for knife/fuse terminal variants. */
  open?: boolean
  /** Separate fuse condition: an open knife and a blown cartridge are not the
   * same field diagnosis even though both interrupt continuity. */
  fuseBlown?: boolean
}

export type TerminalBlockModel =
  | 'FEED_THROUGH'
  | 'PHOENIX_UT25_BU'
  | 'PHOENIX_UT25_PE'
  | 'PHOENIX_UT4_HESI'
  | 'PHOENIX_UT4_MT'
  | 'PHOENIX_UT25_TWIN'
  | 'PHOENIX_UT25_QUATTRO'
  | 'PHOENIX_UT25_PE_L_L'

/** 3-position selector (0=COM,1=LEFT,2=RIGHT) with a break centre (MAN-OFF-AUTO etc.).
 *  pos 0 ⇒ COM-LEFT, pos 1 ⇒ OFF (no contact), pos 2 ⇒ COM-RIGHT. */
export interface Selector3PosSpec {
  kind: 'SELECTOR_3POS'
  pos: 0 | 1 | 2
}

/** Fuse — 2 terminals, NORMAL conducts, BLOWN opens. No I2t / breaking-capacity model. */
export interface FuseSpec {
  kind: 'FUSE'
  blown: boolean
}

/** Emergency stop — maintained NC (0-1). Normal closed; pressed latches OPEN until a
 *  separate reset (toggle again); does NOT auto-close on simulator STOP. */
export interface EstopSpec {
  kind: 'ESTOP'
  pressed: boolean
}

/**
 * A three-lead permanent-split-capacitor (PSC) teaching motor. Terminals:
 * 0=R (run), 1=C (common), 2=S (start). The main R–C winding is the real
 * resistor in the solve; the S–C auxiliary winding and capacitor phase angle are
 * represented by the documented topological teaching approximation below.
 *
 * A DC resistive solve cannot represent the capacitor's phase shift, so whether
 * the motor RUNS is decided topologically (a capacitor bridging aux ↔ a main
 * node) rather than electrically. That run-state switches the winding resistance:
 * locked-rotor (lower R → higher current, "humming") when it cannot start,
 * running (higher R → rated current) when the capacitor is in place.
 */
export interface MotorSpec {
  kind: 'MOTOR'
  runResistanceOhms: number
  lockedResistanceOhms: number
  ratedCurrentAmps: number
}

/** A capacitor (M1). Blocks DC (no branch in the solve); its PRESENCE across the
 *  start winding is what lets the motor develop starting torque. Terminals 0, 1. */
export interface CapacitorSpec {
  kind: 'CAPACITOR'
}

/** A momentary push button (M2). Conducts while `pressed` if normallyOpen
 *  (START); conducts while NOT pressed if normally closed (STOP). Terminals 0,1. */
export interface PushbuttonSpec {
  kind: 'PUSHBUTTON'
  pressed: boolean
  normallyOpen: boolean
}

/**
 * A relay (M2): a coil (terminals 0,1) plus one NO contact (2,3) and one NC
 * contact (4,5). `energized` is NOT stored here — it is derived from coil
 * current by the solve↔relay fixpoint (a latch needs the previous state).
 */
export interface RelaySpec {
  kind: 'RELAY'
  /**
   * Exact package/terminal family. Omitted preserves boards created before the
   * model-specific relay palette existed.
   *
   * Pin count and pin DESIGNATION are deliberately separate: G5V-2 has eight
   * physical pins whose manufacturer numbers include 16.
   */
  model?: RelayModel
  coilResistanceOhms: number
  /** Coil current above which the relay picks up (amperes). */
  pickupAmps: number
}

export type RelayModel =
  | 'LEGACY_1NO_1NC'
  | 'OMRON_MY2_8PIN'
  | 'OMRON_MY3_11PIN'
  | 'OMRON_MY4_14PIN'
  | 'OMRON_G5V2_8PIN'

/** A small indicator lamp (M2). A resistor that lights when current flows. */
export interface IndicatorSpec {
  kind: 'INDICATOR'
  resistanceOhms: number
  ratedCurrentAmps: number
}

/**
 * A balanced 3-phase source (M3). Terminals: 0 = R, 1 = S, 2 = T, 3 = N. ONE base
 * constant is stored — the line-to-line RMS voltage. The line-to-neutral voltage
 * (V_LL/√3) and every phase angle are DERIVED by the phasor solver, never stored,
 * so line-to-line voltage is always the √3 phasor difference, never a table.
 */
export interface ThreePhaseSourceSpec {
  kind: 'SOURCE_3PH'
  /** Nominal line-to-line RMS voltage (e.g. 400 V). The only stored magnitude. */
  vLineToLineVolts: number
  /** Current at which the source's protection trips → fault (amperes). */
  tripAmps: number
}

/**
 * A 3-phase induction motor (M3-B1) — EDUCATIONAL balanced resistive model.
 * Terminals: 0=U1, 1=U2, 2=V1, 3=V2, 4=W1, 5=W2, 6=PE (frame bond).
 * Each winding (U=U1-U2,
 * V=V1-V2, W=W1-W2) is ONE real resistor; the three are separate branches with NO
 * internal cross-winding and NO star/delta tie (those come from external wiring).
 * One resistance is stored (balanced) — complex impedance (R+jX) is deferred.
 */
export interface ThreePhaseMotorSpec {
  kind: 'MOTOR_3PH'
  /** Per-winding resistance (Ω), same for U/V/W in the balanced model. */
  windingResistanceOhms: number
  /** Rated line current for the connection named by `ratedConnection`. */
  ratedCurrentAmps: number
  /** Explicit nameplate context. Never infer a phase or connection from U2/V2/W2. */
  ratedConnection?: 'STAR' | 'DELTA'
  ratedLineVoltageVolts?: number
  nameplateDeltaVolts?: number
  nameplateStarVolts?: number
}

/**
 * A contactor (M3-B1) — CONTRACT + mechanical-state seam only. Terminals:
 * 0=A1, 1=A2 (coil), 2=L1,3=T1, 4=L2,5=T2, 6=L3,7=T3 (three main poles),
 * 8=13,9=14 (aux NO), 10=21,11=22 (aux NC). Whether it is energized is NOT stored
 * here and NOT computed in B1 — it is supplied externally (`contactorEnergized`),
 * default de-energized. Coil pickup from A1-A2 voltage is B2.
 */
export interface ContactorSpec {
  kind: 'CONTACTOR'
  /** Coil resistance (Ω) so A1–A2 draws a small current and the coil node voltage is
   *  DEFINED in the solve. Optional/additive — a bare `{kind:'CONTACTOR'}` still uses
   *  the educational default. */
  coilResistanceOhms?: number
  /** Rated coil RMS voltage (V). Pickup/dropout are fractions of THIS (M3-B2). */
  ratedCoilVolts?: number
  /** Pick up when Vcoil_rms ≥ ratedCoilVolts × pickupFraction (0<dropout<pickup≤1). */
  pickupFraction?: number
  /** Drop out when Vcoil_rms ≤ ratedCoilVolts × dropoutFraction. */
  dropoutFraction?: number
}

/**
 * MCB rated current (A) — closed set of common nominal values used by the
 * educational thermal model. It is not a device-selection or coordination tool.
 */
export type McbRatedCurrent = 6 | 10 | 16 | 20 | 25 | 32 | 40 | 50 | 63

/** Default rated current per MCB kind when the spec omits `ratedAmps`. */
export const MCB_DEFAULT_RATED_AMPS = { BREAKER_1P: 10, BREAKER_3P: 16 } as const

/** The MCB's rated current, defaulting by kind when absent (additive/optional). */
export function mcbRatedAmps(spec: BreakerOnePoleSpec | BreakerThreePoleSpec): McbRatedCurrent {
  return spec.ratedAmps ?? MCB_DEFAULT_RATED_AMPS[spec.kind]
}

/**
 * A single-pole MCB (M3-B1.5) — user-facing MCB; internal kind stays `BREAKER_1P`.
 * Terminals: 0=L_IN, 1=L_OUT (one pole in the live conductor). `on` is a persisted
 * MANUAL handle state: on requests closure; off opens. A latched educational trip
 * overrides `on`. Closure is DERIVED from handle + runtime state in conduction.
 * `ratedAmps` is a nominal label value (optional; defaults to 10 A).
 */
/** MCB trip curve (M3-C3) — EDUCATIONAL instantaneous multiplier, NOT an IEC curve.
 *  Present ONLY because it moves the instantaneous threshold (never decorative). */
export type McbCurve = 'B' | 'C' | 'D'

/** Optional protection parameters shared by both breaker types. Missing values use
 * educational defaults. This is a qualitative thermal/instantaneous demonstration,
 * not an IEC trip curve, discrimination study, or product-selection calculation. */
export interface McbProtectionSpec {
  /** A switch-disconnector has no over-current release. It reuses the same
   * three linked pole geometry, while the runtime must never invent a trip. */
  protectionDisabled?: boolean
  /** Thermal gain per ms while over rated (× the normalised over-current term). */
  heatingRate?: number
  /** Thermal decay per ms while at/under rated (cooling). */
  coolingRate?: number
  /** Normalised `thermalLevel` at which a THERMAL trip latches. */
  thermalTripThreshold?: number
  /** A trip can only be reset once `thermalLevel` has cooled to ≤ this. */
  resetThreshold?: number
  /** If set, an INSTANTANEOUS trip fires at `I ≥ curveMultiplier(curve) × ratedAmps`. */
  curve?: McbCurve
}

export interface BreakerOnePoleSpec extends McbProtectionSpec {
  kind: 'BREAKER_1P'
  on: boolean
  ratedAmps?: McbRatedCurrent
}

/**
 * A three-pole MCB (M3-B1.5) — user-facing MCB; internal kind stays `BREAKER_3P`.
 * Terminals: 0=R_IN,1=R_OUT, 2=S_IN,3=S_OUT, 4=T_IN,5=T_OUT (three poles switched by
 * ONE manual `on` state). on requests all three poles closed; off opens all poles.
 * A latched educational trip opens all poles. `ratedAmps` defaults to 16 A.
 */
export interface BreakerThreePoleSpec extends McbProtectionSpec {
  kind: 'BREAKER_3P'
  on: boolean
  ratedAmps?: McbRatedCurrent
}

/** EDUCATIONAL MCB protection defaults (per ms rates; normalised thresholds). */
export const MCB_PROTECTION_DEFAULTS = {
  heatingRate: 0.0001,
  coolingRate: 0.00005,
  thermalTripThreshold: 1,
  resetThreshold: 0.2,
} as const

/** EDUCATIONAL instantaneous multiplier per curve (× ratedAmps). Not IEC-precise. */
export const MCB_CURVE_MULTIPLIER: Record<McbCurve, number> = { B: 4, C: 8, D: 12 }

/** Resolve an MCB's protection parameters, filling absent/invalid fields with the
 *  educational defaults (finite, positive). */
export function mcbProtection(spec: McbProtectionSpec): {
  heatingRate: number
  coolingRate: number
  thermalTripThreshold: number
  resetThreshold: number
  curve: McbCurve | null
} {
  const pos = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback
  return {
    heatingRate: pos(spec.heatingRate, MCB_PROTECTION_DEFAULTS.heatingRate),
    coolingRate: pos(spec.coolingRate, MCB_PROTECTION_DEFAULTS.coolingRate),
    thermalTripThreshold: pos(spec.thermalTripThreshold, MCB_PROTECTION_DEFAULTS.thermalTripThreshold),
    resetThreshold: pos(spec.resetThreshold, MCB_PROTECTION_DEFAULTS.resetThreshold),
    curve: spec.curve ?? null,
  }
}

/**
 * A star–delta timer (M3-C2) — a coil-operated, time-stepped sequencer. The
 * terminal contract follows the Omron H3DT-G eight-terminal changeover layout:
 * 0=A1, 1=A2; STAR 15(COM)/16(NC)/18(NO); DELTA 25(COM)/26(NC)/28(NO).
 * The runtime (`elapsedMs`, `running`) lives on CircuitState and advances ONLY in
 * `tick`, never in a plain solve — the timer is time-stepped, not part of the
 * instantaneous fixpoint. Durations are EDUCATIONAL defaults, not a product spec.
 */
export interface TimerSpec {
  kind: 'TIMER'
  /** The exact terminal/timing family represented by this component. */
  model?: 'OMRON_H3DT_G' | 'OMRON_H3CR_A8' | 'GENERIC_CONFIGURABLE'
  configured?: boolean
  /** H3CR operating mode. H3DT-G ignores this field. */
  mode?: 'A' | 'B' | 'B2' | 'E' | 'J'
  /** How long the STAR contact stays closed after the coil energizes (ms). */
  starDurationMs: number
  /** Star-to-delta transfer time: one of the product's selectable values (ms). */
  transitionDelayMs: number
}

/**
 * A thermal overload relay (M3-C2) — EDUCATIONAL first-order thermal model, NOT an
 * IEC I²t curve. Terminals: 0..5 three pass-through power poles L1–T1/L2–T2/L3–T3
 * (always closed — sensing only, it never breaks power itself); 6=95,7=96 an aux NC
 * (opens on trip, in the control path so a trip drops the contactors); 8=97,9=98 an
 * aux NO (closes on trip, for a trip lamp). `thermalLevel`/`tripped` are runtime on
 * CircuitState and advance ONLY in `tick`.
 */
export interface OverloadSpec {
  kind: 'OVERLOAD_RELAY'
  /** Rated line current (A). Heating starts above this. Educational default. (Named
   *  like LOAD/MOTOR's `ratedCurrentAmps`, NOT the breaker's nominal `ratedAmps`.) */
  ratedCurrentAmps: number
  /** Normalised trip threshold for `thermalLevel` (trips at ≥ this). Educational. */
  tripMultiplier: number
  /** Thermal gain per ms while over rated (× the normalised over-current term). */
  heatingRate: number
  /** Thermal decay per ms while at/under rated (cooling). */
  coolingRate: number
  /** A trip can only be reset once `thermalLevel` has cooled to ≤ this. */
  resetThreshold: number
}

export interface GroundSpec {
  kind: 'GROUND'
}

export type ComponentSpec =
  | SourceSpec
  | LoadSpec
  | SwitchSpec
  | SwitchTwoWaySpec
  | SwitchCrossSpec
  | Contact2StateSpec
  | LimitSwitchSpec
  | Sensor3WireSpec
  | TerminalBlockSpec
  | Selector3PosSpec
  | FuseSpec
  | EstopSpec
  | MotorSpec
  | CapacitorSpec
  | PushbuttonSpec
  | RelaySpec
  | IndicatorSpec
  | ThreePhaseSourceSpec
  | ThreePhaseMotorSpec
  | ContactorSpec
  | BreakerOnePoleSpec
  | BreakerThreePoleSpec
  | TimerSpec
  | OverloadSpec
  | GroundSpec

export interface PlacedComponent {
  id: ComponentId
  source?: { label: string; description: string; pages: number[]; assumptions?: string[] }
  /** Legacy/initial position. Old boards continue to open without migration. */
  cell: Cell
  spec: ComponentSpec
  /**
   * Stable catalog identity selected by the user (for example
   * `MOTOR_BREAKER_GV2ME14`).  Electrical kind and catalog model are deliberately
   * separate: several real products share a solver primitive but do not share a
   * housing, terminal strip, or IEC presentation.
   *
   * Missing means a legacy/generic component.  We never infer a branded model
   * from an ambiguous old `spec`, so reopening an old board cannot silently turn
   * a generic contact into a particular manufacturer's product.
   */
  modelId?: string
  /**
   * Optional drawing positions. Moving a field device must not rearrange its IEC
   * symbol (and vice versa); absent entries deliberately fall back to `cell`.
   */
  projectionCells?: Partial<Record<BoardProjection, Cell>>
  /** Independent panel placement; display units only, not manufacturer dimensions. */
  panel3d?: PanelPlacement3D
}

/** A mid-span tap: a wire that visually ENDS on another wire's line instead of at
 *  a terminal. Electrically the wire is still `from`↔`to` (its `to` is a terminal of
 *  the tapped wire, i.e. the same electrical node), so the solver needs no special
 *  case — it ignores `tap` entirely. Only the board renderer reads it, to draw the
 *  wire ending on the target's polyline. `near` is an approximate click point (SVG
 *  coords); the renderer projects it onto the target's final rendered polyline. */
export interface WireTap {
  /** Independent arc fraction on the 3D panel route. */
  panel3dPosition?: number
  wireId: WireId
  /**
   * Drawing-specific junction locations. A physical cable route and an IEC route
   * have unrelated arc lengths, so a fraction captured on one must never be used
   * as geometry for the other.
   */
  projectionPositions?: Partial<Record<BoardProjection, number>>
  /**
   * Legacy shared distance along the target route (0=start, 1=end). New edits use
   * `projectionPositions`; this remains readable for saved boards made before the
   * projection layouts were separated.
   */
  position?: number
  /** Legacy board-space hint. Kept for backward-compatible saved boards. */
  near?: { x: number; y: number }
}

/** A wire joins two terminals. Ideal: zero resistance, merges their nodes.
 *  When `tap` is present the wire is a mid-span tap onto `tap.wireId` — same node
 *  electrically (via `to`), but drawn ending on that wire's line. */
export interface Wire {
  id: WireId
  source?: { number: string; pages: number[]; note?: string }
  from: Terminal
  to: Terminal
  tap?: WireTap
}

/** The placement layer: what is on the board and how it is joined. */
export interface Board {
  /** Durable view preferences only; never used by the electrical solver. */
  view?: {
    zoom: number
    projection: BoardProjection
    sourceOpen?: boolean
    active3d?: boolean
    three?: Board3DView
    cameras: Partial<Record<BoardProjection, { x: number; y: number; insets: { left: number; top: number; right: number; bottom: number } }>>
  }
  reference?: {
    templateId: string
    variant: 'document' | 'corrected'
    title: string
    document: string
    notes: string[]
    conflicts: { id: string; description: string; resolved: boolean }[]
  }
  components: Record<ComponentId, PlacedComponent>
  wires: Record<WireId, Wire>
  /** Which solver analyses this board. Absent ⇒ `dc-resistive` (M0–M2 unchanged). */
  domain?: CircuitDomain
  /** Physical interlocks. They are independent of the electrical NC interlock and
   * prevent both named contactors from closing at the same time. */
  mechanicalInterlocks?: ReadonlyArray<{
    contactorA: ComponentId
    contactorB: ComponentId
  }>
}

/**
 * The solver a board is analysed by. An explicit `domain` wins. Without one, a board
 * that holds a 3-phase source, motor or load, or a tapped transformer, needs the
 * phasor solver: a board assembled from the palette has no `domain` field, and
 * nothing in the editor sets one (audit 21 Nov 2026, L1).
 */
export function boardDomain(board: Board): CircuitDomain {
  if (board.domain) return board.domain
  return Object.values(board.components).some(({ spec }) =>
    spec.kind === 'SOURCE_3PH' ||
    spec.kind === 'MOTOR_3PH' ||
    (spec.kind === 'LOAD' && spec.threePhase !== undefined) ||
    (spec.kind === 'SOURCE' && spec.transformer !== undefined))
    ? 'ac-three-phase-balanced'
    : 'dc-resistive'
}

/** Terminal counts per kind. The motor has a third pin (the start winding); the
 *  3-phase source has four (R, S, T, N). */
export const TERMINAL_COUNT: Record<ComponentKind, number> = {
  SOURCE: 2,
  LOAD: 2,
  SWITCH: 2,
  SWITCH_2WAY: 3,
  SWITCH_CROSS: 4,
  CONTACT_2STATE: 3,
  LIMIT_SWITCH: 4,
  SENSOR_3WIRE: 3,
  TERMINAL_BLOCK: 2,
  SELECTOR_3POS: 3,
  FUSE: 2,
  ESTOP: 2,
  MOTOR: 3,
  CAPACITOR: 2,
  PUSHBUTTON: 2,
  RELAY: 6,
  INDICATOR: 2,
  SOURCE_3PH: 4,
  MOTOR_3PH: 7,
  CONTACTOR: 12,
  BREAKER_1P: 2,
  BREAKER_3P: 6,
  TIMER: 8,
  OVERLOAD_RELAY: 10,
  GROUND: 1,
}

/**
 * Number of electrically usable terminals on this exact component instance.
 * Most component kinds have a fixed count. Relay packages are the exception:
 * MY2/MY3/MY4 expose 8/11/14 pins while old saved boards retain the original
 * six-terminal educational relay.
 */
export function terminalCountForSpec(spec: ComponentSpec): number {
  if (spec.kind === 'SOURCE' && spec.transformer) return 5
  if (spec.kind === 'LOAD' && spec.threePhase) return 4
  if (spec.kind === 'TERMINAL_BLOCK') {
    switch (spec.model ?? 'FEED_THROUGH') {
      case 'PHOENIX_UT25_TWIN':
        return 3
      case 'PHOENIX_UT25_QUATTRO':
        return 4
      case 'PHOENIX_UT25_PE_L_L':
        return 6
      default:
        return 2
    }
  }
  if (spec.kind !== 'RELAY') return TERMINAL_COUNT[spec.kind]
  switch (spec.model ?? 'LEGACY_1NO_1NC') {
    case 'OMRON_MY2_8PIN':
    case 'OMRON_G5V2_8PIN':
      return 8
    case 'OMRON_MY3_11PIN':
      return 11
    case 'OMRON_MY4_14PIN':
      return 14
    default:
      return TERMINAL_COUNT.RELAY
  }
}

/** Named terminals, so call sites never guess the index. */
export const SOURCE_TERMINAL = { L: 0, N: 1 } as const
export const LIMIT_SWITCH_TERMINAL = { NC_11: 0, NC_12: 1, NO_33: 2, NO_34: 3 } as const
export const SENSOR_3WIRE_TERMINAL = { BROWN_1_POSITIVE: 0, BLUE_3_ZERO: 1, BLACK_4_OUTPUT: 2 } as const
export const TERMINAL_BLOCK_TERMINAL = { CONNECTION_1: 0, CONNECTION_2: 1 } as const
export const SOURCE_3PH_TERMINAL = { R: 0, S: 1, T: 2, N: 3 } as const
export const MOTOR_3PH_TERMINAL = {
  U1: 0,
  U2: 1,
  V1: 2,
  V2: 3,
  W1: 4,
  W2: 5,
  PE: 6,
} as const
/** Contactor terminals: coil A1/A2, three main poles L/T, aux NO 13/14, aux NC 21/22. */
export const CONTACTOR_TERMINAL = {
  A1: 0,
  A2: 1,
  L1: 2,
  T1: 3,
  L2: 4,
  T2: 5,
  L3: 6,
  T3: 7,
  NO_13: 8,
  NO_14: 9,
  NC_21: 10,
  NC_22: 11,
} as const
/** Single-pole breaker terminals: one pole in the live conductor. */
export const BREAKER_1P_TERMINAL = { L_IN: 0, L_OUT: 1 } as const
/** Three-pole breaker terminals: R/S/T each with an IN and OUT pole. */
export const BREAKER_3P_TERMINAL = {
  R_IN: 0,
  R_OUT: 1,
  S_IN: 2,
  S_OUT: 3,
  T_IN: 4,
  T_OUT: 5,
} as const
/**
 * Timer terminals: coil A1/A2 plus two changeover groups.
 *
 * The first six indices are deliberately unchanged so existing learning boards
 * keep their wiring. 18 and 26 complete the two physical changeover groups
 * visible on the eight-screw timer asset.
 */
export const TIMER_TERMINAL = {
  A1: 0,
  A2: 1,
  /** Generic/H3CR contact group 1. Physical H3CR-A8 pins: COM=1, NC=4, NO=3. */
  CONTACT_1_COMMON: 2,
  CONTACT_1_NC: 3,
  CONTACT_1_NO: 6,
  /** Generic/H3CR contact group 2. Physical H3CR-A8 pins: COM=8, NC=5, NO=6. */
  CONTACT_2_COMMON: 4,
  CONTACT_2_NC: 7,
  CONTACT_2_NO: 5,
  /** H3DT-G functional designations retained for existing star/delta boards. */
  STAR_COMMON_15: 2,
  STAR_NC_16: 3,
  DELTA_COMMON_25: 4,
  DELTA_NO_28: 5,
  STAR_NO_18: 6,
  DELTA_NC_26: 7,
} as const
/** Overload terminals: three pass-through power poles, aux NC 95/96, aux NO 97/98. */
export const OVERLOAD_TERMINAL = {
  L1: 0,
  T1: 1,
  L2: 2,
  T2: 3,
  L3: 4,
  T3: 5,
  N95: 6,
  N96: 7,
  N97: 8,
  N98: 9,
} as const
export const MOTOR_TERMINAL = { MAIN_A: 0, MAIN_B: 1, AUX: 2 } as const
export const RELAY_TERMINAL = {
  COIL_A: 0,
  COIL_B: 1,
  NO_A: 2,
  NO_B: 3,
  NC_A: 4,
  NC_B: 5,
} as const

export function kindOf(component: PlacedComponent): ComponentKind {
  return component.spec.kind
}

/** Stable key for a terminal, used across topology and flow tracing. */
export function terminalKey(terminal: Terminal): string {
  return `${terminal.componentId}:${terminal.index}`
}

export function emptyBoard(): Board {
  return { components: {}, wires: {} }
}
