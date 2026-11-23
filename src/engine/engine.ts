/**
 * The circuit engine — deterministic reduce + tick.
 *
 * Like the sequence engine, this holds ONLY serialisable state and never reads a
 * wall clock: the caller supplies `dtMs` on each TICK, so the same actions always
 * produce the same states (which is what makes the tests real and the animation
 * reproducible). React, canvas, and requestAnimationFrame live in the feature.
 *
 * The current is RAMPED toward its steady value each tick rather than snapped.
 * That is deliberate (BOS decision M0): on a dead short the reader must SEE the
 * current climb before it trips, so the failure is diagnosable rather than an
 * instant, unexplained bang.
 */

import type {
  Board,
  BoardProjection,
  Cell,
  ComponentId,
  ComponentSpec,
  McbRatedCurrent,
  Terminal,
  WireId,
  WireTap,
} from './types'
import {
  emptyBoard,
  mcbProtection,
  mcbRatedAmps,
  TIMER_TERMINAL,
  terminalKey,
} from './types'
import { terminalCountForComponent } from './componentModels'
import { circuitRunRequirements } from './runRequirements'
import { blownFuse, shortCircuitProtection, solveCircuit, type Solution } from './solve'
import { buildNodes, type NodeMap } from './topology'
import { magnitude } from './phasor'
import type { ThreePhaseSolution } from './threePhase'
import { mcbProtectionStep, overloadThermalStep } from './conduction'
import {
  clampTimerStarDurationMs,
  clampTimerTransferDelayMs,
} from './timerSettings'
import type {
  ContactorEnergized,
  McbRuntime,
  OverloadRuntime,
  RelayEnergized,
  RuntimeContacts,
  TimerRuntime,
} from './conduction'
import type { FaultRecord } from './fault'

/** Coil voltage (RMS) above which a timer counts as energized/"running" (M3-C2). */
const TIMER_RUN_THRESHOLD_VOLTS = 20

export type CircuitStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'FAULTED'

export interface CircuitDisplay {
  /** Ramped current the source is delivering (amperes). */
  sourceCurrent: number
  /** Ramped current through each LOAD (amperes). */
  loadCurrent: Record<ComponentId, number>
}

export interface CircuitEvent {
  seq: number
  atMs: number
  type: 'RUN' | 'PAUSE' | 'RESET' | 'SWITCH' | 'FAULT'
  componentId?: ComponentId
}

import { panelMoveAllowed, panelPlacement, normalizeBoard3DView } from './board3d'

export interface CircuitState {
  board: Board
  status: CircuitStatus
  /** Virtual time in ms. Advanced only by TICK, only while RUNNING. */
  timeMs: number
  /** Steady-state solve for the current board (targets for the ramp). */
  solution: Solution
  /** Persistent relay energized state (a latch's memory across solves). */
  relayEnergized: RelayEnergized
  /** Persistent contactor energized state (M3-B2 voltage-driven latch memory).
   *  Seeds the closure↔voltage fixpoint so a self-holding contactor stays latched. */
  contactorEnergized: ContactorEnergized
  /** M3-B3 readout: per-contactor coil RMS voltage at the converged solve (`{}` for DC).
   *  Additive read-only diagnostic carried from the solve; never seeds anything. */
  coilVoltage: Record<ComponentId, number>
  /** M3-B3 readout: did the contactor closure↔voltage fixpoint settle? (true for DC / no contactor). */
  contactorConverged: boolean
  /** M3-B3 readout: the rich phasor result for `ac-three-phase-balanced` boards
   *  (line/winding currents, node status). Undefined for every DC (M0–M2) board. */
  threePhase?: ThreePhaseSolution
  /** M3-C2 time-stepped timer runtime (elapsed + running). Advances ONLY in `tick`;
   *  a plain solve reads it FROZEN so contacts never move without time passing. */
  timerRuntime: TimerRuntime
  /** M3-C2 time-stepped overload runtime (thermal accumulation + trip latch). */
  overloadRuntime: OverloadRuntime
  /** M3-C3 time-stepped MCB protection runtime (per-pole current + thermal + trip). */
  mcbRuntime: McbRuntime
  /** What the instruments currently read (ramped toward the solution). */
  display: CircuitDisplay
  fault: FaultRecord | null
  events: CircuitEvent[]
  nextSeq: number
  /** Board snapshots BEFORE each structural change (for undo). */
  undoStack: Board[]
  /** Board snapshots undone (for redo); cleared on any new structural change. */
  redoStack: Board[]
}

