/**
 * Board geometry — pure grid ↔ pixel math and wire routing for the SVG board.
 *
 * Routing is ORTHOGONAL (clean 90° schematic corners — never diagonal, never a
 * curve) with the FEWEST bends: a straight line when the two terminals are
 * aligned (0 bends), a single L-shape when they are not (bend once, corner chosen
 * to dodge components), and a Z go-around (2 bends) only when both L-shapes would
 * cut through a component. A short stub still leaves each terminal so it is clear
 * which pin a wire belongs to. No React or DOM — all unit-testable.
 */

import {
  terminalCountForComponent,
  relayDefinition,
  type Board,
  type BoardProjection,
  type Cell,
  type ComponentKind,
  type PlacedComponent,
  type WireTap,
} from '../../engine/index'
import {
  virtualAssetDefinitionForComponent,
  virtualAssetDefinitionForKind,
  type AssetRect,
  type AssetViewBox,
  type VirtualAssetLayer,
} from './virtualAssets'

export const CELL = 76
export const PAD = 30
/** Horizontal offset of a component's two terminals from its cell centre. */
export const TERMINAL_DX = 28
/** Perpendicular lane separation so a live and a neutral run never coincide. */
export const LANE_OFFSET = 7
/** Straight "exit" length from a terminal before the wire is free to bend. */
export const STUB_LEN = 12
export const IEC_PREFERRED_TERMINAL_PITCH = 28
export const IEC_MIN_TERMINAL_PITCH = 20
export const IEC_BODY_PADDING = 12
export const ROUTING_OBSTACLE_CLEARANCE = 8
const HOP_R = 7
/** Crossings whose consecutive gap is ≤ this merge into ONE wide hop. Bundled parallel
 *  wires sit ~LANE_GAP (8px) apart, so a run of them becomes a single arc instead of a
 *  crowd of tiny bumps; wires a full cell apart (76px) stay separate readable hops. */
const HOP_MERGE_GAP = 20
/** Cap on a merged hop's bulge height, so a wide bundle arcs over as a shallow half-ellipse
 *  (wide but not tall) rather than a huge semicircle that collides with the row above. */
const HOP_H_MAX = 16
const OVERLAP_PENALTY = 800
// A crossing is a schematic readability event, not just a few extra pixels.
// Keep the legacy scalar search strongly biased toward a clean local detour;
// final candidate selection below is lexicographic (crossings before bends/length).
const CROSS_PENALTY = CELL * 4
const BEND_PENALTY = 16
/** Centre-line distance between two independently routed conductors. With the
 *  3px visual stroke this leaves a clear 5px air gap. */
export const ROUTE_LANE_GAP = 8
const MIN_PARALLEL_CLEARANCE = 4
const GLOBAL_CROSS_PENALTY = CELL * 4
/** Hard visual boundary outside the union of component obstacles. Crossing a
 * nearby conductor is preferable to growing the board past this envelope. */
export const ROUTE_ENVELOPE_MARGIN = 96
const MAX_LOCAL_LANE_ATTEMPTS = 10
const SHARED_TERMINAL_FAN_STUB = 12
export const TERMINAL_ROUTE_KEEP_OUT = 10

export interface Point {
  x: number
  y: number
}

export interface Rect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function cellCentre(cell: Cell): Point {
  return { x: PAD + cell.x * CELL + CELL / 2, y: PAD + cell.y * CELL + CELL / 2 }
}

export type TerminalSide = 'left' | 'right' | 'top' | 'bottom'

export interface IecTerminalAnchor {
  index: number
  side: TerminalSide
  point: Point
  exit: Point
}

export interface IecLayout {
  centre: Point
  frame: Rect
  body: Rect
  footprint: { cols: number; rows: number }
  terminals: readonly IecTerminalAnchor[]
  terminalPitch: number
}

interface IecTerminalGroups {
  left?: readonly number[]
  right?: readonly number[]
  top?: readonly number[]
  bottom?: readonly number[]
}

function baseComponentFootprint(kind: ComponentKind): { cols: number; rows: number } {
  switch (kind) {
    case 'SOURCE_3PH':
      return { cols: 1, rows: 2 }
    case 'MOTOR_3PH':
      return { cols: 2, rows: 1 }
    case 'CONTACTOR':
      return { cols: 2, rows: 2 }
    case 'RELAY':
      // The largest supported plug-in relay has four changeover poles. Reserve
      // enough room for coil + COM/NC/NO groups without stacking terminals.
      return { cols: 2, rows: 2 }
    case 'BREAKER_3P':
      return { cols: 2, rows: 1 }
    case 'OVERLOAD_RELAY':
      return { cols: 2, rows: 1 }
    case 'LIMIT_SWITCH':
    case 'SENSOR_3WIRE':
      return { cols: 2, rows: 1 }
    case 'TIMER':
      return { cols: 1, rows: 2 }
    // BREAKER_1P is a plain 1×1 (like SWITCH) — falls through to the default.
    default:
      return { cols: 1, rows: 1 }
  }
}

function iecTerminalGroups(kind: ComponentKind): IecTerminalGroups {
  switch (kind) {
    case 'GROUND':
      return { top: [0] }
    case 'SOURCE_3PH':
      return { right: [0, 1, 2, 3] }
    case 'MOTOR_3PH':
      return { top: [0, 2, 4], bottom: [1, 3, 5], right: [6] }
    case 'BREAKER_3P':
      return { top: [0, 2, 4], bottom: [1, 3, 5] }
    case 'CONTACTOR':
      return {
        left: [0, 1],
        top: [2, 4, 6],
        bottom: [3, 5, 7],
        right: [8, 9, 10, 11],
      }
    case 'RELAY':
      return { left: [0, 1], right: [2, 3, 4, 5] }
    case 'TIMER':
      // Physical grouping: 15/16/18, then 25/26/28.
      return { left: [0, 1], right: [2, 3, 6, 4, 7, 5] }
    case 'OVERLOAD_RELAY':
      return {
        top: [0, 2, 4],
        bottom: [1, 3, 5],
        right: [6, 7, 8, 9],
      }
    case 'SWITCH_2WAY':
    case 'CONTACT_2STATE':
    case 'SELECTOR_3POS':
      return { left: [0], right: [1, 2] }
    case 'SWITCH_CROSS':
      return { left: [0, 1], right: [2, 3] }
    case 'LIMIT_SWITCH':
      return { top: [0, 2], bottom: [1, 3] }
    case 'SENSOR_3WIRE':
      return { left: [0, 1], right: [2] }
    case 'MOTOR':
      return { left: [0], right: [1], bottom: [2] }
    default:
      return { left: [0], right: [1] }
  }
}

function iecTerminalGroupsFor(component: PlacedComponent): IecTerminalGroups {
  if (component.spec.kind === 'SOURCE' && component.spec.transformer) return { left: [0, 1], right: [2, 3, 4] }
  if (component.spec.kind === 'LOAD' && component.spec.threePhase) return { top: [0, 1, 2], bottom: [3] }
  if (component.modelId === 'AUX_CONTACT_LADN22') {
    return { top: [0, 2, 4, 6], bottom: [1, 3, 5, 7] }
  }
  if (component.modelId === 'PHASE_MONITOR_RM17TG20') {
    return { left: [0, 1, 2], top: [4, 3, 5], bottom: [7, 6, 8] }
  }
  if (component.modelId === 'ILLUMINATED_PB_XB5AW33B5') {
    return { top: [0, 2], bottom: [1, 3], left: [4], right: [5] }
  }
  if (component.modelId === 'PUSHBUTTON_STATION_XB5AL73415') {
    return { top: [0, 2], bottom: [1, 3] }
  }
  if (component.modelId === 'FLOAT_SWITCH_9037HG33') {
    return { top: [0, 2], bottom: [1, 3] }
  }
  if (component.modelId === 'PRESSURE_SWITCH_XMLB004') {
    return { top: [0, 2], bottom: [1, 3] }
  }
  if (component.modelId === 'THERMOSTAT_NSYCCOTHC') {
    return { left: [0], right: [1] }
  }
  if (component.modelId === 'TERMINAL_UT25_PE_LL') {
    // The PE pair is physically the lowest level. Keep the electrical pair
    // indices unchanged while projecting that level at the bottom in IEC.
    return { left: [4, 2, 0], right: [5, 3, 1] }
  }
  if (component.spec.kind === 'TERMINAL_BLOCK') {
    const count = terminalCountForComponent(component)
    if (count === 3) return { left: [0], right: [1, 2] }
    const left = Array.from({ length: Math.ceil(count / 2) }, (_unused, index) => index * 2)
    const right = left.map((index) => index + 1).filter((index) => index < count)
    return { left, right }
  }
  if (component.spec.kind !== 'RELAY') return iecTerminalGroups(component.spec.kind)
  const definition = relayDefinition(component.spec)
  const terminals = definition.terminals
  const indicesWithRole = (role: 'A1' | 'A2' | 'COM' | 'NC' | 'NO') =>
    terminals.filter((terminal) => terminal.role === role).map((terminal) => terminal.index)
  if (definition.contacts.length > 0) {
    const split = Math.ceil(definition.contacts.length / 2)
    const terminalTriples = (contacts: typeof definition.contacts) =>
      contacts.flatMap((contact) => [contact.nc, contact.common, contact.no])
    return {
      left: [...indicesWithRole('A1'), ...indicesWithRole('A2')],
      top: terminalTriples(definition.contacts.slice(0, split)),
      bottom: terminalTriples(definition.contacts.slice(split)),
    }
  }
  return {
    left: [...indicesWithRole('A1'), ...indicesWithRole('A2')],
    right: terminals
      .filter((terminal) => terminal.role !== 'A1' && terminal.role !== 'A2')
      .map((terminal) => terminal.index),
  }
}

function requiredSideSpan(count: number, extraGap = 0): number {
  if (count <= 1) return 0
  return (count - 1) * IEC_MIN_TERMINAL_PITCH + extraGap
}

/**
 * Multi-cell footprint is derived, never serialized. The base size represents the
 * real field-device asset. IEC terminal demand may enlarge it when the minimum
 * 20 px terminal pitch would otherwise be violated.
 */
export function componentFootprint(
  kind: ComponentKind,
  projection: BoardProjection = 'iec',
): { cols: number; rows: number } {
  if (projection === 'virtual') {
    const display = virtualAssetDefinitionForKind(kind).displayCells
    return {
      cols: Math.max(1, Math.ceil(display.width)),
      rows: Math.max(1, Math.ceil(display.height)),
    }
  }
  const base = baseComponentFootprint(kind)
  const groups = iecTerminalGroups(kind)
  const horizontalCount = Math.max(groups.top?.length ?? 0, groups.bottom?.length ?? 0)
  const verticalCount = Math.max(groups.left?.length ?? 0, groups.right?.length ?? 0)
  const verticalSpan =
    kind === 'TIMER'
      ? IEC_MIN_TERMINAL_PITCH * 5
      : requiredSideSpan(verticalCount)
  const requiredWidth =
    requiredSideSpan(horizontalCount) + IEC_BODY_PADDING * 2 + TERMINAL_R * 2
  const requiredHeight = verticalSpan + IEC_BODY_PADDING * 2 + TERMINAL_R * 2
  return {
    cols: Math.max(base.cols, Math.ceil(requiredWidth / CELL)),
    rows: Math.max(base.rows, Math.ceil(requiredHeight / CELL)),
  }
}

/** Resolve a component's drawing position without changing its electrical identity. */
export function projectionCell(
  component: PlacedComponent,
  projection: BoardProjection,
): Cell {
  return component.projectionCells?.[projection] ?? component.cell
}

/** Pixel centre of a component's whole footprint. For 1×1 this equals cellCentre. */
export function footprintCentre(
  component: PlacedComponent,
  projection: BoardProjection = 'iec',
): Point {
  const cell = projectionCell(component, projection)
  const { cols, rows } = componentFootprint(component.spec.kind, projection)
  return {
    x: PAD + (cell.x + cols / 2) * CELL,
    y: PAD + (cell.y + rows / 2) * CELL,
  }
}

/** Every grid cell a component occupies (its footprint), top-left = component.cell. */
export function footprintCells(
  component: PlacedComponent,
  projection: BoardProjection = 'iec',
): Cell[] {
  const origin = projectionCell(component, projection)
  const { cols, rows } = componentFootprint(component.spec.kind, projection)
  const cells: Cell[] = []
  for (let dy = 0; dy < rows; dy += 1) {
    for (let dx = 0; dx < cols; dx += 1) cells.push({ x: origin.x + dx, y: origin.y + dy })
  }
  return cells
}

/**
 * Deterministic board-space rectangle for the 2D virtual instrument.
 *
 * The vector hardware and every physical terminal hole are derived from this
 * same rectangle. There is deliberately no raster crop or secondary image
 * coordinate system: the visible hole, clickable terminal and cable endpoint
 * therefore resolve to the exact same board-space point.
 */
export interface VirtualInstrumentBounds {
  x: number
  y: number
  width: number
  height: number
}

export function virtualInstrumentBounds(component: PlacedComponent): VirtualInstrumentBounds {
  const centre = footprintCentre(component, 'virtual')
  const definition = virtualAssetDefinitionForComponent(component)
  const width = definition.displayCells.width * CELL - 8
  const height = definition.displayCells.height * CELL - 8
  return {
    x: centre.x - width / 2,
    y: centre.y - height / 2,
    width,
    height,
  }
}

export interface VirtualAssetLayerLayout {
  id: string
  src: string
  sourceViewBox: AssetViewBox
  bounds: VirtualInstrumentBounds
}

export interface VirtualAssetLayout {
  bounds: VirtualInstrumentBounds
  layers: readonly VirtualAssetLayerLayout[]
}

function containViewBox(
  target: VirtualInstrumentBounds,
  viewBox: AssetViewBox,
): VirtualInstrumentBounds {
  const scale = Math.min(target.width / viewBox.width, target.height / viewBox.height)
  const width = viewBox.width * scale
  const height = viewBox.height * scale
  return {
    x: target.x + (target.width - width) / 2,
    y: target.y + (target.height - height) / 2,
    width,
    height,
  }
}

function layerTarget(
  bounds: VirtualInstrumentBounds,
  placement: AssetRect,
): VirtualInstrumentBounds {
  return {
    x: bounds.x + placement.x * bounds.width,
    y: bounds.y + placement.y * bounds.height,
    width: placement.width * bounds.width,
    height: placement.height * bounds.height,
  }
}

export function virtualAssetLayout(component: PlacedComponent): VirtualAssetLayout {
  const definition = virtualAssetDefinitionForComponent(component)
  const bounds = virtualInstrumentBounds(component)
  const main: VirtualAssetLayerLayout = {
    id: 'main',
    src: definition.src,
    sourceViewBox: definition.viewBox,
    bounds: containViewBox(bounds, definition.viewBox),
  }
  const extra = (definition.layers ?? []).map((item: VirtualAssetLayer) => ({
    id: item.id,
    src: item.src,
    sourceViewBox: item.viewBox,
    bounds: containViewBox(layerTarget(bounds, item.placement), item.viewBox),
  }))
  return { bounds, layers: [main, ...extra] }
}

function sourcePointToBoard(
  layerLayout: VirtualAssetLayerLayout,
  source: Point,
): Point {
  const viewBox = layerLayout.sourceViewBox
  return {
    x:
      layerLayout.bounds.x +
      ((source.x - viewBox.x) / viewBox.width) * layerLayout.bounds.width,
    y:
      layerLayout.bounds.y +
      ((source.y - viewBox.y) / viewBox.height) * layerLayout.bounds.height,
  }
}

function sourceRectToBoard(
  layerLayout: VirtualAssetLayerLayout,
  source: AssetRect,
): VirtualInstrumentBounds {
  const topLeft = sourcePointToBoard(layerLayout, source)
  const bottomRight = sourcePointToBoard(layerLayout, {
    x: source.x + source.width,
    y: source.y + source.height,
  })
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
}

export function virtualTerminalPoint(component: PlacedComponent, index: number): Point {
  const definition = virtualAssetDefinitionForComponent(component)
  const layout = virtualAssetLayout(component)
  const anchor = definition.terminals[index]
  if (!anchor || terminalCountForComponent(component) > definition.terminals.length) {
    // A model-specific terminal contract may expose more terminals than a
    // legacy generic photograph. Keep every terminal distinct and on the
    // instrument perimeter until a verified product asset supplies exact hole
    // coordinates; never collapse multiple electrical pins onto the centre.
    const count = terminalCountForComponent(component)
    const bounds = layout.bounds
    const column = Math.floor(index / 2)
    const columns = Math.ceil(count / 2)
    return {
      x: bounds.x + (bounds.width * (column + 1)) / (columns + 1),
      y: index % 2 === 0 ? bounds.y : bounds.y + bounds.height,
    }
  }
  const targetLayer =
    layout.layers.find((item) => item.id === (anchor.layer ?? 'main')) ??
    layout.layers[0]
  return sourcePointToBoard(targetLayer, anchor)
}

