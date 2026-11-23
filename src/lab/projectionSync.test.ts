import { describe, expect, it } from 'vitest'
import {
  circuitReducer,
  initialCircuitState,
  type Board,
  type WireTap,
} from '../engine/index'
import {
  componentFootprint,
  footprintCollides,
  pointAtPolylineFraction,
  projectionCell,
  tapFractionForProjection,
  terminalPoint,
  virtualTerminalPoint,
} from './board/geometry'

const baseBoard = (): Board => ({
  components: {
    S: {
      id: 'S',
      cell: { x: 0, y: 0 },
      spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 },
    },
    H: {
      id: 'H',
      cell: { x: 4, y: 0 },
      spec: { kind: 'LOAD', resistanceOhms: 529, ratedCurrentAmps: 0.5 },
    },
  },
  wires: {
    w1: {
      id: 'w1',
      from: { componentId: 'S', index: 0 },
      to: { componentId: 'H', index: 0 },
    },
  },
})

describe('Circuit Lab projection synchronization', () => {
  it('opens legacy boards at the same fallback cell without migration', () => {
    const component = baseBoard().components.S

    expect(projectionCell(component, 'virtual')).toEqual({ x: 0, y: 0 })
    expect(projectionCell(component, 'iec')).toEqual({ x: 0, y: 0 })
  })

  it('moves only the active drawing while preserving one electrical graph', () => {
    const initial = initialCircuitState(baseBoard())
    const virtualMoved = circuitReducer(initial, {
      type: 'MOVE_COMPONENT',
      id: 'S',
      cell: { x: 1, y: 3 },
      projection: 'virtual',
    })

    expect(virtualMoved.board.components.S.cell).toEqual({ x: 0, y: 0 })
    expect(projectionCell(virtualMoved.board.components.S, 'virtual')).toEqual({ x: 1, y: 3 })
    expect(projectionCell(virtualMoved.board.components.S, 'iec')).toEqual({ x: 0, y: 0 })
    expect(virtualMoved.board.wires).toEqual(initial.board.wires)
    expect(virtualMoved.board.components.S.spec).toEqual(initial.board.components.S.spec)

    const iecMoved = circuitReducer(virtualMoved, {
      type: 'MOVE_COMPONENT',
      id: 'S',
      cell: { x: 7, y: 2 },
      projection: 'iec',
    })

    expect(projectionCell(iecMoved.board.components.S, 'virtual')).toEqual({ x: 1, y: 3 })
    expect(projectionCell(iecMoved.board.components.S, 'iec')).toEqual({ x: 7, y: 2 })
    expect(iecMoved.board.wires).toEqual(initial.board.wires)
  })

  it('undoes and redoes a projection move as one structural edit', () => {
    const initial = initialCircuitState(baseBoard())
    const moved = circuitReducer(initial, {
      type: 'MOVE_COMPONENT',
      id: 'S',
      cell: { x: 2, y: 4 },
      projection: 'virtual',
    })
    const undone = circuitReducer(moved, { type: 'UNDO' })
    const redone = circuitReducer(undone, { type: 'REDO' })

    expect(projectionCell(undone.board.components.S, 'virtual')).toEqual({ x: 0, y: 0 })
    expect(projectionCell(redone.board.components.S, 'virtual')).toEqual({ x: 2, y: 4 })
    expect(projectionCell(redone.board.components.S, 'iec')).toEqual({ x: 0, y: 0 })
  })

  it('keeps terminal identity shared while allowing different terminal geometry', () => {
    const component = {
      ...baseBoard().components.S,
      projectionCells: {
        virtual: { x: 1, y: 3 },
        iec: { x: 7, y: 2 },
      },
    }

    expect(virtualTerminalPoint(component, 0)).not.toEqual(terminalPoint(component, 0))
    expect(component.id).toBe('S')
  })

  it('uses drawing-owned junction geometry instead of sharing route fractions', () => {
    const tap: WireTap = {
      wireId: 'w1',
      projectionPositions: { virtual: 0.2, iec: 0.8 },
    }
    const virtualRoute = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]
    const iecRoute = [
      { x: 0, y: 0 },
      { x: 0, y: 200 },
    ]

    expect(
      pointAtPolylineFraction(
        virtualRoute,
        tapFractionForProjection(tap, 'virtual', virtualRoute),
      ),
    ).toEqual({ x: 20, y: 0 })
    expect(
      pointAtPolylineFraction(iecRoute, tapFractionForProjection(tap, 'iec', iecRoute)),
    ).toEqual({ x: 0, y: 160 })
  })

  it('does not leak a new Virtual junction fraction into the IEC route', () => {
    const tap: WireTap = {
      wireId: 'w1',
      projectionPositions: { virtual: 0.2 },
    }
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]

    expect(tapFractionForProjection(tap, 'virtual', route)).toBe(0.2)
    expect(tapFractionForProjection(tap, 'iec', route)).toBe(0.5)
  })

  it('keeps legacy shared tap fractions readable', () => {
    const legacy: WireTap = { wireId: 'w1', position: 0.35 }
    const route = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]

    expect(tapFractionForProjection(legacy, 'virtual', route)).toBe(0.35)
    expect(tapFractionForProjection(legacy, 'iec', route)).toBe(0.35)
  })

  it('lets field assets and IEC symbols own different footprint rules', () => {
    expect(componentFootprint('SOURCE_3PH', 'virtual')).toEqual({ cols: 2, rows: 2 })
    expect(componentFootprint('SOURCE_3PH', 'iec')).toEqual({ cols: 1, rows: 2 })
    expect(componentFootprint('MOTOR_3PH', 'virtual')).toEqual({ cols: 2, rows: 2 })
    expect(componentFootprint('MOTOR_3PH', 'iec')).toEqual({ cols: 2, rows: 1 })
  })

  it('checks collisions in the selected drawing only', () => {
    const board = baseBoard()
    board.components.H.projectionCells = {
      virtual: { x: 1, y: 0 },
      iec: { x: 6, y: 0 },
    }

    expect(footprintCollides(board, 'LOAD', { x: 1, y: 0 }, 'S', 'virtual')).toBe(true)
    expect(footprintCollides(board, 'LOAD', { x: 1, y: 0 }, 'S', 'iec')).toBe(false)
  })
})