export type CircuitAction =
  | { type: 'INITIALIZE_PANEL_3D' }
  | { type: 'MOVE_COMPONENT_3D'; id: ComponentId; placement: import('./board3d.ts').PanelPlacement3D }
  | { type: 'PLACE_COMPONENT'; id: ComponentId; cell: Cell; spec: ComponentSpec; modelId?: string }
  | { type: 'MOVE_COMPONENT'; id: ComponentId; cell: Cell; projection?: BoardProjection }
  | { type: 'REMOVE_COMPONENT'; id: ComponentId }
  | { type: 'CONNECT'; id: WireId; from: Terminal; to: Terminal; tap?: WireTap }
  | { type: 'DISCONNECT'; id: WireId }
  | { type: 'TOGGLE_SWITCH'; id: ComponentId }
  | { type: 'SET_MCB_RATING'; id: ComponentId; ratedAmps: McbRatedCurrent }
  | {
      type: 'SET_TIMER_TIMING'
      id: ComponentId
      starDurationMs: number
      transitionDelayMs: number
    }
  | { type: 'SET_TIMER_MODE'; id: ComponentId; mode: 'A' | 'B' | 'B2' | 'E' | 'J' }
  | { type: 'PRESS_PUSHBUTTON'; id: ComponentId; pressed: boolean }
  | {
      type: 'PRESS_PRODUCT_CONTROL'
      id: ComponentId
      control: 'START' | 'STOP' | 'ACTUATOR'
      pressed: boolean
    }
  | { type: 'REPLACE_COMPONENT'; draggedId: ComponentId; occupantId: ComponentId; cell: Cell; projection?: BoardProjection }
  | { type: 'LOAD_BOARD'; board: Board }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_RUNNING'; running: boolean }
  | { type: 'RESET' }
  | { type: 'RESET_OVERLOAD'; id: ComponentId }
  | { type: 'RESET_MCB'; id: ComponentId }
  | { type: 'TICK'; dtMs: number }

/** Ramp time constant (ms). Small enough to feel instant, large enough to see. */
const RAMP_TAU_MS = 90
/** Component kinds whose current is ramped and shown (carry a resistive branch). */
const RAMPED_KINDS = new Set<ComponentSpec['kind']>([
  'LOAD',
  'MOTOR',
  'INDICATOR',
  'RELAY',
  'LIMIT_SWITCH', // only product variants with an explicit integral lamp get current
])
/** A dead short has no finite steady current; ramp toward a value safely past
 *  the trip point so the climb visibly crosses the threshold. */
const SHORT_OVERSHOOT = 2.5

function zeroDisplay(board: Board): CircuitDisplay {
  const loadCurrent: Record<ComponentId, number> = {}
  for (const component of Object.values(board.components)) {
    if (RAMPED_KINDS.has(component.spec.kind)) loadCurrent[component.id] = 0
  }
  return { sourceCurrent: 0, loadCurrent }
}

/** The source protection a short reaches when nothing on its path opens first: the
 *  source the short involves, else the first source on the board. A 3-phase source
 *  counts too; before, a 3-phase short never tripped anything (L2). */
function shortTripSource(board: Board, involved: readonly ComponentId[] = []) {
  const sources = Object.values(board.components).filter(
    (component) =>
      (component.spec.kind === 'SOURCE' && !component.spec.transformer) ||
      component.spec.kind === 'SOURCE_3PH',
  )
  const source = sources.find((component) => involved.includes(component.id)) ?? sources[0]
  return source && (source.spec.kind === 'SOURCE' || source.spec.kind === 'SOURCE_3PH')
    ? { tripAmps: source.spec.tripAmps }
    : null
}

/** Frozen timer/overload contact positions (M3-C2) fed into a plain solve — read
 *  as-is, never advanced. Time only moves in `tick`. */
export function runtimeContacts(state: CircuitState): RuntimeContacts {
  return { timer: state.timerRuntime, overload: state.overloadRuntime, mcb: state.mcbRuntime }
}

/** The exact dynamic node map used by runtime-facing measurements. Feature/UI
 * code must use this selector instead of rebuilding a partial topology that can
 * omit relay, timer, overload, or MCB contact state. */
export function buildCircuitRuntimeNodes(state: CircuitState): NodeMap {
  return buildNodes(
    state.board,
    state.relayEnergized,
    state.contactorEnergized,
    runtimeContacts(state),
  )
}

/** Measured per-pole current of an MCB from the PREVIOUS solve (via its sense-branch).
 *  3P → three pole magnitudes (`${id}#0..2`); 1P → one (branch phasor on an AC board,
 *  else the DC branch current). Empty/0 when no branch (open) or no solution yet. */
function mcbPoleCurrents(state: CircuitState, id: ComponentId, threePole: boolean): number[] {
  const tp = state.threePhase
  if (threePole) {
    if (!tp) return [0, 1, 2].map(i => Math.abs(state.solution.loadCurrent[`${id}#${i}`] ?? 0))
    return [0, 1, 2].map((i) => {
      const c = tp.branchCurrentPhasor[`${id}#${i}`]
      return c ? Math.hypot(c.re, c.im) : 0
    })
  }
  if (tp) {
    const c = tp.branchCurrentPhasor[id]
    return [c ? Math.hypot(c.re, c.im) : 0]
  }
  return [state.solution.loadCurrent[id] ?? 0]
}

/** RMS voltage across a timer's coil A1–A2 from the PREVIOUS solve (0 if undefined /
 *  not on a phasor board / unreferenced). Decides "running", like a contactor coil. */