export function virtualTerminalExit(
  component: PlacedComponent,
  index: number,
): Point {
  const definition = virtualAssetDefinitionForComponent(component)
  const exactAnchorAvailable = terminalCountForComponent(component) <= definition.terminals.length
  return (exactAnchorAvailable ? definition.terminals[index]?.exit : undefined) ?? {
    x: 0,
    y: index % 2 === 0 ? -1 : 1,
  }
}

export function virtualActuatorRect(
  component: PlacedComponent,
): VirtualInstrumentBounds | null {
  const definition = virtualAssetDefinitionForComponent(component)
  if (!definition.actuator) return null
  const main = virtualAssetLayout(component).layers[0]
  return sourceRectToBoard(main, definition.actuator)
}

export function virtualStatusRect(
  component: PlacedComponent,
  id: 'state' | 'glow' | 'motion' | 'energized' | 'trip',
): VirtualInstrumentBounds | null {
  const definition = virtualAssetDefinitionForComponent(component)
  const status = definition.statusLayers?.find((item) => item.id === id)
  if (!status) return null
  const layout = virtualAssetLayout(component)
  const target =
    layout.layers.find((item) => item.id === (status.layer ?? 'main')) ??
    layout.layers[0]
  return sourceRectToBoard(target, status.rect)
}

export function projectionComponentBox(
  component: PlacedComponent,
  projection: 'virtual' | 'iec',
): Rect {
  if (projection === 'iec') return componentBox(component)
  const bounds = virtualInstrumentBounds(component)
  return {
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.x + bounds.width,
    maxY: bounds.y + bounds.height,
  }
}

export function expandRect(rect: Rect, amount = ROUTING_OBSTACLE_CLEARANCE): Rect {
  return {
    minX: rect.minX - amount,
    minY: rect.minY - amount,
    maxX: rect.maxX + amount,
    maxY: rect.maxY + amount,
  }
}

function sideVector(side: TerminalSide): Point {
  if (side === 'left') return { x: -1, y: 0 }
  if (side === 'right') return { x: 1, y: 0 }
  if (side === 'top') return { x: 0, y: -1 }
  return { x: 0, y: 1 }
}

function terminalOffsets(
  count: number,
  available: number,
  kind: ComponentKind,
  side: TerminalSide,
): { offsets: number[]; pitch: number } {
  if (count <= 1) return { offsets: [0], pitch: IEC_PREFERRED_TERMINAL_PITCH }
  if (kind === 'TIMER' && side === 'right' && count === 6) {
    const groupGap = IEC_MIN_TERMINAL_PITCH
    const pitch = Math.max(
      IEC_MIN_TERMINAL_PITCH,
      Math.min(IEC_PREFERRED_TERMINAL_PITCH, (available - groupGap) / 4),
    )
    const span = pitch * 4 + groupGap
    return {
      offsets: [
        -span / 2,
        -span / 2 + pitch,
        -span / 2 + pitch * 2,
        span / 2 - pitch * 2,
        span / 2 - pitch,
        span / 2,
      ],
      pitch,
    }
  }
  const pitch = Math.max(
    IEC_MIN_TERMINAL_PITCH,
    Math.min(IEC_PREFERRED_TERMINAL_PITCH, available / (count - 1)),
  )
  const start = -((count - 1) * pitch) / 2
  return {
    offsets: Array.from({ length: count }, (_unused, index) => start + index * pitch),
    pitch,
  }
}

function minimumIecBody(kind: ComponentKind): { width: number; height: number } {
  switch (kind) {
    case 'CONTACTOR':
      return { width: 104, height: 104 }
    case 'RELAY':
      return { width: 44, height: 48 }
    case 'TIMER':
      return { width: 44, height: 104 }
    case 'OVERLOAD_RELAY':
      return { width: 104, height: 44 }
    case 'BREAKER_3P':
      return { width: 104, height: 48 }
    case 'BREAKER_1P':
      return { width: 36, height: 48 }
    case 'MOTOR_3PH':
      return { width: 64, height: 44 }
    case 'SOURCE_3PH':
      return { width: 42, height: 70 }
    default:
      return { width: 36, height: 32 }
  }
}

/**
 * Projection-specific IEC geometry. The terminal count determines minimum
 * footprint and pitch; the body is centred in that footprint and never drawn
 * from the top-left cell.
 */
export function iecLayoutFor(component: PlacedComponent): IecLayout {
  const footprint = componentFootprint(component.spec.kind)
  const centre = footprintCentre(component)
  const frame = componentBox(component)
  const groups = iecTerminalGroupsFor(component)
  const terminals: IecTerminalAnchor[] = []
  let terminalPitch = IEC_PREFERRED_TERMINAL_PITCH

  const place = (side: TerminalSide, indices: readonly number[] | undefined) => {
    if (!indices?.length) return
    const available =
      side === 'left' || side === 'right'
        ? frame.maxY - frame.minY
        : frame.maxX - frame.minX
    const placement = terminalOffsets(
      indices.length,
      available,
      component.spec.kind,
      side,
    )
    terminalPitch = Math.min(terminalPitch, placement.pitch)
    indices.forEach((index, order) => {
      const offset = placement.offsets[order]
      const point =
        side === 'left'
          ? { x: frame.minX, y: centre.y + offset }
          : side === 'right'
            ? { x: frame.maxX, y: centre.y + offset }
            : side === 'top'
              ? { x: centre.x + offset, y: frame.minY }
              : { x: centre.x + offset, y: frame.maxY }
      terminals.push({ index, side, point, exit: sideVector(side) })
    })
  }

  place('left', groups.left)
  place('right', groups.right)
  place('top', groups.top)
  place('bottom', groups.bottom)

  const count = terminalCountForComponent(component)
  for (let index = 0; index < count; index += 1) {
    if (terminals.some((terminal) => terminal.index === index)) continue
    terminals.push({
      index,
      side: 'right',
      point: { x: frame.maxX, y: centre.y },
      exit: { x: 1, y: 0 },
    })
  }
  terminals.sort((a, b) => a.index - b.index)

  const minimum = minimumIecBody(component.spec.kind)
  const maxWidth = Math.max(20, frame.maxX - frame.minX - IEC_BODY_PADDING)
  const maxHeight = Math.max(20, frame.maxY - frame.minY - IEC_BODY_PADDING)
  const width = Math.min(maxWidth, Math.max(minimum.width, maxWidth * 0.76))
  const height = Math.min(maxHeight, Math.max(minimum.height, maxHeight * 0.72))
  const body = {
    minX: centre.x - width / 2,
    minY: centre.y - height / 2,
    maxX: centre.x + width / 2,
    maxY: centre.y + height / 2,
  }

  return { centre, frame, body, footprint, terminals, terminalPitch }
}

export function iecTerminalExit(component: PlacedComponent, index: number): Point {
  return iecLayoutFor(component).terminals[index]?.exit ?? { x: 1, y: 0 }
}

export function terminalPoint(component: PlacedComponent, index: number): Point {
  return iecLayoutFor(component).terminals[index]?.point ?? footprintCentre(component)
}

export interface BoardExtent {
  cols: number
  rows: number
  /** Full camera width/height in board px — the grid plus any margin opened by `x`/`y`. */
  width: number
  height: number
  /**
   * Camera origin (the viewBox x/y), never positive. It is 0 for a board that draws
   * entirely inside the grid; it opens upward/leftward by exactly as much as some
   * conductor reaches past the grid's top-left, so nothing is ever clipped out of
   * sight. This moves the CAMERA only — routing, terminals, CELL/PAD and component
   * cells are untouched.
   */
  x: number
  y: number
}

/**
 * Breathing room, in board px, kept between the outermost thing drawn and the camera
 * edge. A polyline point is the CENTRE of a stroke and may carry an arrow marker or a
 * hop arc, so a conductor whose points sit exactly at 0 still paints outside the frame.
 */
const CAMERA_GUTTER = 12

// P1.1: the minimum logical workspace is 12×8 (room to build before the edge). The
// extent still grows to fit components beyond that. CELL/PAD/terminal geometry are
// unchanged — only how much empty grid is shown.
//
// Bug 2 (camera zoom): `minCols`/`minRows` are the CAMERA floor — the caller passes a
// larger minimum on zoom-out so `extent × zoom` fills the workspace instead of
// shrinking the whole board to a centred thumbnail. The extent still grows past that
// floor to fit the circuit. `extraPoints` (routed wire polyline points) plus every
// wire's terminal endpoints are folded into the bounds so a conductor reaching past
// the component block is never clipped at the grid edge.
export function boardExtent(
  board: Board,
  minCols = 12,
  minRows = 8,
  extraPoints: Point[] = [],
  projection: BoardProjection = 'iec',
): BoardExtent {
  let maxX = minCols - 1
  let maxY = minRows - 1
  // Left/top reach of anything drawn, in board px. Routing may lift a lane above the
  // first row or left of the first column; with the camera pinned at 0 that conductor
  // was simply cut off — a wire a learner cannot follow is worse than one they can see
  // sitting in the margin.
  // Infinity, not 0: "nothing drawn yet" must not read as "something sits at 0", or
  // every board would open a gutter it does not need.
  let minPx = Number.POSITIVE_INFINITY
  let minPy = Number.POSITIVE_INFINITY
  for (const component of Object.values(board.components)) {
    // A multi-cell footprint reaches beyond its top-left cell.
    const cell = projectionCell(component, projection)
    const { cols, rows } = componentFootprint(component.spec.kind, projection)
    maxX = Math.max(maxX, cell.x + cols - 1)
    maxY = Math.max(maxY, cell.y + rows - 1)
  }
  // Fold a board-pixel point into the cell bounds (the cell whose right/bottom grid
  // edge covers it), so nothing drawn at that point falls outside the grid.
  const includePoint = (p: Point) => {
    maxX = Math.max(maxX, Math.ceil((p.x - PAD) / CELL) - 1)
    maxY = Math.max(maxY, Math.ceil((p.y - PAD) / CELL) - 1)
    minPx = Math.min(minPx, p.x)
    minPy = Math.min(minPy, p.y)
  }
  // Wire terminal endpoints (pure — derivable from the board, no routing needed).
  for (const wire of Object.values(board.wires)) {
    const from = board.components[wire.from.componentId]
    const to = board.components[wire.to.componentId]
    if (from) {
      includePoint(
        projection === 'virtual'
          ? virtualTerminalPoint(from, wire.from.index)
          : terminalPoint(from, wire.from.index),
      )
    }
    if (to) {
      includePoint(
        projection === 'virtual'
          ? virtualTerminalPoint(to, wire.to.index)
          : terminalPoint(to, wire.to.index),
      )
    }
  }
  // Routed polyline points (lane shifts + go-around detours) from the caller.
  for (const p of extraPoints) includePoint(p)
  const cols = maxX + 1
  const rows = maxY + 1
  // Open the camera only as far as something actually reaches; a board that stays
  // inside the grid keeps the origin at 0 and renders exactly as before.
  const x = Number.isFinite(minPx) ? Math.min(0, Math.floor(minPx - CAMERA_GUTTER)) : 0
  const y = Number.isFinite(minPy) ? Math.min(0, Math.floor(minPy - CAMERA_GUTTER)) : 0
  return {
    cols,
    rows,
    x,
    y,
    width: PAD * 2 + cols * CELL - x,
    height: PAD * 2 + rows * CELL - y,
  }
}

/**
 * CAMERA floor (Bug 2). The minimum grid the board must show so that, rendered at
 * `zoom` (on-screen cell = CELL × zoom), it fills a `vw × vh` workspace — zooming out
 * reveals MORE grid instead of shrinking the board. A non-positive viewport (headless,
 * unmeasured) yields the logical 12×8 floor, so nothing depends on layout in tests.
 */
export function cameraMinCells(vw: number, vh: number, zoom: number): { minCols: number; minRows: number } {
  const screenCell = CELL * zoom
  // extent.(width|height) = 2·PAD + cells·CELL, so the on-screen size is
  // 2·PAD·zoom + cells·screenCell. Solve cells so that size ≥ viewport, i.e. subtract
  // the 2·PAD·zoom border first — otherwise the fit over-counts by ~1 cell and forces
  // the board wider than its natural 12 even at 100% (an unwanted overflow).
  const border = 2 * PAD * zoom
  const fitCols = vw > 0 && screenCell > 0 ? Math.ceil((vw - border) / screenCell) : 0
  const fitRows = vh > 0 && screenCell > 0 ? Math.ceil((vh - border) / screenCell) : 0
  return { minCols: Math.max(12, fitCols), minRows: Math.max(8, fitRows) }
}

/** Every grid cell occupied by any component (all footprint cells). */
export function occupiedCells(
  board: Board,
  projection: BoardProjection = 'iec',
): Set<string> {
  const occupied = new Set<string>()
  for (const component of Object.values(board.components)) {
    for (const cell of footprintCells(component, projection)) occupied.add(`${cell.x},${cell.y}`)
  }
  return occupied
}

export function emptyCells(
  board: Board,
  extent: BoardExtent,
  projection: BoardProjection = 'iec',
): Cell[] {
  const occupied = occupiedCells(board, projection)
  const cells: Cell[] = []
  for (let y = 0; y < extent.rows; y += 1) {
    for (let x = 0; x < extent.cols; x += 1) {
      if (!occupied.has(`${x},${y}`)) cells.push({ x, y })
    }
  }
  return cells
}

/** Would a component of `kind` placed at `cell` collide with an existing footprint
 *  (excluding `ignoreId`, e.g. the component being dragged)? */
export function footprintCollides(
  board: Board,
  kind: ComponentKind,
  cell: Cell,
  ignoreId?: string,
  projection: BoardProjection = 'iec',
): boolean {
  const occupied = new Set<string>()
  for (const component of Object.values(board.components)) {
    if (component.id === ignoreId) continue
    for (const c of footprintCells(component, projection)) occupied.add(`${c.x},${c.y}`)
  }
  const { cols, rows } = componentFootprint(kind, projection)
  for (let dy = 0; dy < rows; dy += 1) {
    for (let dx = 0; dx < cols; dx += 1) {
      if (occupied.has(`${cell.x + dx},${cell.y + dy}`)) return true
    }
  }
  return false
}

/** Existing imported boards are never silently moved. Surface every overlapping
 * footprint so the UI can warn without mutating electrical topology. */
export function collidingComponentPairs(
  board: Board,
  projection: BoardProjection = 'iec',
): [string, string][] {
  const components = Object.values(board.components)
  const cellsById = new Map(
    components.map((component) => [
      component.id,
      new Set(footprintCells(component, projection).map((cell) => `${cell.x},${cell.y}`)),
    ]),
  )
  const pairs: [string, string][] = []
  for (let left = 0; left < components.length; left += 1) {
    for (let right = left + 1; right < components.length; right += 1) {
      const a = components[left]
      const b = components[right]
      const aCells = cellsById.get(a.id)!
      const bCells = cellsById.get(b.id)!
      if ([...aCells].some((cell) => bCells.has(cell))) pairs.push([a.id, b.id])
    }
  }
  return pairs
}

/** Obstacle box covering a component's glyph so a wire can never hide behind it.
 *  Terminals sit just outside. Footprint-aware: a 1×1 gives exactly ±30 (unchanged),
 *  a bigger footprint gives a proportionally bigger box. */
export function componentBox(component: PlacedComponent): Rect {
  const { cols, rows } = componentFootprint(component.spec.kind)
  const centre = footprintCentre(component)
  const halfW = (cols * CELL) / 2 - 8
  const halfH = (rows * CELL) / 2 - 8
  return { minX: centre.x - halfW, minY: centre.y - halfH, maxX: centre.x + halfW, maxY: centre.y + halfH }
}

/** Obstacle box covering a component's glyph (the source is the widest, ±30) so
 *  a wire can never hide behind any component. Terminals sit just outside. */
export function boxAround(centre: Point, half = 30): Rect {
  return { minX: centre.x - half, minY: centre.y - half, maxX: centre.x + half, maxY: centre.y + half }
}

// --- segments ---------------------------------------------------------------

export type Orient = 'H' | 'V'
export interface Seg {
  a: Point
  b: Point
  orient: Orient
}

export function routeSegments(points: Point[]): Seg[] {
  const segs: Seg[] = []
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    segs.push({ a, b, orient: Math.abs(a.y - b.y) < 0.5 ? 'H' : 'V' })
  }
  return segs
}

export function polylineLength(points: Point[]): number {
  let total = 0
  for (let i = 0; i + 1 < points.length; i += 1) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  }
  return total
}

/**
 * Project `p` onto a polyline: the closest point that actually LIES ON one of the
 * polyline's segments (a mid-span tap point). Used so a tapped wire ends exactly on
 * the target wire's rendered line, never leaping to a component terminal. Returns
 * the projected point plus the index of the segment it landed on (for a clean
 * perpendicular approach). An empty polyline yields `p` itself on segment -1.
 */
