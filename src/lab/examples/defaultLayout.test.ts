import { describe, expect, it } from 'vitest'
import type { BoardProjection, PlacedComponent } from '../../engine/index'
import {
  CELL,
  componentFootprint,
  projectionCell,
  projectionComponentBox,
} from '../board/geometry'
import { cameraContentBounds, fitDownZoom } from '../board/viewportGestures'
import { CIRCUIT_EXAMPLES } from './exampleCatalog'

function hasEmptyGridLane(
  first: PlacedComponent,
  second: PlacedComponent,
  projection: BoardProjection,
): boolean {
  const a = projectionCell(first, projection)
  const b = projectionCell(second, projection)
  const af = componentFootprint(first.spec.kind, projection)
  const bf = componentFootprint(second.spec.kind, projection)
  return (
    a.x + af.cols < b.x ||
    b.x + bf.cols < a.x ||
    a.y + af.rows < b.y ||
    b.y + bf.rows < a.y
  )
}

describe('worked-example grid spacing', () => {
  it.each(['virtual', 'iec'] as const)(
    'keeps one empty grid lane between every component on %s',
    (projection) => {
      for (const example of CIRCUIT_EXAMPLES) {
        const components = Object.values(example.build().components)
        for (let first = 0; first < components.length; first += 1) {
          for (let second = first + 1; second < components.length; second += 1) {
            expect(
              hasEmptyGridLane(components[first], components[second], projection),
              `${example.key}: ${components[first].id} and ${components[second].id}`,
            ).toBe(true)
          }
        }
      }
    },
  )

  it('also spaces the Relay example without changing its component type', () => {
    const relay = CIRCUIT_EXAMPLES.find((example) => example.key === 'relay-dasar')?.build()
    expect(relay?.components.K.spec.kind).toBe('RELAY')
    expect(relay?.wires).toHaveProperty('w6')
  })

  it.each(['virtual', 'iec'] as const)(
    'produces a bounded fit-down camera for every %s example',
    (projection) => {
      const portraitSafeField = { left: 0, top: 64, right: 296, bottom: 574 }
      for (const example of CIRCUIT_EXAMPLES) {
        const board = example.build()
        const bounds = cameraContentBounds(
          Object.values(board.components).map((component) =>
            projectionComponentBox(component, projection)),
          [],
          CELL,
        )
        const zoom = fitDownZoom(bounds, portraitSafeField)
        expect(zoom, example.key).toBeGreaterThan(0)
        expect((bounds!.maxX - bounds!.minX) * zoom, example.key).toBeLessThanOrEqual(296.001)
        expect((bounds!.maxY - bounds!.minY) * zoom, example.key).toBeLessThanOrEqual(510.001)
        expect(zoom, example.key).toBeLessThanOrEqual(1)
      }
    },
  )
})