function timerCoilVoltage(state: CircuitState, id: ComponentId): number {
  const tp = state.threePhase
  const nodes = buildCircuitRuntimeNodes(state)
  const nA1 = nodes.nodeOf.get(terminalKey({ componentId: id, index: TIMER_TERMINAL.A1 }))
  const nA2 = nodes.nodeOf.get(terminalKey({ componentId: id, index: TIMER_TERMINAL.A2 }))
  if (nA1 === undefined || nA2 === undefined) return 0
  if (!tp) {
    return Math.abs((state.solution.nodeVoltage[nA1] ?? 0) - (state.solution.nodeVoltage[nA2] ?? 0))
  }
  const mA1 = tp.nodeVoltage[nA1]
  const mA2 = tp.nodeVoltage[nA2]
  if (!mA1 || !mA2 || mA1.status !== 'RESOLVED' || mA2.status !== 'RESOLVED') return 0
  return magnitude({ re: mA1.phasor.re - mA2.phasor.re, im: mA1.phasor.im - mA2.phasor.im })
}

/** Current through this overload relay's own three power poles from the previous
 * solve. Control current elsewhere on the source must never heat the motor OL. */
function sensedOverloadCurrent(state: CircuitState, id: ComponentId): number {
  const tp = state.threePhase
  if (!tp) return Math.max(...[0, 1, 2].map(i => Math.abs(state.solution.loadCurrent[`${id}#${i}`] ?? 0)))
  return Math.max(
    ...[0, 1, 2].map((pole) => magnitude(tp.branchCurrentPhasor[`${id}#${pole}`] ?? { re: 0, im: 0 })),
  )
}

/**
 * The M3-C2 time-step (OUTER loop): advance timer elapsed + overload thermal by
 * `dtMs`, using the PREVIOUS solve's voltages/currents, then FREEZE. The subsequent
 * `solveCircuit` reads these as fixed contact positions — timer/overload are never
 * part of the instantaneous fixpoint (no chicken-egg). A de-energized timer resets
 * its elapsed to 0.
 */
function advanceRuntime(
  state: CircuitState,
  dtMs: number,
): { timerRuntime: TimerRuntime; overloadRuntime: OverloadRuntime; mcbRuntime: McbRuntime } {
  const timerRuntime: TimerRuntime = { ...state.timerRuntime }
  const overloadRuntime: OverloadRuntime = { ...state.overloadRuntime }
  const mcbRuntime: McbRuntime = { ...state.mcbRuntime }
  for (const component of Object.values(state.board.components)) {
    const { spec, id } = component
    if (spec.kind === 'TIMER') {
      const running = timerCoilVoltage(state, id) > TIMER_RUN_THRESHOLD_VOLTS
      const prevElapsed = state.timerRuntime[id]?.elapsedMs ?? 0
      timerRuntime[id] = { elapsedMs: running ? prevElapsed + dtMs : 0, running }
    } else if (spec.kind === 'OVERLOAD_RELAY') {
      const prev = state.overloadRuntime[id] ?? { thermalLevel: 0, tripped: false }
      overloadRuntime[id] = overloadThermalStep(prev, spec, sensedOverloadCurrent(state, id), dtMs)
    } else if (spec.kind === 'BREAKER_1P' || spec.kind === 'BREAKER_3P') {
      const prev = state.mcbRuntime[id] ?? {
        thermalLevel: 0,
        tripped: false,
        tripReason: null,
        poleCurrents: [],
      }
      mcbRuntime[id] = spec.protectionDisabled
        ? {
            thermalLevel: 0,
            tripped: false,
            tripReason: null,
            poleCurrents: mcbPoleCurrents(state, id, spec.kind === 'BREAKER_3P'),
          }
        : mcbProtectionStep(
            prev,
            mcbRatedAmps(spec),
            mcbProtection(spec),
            mcbPoleCurrents(state, id, spec.kind === 'BREAKER_3P'),
            dtMs,
          )
    }
  }
  return { timerRuntime, overloadRuntime, mcbRuntime }
}

export function initialCircuitState(board: Board = emptyBoard()): CircuitState {
  const { solution, relayEnergized, contactorEnergized, coilVoltage, contactorConverged, threePhase } =
    solveCircuit(board, {}, {})
  return {
    board,
    status: 'IDLE',
    timeMs: 0,
    solution,
    relayEnergized,
    contactorEnergized,
    coilVoltage,
    contactorConverged,
    threePhase,
    timerRuntime: {},
    overloadRuntime: {},
    mcbRuntime: {},
    display: zeroDisplay(board),
    fault: null,
    events: [],
    nextSeq: 1,
    undoStack: [],
    redoStack: [],
  }
}

/** A structural edit stops the run and clears the readout — you changed the
 *  circuit, so it is no longer the thing that was running. */
function afterStructuralChange(state: CircuitState, board: Board): CircuitState {
  const { solution, relayEnergized, contactorEnergized, coilVoltage, contactorConverged, threePhase } =
    solveCircuit(board, state.relayEnergized, state.contactorEnergized)
  return {
    ...state,
    board,
    status: 'IDLE',
    timeMs: 0,
    solution,
    relayEnergized,
    contactorEnergized,
    coilVoltage,
    contactorConverged,
    threePhase,
    // A structural edit is a fresh idle board: the timed sequence restarts and the
    // thermal accumulation clears (consistent with timeMs=0 / display zeroed).
    timerRuntime: {},
    overloadRuntime: {},
    mcbRuntime: {},
    display: zeroDisplay(board),
    fault: null,
    // Record the board BEFORE this change; a new change invalidates the redo path.
    undoStack: [...state.undoStack, state.board],
    redoStack: [],
  }
}