export function nearestPointOnPolyline(
  points: Point[],
  p: Point,
): { point: Point; segment: number } {
  let best: Point = points[0] ?? p
  let bestDist = Infinity
  let bestSeg = points.length ? 0 : -1
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
    const proj = { x: a.x + t * dx, y: a.y + t * dy }
    const dist = Math.hypot(p.x - proj.x, p.y - proj.y)
    if (dist < bestDist) {
      bestDist = dist
      best = proj
      bestSeg = i
    }
  }
  return { point: best, segment: bestSeg }
}

/** Arc-length fraction of the point on a polyline nearest to `p`. */
export function fractionOnPolyline(points: Point[], p: Point): number {
  if (points.length < 2) return 0
  const total = polylineLength(points)
  if (total <= 0) return 0

  const hit = nearestPointOnPolyline(points, p)
  if (hit.segment < 0) return 0

  let travelled = 0
  for (let i = 0; i < hit.segment; i += 1) {
    travelled += Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
    )
  }
  travelled += Math.hypot(
    hit.point.x - points[hit.segment].x,
    hit.point.y - points[hit.segment].y,
  )
  return Math.max(0, Math.min(1, travelled / total))
}

/**
 * Resolve a junction only against the drawing that owns its geometry. Legacy
 * boards used one shared fraction/point, so those fields remain the final
 * compatibility fallback rather than leaking into newly edited projections.
 */
export function tapFractionForProjection(
  tap: WireTap,
  projection: BoardProjection,
  targetPoints: Point[],
): number {
  const own = tap.projectionPositions?.[projection]
  if (own !== undefined) return own
  if (tap.position !== undefined) return tap.position
  return tap.near ? fractionOnPolyline(targetPoints, tap.near) : 0.5
}

/** Resolve an arc-length fraction to a point on a polyline. */
export function pointAtPolylineFraction(points: Point[], fraction: number): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]

  const total = polylineLength(points)
  if (total <= 0) return points[0]
  const target = total * Math.max(0, Math.min(1, fraction))
  let travelled = 0

  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y)
    if (travelled + segmentLength >= target) {
      const t = segmentLength === 0 ? 0 : (target - travelled) / segmentLength
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      }
    }
    travelled += segmentLength
  }
  return points[points.length - 1]
}

/** The point half-way along a polyline (by arc length), always on the line. */
export function midpointOnPolyline(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return points[0]
  const half = polylineLength(points) / 2
  let travelled = 0
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const seg = Math.hypot(b.x - a.x, b.y - a.y)
    if (travelled + seg >= half) {
      const t = seg === 0 ? 0 : (half - travelled) / seg
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    travelled += seg
  }
  return points[points.length - 1]
}

/** Interior intersection of a horizontal and a vertical segment, or null. */
export function hvIntersection(horizontal: Seg, vertical: Seg): Point | null {
  const y = horizontal.a.y
  const x = vertical.a.x
  const xmin = Math.min(horizontal.a.x, horizontal.b.x)
  const xmax = Math.max(horizontal.a.x, horizontal.b.x)
  const ymin = Math.min(vertical.a.y, vertical.b.y)
  const ymax = Math.max(vertical.a.y, vertical.b.y)
  const eps = 0.5
  if (x > xmin + eps && x < xmax - eps && y > ymin + eps && y < ymax - eps) return { x, y }
  return null
}

function segHitsRect(seg: Seg, rect: Rect): boolean {
  if (seg.orient === 'H') {
    const y = seg.a.y
    if (y <= rect.minY || y >= rect.maxY) return false
    return Math.max(seg.a.x, seg.b.x) > rect.minX && Math.min(seg.a.x, seg.b.x) < rect.maxX
  }
  const x = seg.a.x
  if (x <= rect.minX || x >= rect.maxX) return false
  return Math.max(seg.a.y, seg.b.y) > rect.minY && Math.min(seg.a.y, seg.b.y) < rect.maxY
}

export function routeIntersectsRect(points: Point[], rect: Rect): boolean {
  return routeSegments(points).some((seg) => segHitsRect(seg, rect))
}

// --- simplify / lane offset -------------------------------------------------

/**
 * Drop collinear interior vertices (also collapses a backward "ekor" onto its
 * run). Endpoints kept, so terminals stay anchored.
 */
export function simplifyRoute(points: Point[]): Point[] {
  const same = (p: Point, q: Point) => Math.abs(p.x - q.x) < 0.5 && Math.abs(p.y - q.y) < 0.5
  let pts = points.filter((p, i) => i === 0 || !same(p, points[i - 1]))
  let changed = true
  while (changed && pts.length > 2) {
    changed = false
    const out: Point[] = [pts[0]]
    for (let i = 1; i < pts.length - 1; i += 1) {
      const a = out[out.length - 1]
      const b = pts[i]
      const c = pts[i + 1]
      const colH = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5
      const colV = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5
      if (colH || colV) {
        changed = true
        continue
      }
      out.push(b)
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

/** Shift a route sideways into its lane, keeping it orthogonal (H segments move
 *  in y, V segments in x). Endpoints stay anchored. */
export function offsetRoute(points: Point[], lane: number): Point[] {
  if (lane === 0 || points.length < 2) return points
  const segs = routeSegments(points)
  const shifted = segs.map((s) =>
    s.orient === 'H'
      ? { a: { x: s.a.x, y: s.a.y + lane }, b: { x: s.b.x, y: s.b.y + lane }, orient: 'H' as const }
      : { a: { x: s.a.x + lane, y: s.a.y }, b: { x: s.b.x + lane, y: s.b.y }, orient: 'V' as const },
  )
  const out: Point[] = [points[0]]
  for (let i = 0; i < shifted.length; i += 1) {
    if (i === 0) {
      out.push(shifted[0].a)
    } else {
      const prev = shifted[i - 1]
      const cur = shifted[i]
      out.push({ x: prev.orient === 'V' ? prev.b.x : cur.a.x, y: prev.orient === 'H' ? prev.b.y : cur.a.y })
    }
    out.push(shifted[i].b)
  }
  out.push(points[points.length - 1])
  return out
}

// --- flow dots --------------------------------------------------------------

function pointAtDistance(points: Point[], distance: number): Point {
  let remaining = distance
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (remaining <= len || i + 2 === points.length) {
      const t = len < 1e-6 ? 0 : remaining / len
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
    remaining -= len
  }
  return points[points.length - 1]
}

export function flowDotsPolyline(
  points: Point[],
  currentAmps: number,
  timeMs: number,
  reducedMotion: boolean,
): Point[] {
  const total = polylineLength(points)
  if (total < 1) return []
  const spacing = 22
  const pxPerSecond = 26 + Math.min(currentAmps, 20) * 22
  const phase = reducedMotion ? spacing / 2 : ((timeMs / 1000) * pxPerSecond) % spacing
  const dots: Point[] = []
  for (let d = phase; d < total; d += spacing) dots.push(pointAtDistance(points, d))
  return dots
}

/** A moving flow marker: a point plus the local travel direction (degrees), so a
 *  chevron can be rotated to point the way current flows. */
export interface FlowMarker {
  x: number
  y: number
  angle: number
}

/** The segment tangent (degrees) at `distance` along the polyline, with the point. */
function markerAtDistance(points: Point[], distance: number): FlowMarker {
  let remaining = distance
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i]
    const b = points[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (remaining <= len || i + 2 === points.length) {
      const t = len < 1e-6 ? 0 : remaining / len
      return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      }
    }
    remaining -= len
  }
  const last = points[points.length - 1]
  const prev = points[points.length - 2] ?? last
  return {
    x: last.x,
    y: last.y,
    angle: (Math.atan2(last.y - prev.y, last.x - prev.x) * 180) / Math.PI,
  }
}

/**
 * Same travelling cadence as `flowDotsPolyline`, but each sample also carries the
 * local direction so the board can draw a moving ARROW (which way the current
 * runs), not just a dot. `points` must already be in flow order (reversed when the
 * wire's stored orientation is against the current).
 *
 * Viz-consistency: the marker is a "current is present" cue, NOT a magnitude gauge, so
 * its speed is a CONSTANT — identical for 1-phase and 3-phase (a lamp's 0.4 A and a
 * motor's line current animate at the same pace). `currentAmps` is kept in the signature
 * (callers unchanged) but no longer scales the speed. `reducedMotion` → a static frame.
 */
const MARKER_PX_PER_SECOND = 40

export function flowMarkersPolyline(
  points: Point[],
  currentAmps: number,
  timeMs: number,
  reducedMotion: boolean,
  markerSpacingPx = 22,
): FlowMarker[] {
  void currentAmps // speed is deliberately independent of magnitude (see above)
  const total = polylineLength(points)
  if (total < 1) return []
  const spacing = Math.max(12, markerSpacingPx)
  const phase = reducedMotion ? spacing / 2 : ((timeMs / 1000) * MARKER_PX_PER_SECOND) % spacing
  const markers: FlowMarker[] = []
  for (let d = phase; d < total; d += spacing) markers.push(markerAtDistance(points, d))
  return markers
}

// --- terminal overlap resolution (render-only) ------------------------------

/** Rendered terminal radius (matches the SVG circle). */
export const TERMINAL_R = 9
/** Two numbered terminal circles closer than this read as one blob. */
export const TERMINAL_DIAMETER = TERMINAL_R * 2
/** Target separation when nudging different-node terminals apart — a clear gap,
 *  not just touching. */
const NUDGE_SEPARATION = Math.round(TERMINAL_DIAMETER * 1.6)

export interface TerminalPlacement {
  key: string
  /** Electrical node id (from topology). Two terminals with the same node are the
   *  same electrical point; different nodes are NOT connected. */
  node: string | undefined
  point: Point
}

export interface OverlapResolution {
  /** key → display position (only terminals that were merged or nudged appear). */
  displayOf: Map<string, Point>
  /** Terminals to draw as a single clean dot instead of a stacked circle. */
  mergedKeys: Set<string>
  /** One clean junction dot per merged same-node cluster. */
  mergeDots: Point[]
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * PURE RENDER FIX — never touches topology, only where dots are drawn. Terminals
 * that pile within `TERMINAL_DIAMETER`:
 *   - SAME electrical node  → merge into ONE clean junction dot (Case A). The
 *     stacked circles are hidden; one node reads as one point.
 *   - DIFFERENT nodes       → nudge their DISPLAY positions apart onto a small ring
 *     so they are clearly two points (Case B). Nothing is connected or cut — only
 *     the drawing moves; wires follow the new display position.
 * Deterministic (angles by sorted key; no clock, no randomness).
 */
export function resolveTerminalOverlap(
  terminals: TerminalPlacement[],
  options: { ignoreWithinComponent?: boolean } = {},
): OverlapResolution {
  const displayOf = new Map<string, Point>()
  const mergedKeys = new Set<string>()
  const mergeDots: Point[] = []
  const n = terminals.length

  // Cluster coincident terminals (single-link, union-find).
  const parent = terminals.map((_unused, i) => i)
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) root = parent[root]
    while (parent[x] !== root) {
      const next = parent[x]
      parent[x] = root
      x = next
    }
    return root
  }
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (
        options.ignoreWithinComponent &&
        terminals[i].key.slice(0, terminals[i].key.lastIndexOf(':')) ===
          terminals[j].key.slice(0, terminals[j].key.lastIndexOf(':'))
      ) {
        continue
      }
      if (distance(terminals[i].point, terminals[j].point) < TERMINAL_DIAMETER) {
        parent[find(i)] = find(j)
      }
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i += 1) {
    const root = find(i)
    const list = groups.get(root) ?? []
    list.push(i)
    groups.set(root, list)
  }

  for (const indices of groups.values()) {
    if (indices.length < 2) continue // no overlap → display stays at the base point
    const members = indices.map((i) => terminals[i])
    const cx = members.reduce((s, m) => s + m.point.x, 0) / members.length
    const cy = members.reduce((s, m) => s + m.point.y, 0) / members.length
    const nodes = new Set(members.map((m) => m.node))

    if (nodes.size === 1) {
      // Case A: one node, stacked terminals → one dot, hide the doubles.
      mergeDots.push({ x: cx, y: cy })
      for (const m of members) {
        mergedKeys.add(m.key)
        displayOf.set(m.key, { x: cx, y: cy })
      }
    } else {
      // Case B: different nodes → fan out on a ring wide enough that neighbours sit
      // at least NUDGE_SEPARATION apart, so no two look connected.
      const sorted = [...members].sort((a, b) => (a.key < b.key ? -1 : 1))
      const count = sorted.length
      const radius = NUDGE_SEPARATION / (2 * Math.sin(Math.PI / count))
      sorted.forEach((m, index) => {
        const angle = (2 * Math.PI * index) / count
        displayOf.set(m.key, {
          x: cx + radius * Math.cos(angle),
          y: cy + radius * Math.sin(angle),
        })
      })
    }
  }

  return { displayOf, mergedKeys, mergeDots }
}

// --- routing ----------------------------------------------------------------

function unionRect(rects: Rect[]): Rect {
  return {
    minX: Math.min(...rects.map((r) => r.minX)),
    minY: Math.min(...rects.map((r) => r.minY)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    maxY: Math.max(...rects.map((r) => r.maxY)),
  }
}

function spanRect(a: Point, b: Point): Rect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  }
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
}

/** Move a terminal along its physical exit direction until it is just outside
 * the owning device obstacle. This replaces the old fixed-length stub, which
 * could stop inside a large field-device image. */
export function terminalExitPoint(
  terminal: Point,
  direction: Point,
  obstacle?: Rect,
): Point {
  if (!obstacle) {
    return {
      x: terminal.x + direction.x * STUB_LEN,
      y: terminal.y + direction.y * STUB_LEN,
    }
  }
  if (Math.abs(direction.x) >= Math.abs(direction.y) && direction.x !== 0) {
    const edge = direction.x < 0 ? obstacle.minX : obstacle.maxX
    const distance = (edge - terminal.x) / direction.x
    const travel = distance >= 0 ? distance + 1 : STUB_LEN
    return { x: terminal.x + direction.x * travel, y: terminal.y }
  }
  if (direction.y !== 0) {
    const edge = direction.y < 0 ? obstacle.minY : obstacle.maxY
    const distance = (edge - terminal.y) / direction.y
    const travel = distance >= 0 ? distance + 1 : STUB_LEN
    return { x: terminal.x, y: terminal.y + direction.y * travel }
  }
  return { x: terminal.x + STUB_LEN, y: terminal.y }
}

/**
 * Orthogonal candidates between the stub ends: a straight line if aligned; else
 * the two single-bend L-shapes; plus Z go-arounds (2 bends) when a component
 * lies in the span, so a blocked L can fall back to routing around.
 */
function routeCandidates(aEnd: Point, bEnd: Point, obstacles: Rect[]): Point[][] {
  const sameRow = Math.abs(aEnd.y - bEnd.y) < 0.5
  const sameCol = Math.abs(aEnd.x - bEnd.x) < 0.5
  const cands: Point[][] = []
  if (sameRow || sameCol) {
    cands.push([aEnd, bEnd])
  } else {
    cands.push([aEnd, { x: bEnd.x, y: aEnd.y }, bEnd]) // L: horizontal first
    cands.push([aEnd, { x: aEnd.x, y: bEnd.y }, bEnd]) // L: vertical first
  }

  const span = spanRect(aEnd, bEnd)
  const blocking = obstacles.filter((o) => rectsOverlap(o, span))
  if (blocking.length > 0) {
    const box = unionRect(blocking)
    // Two clearance rings, so a clear orthogonal detour reliably exists even on
    // a crowded row/column.
    for (const m of [16, 44]) {
      const top = box.minY - m
      const bottom = box.maxY + m
      const left = box.minX - m
      const right = box.maxX + m
      cands.push([aEnd, { x: aEnd.x, y: top }, { x: bEnd.x, y: top }, bEnd])
      cands.push([aEnd, { x: aEnd.x, y: bottom }, { x: bEnd.x, y: bottom }, bEnd])
      cands.push([aEnd, { x: left, y: aEnd.y }, { x: left, y: bEnd.y }, bEnd])
      cands.push([aEnd, { x: right, y: aEnd.y }, { x: right, y: bEnd.y }, bEnd])
    }
  }
  return cands
}

function countOverlaps(points: Point[], obstacles: Rect[]): number {
  let n = 0
  for (const seg of routeSegments(points)) {
    for (const obstacle of obstacles) if (segHitsRect(seg, obstacle)) n += 1
  }
  return n
}

function routeCost(points: Point[], obstacles: Rect[], others: Seg[]): number {
  const segs = routeSegments(points)
  // Bend count = segment-count − 1; fewer bends preferred.
  let cost = polylineLength(points) + BEND_PENALTY * Math.max(0, segs.length - 1)
  for (const seg of segs) {
    for (const obstacle of obstacles) {
      if (segHitsRect(seg, obstacle)) cost += OVERLAP_PENALTY
    }
    for (const other of others) {
      if (seg.orient === other.orient) continue
      const [h, v] = seg.orient === 'H' ? [seg, other] : [other, seg]
      if (hvIntersection(h, v)) cost += CROSS_PENALTY
    }
  }
  return cost
}

