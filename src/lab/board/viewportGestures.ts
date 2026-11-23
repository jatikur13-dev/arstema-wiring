// Numerical safety only: 0.01%, not a user-facing 50% limit.
export const BOARD_ZOOM_MIN = 0.0001
export const BOARD_ZOOM_MAX = 2
export const BUTTON_ZOOM_STEP = 0.1
export const COMPONENT_HOLD_MS = 420
export const TOUCH_PAN_THRESHOLD_PX = 7

export interface ClientPoint {
  x: number
  y: number
}

/** Axis-aligned board-space bounds. Kept independent from the router module so
 * camera mathematics can be tested without constructing an electrical board. */
export interface BoardContentBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** Rectangle in viewport/client pixels. */
export interface ViewportRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface CameraExtent {
  x: number
  y: number
  width: number
  height: number
}

export interface CameraInsets {
  left: number
  top: number
  right: number
  bottom: number
}

export const EMPTY_CAMERA_INSETS: CameraInsets = {
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
}

function rectWidth(rect: ViewportRect): number {
  return Math.max(0, rect.right - rect.left)
}

function rectHeight(rect: ViewportRect): number {
  return Math.max(0, rect.bottom - rect.top)
}

function intersects(a: ViewportRect, b: ViewportRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** Union component rectangles and final route vertices, then add honest visual margin. */
export function cameraContentBounds(
  rectangles: readonly BoardContentBounds[],
  points: readonly ClientPoint[],
  margin = 0,
): BoardContentBounds | null {
  if (rectangles.length === 0 && points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const rectangle of rectangles) {
    minX = Math.min(minX, rectangle.minX)
    minY = Math.min(minY, rectangle.minY)
    maxX = Math.max(maxX, rectangle.maxX)
    maxY = Math.max(maxY, rectangle.maxY)
  }
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  }
}

/**
 * Find the largest rectangular field that is not covered by floating controls.
 * Controls are measured at runtime; this therefore works in portrait, landscape,
 * and the non-overlay desktop layout without hard-coded toolbar dimensions.
 */
export function largestUnobstructedViewport(
  viewportWidth: number,
  viewportHeight: number,
  obstacles: readonly ViewportRect[],
  gap = 8,
): ViewportRect {
  const viewport: ViewportRect = {
    left: 0,
    top: 0,
    right: Math.max(0, viewportWidth),
    bottom: Math.max(0, viewportHeight),
  }
  if (viewport.right === 0 || viewport.bottom === 0) return viewport

  const clipped = obstacles.flatMap((obstacle) => {
    const rect = {
      left: Math.max(viewport.left, obstacle.left - gap),
      top: Math.max(viewport.top, obstacle.top - gap),
      right: Math.min(viewport.right, obstacle.right + gap),
      bottom: Math.min(viewport.bottom, obstacle.bottom + gap),
    }
    return rectWidth(rect) > 0 && rectHeight(rect) > 0 ? [rect] : []
  })
  if (clipped.length === 0) return viewport

  const xs = [...new Set([
    viewport.left,
    viewport.right,
    ...clipped.flatMap((rect) => [rect.left, rect.right]),
  ])].sort((a, b) => a - b)
  const ys = [...new Set([
    viewport.top,
    viewport.bottom,
    ...clipped.flatMap((rect) => [rect.top, rect.bottom]),
  ])].sort((a, b) => a - b)
  const viewportCentre = {
    x: (viewport.left + viewport.right) / 2,
    y: (viewport.top + viewport.bottom) / 2,
  }
  let best = viewport
  let bestArea = -1
  let bestDistance = Number.POSITIVE_INFINITY

  for (let leftIndex = 0; leftIndex < xs.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < xs.length; rightIndex += 1) {
      for (let topIndex = 0; topIndex < ys.length - 1; topIndex += 1) {
        for (let bottomIndex = topIndex + 1; bottomIndex < ys.length; bottomIndex += 1) {
          const candidate: ViewportRect = {
            left: xs[leftIndex],
            top: ys[topIndex],
            right: xs[rightIndex],
            bottom: ys[bottomIndex],
          }
          if (clipped.some((obstacle) => intersects(candidate, obstacle))) continue
          const area = rectWidth(candidate) * rectHeight(candidate)
          const centreX = (candidate.left + candidate.right) / 2
          const centreY = (candidate.top + candidate.bottom) / 2
          const distance = Math.hypot(
            centreX - viewportCentre.x,
            centreY - viewportCentre.y,
          )
          if (area > bestArea || (area === bestArea && distance < bestDistance)) {
            best = candidate
            bestArea = area
            bestDistance = distance
          }
        }
      }
    }
  }
  return bestArea >= 0 ? best : viewport
}