/** Apply a snapshot board without recording history (used by undo/redo). */
function applySnapshot(board: Board): Pick<
  CircuitState,
  'board' | 'status' | 'timeMs' | 'solution' | 'relayEnergized' | 'contactorEnergized'
  | 'coilVoltage' | 'contactorConverged' | 'threePhase' | 'timerRuntime' | 'overloadRuntime'
  | 'mcbRuntime' | 'display' | 'fault'
> {
  const { solution, relayEnergized, contactorEnergized, coilVoltage, contactorConverged, threePhase } =
    solveCircuit(board, {}, {})
  return {
    board,
    status: 'IDLE',
    timeMs: 0,
    solution,
    relayEnergized,
    contactorEnergized,
    coilVoltage,
    contactorConverged,
    threePhase,
    timerRuntime: {},
    overloadRuntime: {},
    mcbRuntime: {},
    display: zeroDisplay(board),
    fault: null,
  }
}

function ramp(current: number, target: number, dtMs: number): number {
  const k = Math.min(1, Math.max(0, dtMs / RAMP_TAU_MS))
  return current + (target - current) * k
}

function pushEvent(state: CircuitState, event: Omit<CircuitEvent, 'seq'>): {
  events: CircuitEvent[]
  nextSeq: number
} {
  return {
    events: [...state.events, { seq: state.nextSeq, ...event }],
    nextSeq: state.nextSeq + 1,
  }
}

function tick(state: CircuitState, dtMs: number): CircuitState {
  if (state.status !== 'RUNNING' || dtMs <= 0) return state

  const timeMs = state.timeMs + dtMs
  // M3-C2 OUTER step: advance timer/thermal from the PREVIOUS solve, freeze, THEN
  // solve with those as fixed contact positions (they never enter the fixpoint).
  const { timerRuntime, overloadRuntime, mcbRuntime } = advanceRuntime(state, dtMs)
  const { solution, relayEnergized, contactorEnergized, coilVoltage, contactorConverged, threePhase } =
    solveCircuit(state.board, state.relayEnergized, state.contactorEnergized, {
      timer: timerRuntime,
      overload: overloadRuntime,
      mcb: mcbRuntime,
    })
  const source = shortTripSource(state.board, solution.short?.sourceIds)

  // Targets the ramp eases toward.
  const targetSource = solution.shorted
    ? (source?.tripAmps ?? 0) * SHORT_OVERSHOOT
    : solution.sourceCurrent
  const nextSourceCurrent = ramp(state.display.sourceCurrent, targetSource, dtMs)

  const nextLoadCurrent: Record<ComponentId, number> = {}
  for (const component of Object.values(state.board.components)) {
    if (!RAMPED_KINDS.has(component.spec.kind)) continue
    const target = solution.shorted ? 0 : solution.loadCurrent[component.id] ?? 0
    nextLoadCurrent[component.id] = ramp(
      state.display.loadCurrent[component.id] ?? 0,
      target,
      dtMs,
    )
  }

  const display: CircuitDisplay = {
    sourceCurrent: nextSourceCurrent,
    loadCurrent: nextLoadCurrent,
  }

  // Evaluate the threshold on the RAMPED reading, so the trip lands at the
  // moment the visible current crosses the limit.
  let fault: FaultRecord | null = null
  const trip = source?.tripAmps ?? Infinity
  if (solution.shorted && nextSourceCurrent >= trip) {
    // L2: the protection on the short's path opens first (an MCB's instantaneous
    // release, a fuse element); only a short with none on its path reaches the source.
    const runtime: RuntimeContacts = { timer: timerRuntime, overload: overloadRuntime, mcb: mcbRuntime }
    const devices = shortCircuitProtection(state.board, relayEnergized, contactorEnergized, runtime)
    const first = devices.length ? state.board.components[devices[0].id] : undefined
    fault = {
      code: devices.length ? 'SHORT_CIRCUIT_TRIPPED' : 'SHORT_CIRCUIT_NO_LOAD',
      atMs: timeMs,
      measured: {
        currentAmps: nextSourceCurrent,
        limitAmps: trip,
        ...(first ? { componentId: first.id } : {}),
        ...(first && (first.spec.kind === 'BREAKER_1P' || first.spec.kind === 'BREAKER_3P')
          ? { ratedAmps: mcbRatedAmps(first.spec) }
          : {}),
      },
      ...(solution.short ? { conductors: solution.short.labels } : {}),
      ...(devices.length ? { devices } : {}),
    }
    if (devices.length) {
      const opened: McbRuntime = { ...mcbRuntime }
      let board = state.board
      for (const device of devices) {
        if (device.kind === 'MCB') {
          opened[device.id] = {
            ...(opened[device.id] ?? { thermalLevel: 0, poleCurrents: [] }),
            tripped: true,
            tripReason: 'INSTANTANEOUS',
          }
        } else {
          board = { ...board, components: { ...board.components, [device.id]: blownFuse(board.components[device.id]) } }
        }
      }
      // Re-solve with the path open: coils fed through it drop, the short is gone.
      const cleared = solveCircuit(board, relayEnergized, contactorEnergized, { ...runtime, mcb: opened })
      const log = pushEvent(state, { atMs: timeMs, type: 'FAULT', componentId: first?.id })
      return {
        ...state,
        board,
        timeMs,
        solution: cleared.solution,
        relayEnergized: cleared.relayEnergized,
        contactorEnergized: cleared.contactorEnergized,
        coilVoltage: cleared.coilVoltage,
        contactorConverged: cleared.contactorConverged,
        threePhase: cleared.threePhase,
        timerRuntime,
        overloadRuntime,
        mcbRuntime: opened,
        display,
        fault,
        status: 'FAULTED',
        ...log,
      }
    }
  } else {
    for (const component of Object.values(state.board.components)) {
      const rated =
        component.spec.kind === 'LOAD' ||
        component.spec.kind === 'MOTOR' ||
        component.spec.kind === 'INDICATOR'
          ? component.spec.ratedCurrentAmps
          : null
      if (rated === null) continue
      const steady = solution.loadCurrent[component.id] ?? 0
      if (steady > rated && (nextLoadCurrent[component.id] ?? 0) >= rated) {
        fault = {
          code: 'LOAD_OVERCURRENT',
          atMs: timeMs,
          measured: {
            currentAmps: nextLoadCurrent[component.id] ?? 0,
            limitAmps: rated,
            componentId: component.id,
            ratedAmps: rated,
          },
        }
        break
      }
    }
  }

  if (fault) {
    const log = pushEvent(state, { atMs: timeMs, type: 'FAULT', componentId: fault.measured.componentId })
    return { ...state, timeMs, solution, relayEnergized, contactorEnergized, coilVoltage, contactorConverged, threePhase, timerRuntime, overloadRuntime, mcbRuntime, display, fault, status: 'FAULTED', ...log }
  }

  return { ...state, timeMs, solution, relayEnergized, contactorEnergized, coilVoltage, contactorConverged, threePhase, timerRuntime, overloadRuntime, mcbRuntime, display }
}