function pointInsideRect(point: Point, rect: Rect): boolean {
  return (
    point.x > rect.minX &&
    point.x < rect.maxX &&
    point.y > rect.minY &&
    point.y < rect.maxY
  )
}

function segmentClear(a: Point, b: Point, obstacles: Rect[]): boolean {
  if (Math.abs(a.x - b.x) >= 0.5 && Math.abs(a.y - b.y) >= 0.5) return false
  const segment: Seg = {
    a,
    b,
    orient: Math.abs(a.y - b.y) < 0.5 ? 'H' : 'V',
  }
  return !obstacles.some((obstacle) => segHitsRect(segment, obstacle))
}

interface VisibilityEdge {
  to: number
  length: number
  orient: Orient
}

interface VisibilityRouteOptions {
  xHints?: number[]
  yHints?: number[]
  edgePenalty?: (segment: Seg) => number | null
}

/**
 * Guaranteed obstacle-free rectilinear fallback. Nodes are the start/end plus
 * obstacle-edge coordinate intersections. Adjacent visible nodes are connected,
 * then Dijkstra minimises length and bends.
 */
const bodyVisibilityCache = new WeakMap<Rect[], Map<string, Point[] | null>>()
function visibilityRoute(
  start: Point,
  end: Point,
  obstacles: Rect[],
  options: VisibilityRouteOptions = {},
): Point[] | null {
  // Corridor candidates repeatedly ask for the same body-only path. Cache only
  // immutable body geometry, never reservation-dependent edge penalties.
  const cacheable = !options.edgePenalty && !options.xHints && !options.yHints
  const key = `${start.x},${start.y}:${end.x},${end.y}`
  let cache = bodyVisibilityCache.get(obstacles)
  if (cacheable && cache?.has(key)) return cache.get(key)!
  let result: Point[] | null = null
  // A short jumper does not need a Cartesian graph of every distant device.
  // Validate the completed local route against ALL obstacles before accepting it.
  if (obstacles.length > 24) {
    const band = expandRect({minX:Math.min(start.x,end.x),minY:Math.min(start.y,end.y),maxX:Math.max(start.x,end.x),maxY:Math.max(start.y,end.y)}, CELL)
    const local = obstacles.filter(obstacle => rectsOverlap(obstacle, band))
    if (local.length < obstacles.length) {
      const candidate = visibilityRouteFull(start,end,local,options)
      if (candidate && routeSegments(candidate).every(segment=>segmentClear(segment.a,segment.b,obstacles))) result=candidate
    }
  }
  result ??= visibilityRouteFull(start,end,obstacles,options)
  if (cacheable) {
    if (!cache) { cache = new Map(); bodyVisibilityCache.set(obstacles,cache) }
    if (cache.size >= 512) cache.clear()
    cache.set(key,result)
  }
  return result
}

function visibilityRouteFull(
  start: Point,
  end: Point,
  obstacles: Rect[],
  options: VisibilityRouteOptions = {},
): Point[] | null {
  if (obstacles.length === 0) {
    return simplifyRoute([
      start,
      { x: end.x, y: start.y },
      end,
    ])
  }
  const bounds = unionRect(obstacles)
  const xs = new Set<number>([
    start.x,
    end.x,
    bounds.minX - 24,
    bounds.maxX + 24,
  ])
  const ys = new Set<number>([
    start.y,
    end.y,
    bounds.minY - 24,
    bounds.maxY + 24,
  ])
  for (const obstacle of obstacles) {
    xs.add(obstacle.minX)
    xs.add(obstacle.maxX)
    ys.add(obstacle.minY)
    ys.add(obstacle.maxY)
  }
  for (const x of options.xHints ?? []) xs.add(x)
  for (const y of options.yHints ?? []) ys.add(y)
  const xValues = [...xs].sort((a, b) => a - b)
  const yValues = [...ys].sort((a, b) => a - b)
  const nodes: Point[] = []
  const nodeOf = new Map<string, number>()
  const keyOf = (x: number, y: number) => `${x}:${y}`
  for (const y of yValues) {
    for (const x of xValues) {
      const point = { x, y }
      if (obstacles.some((obstacle) => pointInsideRect(point, obstacle))) continue
      nodeOf.set(keyOf(x, y), nodes.length)
      nodes.push(point)
    }
  }
  const startIndex = nodeOf.get(keyOf(start.x, start.y))
  const endIndex = nodeOf.get(keyOf(end.x, end.y))
  if (startIndex === undefined || endIndex === undefined) return null

  const edges: VisibilityEdge[][] = Array.from({ length: nodes.length }, () => [])
  const connectLine = (indices: number[], orient: Orient) => {
    indices.sort((a, b) =>
      orient === 'H' ? nodes[a].x - nodes[b].x : nodes[a].y - nodes[b].y,
    )
    for (let index = 0; index + 1 < indices.length; index += 1) {
      const from = indices[index]
      const to = indices[index + 1]
      if (!segmentClear(nodes[from], nodes[to], obstacles)) continue
      const segment: Seg = { a: nodes[from], b: nodes[to], orient }
      const assessedPenalty = options.edgePenalty?.(segment)
      if (assessedPenalty === null) continue
      const penalty = assessedPenalty ?? 0
      const length =
        Math.abs(nodes[from].x - nodes[to].x) +
        Math.abs(nodes[from].y - nodes[to].y) +
        penalty
      edges[from].push({ to, length, orient })
      edges[to].push({ to: from, length, orient })
    }
  }
  for (const y of yValues) {
    connectLine(
      xValues.flatMap((x) => {
        const index = nodeOf.get(keyOf(x, y))
        return index === undefined ? [] : [index]
      }),
      'H',
    )
  }
  for (const x of xValues) {
    connectLine(
      yValues.flatMap((y) => {
        const index = nodeOf.get(keyOf(x, y))
        return index === undefined ? [] : [index]
      }),
      'V',
    )
  }

  // State direction: 0 = start, 1 = horizontal, 2 = vertical.
  const stateCount = nodes.length * 3
  const distances = Array<number>(stateCount).fill(Infinity)
  const previous = Array<number>(stateCount).fill(-1)
  const heap: { state: number; distance: number }[] = []
  const push = (item: { state: number; distance: number }) => {
    heap.push(item)
    let index = heap.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (heap[parent].distance <= item.distance) break
      heap[index] = heap[parent]
      index = parent
    }
    heap[index] = item
  }
  const pop = (): { state: number; distance: number } | undefined => {
    if (heap.length === 0) return undefined
    const root = heap[0]
    const tail = heap.pop()
    if (heap.length > 0 && tail) {
      let index = 0
      while (true) {
        const left = index * 2 + 1
        const right = left + 1
        if (left >= heap.length) break
        const child =
          right < heap.length && heap[right].distance < heap[left].distance ? right : left
        if (heap[child].distance >= tail.distance) break
        heap[index] = heap[child]
        index = child
      }
      heap[index] = tail
    }
    return root
  }

  const firstState = startIndex * 3
  distances[firstState] = 0
  push({ state: firstState, distance: 0 })
  while (heap.length > 0) {
    const current = pop()!
    if (current.distance !== distances[current.state]) continue
    const node = Math.floor(current.state / 3)
    const priorDirection = current.state % 3
    for (const edge of edges[node]) {
      const direction = edge.orient === 'H' ? 1 : 2
      const bend =
        priorDirection !== 0 && priorDirection !== direction ? BEND_PENALTY : 0
      const nextState = edge.to * 3 + direction
      const nextDistance = current.distance + edge.length + bend
      if (nextDistance >= distances[nextState]) continue
      distances[nextState] = nextDistance
      previous[nextState] = current.state
      push({ state: nextState, distance: nextDistance })
    }
  }

  const endStates = [endIndex * 3 + 1, endIndex * 3 + 2, endIndex * 3]
  const bestState = endStates.reduce((best, state) =>
    distances[state] < distances[best] ? state : best,
  )
  if (!Number.isFinite(distances[bestState])) return null
  const reversed: Point[] = []
  let cursor = bestState
  while (cursor >= 0) {
    reversed.push(nodes[Math.floor(cursor / 3)])
    if (cursor === firstState) break
    cursor = previous[cursor]
  }
  if (cursor < 0) return null
  return simplifyRoute(reversed.reverse())
}

function withEndpointStubs(
  a: Point,
  aEnd: Point,
  middle: Point[],
  bEnd: Point,
  b: Point,
): Point[] {
  const points = [a, aEnd, ...middle.slice(1, -1), bEnd, b]
  return points.filter(
    (point, index) =>
      index === 0 ||
      Math.abs(point.x - points[index - 1].x) >= 0.5 ||
      Math.abs(point.y - points[index - 1].y) >= 0.5,
  )
}

/**
 * Route a wire as an orthogonal control polyline: a stub out of each terminal,
 * then the cheapest bend-minimal path (straight / L / Z), shifted into its lane
 * and simplified (no ekor). Rendered by `routeToPath` as clean 90° segments.
 */
export function stubbedRoute(
  a: Point,
  aDir: Point,
  b: Point,
  bDir: Point,
  lane: number,
  obstacles: Rect[] = [],
  others: Seg[] = [],
  endpointObstacles: { a?: Rect; b?: Rect } = {},
): Point[] {
  const aEnd = terminalExitPoint(a, aDir, endpointObstacles.a)
  const bEnd = terminalExitPoint(b, bDir, endpointObstacles.b)
  const finish = (middle: Point[]) =>
    endpointObstacles.a || endpointObstacles.b
      ? withEndpointStubs(a, aEnd, middle, bEnd, b)
      : simplifyRoute([a, ...middle, b])

  // HARD RULE (safety): the wire connects at the TERMINALS (glyph edges) and its
  // MIDDLE run must never enter ANY component glyph — including its own two
  // endpoints. The stubs (terminal → outside) are the only parts allowed to touch
  // an endpoint, and only at its edge. So the middle is routed against ALL
  // obstacles and the overlap check is on the middle only (never the stubs).
  let bestClear: Point[] | null = null
  let bestClearCost = Infinity
  for (const candidate of routeCandidates(aEnd, bEnd, obstacles)) {
    const middle = offsetRoute(simplifyRoute(candidate), lane)
    const full = finish(middle)
    const cost = routeCost(middle, obstacles, others)
    if (countOverlaps(middle, obstacles) === 0 && cost < bestClearCost) {
      bestClearCost = cost
      bestClear = full
    }
  }
  if (bestClear) return bestClear
  const fallback = visibilityRoute(aEnd, bEnd, obstacles)
  if (fallback) return finish(fallback)

  // A valid non-overlapping board always has a route in the unbounded plane.
  // Keep a connected orthogonal emergency shape for malformed imported boards;
  // unlike the removed bestAny fallback, it is never selected merely because it
  // is cheaper than a clear path.
  return withEndpointStubs(
    a,
    aEnd,
    [aEnd, { x: bEnd.x, y: aEnd.y }, bEnd],
    bEnd,
    b,
  )
}

// --- global lane allocation -------------------------------------------------

const LANE_GAP = 8
const MIN_CORRIDOR = 18

interface LaneSeg {
  route: number
  index: number
  coord: number
  lo: number
  hi: number
}

/** Give each long interior segment sharing a corridor its own row/column, so no
 *  two wires ever run on top of each other. A shift never pushes a segment into a
 *  component box. Endpoints (stubs) are never moved. */
function allocateAxis(routes: Point[][], obstacles: Rect[], orient: Orient): void {
  const segs: LaneSeg[] = []
  for (let r = 0; r < routes.length; r += 1) {
    const pts = routes[r]
    // Interior segments only (i-1 and i+1 exist): stubs at the ends never move.
    for (let i = 1; i <= pts.length - 3; i += 1) {
      const a = pts[i]
      const b = pts[i + 1]
      const isH = Math.abs(a.y - b.y) < 0.5
      const isV = Math.abs(a.x - b.x) < 0.5
      if ((orient === 'H' && !isH) || (orient === 'V' && !isV)) continue
      const len = orient === 'H' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)
      if (len < MIN_CORRIDOR) continue
      const coord = orient === 'H' ? a.y : a.x
      const lo = orient === 'H' ? Math.min(a.x, b.x) : Math.min(a.y, b.y)
      const hi = orient === 'H' ? Math.max(a.x, b.x) : Math.max(a.y, b.y)
      segs.push({ route: r, index: i, coord, lo, hi })
    }
  }
  segs.sort((x, y) => x.lo - y.lo || x.route - y.route || x.index - y.index)

  const hitsObstacle = (c: number, lo: number, hi: number): boolean => {
    const seg: Seg =
      orient === 'H'
        ? { a: { x: lo, y: c }, b: { x: hi, y: c }, orient: 'H' }
        : { a: { x: c, y: lo }, b: { x: c, y: hi }, orient: 'V' }
    return obstacles.some((o) => segHitsRect(seg, o))
  }

  const placed: { coord: number; lo: number; hi: number }[] = []
  for (const s of segs) {
    const candidates = [s.coord]
    for (let k = 1; k <= 8; k += 1) {
      candidates.push(s.coord + k * LANE_GAP, s.coord - k * LANE_GAP)
    }
    let chosen = s.coord
    for (const c of candidates) {
      const conflict = placed.some(
        (p) => p.lo < s.hi && p.hi > s.lo && Math.abs(p.coord - c) < LANE_GAP - 1,
      )
      if (!conflict && !hitsObstacle(c, s.lo, s.hi)) {
        chosen = c
        break
      }
    }
    placed.push({ coord: chosen, lo: s.lo, hi: s.hi })
    const pts = routes[s.route]
    if (orient === 'H') {
      pts[s.index].y = chosen
      pts[s.index + 1].y = chosen
    } else {
      pts[s.index].x = chosen
      pts[s.index + 1].x = chosen
    }
  }
}

/** Spread every wire onto its own corridor lane (rows for horizontals, columns
 *  for verticals), globally across all wires. */
export function allocateLanes(polylines: Point[][], obstacles: Rect[] = []): Point[][] {
  const originals = polylines.map((points) => points.map((point) => ({ ...point })))
  const routes = polylines.map((p) => p.map((pt) => ({ x: pt.x, y: pt.y })))
  allocateAxis(routes, obstacles, 'H')
  allocateAxis(routes, obstacles, 'V')
  for (let index = 0; index < routes.length; index += 1) {
    const middle = routes[index].slice(1, -1)
    const orthogonal = routeSegments(routes[index]).every(
      (segment) =>
        Math.abs(segment.a.x - segment.b.x) < 0.5 ||
        Math.abs(segment.a.y - segment.b.y) < 0.5,
    )
    const clear = !obstacles.some((obstacle) => routeIntersectsRect(middle, obstacle))
    if (!orthogonal || !clear) routes[index] = originals[index]
  }
  return routes
}

// --- deterministic global corridor router ---------------------------------

export interface WireRouteEndpoint {
  point: Point
  direction: Point
  obstacle?: Rect
  terminalKey?: string
}

export interface TerminalKeepOut {
  key: string
  rect: Rect
}

export interface WireRouteRequest {
  id: string
  from: WireRouteEndpoint
  to: WireRouteEndpoint
  /** Lower priorities reserve their routes first (ordinary wires before taps). */
  priority?: number
  /** Wires in one bundle are routed consecutively and keep their declared order. */
  bundleKey?: string
  bundleOrder?: number
  bundleSize?: number
  /** Preferred board corridor. It is a preference, never permission to hit a body. */
  preferredSide?: TerminalSide
  /** One intentional mid-span join (tap). All other T-touches remain invalid. */
  join?: { wireId: string; point: Point }
}

export interface RouteReservation {
  wireId: string
  bundleKey?: string
  points: Point[]
  segs: Seg[]
  endpointKeys: [string | undefined, string | undefined]
  endpointStubLengths: [number, number]
  join?: WireRouteRequest['join']
}

export interface RoutedWire {
  id: string
  points: Point[]
  segs: Seg[]
}

interface RouteAssessment {
  valid: boolean
  cost: number
  crossings: number
}

function physicalEndpointStubLength(endpoint: WireRouteEndpoint): number {
  const exit = terminalExitPoint(
    endpoint.point,
    endpoint.direction,
    endpoint.obstacle,
  )
  return (
    Math.abs(exit.x - endpoint.point.x) +
    Math.abs(exit.y - endpoint.point.y)
  )
}

function pointEquals(a: Point, b: Point, epsilon = 0.6): boolean {
  return Math.abs(a.x - b.x) <= epsilon && Math.abs(a.y - b.y) <= epsilon
}

function segmentLength(segment: Seg): number {
  return Math.abs(segment.b.x - segment.a.x) + Math.abs(segment.b.y - segment.a.y)
}

