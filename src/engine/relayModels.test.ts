import { describe, expect, it } from 'vitest'
import { bridgedPairs } from './conduction'
import {
  relayDefinition,
  relayConductingPairs,
  RELAY_MODEL_DEFINITIONS,
} from './relayModels'
import { terminalCountForSpec, type RelayModel, type RelaySpec } from './types'

const spec = (model: RelayModel): RelaySpec => ({
  kind: 'RELAY',
  model,
  coilResistanceOhms: 2200,
  pickupAmps: 0.05,
})

describe('manufacturer-backed relay terminal maps', () => {
  it.each([
    ['OMRON_MY2_8PIN', 8, ['1', '4', '5', '8', '9', '12', '13', '14']],
    ['OMRON_MY3_11PIN', 11, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']],
    ['OMRON_MY4_14PIN', 14, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14']],
    ['OMRON_G5V2_8PIN', 8, ['1', '4', '6', '8', '9', '11', '13', '16']],
  ] as const)('%s exposes %i physical terminals and exact manufacturer designations', (model, count, pins) => {
    const relay = spec(model)
    const definition = relayDefinition(relay)
    expect(terminalCountForSpec(relay)).toBe(count)
    expect(definition.physicalPinCount).toBe(count)
    expect(definition.terminals.map((terminal) => terminal.pin).sort((a, b) => Number(a) - Number(b)))
      .toEqual([...pins])
  })

  it('G5V-2 has eight physical pins even though one manufacturer designation is 16', () => {
    const definition = RELAY_MODEL_DEFINITIONS.OMRON_G5V2_8PIN
    expect(definition.physicalPinCount).toBe(8)
    expect(definition.terminals.some((terminal) => terminal.pin === '16')).toBe(true)
  })

  it('MY2 changes every COM from NC to NO when its coil energizes', () => {
    const relay = spec('OMRON_MY2_8PIN')
    expect(relayConductingPairs(relay, false)).toEqual([[2, 6], [4, 5]])
    expect(relayConductingPairs(relay, true)).toEqual([[2, 3], [4, 7]])
  })

  it('G5V-2 uses pins 4/13 as COM, 6/11 as NC, and 8/9 as NO', () => {
    const relay = spec('OMRON_G5V2_8PIN')
    const definition = relayDefinition(relay)
    const pin = (index: number) => definition.terminals[index].pin
    expect(relayConductingPairs(relay, false).map(([a, b]) => [pin(a), pin(b)]))
      .toEqual([['4', '6'], ['13', '11']])
    expect(relayConductingPairs(relay, true).map(([a, b]) => [pin(a), pin(b)]))
      .toEqual([['4', '8'], ['13', '9']])
  })

  it('the shared conduction engine reads the model-specific contacts', () => {
    const component = {
      id: 'K1',
      cell: { x: 0, y: 0 },
      spec: spec('OMRON_MY4_14PIN'),
    }
    expect(bridgedPairs(component, { K1: false })).toHaveLength(4)
    expect(bridgedPairs(component, { K1: true })).toEqual([[2, 3], [5, 6], [8, 9], [11, 12]])
  })
})
