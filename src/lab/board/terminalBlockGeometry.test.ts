import { describe, expect, it } from 'vitest'
import { terminalCountForSpec, type PlacedComponent, type TerminalBlockSpec } from '../../engine/index'
import { iecLayoutFor, virtualTerminalPoint } from './geometry'

const placed = (spec: TerminalBlockSpec): PlacedComponent => ({ id: 'X1', cell: { x: 2, y: 2 }, spec })

describe('multi-conductor terminal geometry', () => {
  it.each([
    ['PHOENIX_UT25_TWIN', 3],
    ['PHOENIX_UT25_QUATTRO', 4],
    ['PHOENIX_UT25_PE_L_L', 6],
  ] as const)('%s exposes one distinct anchor per electrical terminal in both projections', (model, count) => {
    const component = placed({ kind: 'TERMINAL_BLOCK', model })
    expect(terminalCountForSpec(component.spec)).toBe(count)
    const virtual = Array.from({ length: count }, (_unused, index) => virtualTerminalPoint(component, index))
    const iec = iecLayoutFor(component).terminals.map(({ point }) => point)
    expect(new Set(virtual.map((point) => `${point.x},${point.y}`)).size).toBe(count)
    expect(new Set(iec.map((point) => `${point.x},${point.y}`)).size).toBe(count)
  })
})
