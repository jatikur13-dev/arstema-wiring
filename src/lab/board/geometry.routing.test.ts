import { describe, expect, it } from 'vitest'
import {
  computeCrossings,
  reusableRoutes,
  routeBoardWires,
  routeEndpointSignature,
  routeSegments,
  type WireRouteRequest,
} from './geometry'

function vertical(y1: number, y2: number): WireRouteRequest {
  return {
    id: 'vertical',
    priority: 0,
    from: { point: { x: 50, y: y1 }, direction: { x: 0, y: 1 }, terminalKey: 'V:0' },
    to: { point: { x: 50, y: y2 }, direction: { x: 0, y: -1 }, terminalKey: 'V:1' },
  }
}

function horizontal(): WireRouteRequest {
  return {
    id: 'horizontal',
    priority: 1,
    from: { point: { x: 0, y: 0 }, direction: { x: 1, y: 0 }, terminalKey: 'H:0' },
    to: { point: { x: 100, y: 0 }, direction: { x: -1, y: 0 }, terminalKey: 'H:1' },
  }
}

describe('global schematic route readability', () => {
  const segmentContains = (
    points: Array<{ x: number; y: number }>,
    target: { x: number; y: number },
  ): boolean =>
    routeSegments(points).some((segment) =>
      segment.orient === 'H'
        ? Math.abs(segment.a.y - target.y) < 0.5 &&
          target.x >= Math.min(segment.a.x, segment.b.x) &&
          target.x <= Math.max(segment.a.x, segment.b.x)
        : Math.abs(segment.a.x - target.x) < 0.5 &&
          target.y >= Math.min(segment.a.y, segment.b.y) &&
          target.y <= Math.max(segment.a.y, segment.b.y),
    )

  it('prefers a local crossing-free detour over the shorter crossed line', () => {
    const routed = routeBoardWires([vertical(-40, 40), horizontal()])
    expect(routed.map((wire) => wire.id).sort()).toEqual(['horizontal', 'vertical'])
    const crossings = computeCrossings(routed)
    expect(crossings.over).toHaveLength(0)

    const horizontalRoute = routed.find((wire) => wire.id === 'horizontal')
    expect(horizontalRoute?.points.some((point) => Math.abs(point.y) > 40)).toBe(true)
    expect(Math.max(...(horizontalRoute?.points.map((point) => Math.abs(point.y)) ?? []))).toBeLessThanOrEqual(80)
  })

  it('keeps a true unavoidable interior crossing as a hop rather than a junction', () => {
    const routed = routeBoardWires([vertical(-200, 200), horizontal()])
    expect(routed).toHaveLength(2)
    const crossings = computeCrossings(routed)
    expect(crossings.over).toContainEqual(['horizontal', 'vertical'])
    expect(crossings.hops.horizontal).toEqual([{ x: 50, y: 0 }])
  })

  it('rejects an accidental T landing but accepts the same point as an explicit tap', () => {
    const trunk = vertical(-40, 40)
    const accidental: WireRouteRequest = {
      ...horizontal(),
      to: { point: { x: 50, y: 0 }, direction: { x: -1, y: 0 }, terminalKey: 'H:1' },
    }
    const separated = routeBoardWires([trunk, accidental])
    expect(separated.map((wire) => wire.id).sort()).toEqual(['horizontal', 'vertical'])
    expect(
      segmentContains(
        separated.find((wire) => wire.id === 'vertical')?.points ?? [],
        { x: 50, y: 0 },
      ),
    ).toBe(false)

    const tap: WireRouteRequest = {
      ...accidental,
      join: { wireId: 'vertical', point: { x: 50, y: 0 } },
      to: { point: { x: 50, y: 0 }, direction: { x: -1, y: 0 } },
    }
    const joined = routeBoardWires([trunk, tap])
    expect(joined.map((wire) => wire.id).sort()).toEqual(['horizontal', 'vertical'])
    expect(computeCrossings(joined).over).toHaveLength(0)
    expect(
      segmentContains(
        joined.find((wire) => wire.id === 'vertical')?.points ?? [],
        { x: 50, y: 0 },
      ),
    ).toBe(true)
  })
})

describe('routes kept on screen while a new route is computed', () => {
  const requests = [vertical(-200, 200), horizontal()]
  const routed = routeBoardWires(requests)
  const signatures = new Map(requests.map((request) => [request.id, routeEndpointSignature(request)]))
  const ids = (kept: ReturnType<typeof reusableRoutes>) => kept.map((wire) => wire.id).sort()

  it('keeps every route of an unchanged board', () => {
    expect(ids(reusableRoutes(routed, signatures, requests))).toEqual(['horizontal', 'vertical'])
  })

  it('drops the line of a wire whose far end was dragged until it is re-routed', () => {
    const dragged = { ...horizontal(), to: { ...horizontal().to, point: { x: 400, y: 120 } } }
    expect(ids(reusableRoutes(routed, signatures, [vertical(-200, 200), dragged]))).toEqual(['vertical'])
  })

  it('drops deleted wires, rewired wires, and same-named wires of another board', () => {
    expect(ids(reusableRoutes(routed, signatures, [vertical(-200, 200)]))).toEqual(['vertical'])
    const rewired = { ...horizontal(), to: { ...horizontal().to, terminalKey: 'X:1' } }
    expect(ids(reusableRoutes(routed, signatures, [vertical(-200, 200), rewired]))).toEqual(['vertical'])
    const elsewhere = {
      ...horizontal(),
      from: { ...horizontal().from, point: { x: 600, y: 600 } },
      to: { ...horizontal().to, point: { x: 900, y: 600 } },
    }
    expect(ids(reusableRoutes(routed, signatures, [vertical(-200, 200), elsewhere]))).toEqual(['vertical'])
  })
})