function segmentRange(segment: Seg): { coord: number; lo: number; hi: number } {
  return segment.orient === 'H'
    ? {
        coord: segment.a.y,
        lo: Math.min(segment.a.x, segment.b.x),
        hi: Math.max(segment.a.x, segment.b.x),
      }
    : {
        coord: segment.a.x,
        lo: Math.min(segment.a.y, segment.b.y),
        hi: Math.max(segment.a.y, segment.b.y),
      }
}

function inclusiveHvIntersection(horizontal: Seg, vertical: Seg): {
  point: Point
  horizontalInterior: boolean
  verticalInterior: boolean
} | null {
  const x = vertical.a.x
  const y = horizontal.a.y
  const hLo = Math.min(horizontal.a.x, horizontal.b.x)
  const hHi = Math.max(horizontal.a.x, horizontal.b.x)
  const vLo = Math.min(vertical.a.y, vertical.b.y)
  const vHi = Math.max(vertical.a.y, vertical.b.y)
  const epsilon = 0.5
  if (x < hLo - epsilon || x > hHi + epsilon || y < vLo - epsilon || y > vHi + epsilon) {
    return null
  }
  return {
    point: { x, y },
    horizontalInterior: x > hLo + epsilon && x < hHi - epsilon,
    verticalInterior: y > vLo + epsilon && y < vHi - epsilon,
  }
}

function endpointKeyForSegment(
  index: number,
  segmentCount: number,
  endpointKeys: [string | undefined, string | undefined],
): string | undefined {
  if (index === 0) return endpointKeys[0]
  if (index === segmentCount - 1) return endpointKeys[1]
  return undefined
}

function terminalKeyAtRoutePoint(
  index: number,
  segmentCount: number,
  segment: Seg,
  point: Point,
  endpointKeys: [string | undefined, string | undefined],
): string | undefined {
  const direct = endpointKeyForSegment(index, segmentCount, endpointKeys)
  if (direct) return direct
  // The segment immediately after/before an endpoint stub may meet another
  // conductor at the stub's fan-out vertex. It belongs to that same logical
  // terminal only at that single vertex, never along the rest of the segment.
  if (index === 1 && pointEquals(segment.a, point)) return endpointKeys[0]
  if (index === segmentCount - 2 && pointEquals(segment.b, point)) {
    return endpointKeys[1]
  }
  return undefined
}

function intentionalJoin(
  request: WireRouteRequest,
  reservation: RouteReservation,
  point: Point,
): boolean {
  if (
    request.join &&
    request.join.wireId === reservation.wireId &&
    pointEquals(request.join.point, point)
  ) {
    return true
  }
  return Boolean(
    request.join &&
      reservation.join &&
      request.join.wireId === reservation.join.wireId &&
      pointEquals(request.join.point, reservation.join.point) &&
      pointEquals(request.join.point, point),
  )
}

function visibilityEdgePenalty(
  segment: Seg,
  request: WireRouteRequest,
  reservation: RouteReservation,
  start: Point,
  end: Point,
): number | null {
  const endpointJoin = (point: Point): boolean => {
    if (intentionalJoin(request, reservation, point)) return true
    if (
      pointEquals(point, start) &&
      request.from.terminalKey &&
      reservation.endpointKeys.includes(request.from.terminalKey)
    ) {
      return true
    }
    return Boolean(
      pointEquals(point, end) &&
        request.to.terminalKey &&
        reservation.endpointKeys.includes(request.to.terminalKey),
    )
  }
  let crossings = 0
  for (const existing of reservation.segs) {
    if (segment.orient === existing.orient) {
      const ownRange = segmentRange(segment)
      const existingRange = segmentRange(existing)
      const overlap =
        Math.min(ownRange.hi, existingRange.hi) -
        Math.max(ownRange.lo, existingRange.lo)
      const gap = Math.abs(ownRange.coord - existingRange.coord)
      if (gap >= MIN_PARALLEL_CLEARANCE - 0.5 || overlap < -0.5) continue
      if (gap < 0.5 && overlap <= 0.5) {
        const coordinate = Math.max(ownRange.lo, existingRange.lo)
        const point =
          segment.orient === 'H'
            ? { x: coordinate, y: ownRange.coord }
            : { x: ownRange.coord, y: coordinate }
        if (endpointJoin(point)) continue
      }
      return null
    }
    const horizontal = segment.orient === 'H' ? segment : existing
    const vertical = segment.orient === 'V' ? segment : existing
    const hit = inclusiveHvIntersection(horizontal, vertical)
    if (!hit) continue
    if (endpointJoin(hit.point)) continue
    if (!hit.horizontalInterior || !hit.verticalInterior) return null
    crossings += 1
  }
  return crossings * GLOBAL_CROSS_PENALTY
}

function interactionAssessment(
  points: Point[],
  request: WireRouteRequest,
  reservations: RouteReservation[],
): { valid: boolean; crossings: number } {
  const candidate = routeSegments(points)
  const candidateKeys: [string | undefined, string | undefined] = [
    request.from.terminalKey,
    request.to.terminalKey,
  ]
  const candidateStubLengths: [number, number] = [
    physicalEndpointStubLength(request.from) + SHARED_TERMINAL_FAN_STUB,
    physicalEndpointStubLength(request.to) + SHARED_TERMINAL_FAN_STUB,
  ]
  let crossings = 0

  for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
    const own = candidate[candidateIndex]
    const ownKey = endpointKeyForSegment(candidateIndex, candidate.length, candidateKeys)
    for (const reservation of reservations) {
      for (
        let reservedIndex = 0;
        reservedIndex < reservation.segs.length;
        reservedIndex += 1
      ) {
        const existing = reservation.segs[reservedIndex]
        const existingKey = endpointKeyForSegment(
          reservedIndex,
          reservation.segs.length,
          reservation.endpointKeys,
        )

        if (own.orient === existing.orient) {
          const a = segmentRange(own)
          const b = segmentRange(existing)
          const overlap = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo)
          const gap = Math.abs(a.coord - b.coord)
          if (gap >= MIN_PARALLEL_CLEARANCE - 0.5 || overlap < -0.5) continue
          const ownStubLength =
            candidateIndex === 0
              ? candidateStubLengths[0]
              : candidateIndex === candidate.length - 1
                ? candidateStubLengths[1]
                : 0
          const existingStubLength =
            reservedIndex === 0
              ? reservation.endpointStubLengths[0]
              : reservedIndex === reservation.segs.length - 1
                ? reservation.endpointStubLengths[1]
                : 0
          const terminalComponent = (terminalKey?: string): string | undefined => {
            if (!terminalKey) return undefined
            const separator = terminalKey.lastIndexOf(':')
            return separator >= 0
              ? terminalKey.slice(0, separator)
              : terminalKey
          }
          // Distinct holes in one physical terminal bank can have closer
          // calibrated stubs than the free-air lane clearance. They remain
          // separate centerlines and receive no exemption beyond the short
          // endpoint segments owned by that same device.
          if (
            ownKey &&
            existingKey &&
            ownKey !== existingKey &&
            terminalComponent(ownKey) === terminalComponent(existingKey) &&
            gap >= 0.5 &&
            segmentLength(own) <= ownStubLength + 0.5 &&
            segmentLength(existing) <= existingStubLength + 0.5
          ) {
            continue
          }
          // A shared physical terminal may share exactly the calibrated route
          // from its hole to the component edge. Large field assets can have a
          // longer physical stub than a small IEC glyph; neither may share the
          // conductor after the shorter endpoint has left its own body.
          if (
            ownKey &&
            existingKey &&
            ownKey === existingKey &&
            overlap <= Math.min(ownStubLength, existingStubLength) + 0.5
          ) {
            continue
          }
          if (gap < 0.5 && overlap <= 0.5) {
            const coordinate = Math.max(a.lo, b.lo)
            const touchPoint =
              own.orient === 'H'
                ? { x: coordinate, y: a.coord }
                : { x: a.coord, y: coordinate }
            if (intentionalJoin(request, reservation, touchPoint)) continue
            const ownTouchKey = terminalKeyAtRoutePoint(
              candidateIndex,
              candidate.length,
              own,
              touchPoint,
              candidateKeys,
            )
            const existingTouchKey = terminalKeyAtRoutePoint(
              reservedIndex,
              reservation.segs.length,
              existing,
              touchPoint,
              reservation.endpointKeys,
            )
            if (ownTouchKey && ownTouchKey === existingTouchKey) continue
          }
          if (
            request.join &&
            reservation.join &&
            request.join.wireId === reservation.join.wireId &&
            pointEquals(request.join.point, reservation.join.point) &&
            candidateIndex === candidate.length - 1 &&
            reservedIndex === reservation.segs.length - 1
          ) {
            continue
          }
          // A collinear overlap or end-touch reads as one conductor: forbidden.
          return { valid: false, crossings }
        }

        const horizontal = own.orient === 'H' ? own : existing
        const vertical = own.orient === 'V' ? own : existing
        const hit = inclusiveHvIntersection(horizontal, vertical)
        if (!hit) continue
        if (intentionalJoin(request, reservation, hit.point)) continue
        const ownTouchKey = terminalKeyAtRoutePoint(
          candidateIndex,
          candidate.length,
          own,
          hit.point,
          candidateKeys,
        )
        const existingTouchKey = terminalKeyAtRoutePoint(
          reservedIndex,
          reservation.segs.length,
          existing,
          hit.point,
          reservation.endpointKeys,
        )
        if (ownTouchKey && ownTouchKey === existingTouchKey) continue

        if (hit.horizontalInterior && hit.verticalInterior) {
          crossings += 1
          continue
        }
        // A bend/end landing on another wire would look like an unmodelled
        // junction or a T-splice. Only the explicit tap case above may do this.
        return { valid: false, crossings }
      }
    }
  }

  return { valid: true, crossings }
}

function concatRoutes(...routes: Point[][]): Point[] {
  const out: Point[] = []
  for (const route of routes) {
    for (const point of route) {
      if (out.length > 0 && pointEquals(out[out.length - 1], point)) continue
      out.push(point)
    }
  }
  return simplifyRoute(out)
}

function corridorCoordinate(
  a: Point,
  b: Point,
  obstacles: Rect[],
  side: TerminalSide,
  lane: number,
  boundsOverride?: Rect,
): number {
  const pool =
    boundsOverride
      ? [boundsOverride]
      : obstacles.length > 0
      ? obstacles
      : [
          {
            minX: Math.min(a.x, b.x),
            maxX: Math.max(a.x, b.x),
            minY: Math.min(a.y, b.y),
            maxY: Math.max(a.y, b.y),
          },
        ]
  const margin = 16 + lane * ROUTE_LANE_GAP
  if (side === 'top') return Math.min(...pool.map((rect) => rect.minY)) - margin
  if (side === 'bottom') return Math.max(...pool.map((rect) => rect.maxY)) + margin
  if (side === 'left') return Math.min(...pool.map((rect) => rect.minX)) - margin
  return Math.max(...pool.map((rect) => rect.maxX)) + margin
}

function sideForDirection(direction: Point, fallback: TerminalSide): TerminalSide {
  if (Math.abs(direction.x) >= Math.abs(direction.y) && direction.x !== 0) {
    return direction.x < 0 ? 'left' : 'right'
  }
  if (direction.y !== 0) return direction.y < 0 ? 'top' : 'bottom'
  return fallback
}

function boundaryPoint(
  point: Point,
  side: TerminalSide,
  bounds: Rect,
  margin: number,
): Point {
  if (side === 'top') return { x: point.x, y: bounds.minY - margin }
  if (side === 'bottom') return { x: point.x, y: bounds.maxY + margin }
  if (side === 'left') return { x: bounds.minX - margin, y: point.y }
  return { x: bounds.maxX + margin, y: point.y }
}

function perimeterToCorridor(
  boundary: Point,
  boundarySide: TerminalSide,
  target: Point,
  corridorSide: TerminalSide,
  bounds: Rect,
  margin: number,
): Point[] {
  const left = bounds.minX - margin
  const right = bounds.maxX + margin
  const top = bounds.minY - margin
  const bottom = bounds.maxY + margin
  if (boundarySide === corridorSide) return [boundary, target]

  if (corridorSide === 'top') {
    if (boundarySide === 'left') return [boundary, { x: left, y: top }, target]
    if (boundarySide === 'right') return [boundary, { x: right, y: top }, target]
    const x = Math.abs(boundary.x - left) <= Math.abs(right - boundary.x) ? left : right
    return [boundary, { x, y: bottom }, { x, y: top }, target]
  }
  if (corridorSide === 'bottom') {
    if (boundarySide === 'left') return [boundary, { x: left, y: bottom }, target]
    if (boundarySide === 'right') return [boundary, { x: right, y: bottom }, target]
    const x = Math.abs(boundary.x - left) <= Math.abs(right - boundary.x) ? left : right
    return [boundary, { x, y: top }, { x, y: bottom }, target]
  }
  if (corridorSide === 'left') {
    if (boundarySide === 'top') return [boundary, { x: left, y: top }, target]
    if (boundarySide === 'bottom') return [boundary, { x: left, y: bottom }, target]
    const y = Math.abs(boundary.y - top) <= Math.abs(bottom - boundary.y) ? top : bottom
    return [boundary, { x: right, y }, { x: left, y }, target]
  }
  if (boundarySide === 'top') return [boundary, { x: right, y: top }, target]
  if (boundarySide === 'bottom') return [boundary, { x: right, y: bottom }, target]
  const y = Math.abs(boundary.y - top) <= Math.abs(bottom - boundary.y) ? top : bottom
  return [boundary, { x: left, y }, { x: right, y }, target]
}

function endpointToCorridor(
  endpoint: Point,
  direction: Point,
  target: Point,
  corridorSide: TerminalSide,
  obstacles: Rect[],
  bounds: Rect,
  margin: number,
): Point[] | null {
  if (segmentClear(endpoint, target, obstacles)) return [endpoint, target]
  const outwardSide = sideForDirection(direction, corridorSide)
  const boundary = boundaryPoint(endpoint, outwardSide, bounds, margin)
  const outward = segmentClear(endpoint, boundary, obstacles)
    ? [endpoint, boundary]
    : visibilityRoute(endpoint, boundary, obstacles)
  if (!outward) return null
  return concatRoutes(
    outward,
    perimeterToCorridor(boundary, outwardSide, target, corridorSide, bounds, margin),
  )
}

function corridorTarget(
  endpoint: Point,
  outwardSide: TerminalSide,
  corridorSide: TerminalSide,
  coordinate: number,
  bounds: Rect,
  margin: number,
): Point {
  const left = bounds.minX - margin
  const right = bounds.maxX + margin
  const top = bounds.minY - margin
  const bottom = bounds.maxY + margin
  if (corridorSide === 'top' || corridorSide === 'bottom') {
    const y = coordinate
    if (outwardSide === 'left') return { x: left, y }
    if (outwardSide === 'right') return { x: right, y }
    if (outwardSide === corridorSide) return { x: endpoint.x, y }
    return {
      x: endpoint.x <= (bounds.minX + bounds.maxX) / 2 ? left : right,
      y,
    }
  }
  const x = coordinate
  if (outwardSide === 'top') return { x, y: top }
  if (outwardSide === 'bottom') return { x, y: bottom }
  if (outwardSide === corridorSide) return { x, y: endpoint.y }
  return {
    x,
    y: endpoint.y <= (bounds.minY + bounds.maxY) / 2 ? top : bottom,
  }
}

function normalizedTerminalDirection(direction: Point): Point {
  if (Math.abs(direction.x) >= Math.abs(direction.y) && direction.x !== 0) {
    return { x: Math.sign(direction.x), y: 0 }
  }
  if (direction.y !== 0) return { x: 0, y: Math.sign(direction.y) }
  return { x: 0, y: 0 }
}

function terminalFanRoute(
  endpoint: Point,
  direction: Point,
  fanIndex: number,
): Point[] {
  const normal = normalizedTerminalDirection(direction)
  if (fanIndex <= 0 || (normal.x === 0 && normal.y === 0)) return [endpoint]
  const forwardDistance =
    12 + (fanIndex - 1) * (ROUTE_LANE_GAP + 3)
  const forward = {
    x: endpoint.x + normal.x * forwardDistance,
    y: endpoint.y + normal.y * forwardDistance,
  }
  const magnitude = Math.ceil(fanIndex / 2) * (ROUTE_LANE_GAP + 3)
  const sign = fanIndex % 2 === 1 ? 1 : -1
  const tangent = { x: -normal.y * sign, y: normal.x * sign }
  return [
    endpoint,
    forward,
    {
      x: forward.x + tangent.x * magnitude,
      y: forward.y + tangent.y * magnitude,
    },
  ]
}

