/**
 * Star–delta timer (M3-C2) — the timed sequence is TIME-STEPPED: `elapsedMs`
 * advances ONLY under `tick` while the coil is energized, and a plain solve reads
 * the phase frozen. `timerPhase` is the pure STAR→OPEN→DELTA classifier.
 */
import { describe, expect, it } from 'vitest'
import type { Board } from './types'
import { TIMER_TERMINAL, terminalKey } from './types'
import { bridgedPairs, timerPhase } from './conduction'
import {
  buildCircuitRuntimeNodes,
  circuitReducer,
  initialCircuitState,
  type CircuitState,
} from './engine'

const SRC3 = { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 16 } as const
const spec = (starDurationMs: number, transitionDelayMs: number) =>
  ({ kind: 'TIMER', starDurationMs, transitionDelayMs }) as const

/** A timer whose coil sits across R–N, so it energizes and runs. */
function timerBoard(starDurationMs: number, transitionDelayMs: number, wireCoil = true): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SRC3 } },
      KT: { id: 'KT', cell: { x: 2, y: 0 }, spec: spec(starDurationMs, transitionDelayMs) },
    },
    wires: wireCoil
      ? {
          a1: { id: 'a1', from: { componentId: 'KT', index: 0 }, to: { componentId: 'Q', index: 0 } },
          a2: { id: 'a2', from: { componentId: 'KT', index: 1 }, to: { componentId: 'Q', index: 3 } },
        }
      : {},
  }
}
const runTicks = (s: CircuitState, n: number, dt = 100): CircuitState => {
  for (let i = 0; i < n; i += 1) s = circuitReducer(s, { type: 'TICK', dtMs: dt })
  return s
}

describe('timerPhase (pure)', () => {
  const p = { starDurationMs: 300, transitionDelayMs: 100 }
  it('STAR before starDuration, OPEN in the dead-time, DELTA after', () => {
    expect(timerPhase(0, p)).toBe('STAR')
    expect(timerPhase(299, p)).toBe('STAR')
    expect(timerPhase(300, p)).toBe('OPEN') // dead-time starts inclusively
    expect(timerPhase(399, p)).toBe('OPEN')
    expect(timerPhase(400, p)).toBe('DELTA')
  })
})

describe('timer physical changeover terminals', () => {
  const timer = {
    id: 'KT',
    cell: { x: 0, y: 0 },
    spec: spec(300, 100),
  } as const

  it('makes all eight screws functional with break-before-make switching', () => {
    expect(bridgedPairs(timer, {}, {}, { timer: { KT: { elapsedMs: 0, running: false } } }))
      .toEqual([[2, 3], [4, 7]]) // 15-16 and 25-26
    expect(bridgedPairs(timer, {}, {}, { timer: { KT: { elapsedMs: 0, running: true } } }))
      .toEqual([[2, 6], [4, 7]]) // STAR command: 15-18; delta group rests 25-26
    expect(bridgedPairs(timer, {}, {}, { timer: { KT: { elapsedMs: 350, running: true } } }))
      .toEqual([[2, 3], [4, 7]]) // transfer: neither command NO is closed
    expect(bridgedPairs(timer, {}, {}, { timer: { KT: { elapsedMs: 400, running: true } } }))
      .toEqual([[2, 3], [4, 5]]) // DELTA command: 25-28; star group rests 15-16
  })
})

describe('timer runtime (time-stepped)', () => {
  const p = { starDurationMs: 300, transitionDelayMs: 100 }

  it('runs while energized; elapsed advances only under TICK', () => {
    let s = initialCircuitState(timerBoard(300, 100))
    expect(s.timerRuntime.KT?.elapsedMs ?? 0).toBe(0)
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 2) // 200 ms
    expect(s.timerRuntime.KT.running).toBe(true)
    expect(s.timerRuntime.KT.elapsedMs).toBe(200)
    expect(timerPhase(s.timerRuntime.KT.elapsedMs, p)).toBe('STAR')
    s = runTicks(s, 1) // 300 → dead-time
    expect(timerPhase(s.timerRuntime.KT.elapsedMs, p)).toBe('OPEN')
    s = runTicks(s, 2) // 500 → delta
    expect(timerPhase(s.timerRuntime.KT.elapsedMs, p)).toBe('DELTA')
  })

  it('exposes the same timed contact topology to runtime UI measurements', () => {
    const base = initialCircuitState(timerBoard(300, 100))
    const state: CircuitState = {
      ...base,
      timerRuntime: { KT: { elapsedMs: 0, running: true } },
    }
    const nodes = buildCircuitRuntimeNodes(state)
    const node = (index: number) => nodes.nodeOf.get(terminalKey({ componentId: 'KT', index }))

    expect(node(TIMER_TERMINAL.STAR_COMMON_15)).toBe(node(TIMER_TERMINAL.STAR_NO_18))
    expect(node(TIMER_TERMINAL.STAR_COMMON_15)).not.toBe(node(TIMER_TERMINAL.STAR_NC_16))
    expect(node(TIMER_TERMINAL.DELTA_COMMON_25)).toBe(node(TIMER_TERMINAL.DELTA_NC_26))
  })

  it('SEPARATION: a paused board does not advance elapsed on TICK', () => {
    let s = initialCircuitState(timerBoard(300, 100))
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 2)
    expect(s.timerRuntime.KT.elapsedMs).toBe(200)
    s = circuitReducer(s, { type: 'SET_RUNNING', running: false }) // pause
    s = circuitReducer(s, { type: 'TICK', dtMs: 100 }) // ignored while not RUNNING
    expect(s.timerRuntime.KT.elapsedMs).toBe(200) // frozen — time did not advance
  })

  it('a de-energized timer coil never runs and resets elapsed to 0', () => {
    let s = initialCircuitState(timerBoard(300, 100, /* wireCoil */ false))
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 3)
    expect(s.timerRuntime.KT.running).toBe(false)
    expect(s.timerRuntime.KT.elapsedMs).toBe(0)
  })

  it('updates STAR and transition timing, resets runtime, and remains undoable', () => {
    let s = initialCircuitState(timerBoard(300, 100))
    s = circuitReducer(s, { type: 'SET_RUNNING', running: true })
    s = runTicks(s, 2)
    expect(s.timerRuntime.KT.elapsedMs).toBe(200)

    s = circuitReducer(s, {
      type: 'SET_TIMER_TIMING',
      id: 'KT',
      starDurationMs: 65_500,
      transitionDelayMs: 230,
    })
    const changed = s.board.components.KT.spec
    expect(changed.kind === 'TIMER' && changed.starDurationMs).toBe(65_500)
    expect(changed.kind === 'TIMER' && changed.transitionDelayMs).toBe(250)
    expect(s.status).toBe('IDLE')
    expect(s.timerRuntime).toEqual({})

    s = circuitReducer(s, { type: 'UNDO' })
    const restored = s.board.components.KT.spec
    expect(restored.kind === 'TIMER' && restored.starDurationMs).toBe(300)
    expect(restored.kind === 'TIMER' && restored.transitionDelayMs).toBe(100)
  })

  it('clamps invalid timing before it reaches the sequence model', () => {
    let s = initialCircuitState(timerBoard(300, 100))
    s = circuitReducer(s, {
      type: 'SET_TIMER_TIMING',
      id: 'KT',
      starDurationMs: -1,
      transitionDelayMs: -1,
    })
    const changed = s.board.components.KT.spec
    expect(changed.kind === 'TIMER' && changed.starDurationMs).toBe(1_000)
    expect(changed.kind === 'TIMER' && changed.transitionDelayMs).toBe(50)
  })
})
