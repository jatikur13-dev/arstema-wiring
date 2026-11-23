/**
 * useCircuitLab — binds the pure engine to React.
 *
 * The engine stays deterministic: wall time is accumulated into FIXED 20 ms
 * TICK actions. Several actions may be batched into one React/SVG commit, so a
 * high-refresh display cannot accelerate electrical time and a low-end phone
 * does not have to reconcile the complete board on every display refresh.
 */

import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { structuralAction } from './structuralGuard'
import type { CircuitAction } from '../../engine/engine'
import { useWiringServices } from '../../runtime/services'
import {
  circuitReducer,
  emptyBoard,
  initialCircuitState,
  type Board,
  type BoardProjection,
  type Cell,
  type ComponentId,
  type ComponentSpec,
  type McbRatedCurrent,
  type Terminal,
  type WireTap,
} from '../../engine/index'
import { ID_PREFIX } from '../scenario/topic1a'
import { footprintCollides } from '../board/geometry'
import {
  advanceSimulationClock,
  CIRCUIT_SIMULATION_STEP_MS,
  INITIAL_SIMULATION_CLOCK,
} from './simulationClock'
import {
  browserCircuitDeviceSignals,
  selectCircuitRenderProfile,
} from './renderProfile'

/**
 * A fresh, collision-free id: monotonic per key (never reused in a session) AND
 * never equal to an id already present in `taken`. This is what keeps "add a wire"
 * (or "place a component") from ever clobbering an existing entry when the board
 * was seeded with the same id prefix (e.g. an initial test board with wires
 * w1,w2,w3) — the
 * overwrite the tap feature exposed. Module-scope so it is not a hook dependency.
 */
