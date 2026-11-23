import type { Board, BoardProjection, Cell, PlacedComponent } from '../../engine/index'
import { componentFootprint, projectionCell } from '../board/geometry'

const DEFAULT_GRID_GAP = 1

function axisPositions(
  components: readonly PlacedComponent[],
  projection: BoardProjection,
  axis: 'x' | 'y',
): Map<number, number> {
  const coordinates = Array.from(
    new Set(components.map((component) => projectionCell(component, projection)[axis])),
  ).sort((a, b) => a - b)
  const result = new Map<number, number>()
  let previousPosition: number | null = null
  let previousSize = 0

  for (const coordinate of coordinates) {
    const group = components.filter(
      (component) => projectionCell(component, projection)[axis] === coordinate,
    )
    const groupSize = Math.max(
      ...group.map((component) => {
        const footprint = componentFootprint(component.spec.kind, projection)
        return axis === 'x' ? footprint.cols : footprint.rows
      }),
    )
    const position: number =
      previousPosition === null
        ? coordinate
        : Math.max(coordinate, previousPosition + previousSize + DEFAULT_GRID_GAP)
    result.set(coordinate, position)
    previousPosition = position
    previousSize = groupSize
  }
  return result
}

function layoutForProjection(
  components: readonly PlacedComponent[],
  projection: BoardProjection,
): Map<string, Cell> {
  const xPositions = axisPositions(components, projection, 'x')
  const yPositions = axisPositions(components, projection, 'y')
  return new Map(
    components.map((component) => {
      const current = projectionCell(component, projection)
      return [
        component.id,
        {
          x: xPositions.get(current.x) ?? current.x,
          y: yPositions.get(current.y) ?? current.y,
        },
      ]
    }),
  )
}

/**
 * Give every worked-example component one empty grid lane horizontally or
 * vertically. Each projection is laid out independently because field devices
 * and IEC symbols intentionally have different footprints. Electrical topology,
 * terminal indices, component specs and wires are copied verbatim.
 */
export function withDefaultGridSpacing(board: Board): Board {
  const components = Object.values(board.components)
  if (components.length < 2) return board
  const virtual = layoutForProjection(components, 'virtual')
  const iec = layoutForProjection(components, 'iec')

  return {
    ...board,
    components: Object.fromEntries(
      components.map((component) => [
        component.id,
        {
          ...component,
          projectionCells: {
            ...component.projectionCells,
            virtual: virtual.get(component.id) ?? projectionCell(component, 'virtual'),
            iec: iec.get(component.id) ?? projectionCell(component, 'iec'),
          },
        },
      ]),
    ),
  }
}