function corridorRoute(
  request: WireRouteRequest,
  obstacles: Rect[],
  side: TerminalSide,
  lane: number,
  fromFanLane = 0,
  toFanLane = 0,
  boundsOverride?: Rect,
): Point[] | null {
  const a = request.from.point
  const b = request.to.point
  const aEnd = terminalExitPoint(a, request.from.direction, request.from.obstacle)
  const bEnd = terminalExitPoint(b, request.to.direction, request.to.obstacle)
  const fromFanRoute = terminalFanRoute(
    aEnd,
    request.from.direction,
    fromFanLane,
  )
  const toFanRoute = terminalFanRoute(bEnd, request.to.direction, toFanLane)
  const aFan = fromFanRoute[fromFanRoute.length - 1]
  const bFan = toFanRoute[toFanRoute.length - 1]
  const coordinate = corridorCoordinate(
    aFan,
    bFan,
    obstacles,
    side,
    lane,
    boundsOverride,
  )
  const fallbackBounds: Rect = {
    minX: Math.min(aFan.x, bFan.x),
    minY: Math.min(aFan.y, bFan.y),
    maxX: Math.max(aFan.x, bFan.x),
    maxY: Math.max(aFan.y, bFan.y),
  }
  const bounds =
    boundsOverride ??
    (obstacles.length > 0 ? unionRect(obstacles) : fallbackBounds)
  const margin = 16 + lane * ROUTE_LANE_GAP
  const fromOutwardSide = sideForDirection(request.from.direction, side)
  const toOutwardSide = sideForDirection(request.to.direction, side)
  const naturalEntry =
    side === 'top' || side === 'bottom'
      ? { x: aFan.x, y: coordinate }
      : { x: coordinate, y: aFan.y }
  const naturalExit =
    side === 'top' || side === 'bottom'
      ? { x: bFan.x, y: coordinate }
      : { x: coordinate, y: bFan.y }
  const entry = segmentClear(aFan, naturalEntry, obstacles)
    ? naturalEntry
    : corridorTarget(
        aFan,
        fromOutwardSide,
        side,
        coordinate,
        bounds,
        margin,
      )
  const exit = segmentClear(bFan, naturalExit, obstacles)
    ? naturalExit
    : corridorTarget(
        bFan,
        toOutwardSide,
        side,
        coordinate,
        bounds,
        margin,
      )
  const first = endpointToCorridor(
    aFan,
    request.from.direction,
    entry,
    side,
    obstacles,
    bounds,
    margin,
  )
  const lastFromEndpoint = endpointToCorridor(
    bFan,
    request.to.direction,
    exit,
    side,
    obstacles,
    bounds,
    margin,
  )
  const last = lastFromEndpoint ? [...lastFromEndpoint].reverse() : null
  const middleCore =
    first && last && segmentClear(entry, exit, obstacles)
      ? concatRoutes(first, [entry, exit], last)
      : null
  const middle = middleCore
    ? concatRoutes(fromFanRoute, middleCore, [...toFanRoute].reverse())
    : null
  return middle ? withEndpointStubs(a, aEnd, middle, bEnd, b) : null
}

function routingEnvelope(
  request: WireRouteRequest,
  bodyObstacles: Rect[],
): Rect {
  const componentExtent =
    bodyObstacles.length > 0
      ? unionRect(bodyObstacles)
      : {
          minX: Math.min(request.from.point.x, request.to.point.x),
          minY: Math.min(request.from.point.y, request.to.point.y),
          maxX: Math.max(request.from.point.x, request.to.point.x),
          maxY: Math.max(request.from.point.y, request.to.point.y),
        }
  return expandRect(componentExtent, ROUTE_ENVELOPE_MARGIN)
}

function routeInsideEnvelope(points: Point[], envelope: Rect): boolean {
  const epsilon = 0.5
  return points.every(
    (point) =>
      point.x >= envelope.minX - epsilon &&
      point.x <= envelope.maxX + epsilon &&
      point.y >= envelope.minY - epsilon &&
      point.y <= envelope.maxY + epsilon,
  )
}

function assessGlobalRoute(
  points: Point[],
  request: WireRouteRequest,
  bodyObstacles: Rect[],
  foreignTerminalKeepOuts: TerminalKeepOut[],
  reservations: RouteReservation[],
): RouteAssessment {
  if (points.length < 2) return { valid: false, cost: Infinity, crossings: 0 }
  if (!routeInsideEnvelope(points, routingEnvelope(request, bodyObstacles))) {
    return { valid: false, cost: Infinity, crossings: 0 }
  }
  const segments = routeSegments(points)
  const orthogonal = segments.every(
    (segment) =>
      Math.abs(segment.a.x - segment.b.x) < 0.5 ||
      Math.abs(segment.a.y - segment.b.y) < 0.5,
  )
  if (!orthogonal) return { valid: false, cost: Infinity, crossings: 0 }
  const middle = points.slice(1, -1)
  if (bodyObstacles.some((obstacle) => routeIntersectsRect(middle, obstacle))) {
    return { valid: false, cost: Infinity, crossings: 0 }
  }
  const fromComponentKey = request.from.terminalKey?.slice(
    0,
    request.from.terminalKey.lastIndexOf(':'),
  )
  const toComponentKey = request.to.terminalKey?.slice(
    0,
    request.to.terminalKey.lastIndexOf(':'),
  )
  if (
    foreignTerminalKeepOuts.some((keepOut) => {
      const separator = keepOut.key.lastIndexOf(':')
      const componentKey = separator >= 0 ? keepOut.key.slice(0, separator) : keepOut.key
      const segments = routeSegments(points)
      return segments.some((segment, index) => {
        // Calibrated physical terminal banks can have adjacent face halos. Only
        // the owning endpoint stub may enter that bank; every middle segment
        // and every conductor from another component still observes keep-out.
        if (componentKey === fromComponentKey && index === 0) return false
        if (componentKey === toComponentKey && index === segments.length - 1) return false
        return segHitsRect(segment, keepOut.rect)
      })
    })
  ) {
    return { valid: false, cost: Infinity, crossings: 0 }
  }
  const interaction = interactionAssessment(points, request, reservations)
  if (!interaction.valid) {
    return { valid: false, cost: Infinity, crossings: interaction.crossings }
  }
  const length = polylineLength(points)
  return {
    valid: true,
    crossings: interaction.crossings,
    cost:
      length +
      Math.max(0, segments.length - 1) * BEND_PENALTY +
      interaction.crossings * GLOBAL_CROSS_PENALTY,
  }
}

function oppositeSide(side: TerminalSide): TerminalSide {
  if (side === 'top') return 'bottom'
  if (side === 'bottom') return 'top'
  if (side === 'left') return 'right'
  return 'left'
}

function localRoutingBounds(
  request: WireRouteRequest,
  obstacles: Rect[],
): Rect {
  const span: Rect = {
    minX: Math.min(request.from.point.x, request.to.point.x),
    minY: Math.min(request.from.point.y, request.to.point.y),
    maxX: Math.max(request.from.point.x, request.to.point.x),
    maxY: Math.max(request.from.point.y, request.to.point.y),
  }
  const searchBand = expandRect(span, CELL / 2)
  const relevant = obstacles.filter((obstacle) =>
    rectsOverlap(obstacle, searchBand),
  )
  const endpointObstacles = [request.from.obstacle, request.to.obstacle].filter(
    (obstacle): obstacle is Rect => Boolean(obstacle),
  )
  const members = [...relevant, ...endpointObstacles]
  return members.length > 0 ? unionRect(members) : span
}

function routeOneGlobally(
  request: WireRouteRequest,
  bodyObstacles: Rect[],
  terminalKeepOuts: TerminalKeepOut[],
  reservations: RouteReservation[],
  automaticSide: TerminalSide,
  bounded = false,
): Point[] | null {
  const foreignTerminalKeepOuts = terminalKeepOuts
    .filter(
      (keepOut) =>
        keepOut.key !== request.from.terminalKey &&
        keepOut.key !== request.to.terminalKey,
    )
  // Terminal keep-outs are validated against the finished route, but are not
  // expanded into visibility-graph coordinates. Component boxes already contain
  // their terminal field; adding every individual circle here turns a dense
  // star-delta board into a needlessly quadratic graph.
  const baseObstacles = bodyObstacles
  const localBounds = localRoutingBounds(request, baseObstacles)
  const side = request.preferredSide ?? automaticSide
  const lane = request.bundleOrder ?? 0
  let best: Point[] | null = null
  let bestRank: [crossings: number, bends: number, length: number] = [
    Infinity,
    Infinity,
    Infinity,
  ]
  const rankIsBetter = (
    candidate: [number, number, number],
    current: [number, number, number],
  ): boolean =>
    candidate[0] < current[0] ||
    (candidate[0] === current[0] && candidate[1] < current[1]) ||
    (candidate[0] === current[0] &&
      candidate[1] === current[1] &&
      candidate[2] < current[2])
  const evaluateCandidate = (variant: Point[]) => {
    const normalized = simplifyRoute(variant)
    const assessment = assessGlobalRoute(
      normalized,
      request,
      bodyObstacles,
      foreignTerminalKeepOuts,
      reservations,
    )
    const rank: [number, number, number] = [
      assessment.crossings,
      Math.max(0, routeSegments(normalized).length - 1),
      polylineLength(normalized),
    ]
    if (assessment.valid && rankIsBetter(rank, bestRank)) {
      best = normalized
      bestRank = rank
    }
  }
  const consider = (candidate: Point[] | null) => {
    if (!candidate || candidate.length < 2) return
    evaluateCandidate(candidate)
  }

  // Geometry is decided before labels. Search the compact straight/L/dogleg
  // family first and accept its shortest valid member even when the conductor
  // is too short for three printed identifiers.
  const localOffsets = [0]
  for (let step = 1; step <= MAX_LOCAL_LANE_ATTEMPTS; step += 1) {
    localOffsets.push(step * ROUTE_LANE_GAP, -step * ROUTE_LANE_GAP)
  }
  for (const offset of localOffsets) {
    consider(
      stubbedRoute(
        request.from.point,
        request.from.direction,
        request.to.point,
        request.to.direction,
        offset,
        baseObstacles,
        [],
        { a: request.from.obstacle, b: request.to.obstacle },
      ),
    )
  }
  if (best) return best

  const corridorAttempts = MAX_LOCAL_LANE_ATTEMPTS
  if (request.preferredSide) {
    for (let extra = 0; extra <= corridorAttempts; extra += 1) {
      consider(
        corridorRoute(
          request,
          baseObstacles,
          side,
          lane + extra,
          0,
          0,
          localBounds,
        ),
      )
    }
  } else {
    for (let extra = 0; extra <= corridorAttempts; extra += 1) {
      consider(
        corridorRoute(
          request,
          baseObstacles,
          side,
          lane + extra,
          0,
          0,
          localBounds,
        ),
      )
      consider(
        corridorRoute(
          request,
          baseObstacles,
          oppositeSide(side),
          lane + extra,
          0,
          0,
          localBounds,
        ),
      )
    }
  }
  if (best) return best

  // Dense boards first run every conductor through the bounded candidate family.
  // Only the small set that cannot be placed locally is retried with the expensive
  // fan/visibility search by routeInOrder. Previously every difficult late wire ran
  // thousands of candidates while the Android UI thread was blocked.
  if (bounded) return null

  // If every regular corridor lands on another wire's bend, derive dogleg
  // coordinates from the occupied lanes themselves. Offsetting by one lane
  // turns an end-touch into either clear separation or a true interior 90°
  // crossing, which the hop renderer can represent unambiguously.
  const aEnd = terminalExitPoint(
    request.from.point,
    request.from.direction,
    request.from.obstacle,
  )
  const bEnd = terminalExitPoint(
    request.to.point,
    request.to.direction,
    request.to.obstacle,
  )
  const horizontalLanes = new Set<number>()
  const verticalLanes = new Set<number>()
  for (const reservation of reservations) {
    for (const segment of reservation.segs) {
      const coordinate = segment.orient === 'H' ? segment.a.y : segment.a.x
      const target = segment.orient === 'H' ? horizontalLanes : verticalLanes
      target.add(coordinate - MIN_PARALLEL_CLEARANCE)
      target.add(coordinate + MIN_PARALLEL_CLEARANCE)
      target.add(coordinate - ROUTE_LANE_GAP)
      target.add(coordinate + ROUTE_LANE_GAP)
    }
  }
  const envelope = routingEnvelope(request, bodyObstacles)
  const relevantObstacles = baseObstacles.filter((obstacle) =>
    rectsOverlap(obstacle, expandRect(localBounds, ROUTE_LANE_GAP)),
  )
  for (const obstacle of relevantObstacles) {
    horizontalLanes.add(obstacle.minY - ROUTE_LANE_GAP)
    horizontalLanes.add(obstacle.maxY + ROUTE_LANE_GAP)
    verticalLanes.add(obstacle.minX - ROUTE_LANE_GAP)
    verticalLanes.add(obstacle.maxX + ROUTE_LANE_GAP)
  }
  horizontalLanes.add((aEnd.y + bEnd.y) / 2)
  verticalLanes.add((aEnd.x + bEnd.x) / 2)
  for (let step = 0; step <= MAX_LOCAL_LANE_ATTEMPTS; step += 1) {
    const offset = 16 + step * ROUTE_LANE_GAP
    horizontalLanes.add(localBounds.minY - offset)
    horizontalLanes.add(localBounds.maxY + offset)
    verticalLanes.add(localBounds.minX - offset)
    verticalLanes.add(localBounds.maxX + offset)
  }
  const gridMinX =
    Math.ceil((localBounds.minX - 16) / ROUTE_LANE_GAP) * ROUTE_LANE_GAP
  const gridMaxX = localBounds.maxX + 16
  const gridMinY =
    Math.ceil((localBounds.minY - 16) / ROUTE_LANE_GAP) * ROUTE_LANE_GAP
  const gridMaxY = localBounds.maxY + 16
  for (let x = gridMinX; x <= gridMaxX; x += ROUTE_LANE_GAP) {
    verticalLanes.add(x)
  }
  for (let y = gridMinY; y <= gridMaxY; y += ROUTE_LANE_GAP) {
    horizontalLanes.add(y)
  }
  for (const y of [...horizontalLanes]) {
    if (y < envelope.minY || y > envelope.maxY) horizontalLanes.delete(y)
  }
  for (const x of [...verticalLanes]) {
    if (x < envelope.minX || x > envelope.maxX) verticalLanes.delete(x)
  }
  const nearestLaneHints = (
    values: Set<number>,
    fromCoordinate: number,
    toCoordinate: number,
  ): number[] =>
    [...values]
      .sort(
        (left, right) =>
          Math.min(
            Math.abs(left - fromCoordinate),
            Math.abs(left - toCoordinate),
          ) -
            Math.min(
              Math.abs(right - fromCoordinate),
              Math.abs(right - toCoordinate),
            ) ||
          left - right,
      )
      .slice(0, 64)
  const horizontalHints = nearestLaneHints(horizontalLanes, aEnd.y, bEnd.y)
  const verticalHints = nearestLaneHints(verticalLanes, aEnd.x, bEnd.x)
  const fanLimit = MAX_LOCAL_LANE_ATTEMPTS
  const fanPairs: Array<[number, number]> = [[0, 0]]
  const addFanPair = (fromFan: number, toFan: number) => {
    if (
      !fanPairs.some(
        ([existingFrom, existingTo]) =>
          existingFrom === fromFan && existingTo === toFan,
      )
    ) {
      fanPairs.push([fromFan, toFan])
    }
  }
  for (let fan = 1; fan <= fanLimit; fan += 1) {
    addFanPair(fan, 0)
    addFanPair(0, fan)
    addFanPair(fan, fan)
    if (fan < fanLimit) {
      addFanPair(fan, fan + 1)
      addFanPair(fan + 1, fan)
    }
    if (fan > 1) {
      addFanPair(fan, 1)
      addFanPair(1, fan)
    }
  }
  for (const [fromFan, toFan] of fanPairs) {
    const fromFanRoute = terminalFanRoute(
      aEnd,
      request.from.direction,
      fromFan,
    )
    const toFanRoute = terminalFanRoute(bEnd, request.to.direction, toFan)
    const aFan = fromFanRoute[fromFanRoute.length - 1]
    const bFan = toFanRoute[toFanRoute.length - 1]
    const finishFanCandidate = (core: Point[]) =>
      withEndpointStubs(
        request.from.point,
        aEnd,
        concatRoutes(fromFanRoute, core, [...toFanRoute].reverse()),
        bEnd,
        request.to.point,
      )
    consider(
      finishFanCandidate([aFan, { x: bFan.x, y: aFan.y }, bFan]),
    )
    consider(
      finishFanCandidate([aFan, { x: aFan.x, y: bFan.y }, bFan]),
    )
    for (const y of horizontalHints.slice(0, 32)) {
      consider(
        finishFanCandidate([
          aFan,
          { x: aFan.x, y },
          { x: bFan.x, y },
          bFan,
        ]),
      )
    }
    for (const x of verticalHints.slice(0, 32)) {
      consider(
        finishFanCandidate([
          aFan,
          { x, y: aFan.y },
          { x, y: bFan.y },
          bFan,
        ]),
      )
    }
  }
  if (best) return best

  for (const y of horizontalHints) {
    consider(
      withEndpointStubs(
        request.from.point,
        aEnd,
        [aEnd, { x: aEnd.x, y }, { x: bEnd.x, y }, bEnd],
        bEnd,
        request.to.point,
      ),
    )
  }
  for (const x of verticalHints) {
    consider(
      withEndpointStubs(
        request.from.point,
        aEnd,
        [aEnd, { x, y: aEnd.y }, { x, y: bEnd.y }, bEnd],
        bEnd,
        request.to.point,
      ),
    )
  }
  if (best) return best

  // Final search uses a rectilinear visibility graph augmented by every occupied
  // lane. Existing wires are soft crossing obstacles (with a high cost) but hard
  // overlap/end-touch obstacles, so Dijkstra can still escape a closed wire loop
  // through a hop-safe interior crossing.
  // Visibility graphs grow with |X|×|Y|. Nearby reserved lanes contain the
  // useful escape channels; feeding every bend back into the graph made dense
  // star–delta boards quadratic without improving the accepted path.
  const xHints = new Set<number>(verticalHints)
  const yHints = new Set<number>(horizontalHints)
  const visibilityFallback = (): Point[] | null => {
    const visible = visibilityRoute(aEnd, bEnd, baseObstacles, {
      xHints: [...xHints],
      yHints: [...yHints],
      edgePenalty: (segment) => {
        let penalty = 0
        for (const reservation of reservations) {
          const assessed = visibilityEdgePenalty(
            segment,
            request,
            reservation,
            aEnd,
            bEnd,
          )
          if (assessed === null) return null
          penalty += assessed
        }
        return penalty
      },
    })
    if (!visible) return null
    const route = withEndpointStubs(
      request.from.point,
      aEnd,
      visible,
      bEnd,
      request.to.point,
    )
    return (
      assessGlobalRoute(
        route,
        request,
        bodyObstacles,
        foreignTerminalKeepOuts,
        reservations,
      ).valid ? route : null
    )
  }

  // Exhaust independent port fan-outs before declaring a malformed import.
  // A shared outer lane can be clear while one endpoint column lands on an
  // existing bend; scanning the two fixed ports independently finds the nearby
  // hop-safe column without ever accepting an invalid post-shift route.
  const perpendicularSides: [TerminalSide, TerminalSide] =
    side === 'top' || side === 'bottom'
      ? ['left', 'right']
      : ['top', 'bottom']
  const emergencySides = request.preferredSide
    ? [side]
    : [side, oppositeSide(side), ...perpendicularSides]
  for (const emergencySide of emergencySides) {
    for (let outer = 0; outer <= MAX_LOCAL_LANE_ATTEMPTS; outer += 1) {
      for (const [fromFan, toFan] of fanPairs) {
        const candidate = corridorRoute(
          request,
          baseObstacles,
          emergencySide,
          lane + outer,
          fromFan,
          toFan,
          localBounds,
        )
        if (candidate) evaluateCandidate(candidate)
      }
    }
  }
  if (best) return best

  const componentBounds =
    bodyObstacles.length > 0
      ? unionRect(bodyObstacles)
      : {
          minX: Math.min(aEnd.x, bEnd.x),
          minY: Math.min(aEnd.y, bEnd.y),
          maxX: Math.max(aEnd.x, bEnd.x),
          maxY: Math.max(aEnd.y, bEnd.y),
        }
  const outerSides: TerminalSide[] = request.preferredSide
    ? [
        request.preferredSide,
        oppositeSide(request.preferredSide),
        ...(request.preferredSide === 'top' ||
        request.preferredSide === 'bottom'
          ? (['left', 'right'] as TerminalSide[])
          : (['top', 'bottom'] as TerminalSide[])),
      ]
    : ['top', 'bottom', 'left', 'right']
  const outerFanPairs = [...fanPairs]
  for (
    let fan = MAX_LOCAL_LANE_ATTEMPTS + 1;
    fan <= MAX_LOCAL_LANE_ATTEMPTS + 6;
    fan += 1
  ) {
    outerFanPairs.push(
      [fan, 0],
      [0, fan],
      [fan, 1],
      [1, fan],
      [fan, fan],
    )
  }
  for (let outer = 0; outer <= MAX_LOCAL_LANE_ATTEMPTS; outer += 1) {
    const margin = 16 + outer * ROUTE_LANE_GAP
    for (const outerSide of outerSides) {
      const coordinate =
        outerSide === 'top'
          ? componentBounds.minY - margin
          : outerSide === 'bottom'
            ? componentBounds.maxY + margin
            : outerSide === 'left'
              ? componentBounds.minX - margin
              : componentBounds.maxX + margin
      for (const [fromFan, toFan] of outerFanPairs) {
        const fromFanRoute = terminalFanRoute(
          aEnd,
          request.from.direction,
          fromFan,
        )
        const toFanRoute = terminalFanRoute(
          bEnd,
          request.to.direction,
          toFan,
        )
        const aFan = fromFanRoute[fromFanRoute.length - 1]
        const bFan = toFanRoute[toFanRoute.length - 1]
        const core =
          outerSide === 'top' || outerSide === 'bottom'
            ? [
                aFan,
                { x: aFan.x, y: coordinate },
                { x: bFan.x, y: coordinate },
                bFan,
              ]
            : [
                aFan,
                { x: coordinate, y: aFan.y },
                { x: coordinate, y: bFan.y },
                bFan,
              ]
        evaluateCandidate(
          withEndpointStubs(
            request.from.point,
            aEnd,
            concatRoutes(
              fromFanRoute,
              core,
              [...toFanRoute].reverse(),
            ),
            bEnd,
            request.to.point,
          ),
        )
      }
    }
    if (best) return best
  }

  const visibleRoute = visibilityFallback()
  if (visibleRoute) return visibleRoute

  // A body-clear visibility path is useful only as candidate geometry. Nudge
  // its orthogonal lanes in both directions and accept a variant exclusively
  // through the same terminal/reservation validator used above.
  const bodyOnlyMiddle = visibilityRoute(aEnd, bEnd, baseObstacles)
  if (bodyOnlyMiddle) {
    for (let step = 1; step <= MAX_LOCAL_LANE_ATTEMPTS; step += 1) {
      for (const offset of [
        step * ROUTE_LANE_GAP,
        -step * ROUTE_LANE_GAP,
      ]) {
        const nudgedMiddle = offsetRoute(bodyOnlyMiddle, offset)
        evaluateCandidate(
          withEndpointStubs(
            request.from.point,
            aEnd,
            nudgedMiddle,
            bEnd,
            request.to.point,
          ),
        )
      }
    }
    if (best) return best
  }
  // Only a malformed import with a physically impossible fixed direction remains
  // undisplayable. Never relax the reservation validator: doing so creates the
  // very collinear overlap/T-junction that the global router exists to prevent.
  return null
}

