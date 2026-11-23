import { describe, expect, it } from 'vitest'
import { bridgedPairs, multifunctionTimerOutputOn } from './conduction'
import { circuitReducer, initialCircuitState } from './engine'
import type { Board, PlacedComponent } from './types'

const timer = (mode: 'A' | 'B' | 'B2' | 'E' | 'J'): PlacedComponent => ({
  id: 'KT', cell: { x: 1, y: 0 },
  spec: { kind: 'TIMER', model: 'OMRON_H3CR_A8', mode, starDurationMs: 1000, transitionDelayMs: 0 },
})

describe('Omron H3CR-A8 educational timing modes', () => {
  it('implements A/B/B2/E/J output timing deterministically', () => {
    expect(multifunctionTimerOutputOn(999, timer('A').spec as never)).toBe(false)
    expect(multifunctionTimerOutputOn(1000, timer('A').spec as never)).toBe(true)
    expect(multifunctionTimerOutputOn(500, timer('B').spec as never)).toBe(false)
    expect(multifunctionTimerOutputOn(1500, timer('B').spec as never)).toBe(true)
    expect(multifunctionTimerOutputOn(500, timer('B2').spec as never)).toBe(true)
    expect(multifunctionTimerOutputOn(1500, timer('B2').spec as never)).toBe(false)
    expect(multifunctionTimerOutputOn(500, timer('E').spec as never)).toBe(true)
    expect(multifunctionTimerOutputOn(1500, timer('E').spec as never)).toBe(false)
    expect(multifunctionTimerOutputOn(500, timer('J').spec as never)).toBe(false)
    expect(multifunctionTimerOutputOn(1500, timer('J').spec as never)).toBe(true)
    expect(multifunctionTimerOutputOn(2500, timer('J').spec as never)).toBe(false)
  })

  it('moves both SPDT outputs together after ON-delay', () => {
    expect(bridgedPairs(timer('A'), {}, {}, { timer: { KT: { running: true, elapsedMs: 500 } } })).toEqual([[2, 3], [4, 7]])
    expect(bridgedPairs(timer('A'), {}, {}, { timer: { KT: { running: true, elapsedMs: 1000 } } })).toEqual([[2, 6], [4, 5]])
  })

  it('runs from a 24 VDC source instead of requiring the 3-phase solver', () => {
    const board: Board = {
      components: {
        PS: { id: 'PS', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 24, tripAmps: 2, sourceType: 'din_psu_24vdc' } },
        KT: timer('A'),
      },
      wires: {
        p: { id: 'p', from: { componentId: 'PS', index: 0 }, to: { componentId: 'KT', index: 0 } },
        n: { id: 'n', from: { componentId: 'KT', index: 1 }, to: { componentId: 'PS', index: 1 } },
      },
    }
    let state = initialCircuitState(board)
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = circuitReducer(state, { type: 'TICK', dtMs: 20 })
    expect(state.timerRuntime.KT).toEqual({ running: true, elapsedMs: 20 })
    state = circuitReducer(state, { type: 'SET_TIMER_MODE', id: 'KT', mode: 'B2' })
    expect(state.board.components.KT.spec).toMatchObject({ model: 'OMRON_H3CR_A8', mode: 'B2' })
    expect(state.timerRuntime).toEqual({})
  })
})