/** Initial camera fit: shrink only. A small circuit remains at its honest 100%. */
export function fitDownZoom(
  bounds: BoardContentBounds | null,
  safeViewport: ViewportRect,
  minimum = BOARD_ZOOM_MIN,
  maximum = 1,
): number {
  if (!bounds) return Math.min(1, maximum)
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)
  const availableWidth = Math.max(1, rectWidth(safeViewport))
  const availableHeight = Math.max(1, rectHeight(safeViewport))
  return Math.max(
    minimum,
    Math.min(maximum, availableWidth / width, availableHeight / height),
  )
}

/** Fit-button variant: unlike the initial camera, explicitly requested fit may enlarge. */
export function fitZoom(
  bounds: BoardContentBounds | null,
  safeViewport: ViewportRect,
): number {
  if (!bounds) return 1
  return fitDownZoom(bounds, safeViewport, BOARD_ZOOM_MIN, BOARD_ZOOM_MAX)
}

/**
 * Extra viewBox room required for mathematical centring on the viewport axes.
 * Without leading room, content near row/column zero would require a negative
 * scroll position and browsers clamp it back to the top-left corner.
 */
export function insetsForExactViewportCentre(
  bounds: BoardContentBounds | null,
  extent: CameraExtent,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
): CameraInsets {
  if (!bounds || zoom <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return EMPTY_CAMERA_INSETS
  }
  const centreX = (bounds.minX + bounds.maxX) / 2
  const centreY = (bounds.minY + bounds.maxY) / 2
  const relativeX = (centreX - extent.x) * zoom
  const relativeY = (centreY - extent.y) * zoom
  return {
    left: Math.max(0, viewportWidth / 2 - relativeX) / zoom,
    top: Math.max(0, viewportHeight / 2 - relativeY) / zoom,
    right: Math.max(0, relativeX - extent.width * zoom + viewportWidth / 2) / zoom,
    bottom: Math.max(0, relativeY - extent.height * zoom + viewportHeight / 2) / zoom,
  }
}

export function cameraExtentWithInsets<T extends CameraExtent>(
  extent: T,
  insets: CameraInsets,
): T {
  return {
    ...extent,
    x: extent.x - insets.left,
    y: extent.y - insets.top,
    width: extent.width + insets.left + insets.right,
    height: extent.height + insets.top + insets.bottom,
  }
}

/** Drawing-workspace room, independent from electrical geometry. Keep content
 * centred in a generous canvas; never discard a user's previous expansion. */
export function spaciousCanvasInsets(
  bounds: BoardContentBounds | null,
  extent: CameraExtent,
  zoom: number,
  viewportWidth: number,
  viewportHeight: number,
  current: CameraInsets = EMPTY_CAMERA_INSETS,
): CameraInsets {
  if (!bounds || zoom <= 0) return current
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2
  const roomX = Math.max(480, viewportWidth / zoom)
  const roomY = Math.max(480, viewportHeight / zoom)
  const halfWidth = Math.max(
    (bounds.maxX - bounds.minX) / 2 + roomX,
    cx - extent.x + current.left,
    extent.x + extent.width + current.right - cx,
  )
  const halfHeight = Math.max(
    (bounds.maxY - bounds.minY) / 2 + roomY,
    cy - extent.y + current.top,
    extent.y + extent.height + current.bottom - cy,
  )
  return {
    left: extent.x - cx + halfWidth,
    right: cx + halfWidth - extent.x - extent.width,
    top: extent.y - cy + halfHeight,
    bottom: cy + halfHeight - extent.y - extent.height,
  }
}

/** Symmetric expansion. Compensate scroll by the leading room to keep the
 * same geometry under the user's eyes; zoom and component positions stay put. */