/**
 * Route all board wires in stable bundle order while reserving each accepted
 * middle corridor for the wires that follow. Non-connected wires may cross at
 * 90° (a rendered hop), but may never share or merely touch a segment.
 */
export function routeBoardWires(
  requests: WireRouteRequest[],
  bodyObstacles: Rect[] = [],
  terminalKeepOuts: TerminalKeepOut[] = [],
): RoutedWire[] {
  const baseGroups = new Map<string, WireRouteRequest[]>()
  for (const request of requests) {
    const key = request.bundleKey ?? `wire:${request.id}`
    const group = baseGroups.get(key) ?? []
    group.push(request)
    baseGroups.set(key, group)
  }
  const groups = new Map<string, WireRouteRequest[]>()
  for (const [key, group] of baseGroups) {
    const byOrder = new Map<number, WireRouteRequest[]>()
    for (const request of group) {
      if (request.bundleOrder === undefined) continue
      const ordered = byOrder.get(request.bundleOrder) ?? []
      ordered.push(request)
      byOrder.set(request.bundleOrder, ordered)
    }
    const buckets = [...byOrder.entries()].sort(([a], [b]) => a - b)
    const multiplicity = buckets[0]?.[1].length ?? 1
    const canSplitRepeatedPhases =
      buckets.length > 1 &&
      multiplicity > 1 &&
      buckets.every(([, bucket]) => bucket.length === multiplicity)
    if (!canSplitRepeatedPhases) {
      groups.set(key, group)
      continue
    }
    const sortedBuckets = buckets.map(([, bucket]) =>
      [...bucket].sort((a, b) => a.id.localeCompare(b.id)),
    )
    for (let slot = 0; slot < multiplicity; slot += 1) {
      groups.set(
        `${key}:set-${slot}`,
        sortedBuckets.map((bucket) => bucket[slot]),
      )
    }
  }
  type GroupEntry = [string, WireRouteRequest[]]
  const componentKey = (terminalKey?: string): string | undefined => {
    if (!terminalKey) return undefined
    const separator = terminalKey.lastIndexOf(':')
    return separator >= 0 ? terminalKey.slice(0, separator) : terminalKey
  }
  const constraintRank = (group: WireRouteRequest[]): number => {
    if (
      group.some(
        (request) =>
          componentKey(request.from.terminalKey) ===
          componentKey(request.to.terminalKey),
      )
    ) {
      return 0
    }
    if (group.length > 1) return 1
    return 2
  }
  const baseGroupCompare = ([keyA, groupA]: GroupEntry, [keyB, groupB]: GroupEntry) => {
    const priorityA = Math.min(...groupA.map((request) => request.priority ?? 0))
    const priorityB = Math.min(...groupB.map((request) => request.priority ?? 0))
    const pointA = groupA[0]?.from.point ?? { x: 0, y: 0 }
    const pointB = groupB[0]?.from.point ?? { x: 0, y: 0 }
    return (
      priorityA - priorityB ||
      pointA.y - pointB.y ||
      pointA.x - pointB.x ||
      keyA.localeCompare(keyB)
    )
  }
  const compactGroupCompare = (a: GroupEntry, b: GroupEntry) => {
    const priorityDelta =
      Math.min(...a[1].map((request) => request.priority ?? 0)) -
      Math.min(...b[1].map((request) => request.priority ?? 0))
    if (priorityDelta !== 0) return priorityDelta
    const constraintDelta = constraintRank(a[1]) - constraintRank(b[1])
    if (constraintDelta !== 0) return constraintDelta
    const span = (group: WireRouteRequest[]): number =>
      Math.max(
        ...group.map(
          (request) =>
            Math.abs(request.to.point.x - request.from.point.x) +
            Math.abs(request.to.point.y - request.from.point.y),
        ),
      )
    return span(a[1]) - span(b[1]) || baseGroupCompare(a, b)
  }
  const routeInOrder = (orderedGroups: GroupEntry[]): Map<string, RoutedWire> => {
    const reservations: RouteReservation[] = []
    const routed = new Map<string, RoutedWire>()
    const deferred: Array<{
      request: WireRouteRequest
      automaticSide: TerminalSide
    }> = []
    const bounded = requests.length > 32

    orderedGroups.forEach(([bundleKey, group]) => {
      const members = [...group].sort(
        (a, b) =>
          (a.bundleOrder ?? 0) - (b.bundleOrder ?? 0) ||
          a.id.localeCompare(b.id),
      )
      const averageDx =
        members.reduce(
          (sum, request) => sum + request.to.point.x - request.from.point.x,
          0,
        ) / Math.max(1, members.length)
      const averageDy =
        members.reduce(
          (sum, request) => sum + request.to.point.y - request.from.point.y,
          0,
        ) / Math.max(1, members.length)
      const automaticSide: TerminalSide =
        Math.abs(averageDx) >= Math.abs(averageDy)
          ? 'top'
          : 'left'

      const routedMembers = members.length > 1 ? [...members].reverse() : members
      routedMembers.forEach((request) => {
        const memberIndex = members.indexOf(request)
        const enriched = {
          ...request,
          bundleKey,
          bundleSize: request.bundleSize ?? members.length,
          // Lane indices are local to this bundle. Unrelated wires elsewhere on
          // the board do not consume or displace this compact corridor.
          bundleOrder: memberIndex,
        }
        const points = routeOneGlobally(
          enriched,
          bodyObstacles,
          terminalKeepOuts,
          reservations,
          automaticSide,
          bounded,
        )
        if (!points) {
          deferred.push({ request: enriched, automaticSide })
          return
        }
        const geometry = { id: request.id, points, segs: routeSegments(points) }
        routed.set(request.id, geometry)
        reservations.push({
          wireId: request.id,
          bundleKey,
          points,
          segs: geometry.segs,
          endpointKeys: [request.from.terminalKey, request.to.terminalKey],
          endpointStubLengths: [
            physicalEndpointStubLength(request.from) +
              SHARED_TERMINAL_FAN_STUB,
            physicalEndpointStubLength(request.to) +
              SHARED_TERMINAL_FAN_STUB,
          ],
          join: request.join,
        })
      })
    })
    // Preserve full routing correctness without applying the exhaustive search to
    // every conductor. Reservations from all easy routes are stable first; only
    // genuinely difficult conductors pay for the complete search.
    for (const deferredRoute of deferred) {
      const points = routeOneGlobally(
        deferredRoute.request,
        bodyObstacles,
        terminalKeepOuts,
        reservations,
        deferredRoute.automaticSide,
      )
      if (!points) continue
      const geometry = {
        id: deferredRoute.request.id,
        points,
        segs: routeSegments(points),
      }
      routed.set(deferredRoute.request.id, geometry)
      reservations.push({
        wireId: deferredRoute.request.id,
        bundleKey: deferredRoute.request.bundleKey,
        points,
        segs: geometry.segs,
        endpointKeys: [
          deferredRoute.request.from.terminalKey,
          deferredRoute.request.to.terminalKey,
        ],
        endpointStubLengths: [
          physicalEndpointStubLength(deferredRoute.request.from) +
            SHARED_TERMINAL_FAN_STUB,
          physicalEndpointStubLength(deferredRoute.request.to) +
            SHARED_TERMINAL_FAN_STUB,
        ],
        join: deferredRoute.request.join,
      })
    }
    return routed
  }

  const entries = [...groups.entries()] as GroupEntry[]
  const compactOrder = [...entries].sort(compactGroupCompare)
  let routed = routeInOrder(compactOrder)
  if (routed.size < requests.length) {
    const alternateOrders = [[...entries].sort(baseGroupCompare)]
    // Compact teaching circuits occasionally need a reverse rip-up order to
    // free a shared terminal port. Large star–delta boards already have many
    // independent corridors; trying four complete global permutations there
    // only repeats expensive work without improving route coverage.
    if (requests.length <= 20) {
      alternateOrders.push(
        [...entries].sort(compactGroupCompare).reverse(),
        [...entries].sort(baseGroupCompare).reverse(),
      )
    } else if (requests.length <= 32) {
      alternateOrders.push([...entries].sort(compactGroupCompare).reverse())
    }
    for (const order of alternateOrders) {
      const alternate = routeInOrder(order)
      if (alternate.size > routed.size) routed = alternate
      if (routed.size === requests.length) break
    }
  }
  // A large industrial board can contain 40+ conductors. Re-running every
  // already-routed conductor for six focused permutations made STAR–DELTA block
  // the Android WebView for seconds. Large boards already received compact + base
  // deterministic passes above; reserve focused rip-up for smaller diagrams where
  // it can materially improve coverage without freezing the UI.
  if (routed.size < requests.length && requests.length <= 32) {
    const focusedKeys: string[] = []
    let focusedRoute = routed
    const pinnedEntries = compactOrder.filter(
      ([, group]) => constraintRank(group) <= 1,
    )
    const pinnedKeys = new Set(pinnedEntries.map(([key]) => key))
    const focusedAttemptLimit =
      requests.length > 20
        ? Math.min(2, compactOrder.length)
        : Math.min(12, compactOrder.length)
    for (let attempt = 0; attempt < focusedAttemptLimit; attempt += 1) {
      const missingKey = requests
        .filter((request) => !focusedRoute.has(request.id))
        .map((request) => request.bundleKey ?? `wire:${request.id}`)
        .find((key) => !focusedKeys.includes(key))
      if (!missingKey) break
      focusedKeys.push(missingKey)
      const focusedOrder = [
        ...pinnedEntries,
        ...focusedKeys.flatMap((key) => {
          if (pinnedKeys.has(key)) return []
          const entry = compactOrder.find(([candidate]) => candidate === key)
          return entry ? [entry] : []
        }),
        ...compactOrder.filter(
          ([key]) => !pinnedKeys.has(key) && !focusedKeys.includes(key),
        ),
      ]
      focusedRoute = routeInOrder(focusedOrder)
      if (focusedRoute.size > routed.size) routed = focusedRoute
      if (focusedRoute.size === requests.length) {
        routed = focusedRoute
        break
      }
    }
  }
  return requests.flatMap((request) => {
    const geometry = routed.get(request.id)
    return geometry ? [geometry] : []
  })
}

/** Identity of a route's endpoints; a stored route is reused only while it is unchanged. */
export function routeEndpointSignature(request: WireRouteRequest): string {
  return `${request.from.terminalKey ?? ''}|${request.to.terminalKey ?? ''}|${request.join?.wireId ?? ''}`
}

