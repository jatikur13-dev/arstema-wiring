import { describe, expect, it } from 'vitest'
import { bridgedPairs } from './conduction'
import { circuitReducer, initialCircuitState } from './engine'
import {
  deriveAutomaticProductActuation,
  solveCircuit,
} from './solve'
import type { Board, PlacedComponent, Wire } from './types'

const component = (
  id: string,
  modelId: string,
  spec: PlacedComponent['spec'],
): PlacedComponent => ({ id, modelId, cell: { x: 0, y: 0 }, spec })

const wire = (
  id: string,
  fromId: string,
  fromIndex: number,
  toId: string,
  toIndex: number,
): Wire => ({
  id,
  from: { componentId: fromId, index: fromIndex },
  to: { componentId: toId, index: toIndex },
})

describe('source-backed industrial product semantics', () => {
  it('operates XB5AL73415 START and STOP as independent spring-return heads', () => {
    const station = component('S1', 'PUSHBUTTON_STATION_XB5AL73415', {
      kind: 'LIMIT_SWITCH',
      actuated: false,
      startPressed: false,
      stopPressed: false,
    })
    let state = initialCircuitState({ components: { S1: station }, wires: {} })

    expect(bridgedPairs(state.board.components.S1, {})).toEqual([[0, 1]])
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'START', pressed: true,
    })
    expect(bridgedPairs(state.board.components.S1, {})).toEqual([[0, 1], [2, 3]])
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'STOP', pressed: true,
    })
    expect(bridgedPairs(state.board.components.S1, {})).toEqual([[2, 3]])
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'START', pressed: false,
    })
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'STOP', pressed: false,
    })
    expect(bridgedPairs(state.board.components.S1, {})).toEqual([[0, 1]])
  })

  it('models XB5AW33B5 X1-X2 as an explicit 18 mA pilot-light branch at 24 V', () => {
    const board: Board = {
      components: {
        PS: component('PS', 'BATTERY_24V', {
          kind: 'SOURCE', emfVolts: 24, tripAmps: 2, sourceType: 'battery_dc',
        }),
        PB: component('PB', 'ILLUMINATED_PB_XB5AW33B5', {
          kind: 'LIMIT_SWITCH', actuated: false, lampResistanceOhms: 24 / 0.018,
        }),
      },
      wires: {
        W1: wire('W1', 'PS', 0, 'PB', 4),
        W2: wire('W2', 'PB', 5, 'PS', 1),
      },
    }
    const result = solveCircuit(board).solution
    expect(result.loadCurrent.PB).toBeCloseTo(0.018, 8)
    expect(result.sourceCurrent).toBeCloseTo(0.018, 8)
    let state = initialCircuitState(board)
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = circuitReducer(state, { type: 'TICK', dtMs: 100 })
    expect(state.display.loadCurrent.PB).toBeCloseTo(0.018, 8)
  })

  it('derives RM17TG20 healthy/fault from ideal L1-L2-L3 presence and order', () => {
    const source = component('Q', 'SOURCE_3PH', {
      kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 32,
    })
    const monitor = component('PM', 'PHASE_MONITOR_RM17TG20', {
      kind: 'CONTACT_2STATE', actuated: false,
    })
    const base: Board = {
      domain: 'ac-three-phase-balanced',
      components: { Q: source, PM: monitor },
      wires: {
        R: wire('R', 'Q', 0, 'PM', 0),
        S: wire('S', 'Q', 1, 'PM', 1),
        T: wire('T', 'Q', 2, 'PM', 2),
      },
    }
    expect(deriveAutomaticProductActuation(base).PM).toBe(true)
    expect(bridgedPairs(monitor, {}, {}, { productActuated: { PM: true } })).toEqual([
      [3, 5], [6, 8],
    ])

    const missing: Board = { ...base, wires: { R: base.wires.R, S: base.wires.S } }
    expect(deriveAutomaticProductActuation(missing).PM).toBe(false)

    const swapped: Board = {
      ...base,
      wires: {
        R: wire('R', 'Q', 0, 'PM', 1),
        S: wire('S', 'Q', 1, 'PM', 0),
        T: base.wires.T,
      },
    }
    expect(deriveAutomaticProductActuation(swapped).PM).toBe(false)
  })

  it('keeps RM17TG20 immune to a manual toggle override', () => {
    const board: Board = {
      components: {
        PM: component('PM', 'PHASE_MONITOR_RM17TG20', {
          kind: 'CONTACT_2STATE', actuated: false,
        }),
      },
      wires: {},
    }
    const state = initialCircuitState(board)
    const next = circuitReducer(state, { type: 'TOGGLE_SWITCH', id: 'PM' })
    expect(next).toBe(state)
  })
})