export function expandCanvas(
  current: CameraInsets, zoom: number, viewportWidth: number,
  viewportHeight: number, scroll: ClientPoint,
): { insets: CameraInsets; scroll: ClientPoint } {
  const dx = Math.max(480, viewportWidth / zoom)
  const dy = Math.max(480, viewportHeight / zoom)
  return {
    insets: { left: current.left + dx, right: current.right + dx,
      top: current.top + dy, bottom: current.bottom + dy },
    scroll: { x: scroll.x + dx * zoom, y: scroll.y + dy * zoom },
  }
}

/**
 * Scroll an SVG viewBox so board-space content is centred in the safe field.
 * Subtracting extent.x/y is essential when the router opens a negative origin.
 */
export function scrollForContentCentre(
  bounds: BoardContentBounds | null,
  extent: CameraExtent,
  zoom: number,
  safeViewport: ViewportRect,
  viewportWidth: number,
  viewportHeight: number,
  scrollWidth = extent.width * zoom,
  scrollHeight = extent.height * zoom,
): ClientPoint {
  const boardCentreX = bounds
    ? (bounds.minX + bounds.maxX) / 2
    : extent.x + extent.width / 2
  const boardCentreY = bounds
    ? (bounds.minY + bounds.maxY) / 2
    : extent.y + extent.height / 2
  const safeCentreX = (safeViewport.left + safeViewport.right) / 2
  const safeCentreY = (safeViewport.top + safeViewport.bottom) / 2
  const maxX = Math.max(0, scrollWidth - viewportWidth)
  const maxY = Math.max(0, scrollHeight - viewportHeight)
  return {
    x: Math.min(
      maxX,
      Math.max(0, (boardCentreX - extent.x) * zoom - safeCentreX),
    ),
    y: Math.min(
      maxY,
      Math.max(0, (boardCentreY - extent.y) * zoom - safeCentreY),
    ),
  }
}

export function pointDistance(a: ClientPoint, b: ClientPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function pointMidpoint(a: ClientPoint, b: ClientPoint): ClientPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

export function continuousPinchZoom(
  startZoom: number,
  startDistance: number,
  currentDistance: number,
): number {
  if (!Number.isFinite(startDistance) || startDistance <= 0) return startZoom
  return Math.min(
    BOARD_ZOOM_MAX,
    Math.max(BOARD_ZOOM_MIN, startZoom * (currentDistance / startDistance)),
  )
}

export function steppedButtonZoom(value: number, direction: -1 | 1): number {
  return Math.min(
    BOARD_ZOOM_MAX,
    Math.max(
      BOARD_ZOOM_MIN,
      value < 0.5 || (value <= 0.5 && direction < 0)
        ? value * (direction > 0 ? 1.2 : 1 / 1.2)
        : Math.round((value + direction * BUTTON_ZOOM_STEP) * 100) / 100,
    ),
  )
}

/** Board-space point underneath the fingers when a pinch begins. */
export function pinchAnchor(
  midpoint: ClientPoint,
  wrapLeft: number,
  wrapTop: number,
  scrollLeft: number,
  scrollTop: number,
  zoom: number,
): ClientPoint {
  return {
    x: (scrollLeft + midpoint.x - wrapLeft) / zoom,
    y: (scrollTop + midpoint.y - wrapTop) / zoom,
  }
}

/** Scroll needed to keep an anchor under a (possibly moving) pinch midpoint. */
export function scrollForPinch(
  anchor: ClientPoint,
  midpoint: ClientPoint,
  wrapLeft: number,
  wrapTop: number,
  zoom: number,
): ClientPoint {
  return {
    x: anchor.x * zoom - (midpoint.x - wrapLeft),
    y: anchor.y * zoom - (midpoint.y - wrapTop),
  }
}

/**
 * Compositor-only transform for a live pinch preview. The SVG remains at its
 * committed dimensions; this transform makes the board point captured beneath the
 * fingers stay beneath the moving midpoint until the caller commits zoom + scroll.
 */
export function pinchPreviewTransform(
  anchor: ClientPoint,
  startZoom: number,
  startScroll: ClientPoint,
  midpoint: ClientPoint,
  wrapLeft: number,
  wrapTop: number,
  nextZoom: number,
): { scale: number; translateX: number; translateY: number } {
  const scale = nextZoom / startZoom
  const contentX = anchor.x * startZoom
  const contentY = anchor.y * startZoom
  return {
    scale,
    translateX: midpoint.x - wrapLeft + startScroll.x - contentX * scale,
    translateY: midpoint.y - wrapTop + startScroll.y - contentY * scale,
  }
}
