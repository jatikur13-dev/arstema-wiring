import { describe, expect, it } from 'vitest'
import {
  cameraContentBounds,
  cameraExtentWithInsets,
  spaciousCanvasInsets,
  expandCanvas,
  continuousPinchZoom,
  fitDownZoom,
  fitZoom,
  insetsForExactViewportCentre,
  largestUnobstructedViewport,
  pinchAnchor,
  pinchPreviewTransform,
  scrollForContentCentre,
  scrollForPinch,
  steppedButtonZoom,
} from './viewportGestures'

describe('Wiring viewport gestures', () => {
  it('centres geometry inside a spacious canvas including negative route bounds', () => {
    const bounds = { minX: -120, minY: 20, maxX: 1800, maxY: 900 }
    const base = { x: -180, y: 0, width: 2100, height: 1000 }
    const insets = spaciousCanvasInsets(bounds, base, 0.5, 412, 700)
    const extent = cameraExtentWithInsets(base, insets)
    expect(extent.x + extent.width / 2).toBe((bounds.minX + bounds.maxX) / 2)
    expect(extent.y + extent.height / 2).toBe((bounds.minY + bounds.maxY) / 2)
    expect(bounds.minX - extent.x).toBeGreaterThanOrEqual(824)
    expect(bounds.minY - extent.y).toBeGreaterThanOrEqual(1400)
    expect(spaciousCanvasInsets(bounds, base, 0.5, 412, 700, insets)).toEqual(insets)
  })

  it('expands all four edges without moving the visible geometry or changing zoom', () => {
    const base = { x: -120, y: -200, width: 2400, height: 1600 }
    const initial = { left: 500, top: 700, right: 900, bottom: 800 }
    const oldScroll = { x: 400, y: 500 }
    for (const zoom of [0.5, 1, 2]) {
      const expanded = expandCanvas(initial, zoom, 412, 700, oldScroll)
      const before = cameraExtentWithInsets(base, initial)
      const after = cameraExtentWithInsets(base, expanded.insets)
      expect((300 - after.x) * zoom - expanded.scroll.x)
        .toBeCloseTo((300 - before.x) * zoom - oldScroll.x)
      expect((400 - after.y) * zoom - expanded.scroll.y)
        .toBeCloseTo((400 - before.y) * zoom - oldScroll.y)
      expect(after.width).toBeGreaterThan(before.width)
      expect(after.height).toBeGreaterThan(before.height)
      const fitted = spaciousCanvasInsets({ minX: 0, minY: 0, maxX: 2000, maxY: 1000 },
        base, zoom, 412, 700, expanded.insets)
      for (const edge of ['left', 'top', 'right', 'bottom'] as const)
        expect(fitted[edge]).toBeGreaterThanOrEqual(expanded.insets[edge])
    }
  })

  it('keeps fractional pinch values instead of snapping to ten-percent steps', () => {
    expect(continuousPinchZoom(1, 100, 113)).toBeCloseTo(1.13)
    expect(continuousPinchZoom(1.25, 200, 189)).toBeCloseTo(1.18125)
  })

  it('clamps the continuous gesture to the supported board range', () => {
    expect(continuousPinchZoom(1, 100, 20)).toBe(0.2)
    expect(continuousPinchZoom(1, 100, 400)).toBe(2)
  })

  it('keeps plus and minus buttons on exact ten-percentage-point increments', () => {
    expect(steppedButtonZoom(1, 1)).toBe(1.1)
    expect(steppedButtonZoom(1.1, 1)).toBe(1.2)
    expect(steppedButtonZoom(1.13, -1)).toBe(1.03)
  })

  it('continues zooming out far below 50 percent without rounding to zero', () => {
    let zoom = 0.5
    for (let i = 0; i < 40; i++) zoom = steppedButtonZoom(zoom, -1)
    expect(zoom).toBeLessThan(0.001)
    expect(zoom).toBeGreaterThan(0)
    expect(continuousPinchZoom(0.02, 100, 20)).toBeCloseTo(0.004)
  })

  it('combines pinch and pan while preserving the board point under the fingers', () => {
    const anchor = pinchAnchor({ x: 180, y: 260 }, 20, 60, 140, 90, 1)
    const scroll = scrollForPinch(anchor, { x: 210, y: 245 }, 20, 60, 1.37)
    expect(scroll.x).toBeCloseTo(221)
    expect(scroll.y).toBeCloseTo(212.3)
  })

  it('previews pinch by transforming the SVG while keeping the anchor under the fingers', () => {
    const anchor = pinchAnchor({ x: 180, y: 260 }, 20, 60, 140, 90, 1)
    const preview = pinchPreviewTransform(
      anchor,
      1,
      { x: 140, y: 90 },
      { x: 210, y: 245 },
      20,
      60,
      1.37,
    )
    const renderedX = 20 + anchor.x * preview.scale + preview.translateX - 140
    const renderedY = 60 + anchor.y * preview.scale + preview.translateY - 90
    expect(preview.scale).toBeCloseTo(1.37)
    expect(renderedX).toBeCloseTo(210)
    expect(renderedY).toBeCloseTo(245)
  })

  it('finds the largest safe field around portrait overlay docks', () => {
    const safe = largestUnobstructedViewport(360, 640, [
      { left: 8, top: 8, right: 220, bottom: 58 },
      { left: 304, top: 8, right: 352, bottom: 210 },
      { left: 8, top: 582, right: 352, bottom: 632 },
    ])
    expect(safe).toEqual({ left: 0, top: 66, right: 296, bottom: 574 })
  })

  it('recomputes the safe field from measured landscape docks', () => {
    const safe = largestUnobstructedViewport(800, 360, [
      { left: 8, top: 8, right: 220, bottom: 58 },
      { left: 744, top: 8, right: 792, bottom: 210 },
      { left: 205, top: 302, right: 595, bottom: 352 },
    ])
    expect(safe).toEqual({ left: 0, top: 66, right: 736, bottom: 294 })
  })

  it('keeps the initial camera at or below 100 percent', () => {
    const safe = { left: 0, top: 0, right: 600, bottom: 400 }
    expect(fitDownZoom({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, safe)).toBe(1)
    expect(fitDownZoom({ minX: 0, minY: 0, maxX: 1200, maxY: 400 }, safe)).toBe(0.5)
    expect(fitDownZoom({ minX: 0, minY: 0, maxX: 2400, maxY: 1600 }, safe)).toBe(0.25)
    expect(fitZoom({ minX: 0, minY: 0, maxX: 200, maxY: 100 }, safe)).toBe(2)
  })

  it('centres against a negative viewBox origin and clamps to scroll limits', () => {
    const centred = scrollForContentCentre(
      { minX: -80, minY: 20, maxX: 720, maxY: 420 },
      { x: -100, y: 0, width: 1000, height: 700 },
      1,
      { left: 0, top: 60, right: 300, bottom: 600 },
      360,
      640,
    )
    // Content centre 320 sits 420 px from a viewBox that begins at -100;
    // placing it on safe-field centre 150 requires scrollLeft 270.
    expect(centred.x).toBe(270)
    expect(centred.y).toBe(0)
  })

  it('opens leading camera room when top-row content would require negative scroll', () => {
    const base = { x: 0, y: 0, width: 1200, height: 2200 }
    const bounds = { minX: 100, minY: 100, maxX: 1100, maxY: 400 }
    const insets = insetsForExactViewportCentre(bounds, base, 0.5, 575, 1060)
    expect(insets.top).toBe(810)
    expect(insets.left).toBe(0)

    const extent = cameraExtentWithInsets(base, insets)
    const scroll = scrollForContentCentre(
      bounds,
      extent,
      0.5,
      { left: 0, top: 0, right: 575, bottom: 1060 },
      575,
      1060,
    )
    const renderedCentreX = ((bounds.minX + bounds.maxX) / 2 - extent.x) * 0.5 - scroll.x
    const renderedCentreY = ((bounds.minY + bounds.maxY) / 2 - extent.y) * 0.5 - scroll.y
    expect(renderedCentreX).toBe(287.5)
    expect(renderedCentreY).toBe(530)
  })

  it('opens trailing camera room for content near the far right/bottom edge', () => {
    const base = { x: 0, y: 0, width: 800, height: 600 }
    const bounds = { minX: 700, minY: 500, maxX: 780, maxY: 580 }
    const insets = insetsForExactViewportCentre(bounds, base, 1, 400, 300)
    expect(insets).toEqual({ left: 0, top: 0, right: 140, bottom: 90 })
    const extent = cameraExtentWithInsets(base, insets)
    const scroll = scrollForContentCentre(
      bounds,
      extent,
      1,
      { left: 0, top: 0, right: 400, bottom: 300 },
      400,
      300,
    )
    expect((740 - extent.x) - scroll.x).toBe(200)
    expect((540 - extent.y) - scroll.y).toBe(150)
  })

  it('uses routed points in the supplied bounds rather than component width alone', () => {
    const safe = { left: 0, top: 0, right: 400, bottom: 400 }
    const componentsOnly = cameraContentBounds(
      [{ minX: 100, minY: 100, maxX: 300, maxY: 300 }],
      [],
    )
    const includingLongRoute = cameraContentBounds(
      [{ minX: 100, minY: 100, maxX: 300, maxY: 300 }],
      [{ x: 900, y: 180 }],
    )
    expect(fitDownZoom(componentsOnly, safe)).toBe(1)
    expect(fitDownZoom(includingLongRoute, safe)).toBe(0.5)
  })

  it('adds one requested margin around both components and routed wire points', () => {
    expect(cameraContentBounds(
      [{ minX: 20, minY: 30, maxX: 80, maxY: 90 }],
      [{ x: -15, y: 140 }],
      10,
    )).toEqual({ minX: -25, minY: 20, maxX: 90, maxY: 150 })
  })
})
