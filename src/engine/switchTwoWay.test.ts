import { describe, it, expect } from 'vitest'
import type { PlacedComponent } from './types'
import { TERMINAL_COUNT } from './types'
import { bridgedPairs } from './conduction'
import { terminalPoint, componentFootprint } from '../lab/board/geometry'

/** SWITCH_2WAY — SPDT saklar tukar/hotel. COM(0) bridges to L1(1) or L2(2) by
 *  position; the two positions are mutually exclusive (never both, never neither
 *  when placed). Follows the existing SWITCH toggle pattern (additive kind). */
const at = (toL2: boolean): PlacedComponent => ({
  id: 'X',
  cell: { x: 1, y: 1 },
  spec: { kind: 'SWITCH_2WAY', toL2 },
})

describe('SWITCH_2WAY (saklar tukar / SPDT)', () => {
  it('has three terminals and a 1x1 footprint', () => {
    expect(TERMINAL_COUNT.SWITCH_2WAY).toBe(3)
    expect(componentFootprint('SWITCH_2WAY')).toEqual({ cols: 1, rows: 1 })
  })

  it('COM bridges to L1 in position A, to L2 in position B (never both)', () => {
    expect(bridgedPairs(at(false), {})).toEqual([[0, 1]]) // COM–L1
    expect(bridgedPairs(at(true), {})).toEqual([[0, 2]]) // COM–L2
  })

  it('the three terminals occupy three distinct coordinates', () => {
    const pts = [0, 1, 2].map((i) => terminalPoint(at(false), i))
    const keys = new Set(pts.map((p) => `${p.x},${p.y}`))
    expect(keys.size).toBe(3)
    // COM on the left; L1/L2 on the right (COM.x < L1.x, L2.x).
    expect(pts[0].x).toBeLessThan(pts[1].x)
    expect(pts[0].x).toBeLessThan(pts[2].x)
  })
})

// === Master Instrument Library — switch family (additive kinds) =============
import type { ComponentSpec } from './types'
const comp = (spec: ComponentSpec): PlacedComponent => ({ id: 'X', cell: { x: 1, y: 1 }, spec })

describe('SWITCH_CROSS (saklar silang / intermediate)', () => {
  it('4 terminals; straight 0-2,1-3; crossed 0-3,1-2', () => {
    expect(TERMINAL_COUNT.SWITCH_CROSS).toBe(4)
    expect(bridgedPairs(comp({ kind: 'SWITCH_CROSS', crossed: false }), {})).toEqual([[0, 2], [1, 3]])
    expect(bridgedPairs(comp({ kind: 'SWITCH_CROSS', crossed: true }), {})).toEqual([[0, 3], [1, 2]])
  })
})

describe('CONTACT_2STATE (generic COM/NO/NC)', () => {
  it('3 terminals; normal COM-NC, actuated COM-NO (never both)', () => {
    expect(TERMINAL_COUNT.CONTACT_2STATE).toBe(3)
    expect(bridgedPairs(comp({ kind: 'CONTACT_2STATE', actuated: false }), {})).toEqual([[0, 1]])
    expect(bridgedPairs(comp({ kind: 'CONTACT_2STATE', actuated: true }), {})).toEqual([[0, 2]])
  })
})

describe('SELECTOR_3POS (MAN-OFF-AUTO)', () => {
  it('3 terminals; left COM-1, centre OFF, right COM-2', () => {
    expect(TERMINAL_COUNT.SELECTOR_3POS).toBe(3)
    expect(bridgedPairs(comp({ kind: 'SELECTOR_3POS', pos: 0 }), {})).toEqual([[0, 1]])
    expect(bridgedPairs(comp({ kind: 'SELECTOR_3POS', pos: 1 }), {})).toEqual([])
    expect(bridgedPairs(comp({ kind: 'SELECTOR_3POS', pos: 2 }), {})).toEqual([[0, 2]])
  })
})

describe('FUSE and ESTOP (2-terminal manual break)', () => {
  it('FUSE conducts NORMAL, opens BLOWN', () => {
    expect(TERMINAL_COUNT.FUSE).toBe(2)
    expect(bridgedPairs(comp({ kind: 'FUSE', blown: false }), {})).toEqual([[0, 1]])
    expect(bridgedPairs(comp({ kind: 'FUSE', blown: true }), {})).toEqual([])
  })
  it('ESTOP is maintained NC: closed normal, open when pressed', () => {
    expect(TERMINAL_COUNT.ESTOP).toBe(2)
    expect(bridgedPairs(comp({ kind: 'ESTOP', pressed: false }), {})).toEqual([[0, 1]])
    expect(bridgedPairs(comp({ kind: 'ESTOP', pressed: true }), {})).toEqual([])
  })
})


