import { describe, expect, it } from 'vitest'
import { circuitReducer, initialCircuitState } from './engine'
import type { Board } from './types'

describe('industrial catalog protection semantics', () => {
  it('never invents an over-current trip for a switch-disconnector', () => {
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 24, tripAmps: 100 } },
        QS: { id: 'QS', cell: { x: 1, y: 0 }, spec: { kind: 'BREAKER_1P', on: true, ratedAmps: 6, protectionDisabled: true } },
        R: { id: 'R', cell: { x: 2, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 1, ratedCurrentAmps: 100 } },
      },
      wires: {
        a: { id: 'a', from: { componentId: 'S', index: 0 }, to: { componentId: 'QS', index: 0 } },
        b: { id: 'b', from: { componentId: 'QS', index: 1 }, to: { componentId: 'R', index: 0 } },
        c: { id: 'c', from: { componentId: 'R', index: 1 }, to: { componentId: 'S', index: 1 } },
      },
    }
    let state = initialCircuitState(board)
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    for (let i = 0; i < 100; i += 1) state = circuitReducer(state, { type: 'TICK', dtMs: 20 })
    expect(state.mcbRuntime.QS?.tripped).toBe(false)
    expect(state.mcbRuntime.QS?.thermalLevel).toBe(0)
  })
})
