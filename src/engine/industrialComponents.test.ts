import { describe, expect, it } from 'vitest'
import type { Board, ComponentSpec, PlacedComponent, Terminal } from './types'
import { TERMINAL_COUNT, terminalCountForSpec } from './types'
import { bridgedPairs, resistiveBranch } from './conduction'
import { solveBoard } from './solve'

const placed = (spec: ComponentSpec, id = 'X'): PlacedComponent => ({
  id,
  cell: { x: 0, y: 0 },
  spec,
})
const term = (componentId: string, index: number): Terminal => ({ componentId, index })
const wire = (id: string, from: Terminal, to: Terminal) => ({ id, from, to })

const sensor = (
  output: 'PNP' | 'NPN',
  normallyOpen: boolean,
  actuated: boolean,
): ComponentSpec => ({
  kind: 'SENSOR_3WIRE',
  technology: 'inductive',
  output,
  normallyOpen,
  actuated,
  supplyResistanceOhms: 2400,
})

describe('industrial terminal contracts', () => {
  it('uses the exact terminal counts exposed by the field devices', () => {
    expect(TERMINAL_COUNT.LIMIT_SWITCH).toBe(4)
    expect(TERMINAL_COUNT.SENSOR_3WIRE).toBe(3)
    expect(TERMINAL_COUNT.TERMINAL_BLOCK).toBe(2)
    expect(terminalCountForSpec(sensor('PNP', true, false))).toBe(3)
  })

  it('keeps a one-position terminal block at one electrical potential', () => {
    expect(bridgedPairs(placed({ kind: 'TERMINAL_BLOCK' }), {})).toEqual([[0, 1]])
  })

  it('models Phoenix multi-conductor and multilevel potentials without false joins', () => {
    const twin = { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_TWIN' } as const
    const quattro = { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_QUATTRO' } as const
    const multilevel = { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_PE_L_L' } as const
    expect(terminalCountForSpec(twin)).toBe(3)
    expect(terminalCountForSpec(quattro)).toBe(4)
    expect(terminalCountForSpec(multilevel)).toBe(6)
    expect(bridgedPairs(placed(twin), {})).toEqual([[0, 1], [0, 2]])
    expect(bridgedPairs(placed(quattro), {})).toEqual([[0, 1], [0, 2], [0, 3]])
    expect(bridgedPairs(placed(multilevel), {})).toEqual([[0, 1], [2, 3], [4, 5]])
  })

  it('opens fuse and knife-disconnect terminal blocks without changing their pin contract', () => {
    const fused = (open: boolean, fuseBlown = false) => placed({
      kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT4_HESI', open, fuseBlown,
    })
    expect(bridgedPairs(fused(false), {})).toEqual([[0, 1]])
    expect(bridgedPairs(fused(true), {})).toEqual([])
    expect(bridgedPairs(fused(false, true), {})).toEqual([])
    expect(bridgedPairs(placed({ kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT4_MT', open: true }), {})).toEqual([])
  })

  it('D4N 1NC/1NO closes only 11-12 normal or 33-34 actuated', () => {
    expect(bridgedPairs(placed({ kind: 'LIMIT_SWITCH', actuated: false }), {})).toEqual([[0, 1]])
    expect(bridgedPairs(placed({ kind: 'LIMIT_SWITCH', actuated: true }), {})).toEqual([[2, 3]])
  })
})

describe('DC 3-wire sensor output topology', () => {
  it('PNP sources pin 1 to pin 4 and NPN sinks pin 4 to pin 3', () => {
    expect(bridgedPairs(placed(sensor('PNP', true, true)), {})).toEqual([[0, 2]])
    expect(bridgedPairs(placed(sensor('NPN', true, true)), {})).toEqual([[1, 2]])
  })

  it('NO and NC invert conduction without changing PNP/NPN polarity', () => {
    expect(bridgedPairs(placed(sensor('PNP', true, false)), {})).toEqual([])
    expect(bridgedPairs(placed(sensor('PNP', false, false)), {})).toEqual([[0, 2]])
    expect(bridgedPairs(placed(sensor('PNP', false, true)), {})).toEqual([])
  })

  it('models only an explicit educational supply draw between pins 1 and 3', () => {
    expect(resistiveBranch(placed(sensor('PNP', true, false)), {})).toEqual({
      a: 0,
      b: 1,
      resistance: 2400,
    })
  })
})

describe('24 VDC source and solenoid valve', () => {
  it('energises the 384 ohm VXE21 holding coil at 62.5 mA', () => {
    const board: Board = {
      components: {
        GB1: {
          id: 'GB1',
          cell: { x: 0, y: 0 },
          spec: { kind: 'SOURCE', emfVolts: 24, tripAmps: 10, sourceType: 'battery_dc' },
        },
        YV1: {
          id: 'YV1',
          cell: { x: 2, y: 0 },
          spec: {
            kind: 'LOAD',
            resistanceOhms: 384,
            ratedCurrentAmps: 0.19,
            symbol: 'solenoid_valve',
          },
        },
      },
      wires: {
        w1: wire('w1', term('GB1', 0), term('YV1', 0)),
        w2: wire('w2', term('YV1', 1), term('GB1', 1)),
      },
    }

    const solution = solveBoard(board)
    expect(solution.shorted).toBe(false)
    expect(solution.loadCurrent.YV1).toBeCloseTo(24 / 384, 6)
    expect(solution.sourceCurrent).toBeCloseTo(0.0625, 6)
  })

  it('uses the PNP output to drive a downstream 24 V load only when detected', () => {
    const board = (actuated: boolean): Board => ({
      components: {
        GB1: { id: 'GB1', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 24, tripAmps: 10, sourceType: 'battery_dc' } },
        B1: { id: 'B1', cell: { x: 1, y: 0 }, spec: sensor('PNP', true, actuated) },
        YV1: { id: 'YV1', cell: { x: 2, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 384, ratedCurrentAmps: 0.19, symbol: 'solenoid_valve' } },
      },
      wires: {
        supplyPlus: wire('supplyPlus', term('GB1', 0), term('B1', 0)),
        supplyZero: wire('supplyZero', term('GB1', 1), term('B1', 1)),
        output: wire('output', term('B1', 2), term('YV1', 0)),
        returnZero: wire('returnZero', term('YV1', 1), term('GB1', 1)),
      },
    })

    expect(solveBoard(board(false)).loadCurrent.YV1 ?? 0).toBeCloseTo(0, 8)
    expect(solveBoard(board(true)).loadCurrent.YV1).toBeCloseTo(24 / 384, 6)
  })
})
