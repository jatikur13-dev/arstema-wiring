import { describe, expect, it } from 'vitest'
import { bridgedPairs } from './conduction'
import { circuitReducer, initialCircuitState } from './engine'
import { createCircuitProject, parseCircuitProject } from './project'
import {
  modelTerminalDefinitions,
  terminalCountForComponent,
  WIRING_MODEL_IDS,
} from './componentModels'
import type { PlacedComponent } from './types'

const component = (
  modelId: string,
  spec: PlacedComponent['spec'],
): PlacedComponent => ({ id: 'X1', cell: { x: 0, y: 0 }, modelId, spec })

describe('catalog model identity', () => {
  it('defines exactly the 64 published palette identities', () => {
    expect(WIRING_MODEL_IDS).toHaveLength(64)
    expect(new Set(WIRING_MODEL_IDS).size).toBe(64)
  })

  it('persists modelId when a palette component is placed', () => {
    const state = circuitReducer(initialCircuitState(), {
      type: 'PLACE_COMPONENT',
      id: 'QF1',
      cell: { x: 1, y: 1 },
      modelId: 'MOTOR_BREAKER_GV2ME14',
      spec: { kind: 'BREAKER_3P', on: false },
    })
    expect(state.board.components.QF1.modelId).toBe('MOTOR_BREAKER_GV2ME14')
  })

  it('never guesses an unknown imported model as a branded product', () => {
    const board = {
      components: {
        X1: component('MADE_UP_PRODUCT', { kind: 'SWITCH', closed: false }),
      },
      wires: {},
    }
    const parsed = parseCircuitProject(JSON.stringify(createCircuitProject(board)))
    expect(parsed?.board.components.X1.modelId).toBeUndefined()
    expect(parsed?.board.components.X1.spec.kind).toBe('SWITCH')
  })
})

describe('manufacturer terminal contracts', () => {
  it('uses all LADN22 2NO+2NC terminals and switches the correct pairs', () => {
    const normal = component('AUX_CONTACT_LADN22', { kind: 'CONTACT_2STATE', actuated: false })
    const actuated = { ...normal, spec: { ...normal.spec, actuated: true } } as PlacedComponent
    expect(modelTerminalDefinitions(normal)?.map((item) => item.designation)).toEqual([
      '53', '54', '61', '62', '71', '72', '83', '84',
    ])
    expect(terminalCountForComponent(normal)).toBe(8)
    expect(bridgedPairs(normal, {})).toEqual([[2, 3], [4, 5]])
    expect(bridgedPairs(actuated, {})).toEqual([[0, 1], [6, 7]])
  })

  it('keeps RM17TG20 phase inputs isolated and operates both CO outputs', () => {
    const healthy = component('PHASE_MONITOR_RM17TG20', { kind: 'CONTACT_2STATE', actuated: true })
    const fault = { ...healthy, spec: { ...healthy.spec, actuated: false } } as PlacedComponent
    expect(terminalCountForComponent(healthy)).toBe(9)
    expect(bridgedPairs(healthy, {})).toEqual([[3, 5], [6, 8]])
    expect(bridgedPairs(fault, {})).toEqual([[3, 4], [6, 7]])
  })

  it('uses the official XB5 terminal markings rather than D4N markings', () => {
    const station = component('PUSHBUTTON_STATION_XB5AL73415', { kind: 'LIMIT_SWITCH', actuated: false })
    expect(modelTerminalDefinitions(station)?.map((item) => item.designation)).toEqual(['21', '22', '13', '14'])
    const illuminated = component('ILLUMINATED_PB_XB5AW33B5', {
      kind: 'LIMIT_SWITCH',
      actuated: false,
      lampResistanceOhms: 24 / 0.018,
    })
    expect(modelTerminalDefinitions(illuminated)?.map((item) => item.designation)).toEqual([
      '21', '22', '13', '14', 'X1', 'X2',
    ])
    expect(terminalCountForComponent(illuminated)).toBe(6)
  })

  it('keeps the H3CR-A8 octal socket pin contract in solver index order', () => {
    const timer = component('TIMER_H3CR_A8', {
      kind: 'TIMER',
      model: 'OMRON_H3CR_A8',
      mode: 'A',
      starDurationMs: 1000,
      transitionDelayMs: 0,
    })
    expect(modelTerminalDefinitions(timer)?.map((item) => item.designation)).toEqual([
      '2', '7', '1', '4', '8', '6', '3', '5',
    ])
    expect(terminalCountForComponent(timer)).toBe(8)
  })

  it('models the 9037 float as two ganged poles that open on liquid rise', () => {
    const low = component('FLOAT_SWITCH_9037HG33', { kind: 'CONTACT_2STATE', actuated: false })
    const high = { ...low, spec: { ...low.spec, actuated: true } } as PlacedComponent
    expect(modelTerminalDefinitions(low)?.map((item) => item.designation)).toEqual(['1', '2', '3', '4'])
    expect(bridgedPairs(low, {})).toEqual([[0, 1], [2, 3]])
    expect(bridgedPairs(high, {})).toEqual([])
  })

  it('uses the XMLB separate NO/NC terminal pairs and the NSY thermostat NC pair', () => {
    const pressureNormal = component('PRESSURE_SWITCH_XMLB004', { kind: 'CONTACT_2STATE', actuated: false })
    const pressureHigh = { ...pressureNormal, spec: { ...pressureNormal.spec, actuated: true } } as PlacedComponent
    const thermostatNormal = component('THERMOSTAT_NSYCCOTHC', { kind: 'CONTACT_2STATE', actuated: false })
    const thermostatHigh = { ...thermostatNormal, spec: { ...thermostatNormal.spec, actuated: true } } as PlacedComponent
    expect(modelTerminalDefinitions(pressureNormal)?.map((item) => item.designation)).toEqual(['13', '14', '11', '12'])
    expect(bridgedPairs(pressureNormal, {})).toEqual([[2, 3]])
    expect(bridgedPairs(pressureHigh, {})).toEqual([[0, 1]])
    expect(modelTerminalDefinitions(thermostatNormal)?.map((item) => item.designation)).toEqual(['1', '2'])
    expect(bridgedPairs(thermostatNormal, {})).toEqual([[0, 1]])
    expect(bridgedPairs(thermostatHigh, {})).toEqual([])
  })

  it('uses explicit simulator aliases rather than invented factory numbers on CLIPLINE blocks', () => {
    expect(modelTerminalDefinitions({ modelId: 'TERMINAL_UT25_BU' })?.map((item) => item.designation)).toEqual(['A', 'B'])
    expect(modelTerminalDefinitions({ modelId: 'TERMINAL_UT25_TWIN' })?.map((item) => item.designation)).toEqual(['A', 'B', 'C'])
    expect(modelTerminalDefinitions({ modelId: 'TERMINAL_UT25_QUATTRO' })?.map((item) => item.designation)).toEqual(['A', 'B', 'C', 'D'])
    expect(modelTerminalDefinitions({ modelId: 'TERMINAL_UT25_PE_LL' })?.map((item) => item.designation)).toEqual([
      'PE-A', 'PE-B', 'L1-A', 'L1-B', 'L2-A', 'L2-B',
    ])
  })
})