/**
 * Previously routed lines that may stay drawn while a new route is computed: the
 * wire still exists between the same terminals and neither end has moved. A moved
 * component's cables are not drawn until their new route arrives, so no line ever
 * points at the place a component has left.
 */
export function reusableRoutes(
  previous: WireGeometry[],
  previousSignatures: ReadonlyMap<string, string>,
  requests: WireRouteRequest[],
): WireGeometry[] {
  const current = new Map(requests.map((request) => [request.id, request]))
  const near = (a: Point | undefined, b: Point) =>
    a !== undefined && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5
  return previous.filter((geometry) => {
    const request = current.get(geometry.id)
    return (
      request !== undefined &&
      previousSignatures.get(geometry.id) === routeEndpointSignature(request) &&
      near(geometry.points[0], request.from.point) &&
      near(geometry.points[geometry.points.length - 1], request.to.point)
    )
  })
}

export interface WireLabelPlacement {
  position: 'start' | 'middle' | 'end'
  point: Point
  angle: 0 | -90
  rect: Rect
}

export interface NetLabelAnchor {
  net: string
  point: Point
}

export const NEARBY_NET_LABEL_DISTANCE = 72

/**
 * One conductor number is enough inside a compact same-net cluster. Different
 * nets are never collapsed, even when their labels happen to be close.
 */
export function isNearbyNetLabelDuplicate(
  candidate: NetLabelAnchor,
  accepted: NetLabelAnchor[],
  distance = NEARBY_NET_LABEL_DISTANCE,
): boolean {
  return accepted.some(
    (label) =>
      label.net === candidate.net &&
      Math.hypot(
        label.point.x - candidate.point.x,
        label.point.y - candidate.point.y,
      ) <= distance,
  )
}

function labelRect(point: Point, angle: 0 | -90, text: string): Rect {
  const textWidth = Math.max(10, text.length * 5 + 3)
  const width = angle === 0 ? textWidth : 10
  const height = angle === 0 ? 10 : textWidth
  return {
    minX: point.x - width / 2,
    maxX: point.x + width / 2,
    minY: point.y - height / 2,
    maxY: point.y + height / 2,
  }
}

function pointAtRouteDistance(
  points: Point[],
  distanceAlong: number,
): { point: Point; angle: 0 | -90 } {
  const total = polylineLength(points)
  const target = Math.max(0, Math.min(total, distanceAlong))
  let travelled = 0
  for (const segment of routeSegments(points)) {
    const length = segmentLength(segment)
    if (travelled + length >= target) {
      const local = length === 0 ? 0 : (target - travelled) / length
      return {
        point: {
          x: segment.a.x + (segment.b.x - segment.a.x) * local,
          y: segment.a.y + (segment.b.y - segment.a.y) * local,
        },
        angle: segment.orient === 'H' ? 0 : -90,
      }
    }
    travelled += length
  }
  const tail = points[points.length - 1] ?? { x: 0, y: 0 }
  const segments = routeSegments(points)
  const last = segments[segments.length - 1]
  return { point: tail, angle: last?.orient === 'V' ? -90 : 0 }
}

function overlapArea(a: Rect, b: Rect): number {
  const width = Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX))
  const height = Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
  return width * height
}

/**
 * In-line conductor numbers are fitted to the available geometry. Long wires
 * keep start/middle/end; short wires use fewer labels instead of forcing the
 * router to manufacture printable detours.
 */
export function wireLabelPlacements(
  points: Point[],
  text: string,
  occupied: Rect[] = [],
): WireLabelPlacement[] {
  const total = polylineLength(points)
  if (points.length < 2 || total <= 0) return []
  const segments = routeSegments(points)
  const firstStub = segmentLength(segments[0])
  const lastStub = segmentLength(segments[segments.length - 1])
  const interior = segments
    .map((segment, index) => ({ segment, index, length: segmentLength(segment) }))
    .filter((candidate) => candidate.index > 0 && candidate.index < segments.length - 1)
    .sort((a, b) => b.length - a.length || a.index - b.index)
  const interiorCentres = interior.map((candidate) => {
    let before = 0
    for (let index = 0; index < candidate.index; index += 1) {
      before += segmentLength(segments[index])
    }
    return before + candidate.length / 2
  })
  const startBase = Math.min(total * 0.3, firstStub + 12)
  const endBase = Math.max(total * 0.7, total - lastStub - 12)
  const scanDistances = (from: number, to: number): number[] => {
    if (to <= from) return []
    const step = Math.max(8, Math.min(14, (to - from) / 6))
    const values: number[] = []
    for (let distance = from; distance <= to + 0.1; distance += step) {
      values.push(distance)
    }
    return values
  }
  const candidateDistances: Record<WireLabelPlacement['position'], number[]> = {
    start: [
      startBase,
      18,
      28,
      Math.max(18, firstStub - 12),
      firstStub + 20,
      total * 0.18,
      total * 0.25,
      ...scanDistances(16, Math.max(32, Math.min(total * 0.34, firstStub + 24))),
    ],
    middle: [
      ...interiorCentres,
      total * 0.5,
      total * 0.42,
      total * 0.58,
      ...scanDistances(total * 0.32, total * 0.68),
    ],
    end: [
      endBase,
      total - 18,
      total - 28,
      total - Math.max(18, lastStub - 12),
      total - lastStub - 20,
      total * 0.82,
      total * 0.75,
      ...scanDistances(
        Math.min(total * 0.66, total - lastStub - 24),
        total - 16,
      ),
    ],
  }
  const selected: WireLabelPlacement[] = []
  const blocked = [...occupied]
  const positions: WireLabelPlacement['position'][] =
    total >= 140
      ? ['start', 'middle', 'end']
      : total >= 88
        ? ['start', 'end']
        : total >= 24
          ? ['middle']
          : []

  for (const position of positions) {
    const unique = [...new Set(candidateDistances[position].map((value) => Math.round(value * 10) / 10))]
      .filter((value) => value >= 6 && value <= total - 6)
    let best: WireLabelPlacement | null = null
    let bestPenalty = Infinity
    for (const distanceAlong of unique) {
      const sample = pointAtRouteDistance(points, distanceAlong)
      const rect = labelRect(sample.point, sample.angle, text)
      const penalty = blocked.reduce((sum, other) => sum + overlapArea(rect, other), 0)
      if (penalty < bestPenalty) {
        bestPenalty = penalty
        best = { position, point: sample.point, angle: sample.angle, rect }
      }
      if (penalty === 0) break
    }
    if (!best) continue
    selected.push(best)
    blocked.push(best.rect)
  }
  return selected
}

// --- rendering: orthogonal path + hop arcs ----------------------------------

export interface Crossing {
  x: number
  y: number
}

/** The hops that sit on the horizontal segment a→b, in travel order (a→b). The
 *  single source of "which crossings bump this segment, and in what order" —
 *  shared by `routeToPath` (the drawn arc) and `buildFlowPath` (the arrow travel)
 *  so a flow arrow rides the EXACT arc that is rendered, never a phantom straight
 *  line underneath it. A vertical segment carries no hops. */
export function hopsOnSegment(a: Point, b: Point, hops: Crossing[]): Crossing[] {
  if (Math.abs(a.y - b.y) >= 0.5) return []
  return hops
    .filter(
      (h) =>
        Math.abs(h.y - a.y) < 0.5 &&
        h.x > Math.min(a.x, b.x) + 1 &&
        h.x < Math.max(a.x, b.x) - 1,
    )
    .sort((p, q) => (b.x > a.x ? p.x - q.x : q.x - p.x))
}

/** One hop arc over a cluster of one-or-more adjacent crossings. `entryX`→`exitX` are the
 *  arc ends on the run (travel order); the half-ellipse spans them, centred at `cx`, `rx`
 *  wide and `ry` tall, bulging UP. A lone crossing gives `rx = ry = HOP_R` (the original
 *  semicircle, unchanged). */
export interface HopCluster {
  entryX: number
  exitX: number
  cx: number
  rx: number
  ry: number
}

/**
 * Group the crossings on a horizontal segment into hop CLUSTERS: any run of crossings each
 * within `HOP_MERGE_GAP` of the next becomes ONE wide hop that arcs over the whole bundle,
 * instead of a crowd of tiny bumps that muddy the read (a horizontal wire crossing three
 * bundled verticals draws ONE arc over all three, not three). Travel order is preserved,
 * and a single isolated crossing is byte-for-byte the old radius-`HOP_R` semicircle. The
 * single source of hop geometry — shared by `routeToPath` (drawn arc) and `buildFlowPath`
 * (arrow travel) so both bump identically.
 */
export function hopClustersOnSegment(a: Point, b: Point, hops: Crossing[]): HopCluster[] {
  const crossings = hopsOnSegment(a, b, hops)
  if (crossings.length === 0) return []
  const rightward = b.x > a.x
  const groups: { lo: number; hi: number; prev: number }[] = []
  for (const h of crossings) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(h.x - last.prev) <= HOP_MERGE_GAP) {
      last.prev = h.x
      last.lo = Math.min(last.lo, h.x)
      last.hi = Math.max(last.hi, h.x)
    } else {
      groups.push({ lo: h.x, hi: h.x, prev: h.x })
    }
  }
  return groups.map((g) => {
    const rx = (g.hi - g.lo) / 2 + HOP_R
    return {
      entryX: rightward ? g.lo - HOP_R : g.hi + HOP_R,
      exitX: rightward ? g.hi + HOP_R : g.lo - HOP_R,
      cx: (g.lo + g.hi) / 2,
      rx,
      ry: Math.min(rx, HOP_H_MAX),
    }
  })
}

/** Points sampled along a hop's semicircle, from `before` to `after` (travel
 *  order), bulging up. Used to thread a dense flow polyline over the same arc the
 *  renderer draws, so arrows climb and turn with the bump instead of cutting
 *  through it. `samples` sets smoothness (segments along the half-circle). */
export function hopArcPoints(h: Crossing, baseY: number, rightward: boolean, samples = 8): Point[] {
  // Angle runs through the top of the circle (π/2). Rightward: π → 0; leftward: 0 → π.
  const startAngle = rightward ? Math.PI : 0
  const endAngle = rightward ? 0 : Math.PI
  const pts: Point[] = []
  for (let k = 0; k <= samples; k += 1) {
    const ang = startAngle + (endAngle - startAngle) * (k / samples)
    pts.push({ x: h.x + HOP_R * Math.cos(ang), y: baseY - HOP_R * Math.sin(ang) })
  }
  return pts
}

/** SVG path for an orthogonal route, bumping ONE hop arc over each cluster of crossings
 *  (adjacent bundled wires share a single wide arc) on its horizontal segments. */
export function routeToPath(points: Point[], hops: Crossing[] = []): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const rightward = b.x > a.x
    for (const cl of hopClustersOnSegment(a, b, hops)) {
      d += ` L ${cl.entryX} ${a.y} A ${cl.rx} ${cl.ry} 0 0 ${rightward ? 1 : 0} ${cl.exitX} ${a.y}`
    }
    d += ` L ${b.x} ${b.y}`
  }
  return d
}

/** A DENSE polyline geometrically identical to the SVG path `routeToPath` draws — same
 *  orthogonal corridors, and each hop CLUSTER replaced by points sampled along its
 *  half-ellipse (via the shared `hopClustersOnSegment`). Feeding this to
 *  `flowMarkersPolyline` makes flow arrows ride up and over each hop, matching the drawn
 *  arc exactly; at a crossing the arrow sits at the top of the bump, so it never piles
 *  onto the straight line and never reads as a false junction. */
export function buildFlowPath(points: Point[], hops: Crossing[] = []): Point[] {
  if (points.length === 0) return []
  const out: Point[] = [points[0]]
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    const rightward = b.x > a.x
    for (const cl of hopClustersOnSegment(a, b, hops)) {
      // Sample the SAME half-ellipse routeToPath draws (entryX → top → exitX), so a flow
      // arrow rides up and over the whole bundle. More samples on a wider arc.
      const samples = Math.max(8, Math.ceil(cl.rx))
      const startAngle = rightward ? Math.PI : 0
      const endAngle = rightward ? 0 : Math.PI
      for (let k = 0; k <= samples; k += 1) {
        const ang = startAngle + (endAngle - startAngle) * (k / samples)
        out.push({ x: cl.cx + cl.rx * Math.cos(ang), y: a.y - cl.ry * Math.sin(ang) })
      }
    }
    out.push(b)
  }
  return out
}

export interface WireGeometry {
  id: string
  points: Point[]
  segs: Seg[]
}

/**
 * PHYSICAL DRAWING CONNECTIVITY — a purely geometric pass.
 *
 * Every interior H×V intersection of two DIFFERENT wires is a CROSSOVER: the
 * horizontal wire hops over. A geometric crossing is NEVER a connection — two
 * wires that merely cross on the canvas are not spliced, regardless of whether
 * they are the same electrical net (relay/switch closing elsewhere, an NC contact,
 * a remote bridge, same colour, same potential, current flowing on both). Physical
 * drawing connectivity and electrical node equivalence are deliberately separate:
 * this function knows nothing about nodes, energised state, colour, or current.
 *
 * A real junction is only ever drawn where a wire PHYSICALLY joins another — an
 * explicit endpoint pile (`terminalJunctions`), a mid-span tap (`tapDots`), or a
 * same-node terminal merge (`mergeDots`). Those are produced elsewhere from the
 * persisted model and never depend on this pass. Because `hvIntersection` rejects
 * endpoints (interior only, `eps`), a shared endpoint never appears here at all.
 */
export function computeCrossings(wires: WireGeometry[]): {
  hops: Record<string, Crossing[]>
  /** `[hopperId, crossedId]` per crossover: the hopper (its horizontal run bumps over)
   *  must be PAINTED ON TOP of the crossed wire, else the arc reads as piled under it. */
  over: Array<[string, string]>
} {
  const hops: Record<string, Crossing[]> = {}
  const over: Array<[string, string]> = []
  const seenPair = new Set<string>()

  for (const wireH of wires) {
    for (const hSeg of wireH.segs) {
      if (hSeg.orient !== 'H') continue
      for (const wireV of wires) {
        if (wireV.id === wireH.id) continue
        for (const vSeg of wireV.segs) {
          if (vSeg.orient !== 'V') continue
          const point = hvIntersection(hSeg, vSeg)
          if (!point) continue
          ;(hops[wireH.id] ??= []).push(point)
          const key = `${wireH.id}>${wireV.id}`
          if (!seenPair.has(key)) {
            seenPair.add(key)
            over.push([wireH.id, wireV.id])
          }
        }
      }
    }
  }
  return { hops, over }
}

/**
 * Paint order so every HOP is drawn ON TOP of the wire it jumps: topologically sort the
 * wires so a crossed wire comes before its hopper (arc bridges cleanly instead of piling
 * under the straight wire). Ties keep the original order; a rare cross-cycle (each wire
 * hops the other) falls back to original order for the leftover.
 */
export function orderWiresForHops(
  wires: WireGeometry[],
  over: Array<[string, string]>,
): WireGeometry[] {
  const byId = new Map(wires.map((g, i) => [g.id, { g, i }]))
  const hoppersAfter = new Map<string, Set<string>>() // crossedId -> hoppers that must follow
  const indegree = new Map<string, number>(wires.map((g) => [g.id, 0]))
  for (const [hopper, crossed] of over) {
    if (hopper === crossed || !byId.has(hopper) || !byId.has(crossed)) continue
    const set = hoppersAfter.get(crossed) ?? new Set<string>()
    if (!set.has(hopper)) {
      set.add(hopper)
      hoppersAfter.set(crossed, set)
      indegree.set(hopper, (indegree.get(hopper) ?? 0) + 1)
    }
  }
  const ready = wires.filter((g) => (indegree.get(g.id) ?? 0) === 0).map((g) => g.id)
  const placed = new Set<string>()
  const result: WireGeometry[] = []
  while (ready.length > 0) {
    ready.sort((a, b) => (byId.get(a)?.i ?? 0) - (byId.get(b)?.i ?? 0)) // stable: original order
    const id = ready.shift() as string
    if (placed.has(id)) continue
    placed.add(id)
    result.push(byId.get(id)?.g as WireGeometry)
    for (const hopper of hoppersAfter.get(id) ?? []) {
      indegree.set(hopper, (indegree.get(hopper) ?? 0) - 1)
      if ((indegree.get(hopper) ?? 0) === 0) ready.push(hopper)
    }
  }
  for (const g of wires) if (!placed.has(g.id)) result.push(g) // cycle leftover
  return result
}

/** Nearest grid cell for a point in board pixel space. */
export function cellAtPoint(point: Point): Cell {
  return {
    x: Math.max(0, Math.round((point.x - PAD - CELL / 2) / CELL)),
    y: Math.max(0, Math.round((point.y - PAD - CELL / 2) / CELL)),
  }
}