export function circuitReducer(state: CircuitState, action: CircuitAction): CircuitState {
  switch (action.type) {
    case 'INITIALIZE_PANEL_3D': {
      const three = normalizeBoard3DView(state.board.view?.three)
      if (Object.values(state.board.components).every(c=>c.panel3d || three.placements?.[c.id])) return state
      const placements = { ...three.placements }
      for (const c of Object.values(state.board.components)) if (!c.panel3d && !placements[c.id]) placements[c.id] = panelPlacement(c)
      return { ...state, board: { ...state.board, view: { zoom: 1, projection: 'iec', cameras: {}, ...state.board.view, three: { ...three, placements } } } }
    }
    case 'MOVE_COMPONENT_3D': {
      const c = state.board.components[action.id]
      if (!c || !panelMoveAllowed(state.board, action.id, action.placement)) return state
      return afterStructuralChange(state, { ...state.board, components: { ...state.board.components,
        [action.id]: { ...c, panel3d: { ...action.placement } } } })
    }
    case 'PLACE_COMPONENT': {
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: {
            id: action.id,
            cell: action.cell,
            spec: action.spec,
            ...(action.modelId ? { modelId: action.modelId } : {}),
          },
        },
      }
      return afterStructuralChange(state, board)
    }
    case 'MOVE_COMPONENT': {
      const existing = state.board.components[action.id]
      if (!existing) return state
      const moved = action.projection
        ? {
            ...existing,
            projectionCells: {
              ...existing.projectionCells,
              [action.projection]: action.cell,
            },
          }
        : { ...existing, cell: action.cell }
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: moved,
        },
      }
      return afterStructuralChange(state, board)
    }
    case 'REMOVE_COMPONENT': {
      if (!state.board.components[action.id]) return state
      const components = { ...state.board.components }
      delete components[action.id]
      // Drop any wire that touched the removed component.
      const wires: Record<WireId, Board['wires'][string]> = {}
      for (const wire of Object.values(state.board.wires)) {
        if (wire.from.componentId !== action.id && wire.to.componentId !== action.id) {
          wires[wire.id] = wire
        }
      }
      return afterStructuralChange(state, {
        ...state.board,
        components,
        wires,
        mechanicalInterlocks: state.board.mechanicalInterlocks?.filter(
          ({ contactorA, contactorB }) => contactorA !== action.id && contactorB !== action.id,
        ),
      })
    }
    case 'CONNECT': {
      const board: Board = {
        ...state.board,
        wires: {
          ...state.board.wires,
          [action.id]: {
            id: action.id,
            from: action.from,
            to: action.to,
            ...(action.tap ? { tap: action.tap } : {}),
          },
        },
      }
      return afterStructuralChange(state, board)
    }
    case 'DISCONNECT': {
      if (!state.board.wires[action.id]) return state
      const wires = { ...state.board.wires }
      delete wires[action.id]
      return afterStructuralChange(state, { ...state.board, wires })
    }
    case 'TOGGLE_SWITCH': {
      const existing = state.board.components[action.id]
      if (!existing) return state
      // Manual pole toggle: a SWITCH flips `closed`; a breaker flips its persisted
      // `on` is the manual handle request; a latched runtime trip still overrides it.
      const spec = existing.spec
      if (spec.kind === 'CONTACT_2STATE' && spec.drivenBy) return state
      let nextSpec: ComponentSpec
      if (spec.kind === 'SWITCH') nextSpec = { ...spec, closed: !spec.closed }
      else if (spec.kind === 'SWITCH_2WAY') nextSpec = { ...spec, toL2: !spec.toL2 }
      else if (spec.kind === 'SWITCH_CROSS') nextSpec = { ...spec, crossed: !spec.crossed }
      else if (
        spec.kind === 'CONTACT_2STATE' &&
        existing.modelId === 'PHASE_MONITOR_RM17TG20'
      ) return state // RM17 output is derived from L1/L2/L3; no manual override.
      else if (spec.kind === 'CONTACT_2STATE') nextSpec = { ...spec, actuated: !spec.actuated }
      else if (spec.kind === 'LIMIT_SWITCH' || spec.kind === 'SENSOR_3WIRE')
        nextSpec = { ...spec, actuated: !spec.actuated }
      else if (spec.kind === 'FUSE') nextSpec = { ...spec, blown: !spec.blown }
      else if (
        spec.kind === 'TERMINAL_BLOCK' &&
        (spec.model === 'PHOENIX_UT4_HESI' || spec.model === 'PHOENIX_UT4_MT')
      )
        nextSpec = { ...spec, open: !spec.open }
      else if (spec.kind === 'ESTOP') nextSpec = { ...spec, pressed: !spec.pressed }
      else if (spec.kind === 'SELECTOR_3POS')
        nextSpec = { ...spec, pos: (((spec.pos + 1) % 3) as 0 | 1 | 2) }
      else if (spec.kind === 'BREAKER_1P' || spec.kind === 'BREAKER_3P')
        nextSpec = { ...spec, on: !spec.on }
      else return state
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: { ...existing, spec: nextSpec },
        },
      }
      // A toggle is a LIVE interaction, not a rebuild: keep running, re-solve so
      // the next tick ramps toward the new target (lamp lights or fades).
      const swLog = pushEvent(state, { atMs: state.timeMs, type: 'SWITCH', componentId: action.id })
      // Live interaction: time does NOT advance, so timer/overload stay frozen.
      const swSolve = solveCircuit(board, state.relayEnergized, state.contactorEnergized, runtimeContacts(state))
      return {
        ...state,
        board,
        solution: swSolve.solution,
        relayEnergized: swSolve.relayEnergized,
        contactorEnergized: swSolve.contactorEnergized,
        coilVoltage: swSolve.coilVoltage,
        contactorConverged: swSolve.contactorConverged,
        threePhase: swSolve.threePhase,
        ...swLog,
      }
    }
    case 'SET_MCB_RATING': {
      // Change the nominal current used by the educational thermal model. Routed
      // through the structural funnel so it is undoable/redoable.
      const existing = state.board.components[action.id]
      if (
        !existing ||
        (existing.spec.kind !== 'BREAKER_1P' && existing.spec.kind !== 'BREAKER_3P')
      ) {
        return state
      }
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: { ...existing, spec: { ...existing.spec, ratedAmps: action.ratedAmps } },
        },
      }
      return afterStructuralChange(state, board)
    }
    case 'SET_TIMER_TIMING': {
      const existing = state.board.components[action.id]
      if (!existing || existing.spec.kind !== 'TIMER') return state
      const generic = existing.spec.model === 'GENERIC_CONFIGURABLE'
      const starDurationMs = generic ? (Number.isFinite(action.starDurationMs) ? Math.max(0, Math.min(86400000, action.starDurationMs)) : 0) : clampTimerStarDurationMs(action.starDurationMs)
      const transitionDelayMs = generic ? 0 : clampTimerTransferDelayMs(action.transitionDelayMs)
      if (
        existing.spec.starDurationMs === starDurationMs &&
        existing.spec.transitionDelayMs === transitionDelayMs
      ) {
        return state
      }
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: {
            ...existing,
            spec: { ...existing.spec, starDurationMs, transitionDelayMs, ...(generic ? { configured: starDurationMs > 0 && !!existing.spec.mode } : {}) },
          },
        },
      }
      // A timing change restarts the sequence at a known baseline and remains
      // undoable, exactly like other component-property edits.
      return afterStructuralChange(state, board)
    }
    case 'SET_TIMER_MODE': {
      const existing = state.board.components[action.id]
      if (!existing || existing.spec.kind !== 'TIMER' || !['OMRON_H3CR_A8', 'GENERIC_CONFIGURABLE'].includes(existing.spec.model ?? '')) return state
      if (existing.spec.mode === action.mode) return state
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: { ...existing, spec: { ...existing.spec, mode: action.mode, ...(existing.spec.model === 'GENERIC_CONFIGURABLE' ? { configured: existing.spec.starDurationMs > 0 } : {}) } },
        },
      }
      return afterStructuralChange(state, board)
    }
    case 'PRESS_PUSHBUTTON': {
      const existing = state.board.components[action.id]
      if (!existing || existing.spec.kind !== 'PUSHBUTTON') return state
      if (existing.spec.pressed === action.pressed) return state
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: {
            ...existing,
            spec: { ...existing.spec, pressed: action.pressed },
          },
        },
      }
      // Live: pressing/releasing re-solves (and re-runs the relay fixpoint) so a
      // momentary tap can latch a self-holding relay.
      const pbLog = pushEvent(state, { atMs: state.timeMs, type: 'SWITCH', componentId: action.id })
      // Live interaction: time does NOT advance, so timer/overload stay frozen.
      const pbSolve = solveCircuit(board, state.relayEnergized, state.contactorEnergized, runtimeContacts(state))
      return {
        ...state,
        board,
        solution: pbSolve.solution,
        relayEnergized: pbSolve.relayEnergized,
        contactorEnergized: pbSolve.contactorEnergized,
        coilVoltage: pbSolve.coilVoltage,
        contactorConverged: pbSolve.contactorConverged,
        threePhase: pbSolve.threePhase,
        ...pbLog,
      }
    }
    case 'PRESS_PRODUCT_CONTROL': {
      const existing = state.board.components[action.id]
      if (!existing || existing.spec.kind !== 'LIMIT_SWITCH') return state
      let nextSpec: ComponentSpec
      if (existing.modelId === 'PUSHBUTTON_STATION_XB5AL73415') {
        if (action.control === 'ACTUATOR') return state
        const field = action.control === 'START' ? 'startPressed' : 'stopPressed'
        if (Boolean(existing.spec[field]) === action.pressed) return state
        nextSpec = { ...existing.spec, [field]: action.pressed }
      } else if (existing.modelId === 'ILLUMINATED_PB_XB5AW33B5') {
        if (action.control !== 'ACTUATOR' || existing.spec.actuated === action.pressed) return state
        nextSpec = { ...existing.spec, actuated: action.pressed }
      } else {
        return state
      }
      const board: Board = {
        ...state.board,
        components: {
          ...state.board.components,
          [action.id]: { ...existing, spec: nextSpec },
        },
      }
      const log = pushEvent(state, {
        atMs: state.timeMs,
        type: 'SWITCH',
        componentId: action.id,
      })
      const solved = solveCircuit(
        board,
        state.relayEnergized,
        state.contactorEnergized,
        runtimeContacts(state),
      )
      return {
        ...state,
        board,
        solution: solved.solution,
        relayEnergized: solved.relayEnergized,
        contactorEnergized: solved.contactorEnergized,
        coilVoltage: solved.coilVoltage,
        contactorConverged: solved.contactorConverged,
        threePhase: solved.threePhase,
        ...log,
      }
    }
    case 'REPLACE_COMPONENT': {
      const dragged = state.board.components[action.draggedId]
      const occupant = state.board.components[action.occupantId]
      if (!dragged || !occupant || action.draggedId === action.occupantId) return state
      // The occupant is removed; the dragged component takes its cell.
      const components: Board['components'] = {}
      for (const component of Object.values(state.board.components)) {
        if (component.id === action.occupantId) continue
        components[component.id] =
          component.id === action.draggedId
            ? action.projection
              ? {
                  ...component,
                  projectionCells: {
                    ...component.projectionCells,
                    [action.projection]: action.cell,
                  },
                }
              : { ...component, cell: action.cell }
            : component
      }
      // Re-point the occupant's wires onto the dragged component where the
      // terminal index still exists; drop the rest, and any self-loop.
      const draggedTerminals = terminalCountForComponent(dragged)
      const wires: Board['wires'] = {}
      for (const wire of Object.values(state.board.wires)) {
        let from = wire.from
        let to = wire.to
        let keep = true
        if (from.componentId === action.occupantId) {
          if (from.index < draggedTerminals) from = { componentId: action.draggedId, index: from.index }
          else keep = false
        }
        if (to.componentId === action.occupantId) {
          if (to.index < draggedTerminals) to = { componentId: action.draggedId, index: to.index }
          else keep = false
        }
        if (keep && from.componentId === to.componentId) keep = false // no self-loop
        if (keep) wires[wire.id] = { ...wire, from, to }
      }
      const draggedIsContactor = dragged.spec.kind === 'CONTACTOR'
      const mechanicalInterlocks = state.board.mechanicalInterlocks
        ?.map(({ contactorA, contactorB }) => ({
          contactorA: contactorA === action.occupantId && draggedIsContactor ? action.draggedId : contactorA,
          contactorB: contactorB === action.occupantId && draggedIsContactor ? action.draggedId : contactorB,
        }))
        .filter(
          ({ contactorA, contactorB }) =>
            contactorA !== action.occupantId &&
            contactorB !== action.occupantId &&
            contactorA !== contactorB,
        )
      return afterStructuralChange(state, {
        ...state.board,
        components,
        wires,
        mechanicalInterlocks,
      })
    }
    case 'LOAD_BOARD':
      // Replace the whole board (example loader / test seeding). Same semantics
      // as any structural change: the run stops and the readout clears.
      return afterStructuralChange(state, action.board)
    case 'UNDO': {
      if (state.undoStack.length === 0) return state
      const previous = state.undoStack[state.undoStack.length - 1]
      const log = pushEvent(state, { atMs: 0, type: 'RESET' })
      return {
        ...state,
        ...applySnapshot(previous),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, state.board],
        ...log,
      }
    }
    case 'REDO': {
      if (state.redoStack.length === 0) return state
      const next = state.redoStack[state.redoStack.length - 1]
      const log = pushEvent(state, { atMs: 0, type: 'RESET' })
      return {
        ...state,
        ...applySnapshot(next),
        undoStack: [...state.undoStack, state.board],
        redoStack: state.redoStack.slice(0, -1),
        ...log,
      }
    }
    case 'SET_RUNNING': {
      if (action.running && circuitRunRequirements(state.board).length) return state
      if (state.status === 'FAULTED') return state
      const status: CircuitStatus = action.running ? 'RUNNING' : 'PAUSED'
      const log = pushEvent(state, {
        atMs: state.timeMs,
        type: action.running ? 'RUN' : 'PAUSE',
      })
      return { ...state, status, ...log }
    }
    case 'RESET': {
      const log = pushEvent(state, { atMs: 0, type: 'RESET' })
      // A reset drops every latch: relays AND contactors de-energize; the timed
      // sequence and thermal accumulation return to idle. Re-solve from idle.
      const { solution, relayEnergized, contactorEnergized, coilVoltage, contactorConverged, threePhase } =
        solveCircuit(state.board, {}, {})
      return {
        ...state,
        status: 'IDLE',
        timeMs: 0,
        solution,
        relayEnergized,
        contactorEnergized,
        coilVoltage,
        contactorConverged,
        threePhase,
        timerRuntime: {},
        overloadRuntime: {},
        display: zeroDisplay(state.board),
        fault: null,
        ...log,
      }
    }
    case 'RESET_OVERLOAD': {
      // Manual, CONDITIONAL trip reset: only accepted once the element has cooled to
      // ≤ resetThreshold. Otherwise it is rejected (no silent auto-reset). Clearing
      // the latch is a LIVE edit — time does not advance, so the frozen runtime holds.
      const existing = state.board.components[action.id]
      if (!existing || existing.spec.kind !== 'OVERLOAD_RELAY') return state
      const rt = state.overloadRuntime[action.id]
      if (!rt || !rt.tripped) return state
      if (rt.thermalLevel > existing.spec.resetThreshold) return state // too hot → reject
      const overloadRuntime: OverloadRuntime = {
        ...state.overloadRuntime,
        [action.id]: { thermalLevel: rt.thermalLevel, tripped: false },
      }
      const nextExtra: RuntimeContacts = { timer: state.timerRuntime, overload: overloadRuntime, mcb: state.mcbRuntime }
      const sol = solveCircuit(state.board, state.relayEnergized, state.contactorEnergized, nextExtra)
      return {
        ...state,
        solution: sol.solution,
        relayEnergized: sol.relayEnergized,
        contactorEnergized: sol.contactorEnergized,
        coilVoltage: sol.coilVoltage,
        contactorConverged: sol.contactorConverged,
        threePhase: sol.threePhase,
        overloadRuntime,
      }
    }
    case 'RESET_MCB': {
      // Manual, CONDITIONAL trip reset (M3-C3): accepted ONLY when the handle is OFF
      // (on===false) AND the element has cooled to ≤ resetThreshold. After a reset the
      // MCB stays OFF (never auto-closes); the user turns it ON separately. Live edit.
      const existing = state.board.components[action.id]
      if (!existing || (existing.spec.kind !== 'BREAKER_1P' && existing.spec.kind !== 'BREAKER_3P')) return state
      const rt = state.mcbRuntime[action.id]
      if (!rt || !rt.tripped) return state
      if (existing.spec.on) return state // handle still ON → must be OFF to reset
      if (rt.thermalLevel > mcbProtection(existing.spec).resetThreshold) return state // too hot
      const mcbRuntime: McbRuntime = {
        ...state.mcbRuntime,
        [action.id]: { ...rt, tripped: false, tripReason: null },
      }
      const extra: RuntimeContacts = { timer: state.timerRuntime, overload: state.overloadRuntime, mcb: mcbRuntime }
      const sol = solveCircuit(state.board, state.relayEnergized, state.contactorEnergized, extra)
      return {
        ...state,
        solution: sol.solution,
        relayEnergized: sol.relayEnergized,
        contactorEnergized: sol.contactorEnergized,
        coilVoltage: sol.coilVoltage,
        contactorConverged: sol.contactorConverged,
        threePhase: sol.threePhase,
        mcbRuntime,
      }
    }
    case 'TICK':
      return tick(state, action.dtMs)
    default:
      return state
  }
}