function freshId(
  counters: Record<string, number>,
  key: string,
  prefix: string,
  taken: Record<string, unknown>,
): string {
  let n = (counters[key] ?? 0) + 1
  while (taken[`${prefix}${n}`] !== undefined) n += 1
  counters[key] = n
  return `${prefix}${n}`
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export function useCircuitLab(initialBoard?: Board) {
  const {notify:showToast,active}=useWiringServices()
  const [state, rawDispatch] = useReducer(
    circuitReducer,
    initialBoard,
    (board) => initialCircuitState(board ?? emptyBoard()),
  )
  const editLock = useRef(false)
  const running = useRef(false); running.current = state.status === 'RUNNING'
  const dispatch = useCallback((action: CircuitAction) => {
    if (structuralAction(action) && (editLock.current || running.current)) {
      showToast('Rakit semua dan jeda simulasi sebelum mengedit wiring.'); return;
    }
    rawDispatch(action)
  }, [])
  const counters = useRef<Record<string, number>>({})
  // Latest board, readable inside stable callbacks — so a generated id can skip
  // any id ALREADY on the board (an injected test board or prior edits) instead of blindly
  // reusing a counter value and overwriting an existing wire/component.
  const boardRef = useRef(state.board)
  boardRef.current = state.board
  useEffect(()=>{
    const pause=()=>{if(document.hidden)rawDispatch({type:'SET_RUNNING',running:false});};
    if(!active)rawDispatch({type:'SET_RUNNING',running:false});
    document.addEventListener('visibilitychange',pause);return()=>document.removeEventListener('visibilitychange',pause);
  },[active])
  const prefersReducedMotion = usePrefersReducedMotion()
  const [renderProfile] = useState(() =>
    selectCircuitRenderProfile(browserCircuitDeviceSignals()),
  )

  useEffect(() => {
    if (state.status !== 'RUNNING'||!active) return
    if (typeof requestAnimationFrame === 'undefined') return
    let raf = 0
    let previousTimestamp: number | null = null
    let clock = INITIAL_SIMULATION_CLOCK
    const frame = (timestamp: number) => {
      if(document.hidden){previousTimestamp=null;raf=requestAnimationFrame(frame);return;}
      if (previousTimestamp !== null) {
        const batch = advanceSimulationClock(
          clock,
          timestamp - previousTimestamp,
          1000 / renderProfile.maxFps,
        )
        clock = batch.clock
        // React 18 batches these reducer actions into one visible commit while the
        // pure engine still observes every fixed step in its original order.
        for (let step = 0; step < batch.steps; step += 1) {
          dispatch({ type: 'TICK', dtMs: CIRCUIT_SIMULATION_STEP_MS })
        }
      }
      previousTimestamp = timestamp
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [renderProfile.maxFps, state.status,active])

  const place = useCallback((spec: ComponentSpec, cell: Cell, modelId?: string): string | null => {
    if (editLock.current || running.current) return null
    // A new component initially appears at the same fallback cell in both drawings.
    // Reject only when either projection would overlap; later moves are independent.
    if (
      footprintCollides(boardRef.current, spec.kind, cell, undefined, 'virtual') ||
      footprintCollides(boardRef.current, spec.kind, cell, undefined, 'iec')
    ) return null
    const kind = spec.kind
    const id = freshId(counters.current, kind, ID_PREFIX[kind], boardRef.current.components)
    dispatch({ type: 'PLACE_COMPONENT', id, cell, spec: { ...spec }, modelId })
    return id
  }, [])

  const connect = useCallback((from: Terminal, to: Terminal, tap?: WireTap) => {
    // A new wire ALWAYS gets a fresh id — never one already on the board — so
    // adding a wire (terminal→terminal OR a tap) can never overwrite an existing
    // one. Many wires may share a node; none clobbers another. A `tap` rides along
    // as one CONNECT so tapping a wire is a single undoable step.
    const id = freshId(counters.current, 'wire', 'w', boardRef.current.wires)
    dispatch({ type: 'CONNECT', id, from, to, ...(tap ? { tap } : {}) })
  }, [])

  const removeComponent = useCallback((id: string) => {
    dispatch({ type: 'REMOVE_COMPONENT', id })
  }, [])

  const disconnect = useCallback((id: string) => {
    dispatch({ type: 'DISCONNECT', id })
  }, [])

  const move = useCallback((id: ComponentId, cell: Cell, projection?: BoardProjection): boolean => {
    if (editLock.current || running.current) return false
    const component = boardRef.current.components[id]
    if (
      !component ||
      footprintCollides(
        boardRef.current,
        component.spec.kind,
        cell,
        id,
        projection ?? 'iec',
      )
    ) {
      return false
    }
    dispatch({ type: 'MOVE_COMPONENT', id, cell, ...(projection ? { projection } : {}) })
    return true
  }, [])

  const replace = useCallback((draggedId: ComponentId, occupantId: ComponentId, cell: Cell, projection?: BoardProjection): boolean => {
    if (editLock.current || running.current) return false
    const dragged = boardRef.current.components[draggedId]
    const occupant = boardRef.current.components[occupantId]
    if (!dragged || !occupant) return false
    const remaining = { ...boardRef.current.components }
    delete remaining[occupantId]
    const withoutOccupant: Board = { ...boardRef.current, components: remaining }
    if (
      footprintCollides(
        withoutOccupant,
        dragged.spec.kind,
        cell,
        draggedId,
        projection ?? 'iec',
      )
    ) return false
    dispatch({
      type: 'REPLACE_COMPONENT',
      draggedId,
      occupantId,
      cell,
      ...(projection ? { projection } : {}),
    })
    return true
  }, [])

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), [])
  const redo = useCallback(() => dispatch({ type: 'REDO' }), [])

  const toggle = useCallback((id: string) => {
    dispatch({ type: 'TOGGLE_SWITCH', id })
  }, [])

  const setMcbRating = useCallback((id: string, ratedAmps: McbRatedCurrent) => {
    dispatch({ type: 'SET_MCB_RATING', id, ratedAmps })
  }, [])

  const setTimerTiming = useCallback(
    (id: string, starDurationMs: number, transitionDelayMs: number) => {
      dispatch({ type: 'SET_TIMER_TIMING', id, starDurationMs, transitionDelayMs })
    },
    [],
  )

  const setTimerMode = useCallback((id: string, mode: 'A' | 'B' | 'B2' | 'E' | 'J') => {
    dispatch({ type: 'SET_TIMER_MODE', id, mode })
  }, [])

  const resetOverload = useCallback((id: string) => {
    dispatch({ type: 'RESET_OVERLOAD', id })
  }, [])

  const resetMcb = useCallback((id: string) => {
    dispatch({ type: 'RESET_MCB', id })
  }, [])

  const press = useCallback((id: string, pressed: boolean) => {
    dispatch({ type: 'PRESS_PUSHBUTTON', id, pressed })
  }, [])

  const pressProductControl = useCallback((
    id: string,
    control: 'START' | 'STOP' | 'ACTUATOR',
    pressed: boolean,
  ) => {
    dispatch({ type: 'PRESS_PRODUCT_CONTROL', id, control, pressed })
  }, [])

  const setRunning = useCallback((running: boolean) => {
    dispatch({ type: 'SET_RUNNING', running })
  }, [])

  const reset = useCallback(() => dispatch({ type: 'RESET' }), [])

  const clearBoard = useCallback(() => {
    counters.current = {}
    dispatch({ type: 'LOAD_BOARD', board: emptyBoard() })
  }, [])

  /**
   * Replace the board with a worked example.
   *
   * The id counters reset with it, exactly as clearBoard does — a loaded
   * example brings its own component ids, and carrying the previous board's
   * counters would let a newly placed part collide with one of them.
   */
  const loadBoard = useCallback((board: Board) => {
    counters.current = {}
    dispatch({ type: 'LOAD_BOARD', board })
  }, [])

  return {
    setStructuralLocked: (locked: boolean) => { editLock.current = locked },
    initialize3d: () => dispatch({ type: 'INITIALIZE_PANEL_3D' }),
    move3d: (id: string, placement: import('../../engine/board3d.ts').PanelPlacement3D) => dispatch({ type: 'MOVE_COMPONENT_3D', id, placement }),
    state,
    prefersReducedMotion,
    renderProfile,
    place,
    connect,
    removeComponent,
    disconnect,
    move,
    replace,
    setMcbRating,
    setTimerTiming,
    setTimerMode,
    undo,
    redo,
    toggle,
    press,
    pressProductControl,
    setRunning,
    reset,
    resetOverload,
    resetMcb,
    clearBoard,
    loadBoard,
  }
}
