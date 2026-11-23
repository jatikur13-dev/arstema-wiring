/**
 * MCB (M3-B1.5) — rating is a NOMINAL label on the breaker spec (internal kind
 * unchanged). `mcbRatedAmps` defaults by kind; `SET_MCB_RATING` edits it through
 * the undo funnel and never touches terminals/topology or the `on` state.
 */
import { describe, expect, it } from 'vitest'
import type { Board } from './types'
import { MCB_DEFAULT_RATED_AMPS, mcbRatedAmps } from './types'
import { circuitReducer, initialCircuitState } from './engine'

describe('MCB rating', () => {
  it('defaults 1P=10 A, 3P=16 A when absent; returns the explicit value when set', () => {
    expect(mcbRatedAmps({ kind: 'BREAKER_1P', on: false })).toBe(10)
    expect(mcbRatedAmps({ kind: 'BREAKER_3P', on: false })).toBe(16)
    expect(mcbRatedAmps({ kind: 'BREAKER_1P', on: false, ratedAmps: 25 })).toBe(25)
    expect(MCB_DEFAULT_RATED_AMPS).toEqual({ BREAKER_1P: 10, BREAKER_3P: 16 })
  })

  it('SET_MCB_RATING edits the rating, keeps `on`, and is undoable', () => {
    const board: Board = {
      components: { QF: { id: 'QF', cell: { x: 0, y: 0 }, spec: { kind: 'BREAKER_1P', on: true, ratedAmps: 10 } } },
      wires: {},
    }
    let s = initialCircuitState(board)
    s = circuitReducer(s, { type: 'SET_MCB_RATING', id: 'QF', ratedAmps: 32 })
    const spec = s.board.components.QF.spec
    expect(spec.kind === 'BREAKER_1P' && spec.ratedAmps).toBe(32)
    expect(spec.kind === 'BREAKER_1P' && spec.on).toBe(true) // manual state untouched
    // Terminal count unchanged (rating never touches the contract).
    expect(Object.keys(s.board.components)).toEqual(['QF'])
    // Undo restores the previous rating.
    s = circuitReducer(s, { type: 'UNDO' })
    const undone = s.board.components.QF.spec
    expect(undone.kind === 'BREAKER_1P' && undone.ratedAmps).toBe(10)
  })

  it('SET_MCB_RATING on a non-MCB component is a no-op', () => {
    const board: Board = {
      components: { S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } } },
      wires: {},
    }
    const s = initialCircuitState(board)
    expect(circuitReducer(s, { type: 'SET_MCB_RATING', id: 'S', ratedAmps: 16 })).toBe(s)
  })

  it('a rating change survives a board snapshot (LOAD_BOARD round-trip)', () => {
    const board: Board = {
      components: { QF3: { id: 'QF3', cell: { x: 0, y: 0 }, spec: { kind: 'BREAKER_3P', on: false, ratedAmps: 40 } } },
      wires: {},
    }
    const s = circuitReducer(initialCircuitState(), { type: 'LOAD_BOARD', board })
    const spec = s.board.components.QF3.spec
    expect(spec.kind === 'BREAKER_3P' && spec.ratedAmps).toBe(40)
  })
})


