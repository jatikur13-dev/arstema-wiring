import { wirePresentation } from '../../engine/wirePresentation'
/**
 * CircuitBoard — the SVG papan.
 *
 * Presentation only: it renders the board state and reports interactions upward.
 * Placement is click-to-place onto snap cells; wiring is click-a-terminal then
 * click-another; components can be dragged between cells; erase mode deletes.
 *
 * Wires are routed orthogonally and coloured by the SOLVER's node identity
 * (LIVE=red, NEUTRAL=blue, else neutral). Where two wires cross without being the
 * same electrical node, the horizontal one hops over — crossing ≠ connection. The
 * moving dots are the current, traced and oriented by the engine.
 */

import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import {
  buildPhysicalNodes,
  bridgedPairs,
  deriveAutomaticProductActuation,
  formatTimerDuration,
  isMotor3phRunning,
  mcbRatedAmps,
  multifunctionTimerOutputOn,
  relayDefinition,
  boardDomain,
  terminalKey,
  terminalCountForComponent,
  terminalCountForSpec,
  resolvedTerminalDefinitions,
  timerPhase,
  type Cell,
  type BoardProjection,
  type CircuitState,
  type ComponentSpec,
  type PlacedComponent,
  type Terminal,
} from '../../engine/index'
import {
  boardExtent,
  cameraMinCells,
  componentFootprint,
  footprintCentre,
  footprintCollides,
  cellAtPoint,
  cellCentre,
  computeCrossings,
  buildFlowPath,
  emptyCells,
  expandRect,
  flowMarkersPolyline,
  fractionOnPolyline,
  midpointOnPolyline,
  nearestPointOnPolyline,
  iecLayoutFor,
  isNearbyNetLabelDuplicate,
  iecTerminalExit,
  orderWiresForHops,
  pointAtPolylineFraction,
  projectionCell,
  projectionComponentBox,
  resolveTerminalOverlap,
  reusableRoutes,
  routeBoardWires,
  routeEndpointSignature,
  routeToPath,
  simplifyRoute,
  tapFractionForProjection,
  terminalPoint,
  virtualActuatorRect,
  virtualInstrumentBounds,
  virtualTerminalExit,
  virtualTerminalPoint,
  CELL,
  PAD,
  TERMINAL_R,
  TERMINAL_ROUTE_KEEP_OUT,
  type Point,
  type Rect,
  type TerminalKeepOut,
  type TerminalPlacement,
  type WireRouteRequest,
  type WireGeometry,
  wireLabelPlacements,
} from './geometry'
import { VirtualInstrument } from './VirtualInstrument'
import {
  COMPONENT_HOLD_MS,
  TOUCH_PAN_THRESHOLD_PX,
  cameraContentBounds,
  cameraExtentWithInsets,
  continuousPinchZoom,
  EMPTY_CAMERA_INSETS,
  pinchAnchor,
  pointDistance,
  pointMidpoint,
  pinchPreviewTransform,
  scrollForPinch,
  type CameraInsets,
  type ClientPoint,
} from './viewportGestures'
import {
  buildCommonNetTrunkPlans,
  deriveWireRoutingIntents,
} from './routingIntent'
import type { CircuitRenderProfile } from '../state/renderProfile'

export type CircuitProjection = BoardProjection

export interface CircuitBoardViewportMetrics {
  /** Exact board identity lets the page reject a late worker result after an edit/load. */
  board: CircuitState['board']
  projection: BoardProjection
  /** Router/grid extent before display-only centring room is applied. */
  baseExtent: ReturnType<typeof boardExtent>
  extent: ReturnType<typeof boardExtent>
  /** Component bodies plus the final routed polylines, expanded by one grid cell. */
  contentBounds: Rect | null
  routingReady: boolean
  zoom: number
}

export interface CircuitBoardProps {
  /** False keeps the mounted projection and its scroll/gesture state, but freezes
   * expensive SVG reconciliation until that projection becomes visible again. */
  active?: boolean
  state: CircuitState
  prefersReducedMotion: boolean
  renderProfile?: CircuitRenderProfile
  placingSpec: ComponentSpec | null
  pendingTerminal: Terminal | null
  eraseMode: boolean
  onPlaceCell: (cell: Cell) => void
  onTerminalClick: (terminal: Terminal) => void
  /** Tap the pending terminal onto an existing wire's line (mid-span). `anchor` is a
   *  terminal of the tapped wire — the same electrical node — used for the union;
   *  `near` is the click point in SVG coords, projected onto the wire's line to draw. */
  onTapWire: (targetWireId: string, anchor: Terminal, position: number, near: Point) => void
  onToggleSwitch: (id: string) => void
  /** Select a configurable component body (MCB rating or timer timing). */
  onSelectComponent?: (id: string) => void
  /** The currently selected component id (for the selected outline). */
  selectedId?: string | null
  onPressButton: (id: string, pressed: boolean) => void
  onPressProductControl?: (
    id: string,
    control: 'START' | 'STOP' | 'ACTUATOR',
    pressed: boolean,
  ) => void
  onDeleteComponent: (id: string) => void
  onDeleteWire: (id: string) => void
  onMoveComponent: (id: string, cell: Cell) => void
  onReplaceRequest: (draggedId: string, occupantId: string, cell: Cell) => void
  onCancelWiring: () => void
  /** View zoom (1 = 100% = board's natural size). Pure display transform —
   *  it never touches terminal indices or the solver; `clientToSvg` reads the CTM so
   *  wiring/drag/selection stay accurate at every level. */
  zoom?: number
  /**
   * Two-finger zoom commits exactly once, after the board has finished its GPU
   * preview.  Keeping the committed value in the page preserves the shared zoom
   * contract between IEC and virtual projections without re-rendering this large
   * SVG for every pointermove.
   */
  onPinchZoom?: (zoom: number) => void
  /** Bug 2 camera: the measured workspace size (board-wrap client px). Drives how much
   *  grid the visible extent must cover so `extent × zoom` fills the workspace instead
   *  of shrinking the board to a thumbnail on zoom-out. `{0,0}` (headless/unmeasured)
   *  falls back to the logical 12×8 floor. */
  viewport?: { vw: number; vh: number }
  /** Visual projection only. Both boards share the exact same terminals and solver. */
  projection?: CircuitProjection
  /** Display-only viewBox breathing room used to make exact-axis centring possible. */
  cameraInsets?: CameraInsets
  /** Read-only camera telemetry. It must never feed the router or electrical model. */
  onViewportMetrics?: (metrics: CircuitBoardViewportMetrics) => void
}

/**
 * Penandaan terminal perangkat, bukan nomor urut internal simulator.
 *
 * Dasar penandaan:
 * - IEC/SNI IEC 60445 untuk identifikasi terminal/perlengkapan;
 * - IEC 60947-4-1 untuk kontaktor dan starter;
 * - IEC 60947-5-1 / EN 50005 untuk kontak kontrol: x1-x2 = NC, x3-x4 = NO;
 * - lembar terminal produsen untuk fungsi L1/T1, L2/T2, L3/T3.
 *
 * Indeks solver tetap 0..n dan tidak pernah ditampilkan. Perangkat instalasi yang
 * tidak mempunyai satu penomoran lintas-produsen memakai designation yang jujur
 * (COM/L1/L2, X1/X2, PE), bukan angka yang dibuat-buat. Karena simulator ini tidak
 * meniru satu nomor katalog tertentu, terminal daya menampilkan designation fungsi
 * L/T saja; awalan opsional produsen seperti 1/L1 tidak dipaksakan.
 */
const TERMINAL_NUMBER: Record<string, string[]> = {
  SOURCE: ['L', 'N'],
  LOAD: ['1', '2'],
  SWITCH: ['1', '2'],
  SWITCH_2WAY: ['COM', 'L1', 'L2'],
  SWITCH_CROSS: ['1', '2', '3', '4'],
  CONTACT_2STATE: ['11', '12', '14'],
  LIMIT_SWITCH: ['11', '12', '33', '34'],
  SENSOR_3WIRE: ['1', '3', '4'],
  TERMINAL_BLOCK: ['1', '2'],
  SELECTOR_3POS: ['11', '12', '14'],
  FUSE: ['1', '2'],
  ESTOP: ['11', '12'],
  MOTOR: ['R', 'C', 'S'],
  CAPACITOR: ['1', '2'],
  RELAY: ['A1', 'A2', '13', '14', '21', '22'],
  INDICATOR: ['X1', 'X2'],
  SOURCE_3PH: ['L1', 'L2', 'L3', 'N'],
  MOTOR_3PH: ['U1', 'U2', 'V1', 'V2', 'W1', 'W2', 'PE'],
  CONTACTOR: [
    'A1',
    'A2',
    'L1',
    'T1',
    'L2',
    'T2',
    'L3',
    'T3',
    '13',
    '14',
    '21',
    '22',
  ],
  BREAKER_1P: ['L1', 'T1'],
  BREAKER_3P: ['L1', 'T1', 'L2', 'T2', 'L3', 'T3'],
  TIMER: ['A1', 'A2', '15', '16', '25', '28', '18', '26'],
  OVERLOAD_RELAY: [
    'L1',
    'T1',
    'L2',
    'T2',
    'L3',
    'T3',
    '95',
    '96',
    '97',
    '98',
  ],
  GROUND: ['PE'],
}

const TERMINAL_LABEL: Record<string, string[]> = {
  SOURCE: ['terminal L (bertegangan)', 'terminal N (netral)'],
  GROUND: ['terminal pembumian (PE)'],
  SWITCH: ['terminal masuk saklar', 'terminal keluar saklar'],
  SWITCH_2WAY: ['common (COM)', 'jalur 1 (L1)', 'jalur 2 (L2)'],
  SWITCH_CROSS: ['masuk 1', 'masuk 2', 'keluar 1', 'keluar 2'],
  CONTACT_2STATE: ['common (COM)', 'normally closed (NC)', 'normally open (NO)'],
  LIMIT_SWITCH: [
    'kontak NC 11 (direct-opening pada produk rujukan)',
    'kontak NC 12 (direct-opening pada produk rujukan)',
    'kontak NO 33',
    'kontak NO 34',
  ],
  SENSOR_3WIRE: [
    'pin 1 cokelat: +V',
    'pin 3 biru: 0 V',
    'pin 4 hitam: output',
  ],
  TERMINAL_BLOCK: ['titik sambung 1', 'titik sambung 2 — potensial yang sama'],
  SELECTOR_3POS: ['common (COM)', 'posisi kiri', 'posisi kanan'],
  FUSE: ['terminal 1', 'terminal 2'],
  ESTOP: ['terminal 1', 'terminal 2'],
  LOAD: ['terminal lampu 1', 'terminal lampu 2'],
  MOTOR: [
    'terminal RUN motor PSC (R)',
    'terminal COMMON motor PSC (C)',
    'terminal START motor PSC (S)',
  ],
  CAPACITOR: ['kapasitor sisi 1', 'kapasitor sisi 2'],
  RELAY: [
    'kumparan relay A1',
    'kumparan relay A2',
    'kontak relay NO 13',
    'kontak relay NO 14',
    'kontak relay NC 21',
    'kontak relay NC 22',
  ],
  INDICATOR: ['terminal indikator 1', 'terminal indikator 2'],
  SOURCE_3PH: [
    'terminal L1 (fasa R)',
    'terminal L2 (fasa S)',
    'terminal L3 (fasa T)',
    'terminal N (netral)',
  ],
  MOTOR_3PH: [
    'belitan U1',
    'belitan U2',
    'belitan V1',
    'belitan V2',
    'belitan W1',
    'belitan W2',
    'terminal pelindung rangka motor (PE)',
  ],
  CONTACTOR: [
    'kumparan A1',
    'kumparan A2',
    'kontak utama masuk L1',
    'kontak utama keluar T1',
    'kontak utama masuk L2',
    'kontak utama keluar T2',
    'kontak utama masuk L3',
    'kontak utama keluar T3',
    'kontak bantu NO 13',
    'kontak bantu NO 14',
    'kontak bantu NC 21',
    'kontak bantu NC 22',
  ],
  BREAKER_1P: ['masuk fasa L1', 'keluar fasa T1'],
  BREAKER_3P: [
    'masuk fasa L1',
    'keluar fasa T1',
    'masuk fasa L2',
    'keluar fasa T2',
    'masuk fasa L3',
    'keluar fasa T3',
  ],
  TIMER: [
    'catu timer A1',
    'catu timer A2',
    'common kontak STAR 15',
    'kontak STAR NC 16',
    'common kontak DELTA 25',
    'kontak DELTA NO 28',
    'kontak STAR NO 18',
    'kontak DELTA NC 26',
  ],
  OVERLOAD_RELAY: [
    'masuk overload fasa L1',
    'keluar overload fasa T1',
    'masuk overload fasa L2',
    'keluar overload fasa T2',
    'masuk overload fasa L3',
    'keluar overload fasa T3',
    'kontak trip NC overload 95',
    'kontak trip NC overload 96',
    'kontak sinyal NO overload 97',
    'kontak sinyal NO overload 98',
  ],
}

function terminalNumbersFor(component: PlacedComponent): string[] {
  const exact = resolvedTerminalDefinitions(component)
  if (exact) return exact.map((item) => item.designation)
  if (
    component.spec.kind === 'SOURCE' &&
    (component.spec.sourceType === 'battery_dc' || component.spec.sourceType === 'din_psu_24vdc')
  ) {
    return ['+', '−']
  }
  if (component.spec.kind === 'SOURCE' && component.spec.sourceType === 'control_transformer_24vac') {
    return ['X1', 'X2']
  }
  if (component.spec.kind === 'LOAD' && component.spec.symbol === 'solenoid_valve') {
    return ['1', '2']
  }
  if (component.spec.kind === 'PUSHBUTTON') {
    return component.spec.normallyOpen ? ['13', '14'] : ['21', '22']
  }
  if (component.spec.kind === 'RELAY') {
    return relayDefinition(component.spec).terminals.map((terminal) => terminal.pin)
  }
  if (component.spec.kind === 'TIMER' && component.spec.model === 'OMRON_H3CR_A8') {
    // Omron H3CR-A8 / P2CF-08 physical socket numbering (bottom view).
    return ['2', '7', '1', '4', '8', '6', '3', '5']
  }
  if (component.spec.kind === 'TERMINAL_BLOCK') {
    switch (component.spec.model) {
      case 'PHOENIX_UT25_PE':
        return ['PE1', 'PE2']
      case 'PHOENIX_UT25_TWIN':
        return ['1', '2', '3']
      case 'PHOENIX_UT25_QUATTRO':
        return ['1', '2', '3', '4']
      case 'PHOENIX_UT25_PE_L_L':
        return ['PE1', 'PE2', 'L1', 'L2', "L'1", "L'2"]
      default:
        return ['1', '2']
    }
  }
  return TERMINAL_NUMBER[component.spec.kind] ?? []
}

function terminalLabelsFor(component: PlacedComponent, numbers: string[]): string[] {
  const exact = resolvedTerminalDefinitions(component)
  if (exact) return exact.map((item) => item.description)
  if (
    component.spec.kind === 'SOURCE' &&
    (component.spec.sourceType === 'battery_dc' || component.spec.sourceType === 'din_psu_24vdc')
  ) {
    return component.spec.sourceType === 'battery_dc'
      ? ['terminal positif battery (+)', 'terminal negatif battery (−)']
      : ['keluaran catu daya positif (+V)', 'keluaran catu daya negatif (−V)']
  }
  if (component.spec.kind === 'SOURCE' && component.spec.sourceType === 'control_transformer_24vac') {
    return ['sekunder 24 VAC X1', 'sekunder 24 VAC X2']
  }
  if (component.spec.kind === 'LOAD' && component.spec.symbol === 'solenoid_valve') {
    return ['coil solenoid terminal 1', 'coil solenoid terminal 2']
  }
  if (component.spec.kind === 'PUSHBUTTON') {
    const functionName = component.spec.normallyOpen ? 'NO' : 'NC'
    return numbers.map((number) => `kontak tombol ${functionName} ${number}`)
  }
  if (component.spec.kind === 'RELAY') {
    const definition = relayDefinition(component.spec)
    return definition.terminals.map((terminal) => {
      const pole = terminal.pole === undefined ? '' : `, pole ${terminal.pole}`
      return `${definition.family} pin ${terminal.pin}: ${terminal.role}${pole}`
    })
  }
  if (component.spec.kind === 'TIMER' && component.spec.model === 'OMRON_H3CR_A8') {
    return [
      'H3CR-A8 pin 2: catu timer',
      'H3CR-A8 pin 7: catu timer',
      'H3CR-A8 pin 1: common kontak 1',
      'H3CR-A8 pin 4: normally closed kontak 1',
      'H3CR-A8 pin 8: common kontak 2',
      'H3CR-A8 pin 6: normally open kontak 2',
      'H3CR-A8 pin 3: normally open kontak 1',
      'H3CR-A8 pin 5: normally closed kontak 2',
    ]
  }
  if (component.spec.kind === 'TERMINAL_BLOCK') {
    const model = component.spec.model ?? 'FEED_THROUGH'
    if (model === 'PHOENIX_UT25_PE_L_L') {
      return ['PE level A', 'PE level B', 'L level A', 'L level B', "L' level A", "L' level B"]
    }
    const potential = model === 'PHOENIX_UT25_PE' ? 'PE yang sama' : 'potensial yang sama'
    return numbers.map((number) => `terminal ${number} — ${potential}`)
  }
  return TERMINAL_LABEL[component.spec.kind] ?? numbers.map((number) => `terminal ${number}`)
}

/** Function printed above the terminal designation when the function matters. */
function terminalRolesFor(component: PlacedComponent): Array<string | undefined> {
  const exact = resolvedTerminalDefinitions(component)
  if (exact) return exact.map((item) => item.role)
  if (component.spec.kind === 'PUSHBUTTON') {
    const role = component.spec.normallyOpen ? 'NO' : 'NC'
    return [role, role]
  }
  switch (component.spec.kind) {
    case 'CONTACT_2STATE':
      return ['COM', 'NC', 'NO']
    case 'LIMIT_SWITCH':
      return ['NC', 'NC', 'NO', 'NO']
    case 'SENSOR_3WIRE':
      return ['+V', '0V', component.spec.output]
    case 'TERMINAL_BLOCK':
      if (component.spec.model === 'PHOENIX_UT25_PE_L_L') return ['PE', 'PE', 'L', 'L', "L'", "L'"]
      return []
    case 'ESTOP':
      return ['NC', 'NC']
    case 'RELAY':
      return relayDefinition(component.spec).terminals.map((terminal) => terminal.role)
    case 'CONTACTOR':
      return [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'NO',
        'NO',
        'NC',
        'NC',
      ]
    case 'TIMER':
      return [undefined, undefined, 'COM', 'NC', 'COM', 'NO', 'NO', 'NC']
    case 'OVERLOAD_RELAY':
      return [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'NC',
        'NC',
        'NO',
        'NO',
      ]
    default:
      return []
  }
}

const COMPONENT_LABEL: Record<string, string> = {
  SOURCE: 'sumber',
  SWITCH: 'saklar',
  SWITCH_2WAY: 'saklar tukar',
  SWITCH_CROSS: 'saklar silang',
  CONTACT_2STATE: 'kontak',
  LIMIT_SWITCH: 'limit switch',
  SENSOR_3WIRE: 'sensor 3-wire',
  TERMINAL_BLOCK: 'terminal block',
  SELECTOR_3POS: 'selektor',
  FUSE: 'sekring',
  ESTOP: 'tombol darurat',
  LOAD: 'lampu',
  MOTOR: 'motor',
  CAPACITOR: 'kapasitor',
  PUSHBUTTON: 'tombol',
  RELAY: 'relay',
  INDICATOR: 'indikator',
  SOURCE_3PH: 'sumber 3-fasa',
  MOTOR_3PH: 'motor 3-fasa',
  CONTACTOR: 'kontaktor',
  BREAKER_1P: 'MCB 1-fasa',
  BREAKER_3P: 'MCB 3-fasa',
}

const DRAG_THRESHOLD = 4
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function activateOnKey(handler: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handler()
    }
  }
}

interface DragState {
  id: string
  cell: Cell
  moved: boolean
}

interface RoutingWorkerReply {
  requestId: number
  key: string
  geometries: WireGeometry[]
}

/** One stable empty result, so memoised consumers do not recompute on every render. */
const NO_GEOMETRY: WireGeometry[] = []

/**
 * Route in a dedicated worker in the browser/Android WebView. Geometry routing is
 * pure but can be CPU-heavy on an industrial board; keeping it off the UI thread
 * means the component board, tabs, Back, and loading state remain responsive.
 * SSR/tests retain the deterministic synchronous path.
 *
 * While `hold` is set (a component drag), the inputs of the last committed board
 * stay the routing job, so the drag never starts a route; the drop routes once.
 * Until a new route arrives the previous lines stay drawn for every wire whose
 * endpoints did not change; a moved component's cables wait for their new route.
 */
function useRoutedGeometry(
  key: string,
  requests: WireRouteRequest[],
  obstacles: Rect[],
  terminalKeepOuts: TerminalKeepOut[],
  enabled = true,
  routingDebounceMs = 24,
  hold = false,
): { geometries: WireGeometry[]; ready: boolean } {
  const canUseWorker = typeof window !== 'undefined' && typeof Worker !== 'undefined'
  const syncCache = useRef<{ key: string; geometries: WireGeometry[] } | null>(null)
  const requestIdRef = useRef(0)
  const [asyncResult, setAsyncResult] = useState<{
    key: string
    geometries: WireGeometry[]
    endpoints: Map<string, string>
  } | null>(null)
  const routedKey = useRef<string | null>(null)
  routedKey.current = asyncResult?.key ?? null
  const held = useRef({ key, requests, obstacles, terminalKeepOuts })
  if (!hold) held.current = { key, requests, obstacles, terminalKeepOuts }
  const job = held.current

  useEffect(() => {
    // An already-routed key (a tab shown again, a drag that snapped back) is final.
    if (!canUseWorker || !enabled || job.requests.length === 0 || routedKey.current === job.key) return
    let worker: Worker | null = null
    // Coalesce rapid successive edits. The route itself is deterministic; this
    // short delay only avoids spawning a worker per keystroke on older devices.
    const timer = window.setTimeout(() => {
      worker = new Worker(
        new URL('./routingWorker.ts', import.meta.url),
        { type: 'module', name: 'takar-wiring-router' },
      )
      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      const endpoints = new Map(job.requests.map((request) => [request.id, routeEndpointSignature(request)]))
      worker.onmessage = (event: MessageEvent<RoutingWorkerReply>) => {
        if (event.data.requestId !== requestId || event.data.key !== job.key) return
        // A finished worker still holds its own JS heap; release it now.
        worker?.terminate()
        worker = null
        setAsyncResult({ key: job.key, geometries: event.data.geometries, endpoints })
      }
      worker.postMessage({
        requestId,
        key: job.key,
        requests: job.requests,
        obstacles: job.obstacles,
        terminalKeepOuts: job.terminalKeepOuts,
      })
    }, routingDebounceMs)
    // A newer board invalidates the job; terminating it means a changed board
    // never waits behind an obsolete 40-wire route.
    return () => {
      window.clearTimeout(timer)
      worker?.terminate()
    }
  }, [canUseWorker, enabled, job.key, routingDebounceMs])

  const stale = useMemo(() => {
    if (!asyncResult) return NO_GEOMETRY
    if (asyncResult.key === job.key) return asyncResult.geometries
    return reusableRoutes(asyncResult.geometries, asyncResult.endpoints, job.requests)
  }, [asyncResult, job.key])

  if (!enabled) return { geometries: stale, ready: false }
  if (job.requests.length === 0) return { geometries: NO_GEOMETRY, ready: true }
  if (canUseWorker) return { geometries: stale, ready: asyncResult?.key === job.key }
  if (!syncCache.current || syncCache.current.key !== job.key) {
    syncCache.current = {
      key: job.key,
      geometries: routeBoardWires(job.requests, job.obstacles, job.terminalKeepOuts),
    }
  }
  return { geometries: syncCache.current.geometries, ready: true }
}

function CircuitBoardView({
  active = true,
  state,
  prefersReducedMotion,
  renderProfile,
  placingSpec,
  pendingTerminal,
  eraseMode,
  onPlaceCell,
  onTerminalClick,
  onTapWire,
  onToggleSwitch,
  onSelectComponent,
  selectedId,
  onPressButton,
  onPressProductControl = () => undefined,
  onDeleteComponent,
  onDeleteWire,
  onMoveComponent,
  onReplaceRequest,
  onCancelWiring,
  projection = 'virtual',
  zoom = 1,
  onPinchZoom,
  viewport = { vw: 0, vh: 0 },
  cameraInsets = EMPTY_CAMERA_INSETS,
  onViewportMetrics,
}: CircuitBoardProps) {
  const { board } = state
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragStart = useRef<
    {
      id: string
      pointerId: number
      startX: number
      startY: number
      origCell: Cell
      capturing: boolean
      pointerType: string
      holdReady: boolean
      holdTimer: number | null
    } | null
  >(null)
  const activeTouches = useRef(
    new Map<
      number,
      ClientPoint & {
        startX: number
        startY: number
        scrollLeft: number
        scrollTop: number
      }
    >(),
  )
  const panGesture = useRef<{
    pointerId: number
    startX: number
    startY: number
    scrollLeft: number
    scrollTop: number
  } | null>(null)
  const pinchGesture = useRef<{
    pointerIds: [number, number]
    startDistance: number
    startZoom: number
    anchor: ClientPoint
  } | null>(null)
  const pinchPreviewFrame = useRef(0)
  const pendingPinchPreview = useRef<{
    scale: number
    translateX: number
    translateY: number
  } | null>(null)
  const pendingPinchCommit = useRef<{
    zoom: number
    scroll: ClientPoint
  } | null>(null)
  const suppressClick = useRef<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  // Cursor position (board pixels) while dragging a wire out of a terminal.
  const [cursor, setCursor] = useState<Point | null>(null)

  /**
   * The only React update in a pinch arrives through `onPinchZoom` at pointer-up.
   * Until then the SVG is a compositor layer.  A layout effect applies the final
   * scroll position while the committed SVG dimensions are already in the DOM, then
   * clears the temporary transform before the browser paints the settled frame.
   */
  useClientLayoutEffect(() => {
    const commit = pendingPinchCommit.current
    if (!commit || Math.abs(commit.zoom - zoom) > 1e-9) return
    const wrap = boardWrap()
    if (wrap) {
      wrap.scrollLeft = commit.scroll.x
      wrap.scrollTop = commit.scroll.y
    }
    const svg = svgRef.current
    if (svg) {
      svg.style.transform = ''
      svg.style.willChange = ''
      svg.style.transformBox = ''
      delete svg.dataset.pinchPreview
    }
    pendingPinchCommit.current = null
  }, [zoom])

  useEffect(() => () => {
    if (pinchPreviewFrame.current) cancelAnimationFrame(pinchPreviewFrame.current)
  }, [])

  // While dragging, a component renders at its ghost cell; its wires follow. The
  // placed component list is otherwise topology-static across simulation ticks.
  const components = useMemo(
    () => Object.values(board.components).map((component): PlacedComponent =>
      drag && drag.moved && drag.id === component.id
        ? {
            ...component,
            projectionCells: {
              ...component.projectionCells,
              [projection]: drag.cell,
            },
          }
        : component,
    ),
    [board.components, drag, projection],
  )
  const componentById = useMemo(
    () => new Map(components.map((component) => [component.id, component])),
    [components],
  )
  const automaticProductState = useMemo(
    () => deriveAutomaticProductActuation(
      board,
      state.relayEnergized,
      state.contactorEnergized,
      {
        timer: state.timerRuntime,
        overload: state.overloadRuntime,
        mcb: state.mcbRuntime,
      },
    ),
    [
      board,
      state.relayEnergized,
      state.contactorEnergized,
      state.timerRuntime,
      state.overloadRuntime,
      state.mcbRuntime,
    ],
  )

  const sharedWires = useMemo(() => wirePresentation(state), [state])
  const trace = Object.fromEntries(Object.entries(sharedWires).map(([id, wire]) => [id, { onPath: wire.flowing, direction: wire.direction }]))
  const energised = state.solution.energised
  const conductor = Object.fromEntries(Object.entries(sharedWires).map(([id,wire])=>[id,wire.conductor]))
  // Pack 2A: on a 3-phase board, colour wires by their ACTUAL node phase and animate
  // only where real current flows (from the phasor solution) — not component status.
  // DC boards keep the L/N `conductor` + directional flow markers untouched.
  const phaseClass = boardDomain(board) === 'ac-three-phase-balanced' ? sharedWires : null
  const faulted = state.status === 'FAULTED'
  const draggable = !eraseMode && !placingSpec && !pendingTerminal

  // RENDER-ONLY overlap fix: where terminal dots would pile up, dots that are the
  // same PHYSICAL node merge into one and different-node dots fan apart.
  //
  // "Physical node" here is connectivity by WIRES ONLY (endpoint↔endpoint), never by
  // a component bridge (a closed switch, a pressed button, a picked-up relay contact,
  // an NC contact). Those are dynamic electrical shorts, not a drawn splice — so the
  // drawn terminal positions never shift when the simulation energises a net. This is
  // the same crossing≠connection contract as computeCrossings, applied to terminals:
  // relay/switch state and current can change colour/animation but never geometry.
  const physicalTopology = useMemo(() => buildPhysicalNodes(board), [board])
  const physicalNodeOf = physicalTopology.nodeOf
  const projectedTerminalPoint = (component: PlacedComponent, index: number): Point =>
    projection === 'virtual'
      ? virtualTerminalPoint(component, index)
      : terminalPoint(component, index)
  // A simulation tick changes currents and contact states, never placement, so the
  // pure geometry below is memoised on the layout instead of rebuilt every commit.
  // Physical terminals must stay centred on their actual screw/terminal wells.
  // The schematic projection may still nudge accidental overlaps for legibility.
  const overlap = useMemo(() => {
    if (projection === 'virtual') return resolveTerminalOverlap([])
    const terminalPlacements: TerminalPlacement[] = components.flatMap((component) =>
      Array.from({ length: terminalCountForComponent(component) }, (_unused, index) => {
        const key = `${component.id}:${index}`
        return { key, node: physicalNodeOf.get(key), point: terminalPoint(component, index) }
      }),
    )
    return resolveTerminalOverlap(terminalPlacements)
  }, [components, physicalNodeOf, projection])
  // The position a terminal is DRAWN at (and where its wires attach). Equal to the
  // real terminal point unless the overlap fix merged or nudged it.
  const displayPoint = (component: PlacedComponent, index: number): Point =>
    overlap.displayOf.get(`${component.id}:${index}`) ?? projectedTerminalPoint(component, index)

  // One deterministic number per physically wired node. Because this map is built
  // from the shared board model, the same small circled number appears on both the
  // virtual board and the IEC board, including jumper branches.
  const { netNumberOf, groundRoots } = useMemo(() => {
    const wiredRoots = new Set<string>()
    for (const wire of Object.values(board.wires)) {
      const root = physicalNodeOf.get(terminalKey(wire.from))
      if (root) wiredRoots.add(root)
    }
    // Net numbering must be identical on both projections even though their
    // terminal drawings now have projection-specific physical coordinates.
    // Top-most, then left-most terminal per net, found in one pass (not per comparison).
    const sortPoint = new Map<string, Point>()
    for (const component of components) {
      for (let index = 0; index < terminalCountForComponent(component); index += 1) {
        const root = physicalNodeOf.get(`${component.id}:${index}`)
        if (root === undefined || !wiredRoots.has(root)) continue
        const point = terminalPoint(component, index)
        const best = sortPoint.get(root)
        if (!best || point.y < best.y || (point.y === best.y && point.x < best.x)) {
          sortPoint.set(root, point)
        }
      }
    }
    const far = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY }
    const orderedRoots = [...wiredRoots].sort((a, b) => {
      const pa = sortPoint.get(a) ?? far
      const pb = sortPoint.get(b) ?? far
      return pa.y - pb.y || pa.x - pb.x || a.localeCompare(b)
    })
    return {
      netNumberOf: new Map(orderedRoots.map((root, index) => [root, index + 1])),
      groundRoots: new Set(
        components
          .filter((component) => component.spec.kind === 'GROUND')
          .map((component) => physicalNodeOf.get(`${component.id}:0`))
          .filter((root): root is string => Boolean(root)),
      ),
    }
  }, [board.wires, components, physicalNodeOf])
  const netOfTerminal = (terminal: Terminal): number | undefined => {
    const root = physicalNodeOf.get(terminalKey(terminal))
    return root ? netNumberOf.get(root) : undefined
  }
  const netColorIndex = (net: number | undefined): number | undefined =>
    net === undefined ? undefined : (net - 1) % 12
  const isProtectiveEarthWire = (wireId: string): boolean => {
    const wire = board.wires[wireId]
    const root = wire ? physicalNodeOf.get(terminalKey(wire.from)) : undefined
    return Boolean(root && groundRoots.has(root))
  }

  // The wire exits straight out of the terminal's face. Relay coil pins (0,1)
  // exit left, its contact pins (2–5) exit right; a motor's aux (2) exits down.
  const exitDir = (comp: PlacedComponent, index: number): Point => {
    if (projection === 'virtual') return virtualTerminalExit(comp, index)
    return iecTerminalExit(comp, index)
  }

  // Build all route requests first. The global router owns corridor selection,
  // bundle spacing, terminal keep-outs, and reservations between unrelated wires.
  const { boxOf, allObstacles, terminalKeepOuts } = useMemo(() => {
    // Obstacle boxes around each component glyph, for space-aware routing.
    // Footprint-aware: a 1×1 glyph gives exactly the old ±30 box.
    const boxOf = new Map<string, Rect>()
    for (const component of components) {
      const body = projectionComponentBox(component, projection)
      boxOf.set(component.id, expandRect(body))
    }
    const terminalKeepOuts: TerminalKeepOut[] = components.flatMap((component) =>
      Array.from({ length: terminalCountForComponent(component) }, (_unused, index) => {
        const point = displayPoint(component, index)
        const radius = projection === 'virtual' ? 7.5 : TERMINAL_ROUTE_KEEP_OUT
        return {
          key: `${component.id}:${index}`,
          rect: {
            minX: point.x - radius,
            minY: point.y - radius,
            maxX: point.x + radius,
            maxY: point.y + radius,
          },
        }
      }),
    )
    return { boxOf, allObstacles: [...boxOf.values()], terminalKeepOuts }
  }, [components, overlap, projection])
  const routingIntents = useMemo(
    () => deriveWireRoutingIntents(board, physicalTopology),
    [board, physicalTopology],
  )
  const commonTrunkPlans = useMemo(
    () => buildCommonNetTrunkPlans(board, physicalTopology),
    [board, physicalTopology],
  )
  const semanticTapByWireId = useMemo(
    () => new Map(commonTrunkPlans.map((plan) => [plan.branchWireId, plan])),
    [commonTrunkPlans],
  )
  const routeRequestFor = (
    wire: (typeof board.wires)[string],
    visualTo?: { point: Point; direction: Point; joinWireId: string },
    visualFrom?: Terminal,
  ): WireRouteRequest | null => {
    const fromTerminal = visualFrom ?? wire.from
    const fromComp = componentById.get(fromTerminal.componentId)
    const toComp = componentById.get(wire.to.componentId)
    if (!fromComp || !toComp) return null
    const pair = [fromComp.id, toComp.id].sort().join('<->')
    const intent = routingIntents.get(wire.id)
    const fromDirection = exitDir(fromComp, fromTerminal.index)
    const toDirection = visualTo?.direction ?? exitDir(toComp, wire.to.index)
    const directionSignature =
      `${fromDirection.x},${fromDirection.y}:${toDirection.x},${toDirection.y}`
    return {
      id: wire.id,
      priority: visualTo ? 1 : 0,
      bundleKey: visualTo
        ? `tap:${visualTo.joinWireId}:${visualTo.point.x.toFixed(2)}:${visualTo.point.y.toFixed(2)}`
        : intent?.bundleKey ?? `pair:${pair}:${directionSignature}`,
      bundleOrder: intent?.bundleOrder ?? fromTerminal.index * 100 + wire.to.index,
      preferredSide: visualTo ? undefined : intent?.preferredSide,
      from: {
        point: displayPoint(fromComp, fromTerminal.index),
        direction: fromDirection,
        obstacle: boxOf.get(fromComp.id),
        terminalKey: terminalKey(fromTerminal),
      },
      to: visualTo
        ? {
            point: visualTo.point,
            direction: visualTo.direction,
          }
        : {
            point: displayPoint(toComp, wire.to.index),
            direction: toDirection,
            obstacle: boxOf.get(toComp.id),
            terminalKey: terminalKey(wire.to),
          },
      join: visualTo
        ? { wireId: visualTo.joinWireId, point: visualTo.point }
        : undefined,
    }
  }

  const wires = useMemo(() => Object.values(board.wires), [board.wires])
  // A drag previews the component only; its cables are routed once on the drop.
  const holdRouting = Boolean(drag?.moved)
  // The first pass establishes stable tap targets. Ordinary wires have priority
  // zero, so replacing a tap's logical endpoint cannot move its target route.
  const { logicalRequests, logicalRouteKey } = useMemo(() => {
    const requests = wires.flatMap((wire) => {
      const request = routeRequestFor(wire)
      return request ? [request] : []
    })
    return {
      logicalRequests: requests,
      logicalRouteKey: JSON.stringify({
        projection,
        requests,
        obstacles: allObstacles,
        terminalKeepOuts,
      }),
    }
  }, [wires, componentById, routingIntents, boxOf, allObstacles, terminalKeepOuts, overlap, projection])
  const logicalRouting = useRoutedGeometry(
    logicalRouteKey,
    logicalRequests,
    allObstacles,
    terminalKeepOuts,
    active,
    renderProfile?.routingDebounceMs,
    holdRouting,
  )
  const logicalGeoms = logicalRouting.geometries
  const hasTap = wires.some((wire) => Boolean(wire.tap) || semanticTapByWireId.has(wire.id))
  const { finalRequests, finalRouteKey, tapDots } = useMemo(() => {
    if (!hasTap) {
      return { finalRequests: logicalRequests, finalRouteKey: logicalRouteKey, tapDots: [] as Point[] }
    }
    const logicalById = new Map(logicalGeoms.map((geometry) => [geometry.id, geometry.points]))
    const tapDots: Point[] = []
    const visualTapFraction = (
      wire: (typeof board.wires)[string],
      targetPoints: Point[],
    ): number => {
      if (!wire.tap) return 0.5
      const baseFraction = tapFractionForProjection(wire.tap, projection, targetPoints)
      const colocated = wires
        .filter((candidate) => candidate.tap?.wireId === wire.tap?.wireId)
        .map((candidate) => {
          const fraction = candidate.tap
            ? tapFractionForProjection(candidate.tap, projection, targetPoints)
            : 0.5
          return { id: candidate.id, fraction }
        })
        .filter((candidate) => Math.abs(candidate.fraction - baseFraction) < 0.005)
        .sort((a, b) => a.id.localeCompare(b.id))
      if (colocated.length < 2) return baseFraction
      const rank = colocated.findIndex((candidate) => candidate.id === wire.id)
      const spread = (rank - (colocated.length - 1) / 2) * 0.06
      return Math.max(0.08, Math.min(0.92, baseFraction + spread))
    }
    const requests = wires.flatMap((wire) => {
      const semanticTap = semanticTapByWireId.get(wire.id)
      const targetWireId = wire.tap?.wireId ?? semanticTap?.targetWireId
      if (!targetWireId) {
        const request = routeRequestFor(wire)
        return request ? [request] : []
      }
      const sourceTerminal = semanticTap?.branchTerminal ?? wire.from
      const targetPoints = logicalById.get(targetWireId)
      const fromComponent = componentById.get(sourceTerminal.componentId)
      if (!targetPoints || targetPoints.length < 2 || !fromComponent) {
        const request = routeRequestFor(wire)
        return request ? [request] : []
      }
      const requestedPoint = pointAtPolylineFraction(
        targetPoints,
        semanticTap?.junctionFraction ?? visualTapFraction(wire, targetPoints),
      )
      const hit = nearestPointOnPolyline(targetPoints, requestedPoint)
      const segment = targetPoints[hit.segment]
      const next = targetPoints[hit.segment + 1]
      const targetIsHorizontal =
        segment && next ? Math.abs(segment.y - next.y) < 0.5 : true
      const start = displayPoint(fromComponent, sourceTerminal.index)
      const endDirection: Point = targetIsHorizontal
        ? { x: 0, y: Math.sign(start.y - hit.point.y) || 1 }
        : { x: Math.sign(start.x - hit.point.x) || 1, y: 0 }
      tapDots.push(hit.point)
      const request = routeRequestFor(wire, {
        point: hit.point,
        direction: endDirection,
        joinWireId: targetWireId,
      }, sourceTerminal)
      return request ? [request] : []
    })
    return {
      finalRequests: requests,
      finalRouteKey: JSON.stringify({
        projection,
        requests,
        obstacles: allObstacles,
        terminalKeepOuts,
      }),
      tapDots,
    }
  }, [hasTap, logicalRequests, logicalRouteKey, logicalGeoms, wires, semanticTapByWireId, componentById, routingIntents, boxOf, allObstacles, terminalKeepOuts, overlap, projection])
  const finalRouting = useRoutedGeometry(
    finalRouteKey,
    finalRequests,
    allObstacles,
    terminalKeepOuts,
    active && hasTap && logicalRouting.ready,
    renderProfile?.routingDebounceMs,
    holdRouting,
  )
  const routedGeoms: WireGeometry[] = hasTap ? finalRouting.geometries : logicalGeoms
  // The dragged component's own cables would still point at its old place; hide them
  // until the drop routes them again (the other cables stay drawn).
  const dragId = holdRouting ? drag?.id : undefined
  const geoms = useMemo(() => {
    if (!dragId) return routedGeoms
    const attached = new Set(
      wires
        .filter((wire) => wire.from.componentId === dragId || wire.to.componentId === dragId)
        .map((wire) => wire.id),
    )
    return routedGeoms.filter((geometry) => !attached.has(geometry.id))
  }, [routedGeoms, dragId, wires])
  const routingPending =
    wires.length > 0 && (!logicalRouting.ready || (hasTap && !finalRouting.ready))
  // Global lane allocation keeps DIFFERENT nets in separate corridors. A derived
  // common-net plan may intentionally terminate one branch on its shared trunk;
  // that explicit junction is the only overlap/touch exception.
  // Mid-span taps: redirect each tap wire so it ENDS on the target wire's FINAL
  // rendered polyline (after lane shifts), meeting it at 90° — never leaping to a
  // component terminal. Electrically the wire is still from↔to (the solver handles
  // that); this only sets the DRAWN endpoint, so the tap sits on the wire's line.
  // Bug 2 — CAMERA extent. Computed here (after routing) so the final wire polylines
  // extend the bounds and no conductor clips at the edge. `cameraMinCells` grows the
  // grid floor on zoom-out so `extent × zoom` fills the workspace (native scroll pans
  // when the circuit is larger); headless viewport {0,0} → the logical 12×8 floor.
  const { minCols, minRows } = cameraMinCells(viewport.vw, viewport.vh, zoom)
  const baseExtent = useMemo(() => boardExtent(
    board,
    minCols,
    minRows,
    [
      ...geoms.flatMap((g) => g.points),
      ...components.flatMap((component) => {
        const box = projectionComponentBox(component, projection)
        return [
          { x: box.minX, y: box.minY },
          { x: box.maxX, y: box.maxY },
        ]
      }),
    ],
    projection,
  ), [board, minCols, minRows, geoms, components, projection])
  // Camera metadata only. It observes the already-computed component and routing
  // geometry and cannot alter either. The one-cell margin keeps labels, hops, and
  // terminal affordances away from overlay controls when centred/fitted.
  const contentBounds: Rect | null = useMemo(() => cameraContentBounds(
    components.map((component) => projectionComponentBox(component, projection)),
    geoms.flatMap((geometry) => geometry.points),
    CELL,
  ), [components, geoms, projection])
  const extent = cameraExtentWithInsets(baseExtent, cameraInsets)
  const contentMinX = contentBounds?.minX
  const contentMinY = contentBounds?.minY
  const contentMaxX = contentBounds?.maxX
  const contentMaxY = contentBounds?.maxY
  useClientLayoutEffect(() => {
    if (!onViewportMetrics) return
    onViewportMetrics({
      board,
      projection,
      baseExtent,
      extent,
      contentBounds:
        contentMinX === undefined ||
        contentMinY === undefined ||
        contentMaxX === undefined ||
        contentMaxY === undefined
          ? null
          : {
              minX: contentMinX,
              minY: contentMinY,
              maxX: contentMaxX,
              maxY: contentMaxY,
            },
      routingReady: !routingPending,
      zoom,
    })
  }, [
    board,
    projection,
    baseExtent.x,
    baseExtent.y,
    baseExtent.width,
    baseExtent.height,
    extent.x,
    extent.y,
    extent.width,
    extent.height,
    contentMinX,
    contentMinY,
    contentMaxX,
    contentMaxY,
    routingPending,
    zoom,
    onViewportMetrics,
  ])
  // Crossings are PURELY geometric: every interior H×V intersection is a hop.
  // Connectivity is never inferred from a crossing — real junctions come only from
  // terminalJunctions / tapDots / mergeDots below (explicit physical joins). So the
  // drawn crossing geometry is identical idle vs energised; relay/switch state, node
  // identity, colour and current never move a hop or turn it into a junction.
  const { hops, renderGeoms } = useMemo(() => {
    const { hops, over } = computeCrossings(geoms)
    // Paint hoppers ON TOP of the wires they cross, so each hop arc bridges the crossed wire
    // cleanly instead of piling under it (owner: "kabel yang jadi wired-loop harus di atas").
    return { hops, renderGeoms: orderWiresForHops(geoms, over) }
  }, [geoms])
  const breakerAnnotationRect = (component: PlacedComponent): Rect | null => {
    if (
      projection !== 'iec' ||
      (component.spec.kind !== 'BREAKER_1P' && component.spec.kind !== 'BREAKER_3P')
    ) {
      return null
    }
    const body = iecLayoutFor(component).body
    return {
      minX: body.minX + 3,
      maxX: body.maxX - 3,
      minY: body.minY + 2,
      maxY: Math.min(body.maxY - 2, body.minY + 24),
    }
  }
  const wireLabels = useMemo(() => {
    const breakerAnnotationRects = components.flatMap((component) => {
      const rect = breakerAnnotationRect(component)
      return rect ? [rect] : []
    })
    const labelOccupied: Rect[] = [
      ...terminalKeepOuts.map((keepOut) => keepOut.rect),
      ...breakerAnnotationRects,
      ...Object.values(hops).flatMap((crossings) =>
        crossings.map((crossing) => ({
          minX: crossing.x - 12,
          minY: crossing.y - 12,
          maxX: crossing.x + 12,
          maxY: crossing.y + 12,
        })),
      ),
    ]
    const wireLabels = new Map<
      string,
      ReturnType<typeof wireLabelPlacements>
    >()
    const acceptedNetLabels: Array<{ net: string; point: Point }> = []
    for (const geom of [...renderGeoms].sort((a, b) => a.id.localeCompare(b.id))) {
      const wire = board.wires[geom.id]
      const net = wire?.source?.number ?? (wire ? netOfTerminal(wire.from) : undefined)
      if (!net) continue
      const placements = wireLabelPlacements(geom.points, String(net), labelOccupied)
      const visiblePlacements = placements.filter((placement) => {
        const candidate = { net: String(net), point: placement.point }
        if (isNearbyNetLabelDuplicate(candidate, acceptedNetLabels)) return false
        acceptedNetLabels.push(candidate)
        return true
      })
      wireLabels.set(geom.id, visiblePlacements)
      labelOccupied.push(...visiblePlacements.map((placement) => placement.rect))
    }
    return wireLabels
  }, [board.wires, components, hops, netNumberOf, physicalNodeOf, projection, renderGeoms, terminalKeepOuts])

  const { endsPerTerminal, allJunctions } = useMemo(() => {
    // A solder dot wherever three or more wire ends pile onto one terminal (a
    // tap/branch): the meeting IS a connection, so it reads as a junction, never a
    // hop. Two ends is an ordinary pass-through and gets no dot.
    const endsPerTerminal = new Map<string, number>()
    for (const wire of Object.values(board.wires)) {
      for (const terminal of [wire.from, wire.to]) {
        const key = `${terminal.componentId}:${terminal.index}`
        endsPerTerminal.set(key, (endsPerTerminal.get(key) ?? 0) + 1)
      }
    }
    const terminalJunctions: Point[] = []
    for (const [key, count] of endsPerTerminal) {
      if (count < 3) continue
      const split = key.lastIndexOf(':')
      const comp = componentById.get(key.slice(0, split))
      if (!comp) continue
      terminalJunctions.push(displayPoint(comp, Number(key.slice(split + 1))))
    }
    // All solder dots come ONLY from explicit physical joins: ≥3-end terminals
    // (`terminalJunctions`), same-node terminal merges (`overlap.mergeDots`), and
    // mid-span taps (`tapDots`). A bare geometric crossing is never here — it is a
    // hop. De-duplicated by position so a merged terminal that also carries three
    // wires shows a single clean dot, never two stacked.
    const allJunctions: Point[] = []
    const seenDot = new Set<string>()
    for (const dot of [...terminalJunctions, ...overlap.mergeDots, ...tapDots]) {
      const dotKey = `${Math.round(dot.x)},${Math.round(dot.y)}`
      if (seenDot.has(dotKey)) continue
      seenDot.add(dotKey)
      allJunctions.push(dot)
    }
    return { endsPerTerminal, allJunctions }
  }, [board.wires, componentById, overlap, projection, tapDots])
  // A terminal is drawn as a clean merged dot (its stacked circle hidden) when a
  // junction dot already represents its point: a ≥3-end node, or a same-node pile.
  const isMergedTerminal = (key: string): boolean =>
    overlap.mergedKeys.has(key) || (endsPerTerminal.get(key) ?? 0) >= 3

  // --- drag plumbing --------------------------------------------------------

  function boardWrap(): HTMLDivElement | null {
    const parent = svgRef.current?.parentElement
    return parent instanceof HTMLDivElement ? parent : null
  }

  function releaseBoardPointer(pointerId: number) {
    try {
      if (svgRef.current?.hasPointerCapture(pointerId)) {
        svgRef.current.releasePointerCapture(pointerId)
      }
    } catch {
      /* Pointer capture is an enhancement on older WebViews and in jsdom. */
    }
  }

  function clearHoldTimer() {
    const timer = dragStart.current?.holdTimer
    if (timer !== null && timer !== undefined) window.clearTimeout(timer)
    if (dragStart.current) dragStart.current.holdTimer = null
  }

  function cancelComponentGesture(suppressTap = false) {
    const start = dragStart.current
    if (start && suppressTap) suppressClick.current = start.id
    clearHoldTimer()
    if (start) releaseBoardPointer(start.pointerId)
    dragStart.current = null
    dragRef.current = null
    setDrag(null)
  }

  function releaseMomentaryActuators() {
    for (const component of Object.values(board.components)) {
      if (component.spec.kind === 'PUSHBUTTON' && component.spec.pressed) {
        onPressButton(component.id, false)
      }
    }
  }

  function beginPinch() {
    if (activeTouches.current.size < 2) return
    releaseMomentaryActuators()
    cancelComponentGesture(true)
    panGesture.current = null
    const [[firstId, first], [secondId, second]] = Array.from(
      activeTouches.current.entries(),
    )
    const wrap = boardWrap()
    if (!wrap) return
    const midpoint = pointMidpoint(first, second)
    const rect = wrap.getBoundingClientRect()
    pinchGesture.current = {
      pointerIds: [firstId, secondId],
      startDistance: Math.max(1, pointDistance(first, second)),
      startZoom: zoom,
      anchor: pinchAnchor(
        midpoint,
        rect.left,
        rect.top,
        wrap.scrollLeft,
        wrap.scrollTop,
        zoom,
      ),
    }
    // Promote the already-rendered board once.  Its geometry, terminal map and
    // solver state remain untouched while the compositor previews the zoom.
    if (svgRef.current) {
      svgRef.current.style.transformOrigin = '0 0'
      // Pinch math is expressed in CSS border-box pixels. SVG's default
      // `view-box` transform box can move that origin whenever the camera opens
      // a negative viewBox margin, which is perceived as a jump on Android.
      svgRef.current.style.transformBox = 'border-box'
      svgRef.current.style.willChange = 'transform'
      svgRef.current.dataset.pinchPreview = 'true'
    }
    for (const pointerId of [firstId, secondId]) {
      try {
        svgRef.current?.setPointerCapture(pointerId)
      } catch {
        /* see releaseBoardPointer */
      }
    }
  }

  function onBoardPointerDownCapture(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType !== 'touch') return
    const wrap = boardWrap()
    activeTouches.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: wrap?.scrollLeft ?? 0,
      scrollTop: wrap?.scrollTop ?? 0,
    })
    if (activeTouches.current.size >= 2) beginPinch()
  }

  function clientToSvg(clientX: number, clientY: number): Point | null {
    const svg = svgRef.current
    if (!svg || typeof svg.getScreenCTM !== 'function') return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const dompoint = svg.createSVGPoint()
    dompoint.x = clientX
    dompoint.y = clientY
    const local = dompoint.matrixTransform(ctm.inverse())
    return { x: local.x, y: local.y }
  }

  // Tap an existing wire while a terminal is pending. A wire is ONE electrical node,
  // so we union the pending terminal to one of the wire's own terminals (`anchor`) —
  // electrically identical to tapping anywhere on that wire. But VISUALLY the new
  // wire must END ON THE WIRE'S LINE, not leap to a component terminal: we hand the
  // click point (projected onto the wire's rendered polyline) to `onTapWire`, which
  // stores it as a render-only tap. When the click point can't be resolved (jsdom),
  // fall back to the target wire's polyline MIDPOINT — still a point ON the line.
  function tapWire(wireId: string, clientX?: number, clientY?: number) {
    if (!pendingTerminal) return
    const wire = board.wires[wireId]
    if (!wire) return
    const isPending = (t: Terminal) =>
      t.componentId === pendingTerminal.componentId && t.index === pendingTerminal.index
    // Anchor = a terminal of the tapped wire that is NOT the pending terminal, so the
    // union joins two distinct pins of the (now shared) node.
    const anchor = [wire.from, wire.to].find((t) => !isPending(t))
    if (!anchor) return
    const targetGeom = geoms.find((g) => g.id === wireId)
    const clickPoint =
      clientX !== undefined && clientY !== undefined ? clientToSvg(clientX, clientY) : null
    // The point we store must lie ON the target wire's line. Project the click onto
    // the rendered polyline; if there is no click (jsdom) use the polyline midpoint.
    const near: Point = targetGeom
      ? clickPoint
        ? nearestPointOnPolyline(targetGeom.points, clickPoint).point
        : midpointOnPolyline(targetGeom.points)
      : (clickPoint ?? displayPoint(componentById.get(anchor.componentId)!, anchor.index))
    const position = targetGeom ? fractionOnPolyline(targetGeom.points, near) : 0.5
    onTapWire(wireId, anchor, position, near)
  }

  function startDrag(event: PointerEvent, component: PlacedComponent) {
    if (!draggable || event.button !== 0 || activeTouches.current.size >= 2) return
    clearHoldTimer()
    // Record the gesture but do NOT capture the pointer yet: capturing on a
    // plain click would steal the pointerup from the element and swallow its
    // click (e.g. the switch toggle). Mouse capture begins after movement; touch
    // capture begins only after a deliberate hold so a normal swipe always pans.
    const start = {
      id: component.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origCell: projectionCell(component, projection),
      capturing: false,
      pointerType: event.pointerType,
      holdReady: event.pointerType !== 'touch',
      holdTimer: null as number | null,
    }
    dragStart.current = start
    if (event.pointerType === 'touch') {
      start.holdTimer = window.setTimeout(() => {
        if (
          dragStart.current !== start ||
          activeTouches.current.size !== 1 ||
          panGesture.current ||
          pinchGesture.current
        ) {
          return
        }
        start.holdReady = true
        start.capturing = true
        start.holdTimer = null
        suppressClick.current = start.id
        // Arm the drag at the original snapped cell immediately. Besides giving
        // Android a visible long-press acknowledgement, this keeps a hold distinct
        // from a one-finger pan even before the finger crosses into the next cell.
        const armed = { id: start.id, cell: start.origCell, moved: false }
        dragRef.current = armed
        setDrag(armed)
        try {
          svgRef.current?.setPointerCapture(start.pointerId)
        } catch {
          /* Pointer capture is optional; movement still works inside the board. */
        }
        window.navigator.vibrate?.(12)
      }, COMPONENT_HOLD_MS)
    }
  }

  function onPointerMove(event: PointerEvent) {
    // While pulling a wire out of a terminal, track the cursor for the preview.
    if (pendingTerminal) {
      const point = clientToSvg(event.clientX, event.clientY)
      if (point) setCursor(point)
    }
    if (event.pointerType === 'touch') {
      const touch = activeTouches.current.get(event.pointerId)
      if (!touch) return
      // Android may coalesce several hardware touch samples before dispatching
      // one PointerEvent. Preview the most recent sample, not the older event
      // position, so a compositor frame never trails a rapid pinch by a full
      // input batch.
      const coalesced = event.nativeEvent.getCoalescedEvents?.()
      const latest = coalesced && coalesced.length > 0
        ? coalesced[coalesced.length - 1]
        : event.nativeEvent
      touch.x = latest.clientX
      touch.y = latest.clientY

      const pinch = pinchGesture.current
      if (pinch) {
        const first = activeTouches.current.get(pinch.pointerIds[0])
        const second = activeTouches.current.get(pinch.pointerIds[1])
        const wrap = boardWrap()
        if (!first || !second || !wrap) return
        event.preventDefault()
        const nextZoom = continuousPinchZoom(
          pinch.startZoom,
          pinch.startDistance,
          pointDistance(first, second),
        )
        const midpoint = pointMidpoint(first, second)
        const rect = wrap.getBoundingClientRect()
        const nextScroll = scrollForPinch(
          pinch.anchor,
          midpoint,
          rect.left,
          rect.top,
          nextZoom,
        )
        // Do not set React state or scroll the wrapper for every move. Both actions
        // force style/layout work across a large routed SVG on Android. A temporary
        // transform keeps the precise board anchor under the moving midpoint; the
        // final zoom+scroll pair is committed atomically at pointer-up.
        pendingPinchPreview.current = pinchPreviewTransform(
          pinch.anchor,
          pinch.startZoom,
          { x: first.scrollLeft, y: first.scrollTop },
          midpoint,
          rect.left,
          rect.top,
          nextZoom,
        )
        pendingPinchCommit.current = { zoom: nextZoom, scroll: nextScroll }
        if (!pinchPreviewFrame.current) {
          pinchPreviewFrame.current = requestAnimationFrame(() => {
            pinchPreviewFrame.current = 0
            const preview = pendingPinchPreview.current
            const svg = svgRef.current
            if (!preview || !svg) return
            svg.style.transform = `translate3d(${preview.translateX}px, ${preview.translateY}px, 0) scale(${preview.scale})`
          })
        }
        return
      }

      const start = dragStart.current
      if (start?.pointerId === event.pointerId && start.holdReady) {
        event.preventDefault()
        const point = clientToSvg(event.clientX, event.clientY)
        if (point) moveDragTo(start.id, cellAtPoint(point))
        return
      }

      const distance = Math.hypot(event.clientX - touch.startX, event.clientY - touch.startY)
      if (distance < TOUCH_PAN_THRESHOLD_PX) return
      if (start?.pointerId === event.pointerId) cancelComponentGesture(true)
      const wrap = boardWrap()
      if (!wrap) return
      if (!panGesture.current) {
        releaseMomentaryActuators()
        panGesture.current = {
          pointerId: event.pointerId,
          startX: touch.startX,
          startY: touch.startY,
          scrollLeft: touch.scrollLeft,
          scrollTop: touch.scrollTop,
        }
        try {
          svgRef.current?.setPointerCapture(event.pointerId)
        } catch {
          /* optional */
        }
      }
      const pan = panGesture.current
      if (pan.pointerId !== event.pointerId) return
      event.preventDefault()
      wrap.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX)
      wrap.scrollTop = pan.scrollTop - (event.clientY - pan.startY)
      return
    }

    const start = dragStart.current
    if (!start || event.pointerId !== start.pointerId) return
    const distance = Math.hypot(event.clientX - start.startX, event.clientY - start.startY)
    if (!start.capturing && distance < DRAG_THRESHOLD) return
    if (!start.capturing) {
      start.capturing = true
      try {
        svgRef.current?.setPointerCapture(start.pointerId)
      } catch {
        /* jsdom / unsupported: drag simply won't track */
      }
    }
    const point = clientToSvg(event.clientX, event.clientY)
    if (!point) return
    moveDragTo(start.id, cellAtPoint(point))
  }

  // Re-render only when the dragged component enters another cell, not on every
  // pointer sample inside the same cell.
  function moveDragTo(id: string, cell: Cell) {
    const current = dragRef.current
    if (current?.moved && current.id === id && current.cell.x === cell.x && current.cell.y === cell.y) return
    const next = { id, cell, moved: true }
    dragRef.current = next
    setDrag(next)
  }

  function finishDrag(commit: boolean) {
    const start = dragStart.current
    clearHoldTimer()
    if (start?.capturing) releaseBoardPointer(start.pointerId)
    const finalDrag = dragRef.current
    if (commit && finalDrag?.moved && start) {
      const changed =
        finalDrag.cell.x !== start.origCell.x || finalDrag.cell.y !== start.origCell.y
      const dragged = componentById.get(start.id)
      if (changed && dragged) {
        const draggedKind = dragged.spec.kind
        const is1x1 = (kind: typeof draggedKind) => {
          const fp = componentFootprint(kind, projection)
          return fp.cols === 1 && fp.rows === 1
        }
        if (!footprintCollides(board, draggedKind, finalDrag.cell, start.id, projection)) {
          onMoveComponent(start.id, finalDrag.cell)
        } else {
          // Overlap. The existing 1×1-onto-1×1 case still offers replace; any overlap
          // involving a MULTI-CELL footprint is rejected (the move snaps back).
          const occupant = components.find(
            (c) => {
              const cell = projectionCell(c, projection)
              return (
                c.id !== start.id &&
                cell.x === finalDrag.cell.x &&
                cell.y === finalDrag.cell.y
              )
            },
          )
          if (occupant && is1x1(draggedKind) && is1x1(occupant.spec.kind)) {
            onReplaceRequest(start.id, occupant.id, finalDrag.cell)
          }
        }
      }
      // A drag gesture must not also toggle the switch it grabbed.
      suppressClick.current = start.id
    }
    dragStart.current = null
    dragRef.current = null
    setDrag(null)
  }

  function finishPointer(event: PointerEvent, cancelled = false) {
    if (event.pointerType !== 'touch') {
      finishDrag(!cancelled)
      return
    }

    const wasPinching = Boolean(pinchGesture.current)
    const wasPanning = panGesture.current?.pointerId === event.pointerId
    activeTouches.current.delete(event.pointerId)
    releaseBoardPointer(event.pointerId)

    if (wasPinching) {
      event.preventDefault()
      cancelComponentGesture(true)
      const commit = pendingPinchCommit.current
      if (pinchPreviewFrame.current) {
        cancelAnimationFrame(pinchPreviewFrame.current)
        pinchPreviewFrame.current = 0
      }
      if (!cancelled && commit) onPinchZoom?.(commit.zoom)
      // At a zoom limit the final value can equal the starting value, so the
      // parent deliberately has no state update to trigger the layout effect
      // above. Clear the preview synchronously in that no-op case rather than
      // leaving a stale transform on the board.
      if (!cancelled && commit && Math.abs(commit.zoom - zoom) <= 0.0001) {
        const wrap = boardWrap()
        if (wrap) {
          wrap.scrollLeft = commit.scroll.x
          wrap.scrollTop = commit.scroll.y
        }
        const svg = svgRef.current
        if (svg) {
          svg.style.transform = ''
          svg.style.willChange = ''
          svg.style.transformBox = ''
          delete svg.dataset.pinchPreview
        }
        pendingPinchCommit.current = null
      }
      if (cancelled) {
        pendingPinchCommit.current = null
        const svg = svgRef.current
        if (svg) {
          svg.style.transform = ''
          svg.style.willChange = ''
          svg.style.transformBox = ''
          delete svg.dataset.pinchPreview
        }
      }
      pinchGesture.current = null
      panGesture.current = null
      // If one finger remains, it may continue panning from its CURRENT position;
      // it must never turn into a component drag after a pinch.
      const remaining = Array.from(activeTouches.current.entries())[0]
      const wrap = boardWrap()
      if (remaining && wrap) {
        const [pointerId, point] = remaining
        point.startX = point.x
        point.startY = point.y
        point.scrollLeft = wrap.scrollLeft
        point.scrollTop = wrap.scrollTop
        panGesture.current = {
          pointerId,
          startX: point.x,
          startY: point.y,
          scrollLeft: wrap.scrollLeft,
          scrollTop: wrap.scrollTop,
        }
      }
      return
    }

    if (wasPanning) {
      event.preventDefault()
      panGesture.current = null
      cancelComponentGesture(true)
      return
    }
    finishDrag(!cancelled)
  }

  // --- rendering ------------------------------------------------------------

  // Decimate the display grid at distant zoom; never allocate millions of SVG nodes.
  const gridStride = Math.max(1, Math.ceil(24 / (CELL * zoom)))
  const gridLines = []
  const firstGridColumn = Math.floor((extent.x - PAD) / CELL)
  const lastGridColumn = Math.ceil((extent.x + extent.width - PAD) / CELL)
  const firstGridRow = Math.floor((extent.y - PAD) / CELL)
  const lastGridRow = Math.ceil((extent.y + extent.height - PAD) / CELL)
  for (let x = Math.ceil(firstGridColumn / gridStride) * gridStride; x <= lastGridColumn; x += gridStride) {
    gridLines.push(
      <line
        key={`gx${x}`}
        className="as-lab-board__grid"
        x1={PAD + x * CELL}
        y1={extent.y}
        x2={PAD + x * CELL}
        y2={extent.y + extent.height}
      />,
    )
  }
  for (let y = Math.ceil(firstGridRow / gridStride) * gridStride; y <= lastGridRow; y += gridStride) {
    gridLines.push(
      <line
        key={`gy${y}`}
        className="as-lab-board__grid"
        x1={extent.x}
        y1={PAD + y * CELL}
        x2={extent.x + extent.width}
        y2={PAD + y * CELL}
      />,
    )
  }
  // The coordinate ruler is deliberately NOT part of the SVG. It used to pan
  // and pinch with the electrical drawing, leaving address numbers in the centre
  // of the learner's workspace. The HTML rulers rendered below are sticky at the
  // top/left edges; the SVG itself now contains only the working grid and circuit.

  const isPending = (t: Terminal) =>
    pendingTerminal?.componentId === t.componentId &&
    pendingTerminal?.index === t.index

  /** Terminal hardware sits with the device body, below conductors. */
  function renderTerminals(component: PlacedComponent) {
    const count = terminalCountForComponent(component)
    return Array.from({ length: count }, (_unused, index) => {
      const point = displayPoint(component, index)
      const terminal: Terminal = { componentId: component.id, index }
      const pending = isPending(terminal)
      const merged = isMergedTerminal(`${component.id}:${index}`)
      return (
        <circle
          key={`${component.id}-face-${index}`}
          className={`as-lab-board__terminal-face${projection === 'iec' ? ' as-lab-board__terminal-face--iec' : ''}`}
          data-pending={pending || undefined}
          data-merged={merged || undefined}
          data-terminal-face-key={`${component.id}:${index}`}
          cx={point.x}
          cy={point.y}
          r={projection === 'virtual' ? 6.5 : TERMINAL_R}
          aria-hidden="true"
        />
      )
    })
  }

  /** Labels and transparent hit targets are painted after every wire. */
  function renderTerminalOverlays(component: PlacedComponent) {
    const numbers = terminalNumbersFor(component)
    const labels = terminalLabelsFor(component, numbers)
    const roles = terminalRolesFor(component)
    const count = terminalCountForComponent(component)
    return Array.from({ length: count }, (_unused, index) => {
      const point = displayPoint(component, index)
      const terminal: Terminal = { componentId: component.id, index }
      const pending = isPending(terminal)
      const merged = isMergedTerminal(`${component.id}:${index}`)
      const role = roles[index]
      const number = numbers[index] ?? `${index + 1}`
      return (
        <g
          key={`${component.id}-t${index}`}
          className="as-lab-board__terminal-unit"
        >
          <circle
            className={`as-lab-board__terminal${projection === 'virtual' ? ' as-lab-board__terminal--physical-hit' : ''}`}
            data-pending={pending || undefined}
            data-merged={merged || undefined}
            cx={point.x}
            cy={point.y}
            r={projection === 'virtual' ? 12 : TERMINAL_R}
            role="button"
            tabIndex={0}
            aria-label={
              projection === 'virtual' ? labels[index] : `${labels[index]} — papan IEC`
            }
            data-terminal-key={`${component.id}:${index}`}
            data-terminal-designation={number}
            data-contact-function={role}
            data-net={netOfTerminal(terminal)}
            aria-pressed={pending}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onTerminalClick(terminal)}
            onKeyDown={activateOnKey(() => onTerminalClick(terminal))}
          />
          <text
            x={point.x}
            y={point.y + 3}
            textAnchor="middle"
            className="as-lab-board__terminal-number"
            data-pending={pending || undefined}
            data-merged={merged || undefined}
            data-long={number.length > 3 || undefined}
            data-functional={role || undefined}
            aria-hidden="true"
          >
            {role ? (
              <>
                <tspan
                  x={point.x}
                  y={point.y - 1.5}
                  className="as-lab-board__terminal-role"
                >
                  {role}
                </tspan>
                <tspan
                  x={point.x}
                  y={point.y + 5}
                  className="as-lab-board__terminal-designation"
                >
                  {number}
                </tspan>
              </>
            ) : (
              number
            )}
          </text>
        </g>
      )
    })
  }

  // IEC 60617 wiring-style body (read view). Same terminals/positions as the schematic
  // glyph — only the body drawing differs. Returns null for kinds not yet translated,
  // so those fall back to the schematic glyph (never blank). Static (learning view).
  // Label nomor terminal untuk mode wiring — digambar sebagai sibling (koordinat SVG
  // absolut di titik terminal), tidak mengganggu klik terminal maupun engine.
  function renderBreakerAnnotation(component: PlacedComponent) {
    const rect = breakerAnnotationRect(component)
    if (!rect) return null
    const spec = component.spec
    if (spec.kind !== 'BREAKER_1P' && spec.kind !== 'BREAKER_3P') return null
    const x = (rect.minX + rect.maxX) / 2
    const top = rect.minY
    const height = rect.maxY - rect.minY
    return (
      <g
        key={`${component.id}-breaker-annotation`}
        className="as-lab-board__breaker-annotation"
        data-breaker-annotation={component.id}
        pointerEvents="none"
      >
        <rect
          x={rect.minX}
          y={rect.minY}
          width={rect.maxX - rect.minX}
          height={height}
          rx={2}
        />
        <text x={x} y={top + 9} textAnchor="middle">
          {spec.kind === 'BREAKER_3P' ? 'QF · 3P' : 'QF · 1P'}
        </text>
        <text x={x} y={top + 18} textAnchor="middle" data-rating="">
          {component.source && spec.protectionDisabled ? 'Rating ?' : `${mcbRatedAmps(spec)} A`}
        </text>
      </g>
    )
  }

  function renderVirtual(component: PlacedComponent) {
    const spec = component.spec
    const centre = footprintCentre(component, projection)
    const viewport = virtualInstrumentBounds(component)
    const { width, height } = viewport
    const actuator = virtualActuatorRect(component)
    const actuatorCentre = actuator
      ? {
          x: actuator.x + actuator.width / 2,
          y: actuator.y + actuator.height / 2,
        }
      : centre
    const dragProps = {
      onPointerDown: (event: PointerEvent) => startDrag(event, component),
    }
    const toggle = () => {
      if (suppressClick.current === component.id) {
        suppressClick.current = null
        return
      }
      onToggleSwitch(component.id)
    }
    const toggleOnKey = activateOnKey(() => onToggleSwitch(component.id))

    let active = false
    let status: string | undefined
    let testId: string | undefined
    if (spec.kind === 'LOAD') {
      const src = Object.values(board.components).find((c) => c.spec.kind === 'SOURCE')
      // The supply that feeds this load's circuit, so a 24 V load is lit at 24 V (L3).
      const emf = state.solution.supplyVolts?.[component.id] ?? (src && src.spec.kind === 'SOURCE' ? src.spec.emfVolts : 220)
      const nominal =
        spec.resistanceOhms > 0 ? emf / spec.resistanceOhms : spec.ratedCurrentAmps
      active = (state.display.loadCurrent[component.id] ?? 0) / nominal > 0.05
      testId =
        (spec.symbol ?? 'lamp') === 'lamp'
          ? `lamp-${component.id}`
          : `load-${component.id}`
    } else if (spec.kind === 'INDICATOR') {
      active =
        (state.display.loadCurrent[component.id] ?? 0) > spec.ratedCurrentAmps * 0.05
      testId = `indicator-${component.id}`
    } else if (spec.kind === 'MOTOR') {
      status = (state.solution.motorStatus[component.id] ?? 'IDLE').toLowerCase()
      active = status === 'running'
      testId = `motor-${component.id}`
    } else if (spec.kind === 'MOTOR_3PH') {
      active =
        state.status === 'RUNNING' && Boolean(state.threePhase)
          ? isMotor3phRunning(state.threePhase!, component.id)
          : false
      status = active ? 'running' : 'idle'
      testId = `motor3ph-${component.id}`
    } else if (spec.kind === 'RELAY') {
      active = state.relayEnergized[component.id] ?? false
      testId = `relay-${component.id}`
    } else if (spec.kind === 'CONTACTOR') {
      active = state.contactorEnergized[component.id] ?? false
      testId = `contactor-${component.id}`
    } else if (spec.kind === 'TIMER') {
      const runtime = state.timerRuntime[component.id]
      active = runtime?.running ?? false
      status = active ? 'running' : 'idle'
      testId = `timer-${component.id}`
    } else if (spec.kind === 'OVERLOAD_RELAY') {
      const runtime = state.overloadRuntime[component.id]
      active = runtime?.tripped ?? false
      status = runtime?.tripped
        ? 'tripped'
        : (runtime?.thermalLevel ?? 0) > 0.05
          ? 'heating'
          : 'normal'
      testId = `overload-${component.id}`
    } else if (spec.kind === 'CONTACT_2STATE' && spec.drivenBy) {
      active = (spec.drivenBy.kind === 'relay' ? state.relayEnergized : state.contactorEnergized)[spec.drivenBy.id] ?? false
      testId = `driven-contact-${component.id}`
    } else if (spec.kind === 'SOURCE_3PH') {
      testId = `source3ph-${component.id}`
    } else if (spec.kind === 'SENSOR_3WIRE') {
      active = spec.actuated
      status = spec.actuated ? 'detected' : 'clear'
      testId = `sensor-${component.id}`
    } else if (
      spec.kind === 'CONTACT_2STATE' &&
      component.modelId === 'PHASE_MONITOR_RM17TG20'
    ) {
      active = automaticProductState[component.id] ?? false
      status = active ? 'healthy' : 'fault'
      testId = `phase-monitor-${component.id}`
    } else if (spec.kind === 'LIMIT_SWITCH') {
      active = component.modelId === 'ILLUMINATED_PB_XB5AW33B5'
        ? state.status === 'RUNNING' &&
          (state.display.loadCurrent[component.id] ?? 0) > 0.0005
        : spec.actuated
      status = component.modelId === 'PUSHBUTTON_STATION_XB5AL73415'
        ? spec.startPressed
          ? 'start-pressed'
          : spec.stopPressed
            ? 'stop-pressed'
            : 'released'
        : spec.actuated
          ? 'actuated'
          : 'normal'
      testId = `limit-switch-${component.id}`
    }

    const instrumentVisual = (
      <VirtualInstrument
        component={component}
        active={active}
        status={status}
        terminalPoint={(index) => displayPoint(component, index)}
      />
    )

    const common = {
      className: 'as-lab-board__virtual',
      'data-component-id': component.id,
      'data-kind': spec.kind,
      'data-active': active || undefined,
      'data-status': status,
      'data-draggable': draggable || undefined,
      'data-dragging': drag?.id === component.id || undefined,
      'data-testid': testId,
    }

    if (spec.kind === 'PUSHBUTTON') {
      const pressed = spec.pressed
      const releaseActuator = (event: PointerEvent) => {
        onPressButton(component.id, false)
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* jsdom / already released */
        }
      }
      return (
        <g
          key={component.id}
          {...common}
          className="as-lab-board__virtual as-lab-board__pushbutton"
          data-pressed={pressed || undefined}
          data-testid={undefined}
        >
          <g {...dragProps}>
            {instrumentVisual}
            <rect
              x={viewport.x}
              y={viewport.y}
              width={width}
              height={height}
              rx={5}
              fill="transparent"
              className="as-lab-board__button-hit"
              data-role="body"
            />
          </g>
          <circle
            cx={actuatorCentre.x}
            cy={actuatorCentre.y}
            r={
              actuator
                ? Math.max(8, Math.min(actuator.width, actuator.height) / 2)
                : 12
            }
            className="as-lab-board__virtual-actuator as-lab-board__button-cap"
            data-role="actuator"
            data-testid={`pushbutton-cap-${component.id}`}
            role="button"
            tabIndex={0}
            aria-label={`Tombol ${spec.normallyOpen ? 'START (NO)' : 'STOP (NC)'}${pressed ? ' ditekan' : ''}`}
            aria-pressed={pressed}
            onPointerDown={(event) => {
              event.stopPropagation()
              onPressButton(component.id, true)
              try {
                event.currentTarget.setPointerCapture(event.pointerId)
              } catch {
                /* jsdom / unsupported */
              }
            }}
            onPointerUp={releaseActuator}
            onPointerCancel={releaseActuator}
            onLostPointerCapture={releaseActuator}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onPressButton(component.id, true)
              }
            }}
            onKeyUp={() => onPressButton(component.id, false)}
          />
          {renderTerminals(component)}
        </g>
      )
    }

    if (
      spec.kind === 'LIMIT_SWITCH' &&
      (component.modelId === 'PUSHBUTTON_STATION_XB5AL73415' ||
        component.modelId === 'ILLUMINATED_PB_XB5AW33B5')
    ) {
      const hit = actuator ?? {
        x: centre.x - 22,
        y: centre.y - 26,
        width: 44,
        height: 52,
      }
      const station = component.modelId === 'PUSHBUTTON_STATION_XB5AL73415'
      const controls = station
        ? [
            {
              control: 'START' as const,
              label: 'START 13-14 (NO)',
              pressed: Boolean(spec.startPressed),
              y: hit.y,
              height: hit.height / 2,
            },
            {
              control: 'STOP' as const,
              label: 'STOP 21-22 (NC)',
              pressed: Boolean(spec.stopPressed),
              y: hit.y + hit.height / 2,
              height: hit.height / 2,
            },
          ]
        : [
            {
              control: 'ACTUATOR' as const,
              label: 'Pushbutton berlampu 1NO+1NC',
              pressed: spec.actuated,
              y: hit.y,
              height: hit.height,
            },
          ]
      const release = (
        event: PointerEvent<SVGRectElement>,
        control: 'START' | 'STOP' | 'ACTUATOR',
      ) => {
        onPressProductControl(component.id, control, false)
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* jsdom / already released */
        }
      }
      return (
        <g
          key={component.id}
          {...common}
          className="as-lab-board__virtual as-lab-board__product-pushbutton"
        >
          <g {...dragProps}>
            {instrumentVisual}
            <rect
              x={viewport.x}
              y={viewport.y}
              width={width}
              height={height}
              rx={5}
              fill="transparent"
              className="as-lab-board__button-hit"
              data-role="body"
            />
          </g>
          {controls.map((control) => (
            <rect
              key={control.control}
              x={hit.x}
              y={control.y}
              width={hit.width}
              height={control.height}
              rx={5}
              className="as-lab-board__virtual-actuator as-lab-board__product-control-hit"
              data-control={control.control.toLowerCase()}
              data-pressed={control.pressed || undefined}
              role="button"
              tabIndex={0}
              aria-label={`${control.label}${control.pressed ? ' ditekan' : ''}`}
              aria-pressed={control.pressed}
              onPointerDown={(event) => {
                event.stopPropagation()
                onPressProductControl(component.id, control.control, true)
                try {
                  event.currentTarget.setPointerCapture(event.pointerId)
                } catch {
                  /* jsdom / unsupported */
                }
              }}
              onPointerUp={(event) => release(event, control.control)}
              onPointerCancel={(event) => release(event, control.control)}
              onLostPointerCapture={(event) => release(event, control.control)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onPressProductControl(component.id, control.control, true)
                }
              }}
              onKeyUp={() => onPressProductControl(component.id, control.control, false)}
            />
          ))}
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'BREAKER_1P' || spec.kind === 'BREAKER_3P') {
      const tripped = state.mcbRuntime[component.id]?.tripped ?? false
      const on = spec.on
      const rating = mcbRatedAmps(spec)
      const pole = spec.kind === 'BREAKER_3P' ? '3P' : '1P'
      const handle = actuator ?? {
        x: centre.x - 14,
        y: centre.y - 18,
        width: 28,
        height: 36,
      }
      const breakerPosition = tripped ? 'tripped' : on ? 'on' : 'off'
      return (
        <g
          key={component.id}
          {...common}
          className="as-lab-board__virtual as-lab-board__breaker"
          data-on={on || undefined}
          data-tripped={tripped || undefined}
          data-selected={selectedId === component.id || undefined}
          data-testid={`breaker-${component.id}`}
          {...dragProps}
        >
          <g
            role="button"
            tabIndex={0}
            aria-label={`MCB ${spec.kind === 'BREAKER_3P' ? '3-fasa' : '1-fasa'} ${rating} A${tripped ? ' (TRIP)' : ''}. Klik untuk memilih.`}
            onClick={() => onSelectComponent?.(component.id)}
            onKeyDown={activateOnKey(() => onSelectComponent?.(component.id))}
          >
            {instrumentVisual}
          </g>
          <text
            x={centre.x}
            y={centre.y - 17}
            textAnchor="middle"
            className="as-lab-board__glyph-sub as-lab-board__virtual-plate"
          >
            {tripped ? `MCB · TRIP` : `MCB · ${pole}`}
          </text>
          <text
            x={centre.x}
            y={centre.y + 23}
            textAnchor="middle"
            className="as-lab-board__glyph-value as-lab-board__virtual-plate"
          >
            {rating} A
          </text>
          <g
            className="as-lab-board__virtual-breaker-mechanism"
            data-breaker-position={breakerPosition}
            pointerEvents="none"
          >
            <rect
              x={handle.x + handle.width * 0.08}
              y={handle.y + handle.height * 0.06}
              width={handle.width * 0.84}
              height={handle.height * 0.88}
              rx={Math.max(2, handle.width * 0.08)}
              className="as-lab-board__virtual-breaker-track"
            />
            <rect
              x={handle.x + handle.width * 0.17}
              y={handle.y + handle.height * 0.32}
              width={handle.width * 0.66}
              height={handle.height * 0.36}
              rx={Math.max(2, handle.width * 0.07)}
              className="as-lab-board__virtual-breaker-lever"
            />
            <text
              x={handle.x + handle.width / 2}
              y={handle.y + handle.height * 0.15}
              textAnchor="middle"
              className="as-lab-board__virtual-breaker-state-text"
            >
              I
            </text>
            <text
              x={handle.x + handle.width / 2}
              y={handle.y + handle.height * 0.94}
              textAnchor="middle"
              className="as-lab-board__virtual-breaker-state-text"
            >
              O
            </text>
          </g>
          <rect
            x={handle.x}
            y={handle.y}
            width={handle.width}
            height={handle.height}
            rx={5}
            className="as-lab-board__virtual-breaker-handle"
            data-breaker-position={breakerPosition}
            role="button"
            tabIndex={0}
            aria-label={`Sakelar MCB ${spec.kind === 'BREAKER_3P' ? '3-fasa' : '1-fasa'} ${on ? 'ON (tertutup)' : 'OFF (terbuka)'}. Klik untuk mengubah.`}
            aria-pressed={on}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              toggle()
            }}
            onKeyDown={toggleOnKey}
          />
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'TIMER') {
      const runtime = state.timerRuntime[component.id]
      const multifunction = spec.model === 'OMRON_H3CR_A8'
      const phase = runtime?.running
        ? multifunction
          ? multifunctionTimerOutputOn(runtime.elapsedMs, spec) ? 'OUTPUT_ON' : 'OUTPUT_OFF'
          : timerPhase(runtime.elapsedMs, spec)
        : 'IDLE'
      const totalMs = Math.max(100, multifunction ? spec.starDurationMs : spec.starDurationMs + spec.transitionDelayMs)
      const displayElapsed = multifunction && (spec.mode === 'B' || spec.mode === 'B2')
        ? (runtime?.elapsedMs ?? 0) % totalMs
        : runtime?.elapsedMs ?? 0
      const progress = runtime?.running
        ? Math.min(1, Math.max(0, displayElapsed / totalMs))
        : 0
      const dial = actuator ?? {
        x: centre.x - 22,
        y: centre.y - 22,
        width: 44,
        height: 44,
      }
      const dialCx = dial.x + dial.width / 2
      const dialCy = dial.y + dial.height / 2
      const dialR = Math.min(dial.width, dial.height) * 0.42
      const handAngle = -145 + progress * 290
      return (
        <g
          key={component.id}
          {...common}
          className="as-lab-board__virtual as-lab-board__timer"
          data-selected={selectedId === component.id || undefined}
          data-timer-phase={phase}
          data-timer-setting={formatTimerDuration(spec.starDurationMs)}
          {...dragProps}
        >
          <g
            role="button"
            tabIndex={0}
            aria-label={multifunction
              ? `Timer H3CR-A8 ${component.id}, mode ${spec.mode ?? 'A'}, set ${formatTimerDuration(spec.starDurationMs)}. Klik untuk mengatur.`
              : `Timer ${component.id}, STAR ${formatTimerDuration(spec.starDurationMs)}, jeda ${formatTimerDuration(spec.transitionDelayMs)}. Klik untuk mengatur.`}
            onClick={() => onSelectComponent?.(component.id)}
            onKeyDown={activateOnKey(() => onSelectComponent?.(component.id))}
          >
            {instrumentVisual}
            <circle
              cx={dialCx}
              cy={dialCy}
              r={dialR}
              className="as-lab-board__virtual-timer-dial"
            />
            <line
              x1={dialCx}
              y1={dialCy}
              x2={dialCx}
              y2={dialCy - dialR * 0.7}
              transform={`rotate(${handAngle} ${dialCx} ${dialCy})`}
              className="as-lab-board__virtual-timer-hand"
            />
            <text
              x={dialCx}
              y={dialCy + dialR * 0.38}
              textAnchor="middle"
              className="as-lab-board__virtual-timer-value"
            >
              {formatTimerDuration(spec.starDurationMs)}
            </text>
            <rect
              x={viewport.x}
              y={viewport.y}
              width={width}
              height={height}
              fill="transparent"
            />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (
      spec.kind === 'CONTACT_2STATE' &&
      component.modelId === 'PHASE_MONITOR_RM17TG20'
    ) {
      return (
        <g key={component.id} {...common} {...dragProps}>
          {instrumentVisual}
          <rect
            x={viewport.x}
            y={viewport.y}
            width={width}
            height={height}
            fill="transparent"
            aria-label={`RM17TG20 memantau L1/L2/L3 otomatis: ${active ? 'urutan sehat' : 'fault atau fasa hilang'}`}
          />
          {renderTerminals(component)}
        </g>
      )
    }

    if (
      spec.kind === 'SWITCH' ||
      spec.kind === 'SWITCH_2WAY' ||
      spec.kind === 'SWITCH_CROSS' ||
      spec.kind === 'CONTACT_2STATE' ||
      spec.kind === 'LIMIT_SWITCH' ||
      spec.kind === 'SENSOR_3WIRE' ||
      spec.kind === 'SELECTOR_3POS' ||
      spec.kind === 'FUSE' ||
      spec.kind === 'ESTOP' ||
      (spec.kind === 'TERMINAL_BLOCK' &&
        (spec.model === 'PHOENIX_UT4_HESI' || spec.model === 'PHOENIX_UT4_MT'))
    ) {
      const pressed =
        spec.kind === 'SWITCH'
          ? spec.closed
          : spec.kind === 'SWITCH_2WAY'
            ? spec.toL2
            : spec.kind === 'SWITCH_CROSS'
              ? spec.crossed
              : spec.kind === 'CONTACT_2STATE'
                ? spec.drivenBy ? active : spec.actuated
                : spec.kind === 'LIMIT_SWITCH' || spec.kind === 'SENSOR_3WIRE'
                  ? spec.actuated
                : spec.kind === 'SELECTOR_3POS'
                  ? spec.pos !== 1
                  : spec.kind === 'FUSE'
                    ? spec.blown
                    : spec.kind === 'TERMINAL_BLOCK'
                      ? !!spec.open
                      : spec.pressed
      const actionLabel =
        spec.kind === 'SWITCH'
          ? `Saklar ${spec.closed ? 'tertutup' : 'terbuka'}. Klik untuk mengubah.`
          : spec.kind === 'SWITCH_2WAY'
            ? `Saklar tukar, arah ${spec.toL2 ? 'L2' : 'L1'}. Klik untuk mengubah.`
            : spec.kind === 'SWITCH_CROSS'
              ? `Saklar silang, ${spec.crossed ? 'silang' : 'lurus'}. Klik untuk mengubah.`
              : spec.kind === 'CONTACT_2STATE'
                ? component.modelId === 'AUX_CONTACT_LADN22'
                  ? `LADN22 2NO+2NC, ${spec.actuated ? 'actuated: 53-54 dan 83-84 menutup' : 'normal: 61-62 dan 71-72 menutup'}. Klik untuk mengubah state mekanis.`
                  : component.modelId === 'PHASE_MONITOR_RM17TG20'
                    ? `RM17TG20, ${spec.actuated ? 'kondisi sehat: 11-14 dan 21-24 menutup' : 'fault: 11-12 dan 21-22 menutup'}. Klik untuk mengubah kondisi uji.`
                    : `Kontak, ${spec.actuated ? 'aktif (COM-NO)' : 'normal (COM-NC)'}. Klik untuk mengubah.`
                : spec.kind === 'LIMIT_SWITCH'
                  ? component.modelId === 'PUSHBUTTON_STATION_XB5AL73415'
                    ? `Station START/STOP, ${spec.actuated ? 'START 13-14 menutup' : 'STOP NC 21-22 menutup'}. Klik untuk mengubah state latihan.`
                    : component.modelId === 'ILLUMINATED_PB_XB5AW33B5'
                      ? `Pushbutton berlampu, ${spec.actuated ? 'ditekan: NO 13-14 menutup' : 'dilepas: NC 21-22 menutup'}. Klik untuk mengubah.`
                      : `Limit switch D4N, ${spec.actuated ? 'tertekan: 33-34 menutup' : 'normal: 11-12 menutup'}. Klik untuk mengubah.`
                  : spec.kind === 'SENSOR_3WIRE'
                    ? `Sensor ${spec.technology} ${spec.output} ${spec.normallyOpen ? 'NO' : 'NC'}, ${spec.actuated ? 'target terdeteksi' : 'target tidak terdeteksi'}. Klik untuk mengubah target.`
                : spec.kind === 'SELECTOR_3POS'
                  ? `Selektor posisi ${spec.pos === 0 ? 'kiri' : spec.pos === 2 ? 'kanan' : 'tengah (OFF)'}. Klik untuk memutar.`
                  : spec.kind === 'FUSE'
                    ? `Sekring, ${spec.blown ? 'putus' : 'normal'}. Klik untuk mengubah.`
                    : spec.kind === 'TERMINAL_BLOCK'
                      ? `${spec.model === 'PHOENIX_UT4_HESI' ? 'Fuse carrier' : 'Knife disconnect'}, ${spec.open ? 'OPEN' : 'CLOSED'}. Klik untuk mengubah.`
                      : `Emergency stop, ${spec.pressed ? 'ditekan (terkunci terbuka)' : 'normal (tertutup)'}. Klik untuk ${spec.pressed ? 'reset' : 'menekan'}.`
      return (
        <g key={component.id} {...common} {...dragProps}>
          <g
            role="button"
            tabIndex={0}
            aria-label={actionLabel}
            aria-pressed={pressed}
            onClick={toggle}
            onKeyDown={toggleOnKey}
          >
            {instrumentVisual}
            <rect
              x={viewport.x}
              y={viewport.y}
              width={width}
              height={height}
              fill="transparent"
            />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    return (
      <g key={component.id} {...common} {...dragProps}>
        {instrumentVisual}
        {renderTerminals(component)}
      </g>
    )
  }

  function renderIec(component: PlacedComponent) {
    const spec = component.spec
    const layout = iecLayoutFor(component)
    const c = layout.centre
    const body = layout.body
    const bodyWidth = body.maxX - body.minX
    const bodyHeight = body.maxY - body.minY
    const terminalAt = (index: number) =>
      layout.terminals[index]?.point ?? layout.centre
    // Contacts connect to their actual electrical ports. Mechanical linkage is
    // dashed and cannot be mistaken for a conducting wire.
    const contactPair = (a: number, b: number, closed: boolean, name: string, xOverride?: number) => {
      const p = terminalAt(a), q = terminalAt(b)
      const vertical = Math.abs(q.y - p.y) > Math.abs(q.x - p.x)
      const x = xOverride ?? (p.x + q.x) / 2, y = (p.y + q.y) / 2
      const start = vertical ? { x, y: y - 9 } : { x: x - 14, y }
      const end = vertical ? { x, y: y + 9 } : { x: x + 14, y }
      return <g data-iec-contact={name} data-contact-state={closed ? 'closed' : 'open'}>
        <path d={vertical
          ? `M ${p.x} ${p.y} H ${x} V ${start.y} M ${end.x} ${end.y} V ${q.y} H ${q.x}`
          : `M ${p.x} ${p.y} H ${start.x} V ${y} M ${end.x} ${y} H ${q.x} V ${q.y}`}
          className="as-lab-board__lever" fill="none" />
        <circle cx={start.x} cy={start.y} r={2} className="as-lab-board__pivot" />
        <circle cx={end.x} cy={end.y} r={2} className="as-lab-board__pivot" />
        <line x1={start.x} y1={start.y} x2={closed ? end.x : end.x + (vertical ? 10 : 0)}
          y2={closed ? end.y : end.y - (vertical ? 5 : 10)} className="as-lab-board__lever" />
      </g>
    }
    const twoPortLeads = (left: number, right = left) => <g data-iec-leads="">
      <path d={`M ${terminalAt(0).x} ${terminalAt(0).y} H ${c.x - left} V ${c.y} M ${c.x + right} ${c.y} H ${terminalAt(1).x} V ${terminalAt(1).y}`}
        className="as-lab-board__lever" fill="none" />
    </g>
    const dp = { onPointerDown: (event: PointerEvent) => startDrag(event, component) }
    const toggle = () => {
      if (suppressClick.current === component.id) { suppressClick.current = null; return }
      onToggleSwitch(component.id)
    }
    const layoutData = {
      'data-component-id': component.id,
      'data-dragging': drag?.id === component.id || undefined,
      'data-iec': '',
      'data-body-width': Math.round(bodyWidth),
      'data-body-height': Math.round(bodyHeight),
      'data-terminal-pitch': Math.round(layout.terminalPitch),
    }
    const staticWrap = (inner: React.ReactNode) => (
      <g key={component.id} data-draggable={draggable || undefined} {...layoutData} {...dp}>
        {inner}
        {renderTerminals(component)}
      </g>
    )
    const selectWrap = (inner: React.ReactNode, label: string) => (
      <g
        key={component.id}
        data-draggable={draggable || undefined}
        data-selected={selectedId === component.id || undefined}
        {...layoutData}
        {...dp}
      >
        <g
          role="button"
          tabIndex={0}
          aria-label={label}
          onClick={() => onSelectComponent?.(component.id)}
          onKeyDown={activateOnKey(() => onSelectComponent?.(component.id))}
        >
          <rect x={body.minX} y={body.minY} width={bodyWidth} height={bodyHeight} rx={3} className="as-lab-board__switch-hit" />
          {inner}
        </g>
        {renderTerminals(component)}
      </g>
    )
    const clickWrap = (inner: React.ReactNode, label: string, pressed?: boolean) => (
      <g key={component.id} data-draggable={draggable || undefined} {...layoutData} {...dp}>
        <g role="button" tabIndex={0} aria-label={label} aria-pressed={pressed}
           onClick={toggle} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
          <rect x={body.minX} y={body.minY} width={bodyWidth} height={bodyHeight} rx={3} className="as-lab-board__switch-hit" />
          {inner}
        </g>
        {renderTerminals(component)}
      </g>
    )

    // ---- interactive, state-aware contacts (click = toggle) ----
    if (spec.kind === 'SWITCH') {
      return clickWrap(contactPair(0, 1, spec.closed, 'switch'),
        `Saklar ${spec.closed ? 'tertutup' : 'terbuka'}. Klik untuk mengubah.`, spec.closed)
    }
    if (spec.kind === 'FUSE') {
      const blown = spec.blown
      return clickWrap(
        <>
          {twoPortLeads(18)}
          <rect x={c.x - 18} y={c.y - 7} width={36} height={14} rx={2} className="as-lab-board__body" />
          {blown
            ? (<><line x1={c.x - 14} y1={c.y} x2={c.x - 4} y2={c.y} className="as-lab-board__lever" /><line x1={c.x + 4} y1={c.y} x2={c.x + 14} y2={c.y} className="as-lab-board__lever" /></>)
            : (<line x1={c.x - 14} y1={c.y} x2={c.x + 14} y2={c.y} className="as-lab-board__lever" />)}
        </>, `Sekring ${blown ? 'putus' : 'normal'}. Klik untuk mengubah.`, blown)
    }
    if (spec.kind === 'SWITCH_2WAY' || spec.kind === 'CONTACT_2STATE' || spec.kind === 'SELECTOR_3POS') {
      const conducting = bridgedPairs(component, state.relayEnergized, state.contactorEnergized,
        { productActuated: automaticProductState })
      const closed = (a: number, b: number) => conducting.some(([x, y]) => x === a && y === b)
      const paired = component.modelId === 'AUX_CONTACT_LADN22' ? [[0,1],[2,3],[4,5],[6,7]]
        : component.modelId === 'FLOAT_SWITCH_9037HG33' || component.modelId === 'PRESSURE_SWITCH_XMLB004' ? [[0,1],[2,3]]
        : component.modelId === 'THERMOSTAT_NSYCCOTHC' ? [[0,1]] : null
      if (paired) return clickWrap(<g data-iec-product={component.modelId}>
        {paired.map(([a,b]) => <g key={a}>{contactPair(a,b,closed(a,b),`${a}-${b}`)}</g>)}
        {paired.length > 1 && <line x1={terminalAt(0).x} y1={c.y} x2={terminalAt(paired[paired.length-1][0]).x} y2={c.y}
          className="as-lab-board__lever" strokeDasharray="3 3" />}
      </g>, `Kontak ${component.id}. Klik untuk mengubah.`)
      const phaseMonitor = component.modelId === 'PHASE_MONITOR_RM17TG20'
      const groups = phaseMonitor ? [[3,4,5],[6,7,8]] : [[0,1,2]]
      return clickWrap(<g data-iec-product={component.modelId}>
        {phaseMonitor && <>
          <rect x={body.minX} y={c.y-10} width={bodyWidth} height={20} className="as-lab-board__body" />
          <text x={c.x} y={c.y+4} textAnchor="middle" className="as-lab-board__glyph-sub">3~</text>
        </>}
        {groups.map(([com,nc,no],index) => {
          const p=terminalAt(com),n=terminalAt(nc),o=terminalAt(no)
          const fromTop=layout.terminals[com]?.side==='top'
          const row=phaseMonitor ? (fromTop ? body.minY+20 : body.maxY-20) : c.y
          const pivot={x:phaseMonitor?p.x:c.x-14,y:row}
          const ncPoint={x:phaseMonitor?n.x:c.x+14,y:phaseMonitor?row+(fromTop?-12:12):c.y-12}
          const noPoint={x:phaseMonitor?o.x:c.x+14,y:ncPoint.y+(phaseMonitor?0:24)}
          const selected=closed(com,no)?noPoint:closed(com,nc)?ncPoint:{x:c.x+10,y:c.y}
          return <g key={index} data-iec-changeover={index} data-selected-throw={closed(com,no)?'no':closed(com,nc)?'nc':'off'}>
            {[[p,pivot],[n,ncPoint],[o,noPoint]].map(([start,end],i)=><path key={i} d={`M ${start.x} ${start.y} L ${end.x} ${end.y}`} className="as-lab-board__lever" />)}
            <circle cx={ncPoint.x} cy={ncPoint.y} r={2} className="as-lab-board__pivot" />
            <circle cx={noPoint.x} cy={noPoint.y} r={2} className="as-lab-board__pivot" />
            <line x1={pivot.x} y1={pivot.y} x2={selected.x} y2={selected.y} className="as-lab-board__lever" />
          </g>
        })}
      </g>, spec.kind==='SELECTOR_3POS' ? 'Selektor 3 posisi. Klik untuk memutar.' : `Kontak dua arah ${component.id}. Klik untuk mengubah.`)
    }
    if (spec.kind === 'LIMIT_SWITCH') {
      const releaseProductControl = (
        event: PointerEvent<SVGRectElement>,
        control: 'START' | 'STOP' | 'ACTUATOR',
      ) => {
        onPressProductControl(component.id, control, false)
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* jsdom / already released */
        }
      }
      const actuated = spec.actuated
      const pair = (x: number, y: number, closed: boolean, label: string) => {
        const a = x < c.x ? 0 : 2
        return <g>{contactPair(a,a+1,closed,label)}
          <text x={x} y={y+27} textAnchor="middle" className="as-lab-board__glyph-sub">{label}</text>
        </g>
      }
      if (component.modelId === 'PUSHBUTTON_STATION_XB5AL73415') {
        const controls = [
          {
            control: 'STOP' as const,
            label: '21–22 STOP NC',
            pressed: Boolean(spec.stopPressed),
            x: c.x - 30,
          },
          {
            control: 'START' as const,
            label: '13–14 START NO',
            pressed: Boolean(spec.startPressed),
            x: c.x + 30,
          },
        ]
        return (
          <g key={component.id} className="as-lab-board__switch" {...layoutData} data-draggable={draggable || undefined} {...dp}>
            {pair(c.x - 30, c.y, !spec.stopPressed, '21–22 STOP')}
            {pair(c.x + 30, c.y, Boolean(spec.startPressed), '13–14 START')}
            <line x1={c.x - 30} y1={c.y - 26} x2={c.x - 30} y2={c.y - 10} className="as-lab-board__lever" strokeDasharray="3 3" />
            <line x1={c.x + 30} y1={c.y - 26} x2={c.x + 30} y2={c.y - 10} className="as-lab-board__lever" strokeDasharray="3 3" />
            {controls.map((control) => (
              <rect
                key={control.control}
                x={control.x - 26}
                y={c.y - 32}
                width={52}
                height={60}
                fill="transparent"
                role="button"
                tabIndex={0}
                data-control={control.control.toLowerCase()}
                aria-label={control.label}
                aria-pressed={control.pressed}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onPressProductControl(component.id, control.control, true)
                  try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* unsupported */ }
                }}
                onPointerUp={(event) => releaseProductControl(event, control.control)}
                onPointerCancel={(event) => releaseProductControl(event, control.control)}
                onLostPointerCapture={(event) => releaseProductControl(event, control.control)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onPressProductControl(component.id, control.control, true)
                  }
                }}
                onKeyUp={() => onPressProductControl(component.id, control.control, false)}
              />
            ))}
            {renderTerminals(component)}
          </g>
        )
      }
      if (component.modelId === 'ILLUMINATED_PB_XB5AW33B5') {
        const lampOn = state.status === 'RUNNING' &&
          (state.display.loadCurrent[component.id] ?? 0) > 0.0005
        return (
          <g key={component.id} className="as-lab-board__switch" {...layoutData} data-draggable={draggable || undefined} data-active={lampOn || undefined} {...dp}>
            {pair(c.x - 29, c.y - 2, !actuated, '21–22 NC')}
            {pair(c.x + 29, c.y - 2, actuated, '13–14 NO')}
            <circle cx={c.x} cy={c.y + 29} r={8} className="as-lab-board__body" data-pilot-light="" />
            <line x1={c.x - 5.5} y1={c.y + 23.5} x2={c.x + 5.5} y2={c.y + 34.5} className="as-lab-board__lever" />
            <line x1={c.x + 5.5} y1={c.y + 23.5} x2={c.x - 5.5} y2={c.y + 34.5} className="as-lab-board__lever" />
            <text x={c.x} y={c.y + 45} textAnchor="middle" className="as-lab-board__glyph-sub">X1–X2 LED 24 V</text>
            <rect
              x={c.x - 56}
              y={c.y - 35}
              width={112}
              height={54}
              fill="transparent"
              role="button"
              tabIndex={0}
              aria-label="Pushbutton berlampu 1NO+1NC"
              aria-pressed={actuated}
              onPointerDown={(event) => {
                event.stopPropagation()
                onPressProductControl(component.id, 'ACTUATOR', true)
                try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* unsupported */ }
              }}
              onPointerUp={(event) => releaseProductControl(event, 'ACTUATOR')}
              onPointerCancel={(event) => releaseProductControl(event, 'ACTUATOR')}
              onLostPointerCapture={(event) => releaseProductControl(event, 'ACTUATOR')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onPressProductControl(component.id, 'ACTUATOR', true)
                }
              }}
              onKeyUp={() => onPressProductControl(component.id, 'ACTUATOR', false)}
            />
            {renderTerminals(component)}
          </g>
        )
      }
      return clickWrap(
        <>
          {pair(c.x - 28, c.y, !actuated, '11–12 NC')}
          {pair(c.x + 28, c.y, actuated, '33–34 NO')}
          <line x1={c.x} y1={c.y - 24} x2={c.x} y2={c.y - 8} className="as-lab-board__lever" strokeDasharray="3 3" />
        </>,
        `Limit switch ${actuated ? 'tertekan' : 'normal'}.`,
        actuated,
      )
    }
    if (spec.kind === 'SENSOR_3WIRE') {
      const detected = spec.actuated
      const abbreviation =
        spec.technology === 'inductive' ? 'IND' : spec.technology === 'capacitive' ? 'CAP' : 'PHOTO'
      const conducting = spec.normallyOpen ? detected : !detected
      return clickWrap(
        <>
          <rect x={c.x - 31} y={c.y - 22} width={62} height={44} rx={3} className="as-lab-board__body" />
          <text x={c.x} y={c.y - 5} textAnchor="middle" className="as-lab-board__glyph-sub">{abbreviation}</text>
          <text x={c.x} y={c.y + 9} textAnchor="middle" className="as-lab-board__glyph-value">{spec.output} {spec.normallyOpen ? 'NO' : 'NC'}</text>
          <path d={`M ${c.x - 43} ${c.y - 14} q -10 14 0 28 M ${c.x - 49} ${c.y - 20} q -18 20 0 40`} className="as-lab-board__lever" fill="none" />
          <circle cx={c.x + 22} cy={c.y - 14} r={3.5} fill={conducting ? 'var(--as-accent)' : 'none'} className="as-lab-board__pivot" />
        </>,
        `Sensor ${abbreviation} ${spec.output} ${detected ? 'mendeteksi target' : 'tanpa target'}.`,
        detected,
      )
    }
    if (spec.kind === 'SWITCH_CROSS') {
      const crossed = spec.crossed
      return clickWrap(
        <>
          <rect x={c.x - 12} y={c.y - 12} width={24} height={24} rx={2} className="as-lab-board__body" />
          <line x1={c.x - 16} y1={c.y - 10} x2={c.x + 16} y2={crossed ? c.y + 10 : c.y - 10} className="as-lab-board__lever" />
          <line x1={c.x - 16} y1={c.y + 10} x2={c.x + 16} y2={crossed ? c.y - 10 : c.y + 10} className="as-lab-board__lever" />
        </>, 'Saklar silang. Klik untuk mengubah.')
    }
    if (spec.kind === 'ESTOP') {
      const pressed = spec.pressed
      return clickWrap(<g data-iec-actuator="emergency-stop">
        {contactPair(0, 1, !pressed, 'emergency-stop-nc')}
        <path d={`M ${c.x - 12} ${c.y - 22} Q ${c.x} ${c.y - 37} ${c.x + 12} ${c.y - 22} Z`} className="as-lab-board__body" />
        <path d={`M ${c.x} ${c.y - 22} V ${c.y - 4}`} strokeDasharray="3 3" className="as-lab-board__lever" />
        <text x={c.x + 20} y={c.y - 20} className="as-lab-board__glyph-sub">NC</text>
      </g>, `Emergency stop ${pressed ? 'ditekan (terkunci)' : 'normal'}. Klik untuk ${pressed ? 'reset' : 'menekan'}.`, pressed)
    }
    if (spec.kind === 'BREAKER_1P' || spec.kind === 'BREAKER_3P') {
      const tripped = state.mcbRuntime[component.id]?.tripped ?? false
      const closed = spec.on && !tripped
      const poles = spec.kind === 'BREAKER_3P' ? [0, 2, 4] : [0]
      return clickWrap(
        <>
          {poles.map((inputIndex) => {
            const input = terminalAt(inputIndex)
            const output = terminalAt(inputIndex + 1)
            const x = (input.x + output.x) / 2
            const top = c.y - 13
            const bottom = c.y + 13
            const contactState = closed ? 'closed' : tripped ? 'tripped' : 'open'
            return (
              <g
                key={inputIndex}
                data-breaker-pole={inputIndex / 2 + 1}
                data-contact-state={contactState}
              >
                <line x1={x} y1={input.y} x2={x} y2={top} className="as-lab-board__lever" />
                <circle cx={x} cy={top} r={2.1} className="as-lab-board__pivot" />
                <circle cx={x} cy={bottom} r={2.1} className="as-lab-board__pivot" />
                <line
                  x1={x}
                  y1={bottom}
                  x2={closed ? x : x + 13}
                  y2={closed ? top : top + 7}
                  className="as-lab-board__lever"
                  data-iec-breaker-contact={`${component.id}:${inputIndex / 2 + 1}`}
                  data-contact-state={contactState}
                />
                <line x1={x} y1={bottom} x2={x} y2={output.y} className="as-lab-board__lever" />
              </g>
            )
          })}
          <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={10} className="as-lab-board__glyph-value as-lab-board__breaker-inline-label">
            {tripped ? 'TRIP' : spec.kind === 'BREAKER_3P' ? 'QF · 3P' : 'QF'}
          </text>
        </>, `MCB ${closed ? 'ON' : tripped ? 'TRIP' : 'OFF'}. Klik untuk mengubah.`, spec.on)
    }

    // ---- pushbutton (momentary press) ----
    if (spec.kind === 'PUSHBUTTON') {
      const pressed = spec.pressed
      const conducting = spec.normallyOpen ? pressed : !pressed
      return (
        <g key={component.id} data-draggable={draggable || undefined} {...layoutData} {...dp}>
          <g role="button" tabIndex={0}
             aria-label={`Aktuator momentary IEC ${component.id}, ${pressed ? 'ditekan' : 'lepas'}`}
             onPointerDown={(event) => { event.stopPropagation(); onPressButton(component.id, true) }}
             onPointerUp={() => onPressButton(component.id, false)}
             onPointerLeave={() => onPressButton(component.id, false)}
             onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') onPressButton(component.id, true) }}
             onKeyUp={() => onPressButton(component.id, false)}>
            <rect x={c.x - 20} y={c.y - 22} width={40} height={44} rx={3} className="as-lab-board__button-hit" />
            <rect x={c.x - 5} y={c.y - 20} width={10} height={5} className="as-lab-board__button-cap" data-pressed={pressed || undefined} />
            <line x1={c.x} y1={c.y - 15} x2={c.x} y2={c.y - 8} className="as-lab-board__lever" />
            {contactPair(0, 1, conducting, spec.normallyOpen ? 'pushbutton-no' : 'pushbutton-nc')}
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    // ---- static bodies (energized state is solver-driven, not user-clicked) ----
    if ((spec.kind === 'SOURCE' && spec.transformer) || (spec.kind === 'LOAD' && spec.threePhase)) {
      return staticWrap(<g>
        <rect x={c.x - 25} y={c.y - 28} width={50} height={56} rx={3} className="as-lab-board__body" />
        {spec.kind === 'SOURCE' ? <>
          <path d={`M ${c.x - 12} ${c.y - 20} q 14 4 0 8 q 14 4 0 8 q 14 4 0 8 q 14 4 0 8 M ${c.x + 12} ${c.y - 20} q -14 4 0 8 q -14 4 0 8 q -14 4 0 8 q -14 4 0 8 M ${c.x - 2} ${c.y - 22} v 44 M ${c.x + 2} ${c.y - 22} v 44`} fill="none" className="as-lab-board__lever" />
          <title>Trafo ideal 415 / 110–220 V; primer dan sekunder terisolasi</title>
        </> : <>
          <path d={`M ${c.x} ${c.y - 18} l -19 33 h 38 Z`} fill="none" className="as-lab-board__lever" />
          <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={11} fill="currentColor">3~</text>
          <title>Heater tiga fasa ekuivalen {spec.threePhase?.powerWatts} W</title>
        </>}
      </g>)
    }
    if (spec.kind === 'LOAD' && spec.symbol && spec.symbol !== 'lamp') {
      const s = spec.symbol
      return staticWrap(
        <g>
          {twoPortLeads(s === 'solenoid_valve' ? 28 : s === 'bell' ? 16 : 20, s === 'solenoid_valve' ? 6 : s === 'bell' ? 16 : 20)}
          {s === 'solenoid_valve'
            ? (<><rect x={c.x - 28} y={c.y - 16} width={34} height={32} className="as-lab-board__body" /><path d={`M ${c.x - 23} ${c.y + 10} l 22 -20 M ${c.x + 10} ${c.y} h 28 M ${c.x + 23} ${c.y - 12} v 24`} className="as-lab-board__lever" fill="none" /></>)
            : s === 'bell'
            ? (<path d={`M ${c.x - 16} ${c.y + 6} A 16 16 0 0 1 ${c.x + 16} ${c.y + 6} Z`} className="as-lab-board__body" />)
            : (<rect x={c.x - 20} y={c.y - 10} width={40} height={20} rx={2} className="as-lab-board__body" />)}
          {s === 'heater' && (<path d={`M ${c.x - 12} ${c.y + 4} q 4 -9 8 0 t 8 0`} className="as-lab-board__lever" fill="none" />)}
        </g>
      )
    }
    if (spec.kind === 'SOURCE' || spec.kind === 'INDICATOR' || spec.kind === 'LOAD' || spec.kind === 'MOTOR' || spec.kind === 'MOTOR_3PH') {
      const label = spec.kind === 'MOTOR' || spec.kind === 'MOTOR_3PH' ? 'M' : ''
      const lamp = spec.kind === 'LOAD' || spec.kind === 'INDICATOR'
      const radius = Math.max(15, Math.min(28, bodyWidth / 2 - 3, bodyHeight / 2 - 3))
      return staticWrap(
        <g>
          {spec.kind !== 'MOTOR_3PH' && twoPortLeads(spec.kind === 'SOURCE' && (spec.sourceType === 'battery_dc' || spec.sourceType === 'din_psu_24vdc') ? 7 : radius)}
          {spec.kind === 'SOURCE' && (spec.sourceType === 'battery_dc' || spec.sourceType === 'din_psu_24vdc') ? (
            <>
              <line x1={c.x - 7} y1={c.y - 18} x2={c.x - 7} y2={c.y + 18} className="as-lab-board__lever" />
              <line x1={c.x + 7} y1={c.y - 10} x2={c.x + 7} y2={c.y + 10} className="as-lab-board__lever" />
              <text x={c.x - 16} y={c.y - 17} className="as-lab-board__glyph-sub">+</text>
              <text x={c.x + 14} y={c.y - 13} className="as-lab-board__glyph-sub">−</text>
            </>
          ) : spec.kind === 'SOURCE' && spec.sourceType === 'control_transformer_24vac' ? (
            <>
              <path d={`M ${c.x - 18} ${c.y - 18} q -10 6 0 12 t 0 12 t 0 12 M ${c.x + 18} ${c.y - 18} q 10 6 0 12 t 0 12 t 0 12`} className="as-lab-board__lever" fill="none" />
              <line x1={c.x - 4} y1={c.y - 22} x2={c.x - 4} y2={c.y + 22} className="as-lab-board__lever" />
              <line x1={c.x + 4} y1={c.y - 22} x2={c.x + 4} y2={c.y + 22} className="as-lab-board__lever" />
            </>
          ) : (
            <>
              <circle cx={c.x} cy={c.y} r={radius} className="as-lab-board__body" />
              {spec.kind === 'SOURCE' && <path d={`M ${c.x - 9} ${c.y} q 4.5 -8 9 0 t 9 0`} className="as-lab-board__lever" fill="none" />}
            </>
          )}
          {spec.kind === 'MOTOR_3PH' && layout.terminals.filter(t => t.index < 6).map(t => {
            const dx=t.point.x-c.x,dy=t.point.y-c.y,d=Math.hypot(dx,dy)
            return <line key={t.index} x1={t.point.x} y1={t.point.y} x2={c.x+dx/d*radius} y2={c.y+dy/d*radius} className="as-lab-board__lever" />
          })}
          {label && <text x={c.x} y={c.y + 4} textAnchor="middle" className="as-lab-board__glyph-value">{label}</text>}
          {spec.kind === 'MOTOR_3PH' && <text x={c.x} y={c.y + 15} textAnchor="middle" className="as-lab-board__glyph-sub">3~</text>}
          {lamp && (<><line x1={c.x - 12} y1={c.y - 12} x2={c.x + 12} y2={c.y + 12} className="as-lab-board__lever" /><line x1={c.x - 12} y1={c.y + 12} x2={c.x + 12} y2={c.y - 12} className="as-lab-board__lever" /></>)}
        </g>)
    }
    if (spec.kind === 'TERMINAL_BLOCK') {
      const count = terminalCountForSpec(spec)
      const disconnectable = spec.model === 'PHOENIX_UT4_HESI' || spec.model === 'PHOENIX_UT4_MT'
      const label =
        spec.model === 'PHOENIX_UT25_PE_L_L' ? 'PE/L/L'
          : spec.model === 'PHOENIX_UT25_QUATTRO' ? 'X4'
            : spec.model === 'PHOENIX_UT25_TWIN' ? 'X3'
              : spec.model === 'PHOENIX_UT4_HESI' ? 'XF'
                : spec.model === 'PHOENIX_UT4_MT' ? 'X-MT'
                  : spec.model === 'PHOENIX_UT25_PE' ? 'PE' : 'X'
      const points = Array.from({ length: count }, (_unused, index) => terminalAt(index))
      const symbol = (() => {
        if (spec.model === 'PHOENIX_UT4_HESI') {
          const [a, b] = points
          const interrupted = Boolean(spec.open || spec.fuseBlown)
          return (
            <g data-terminal-symbol="fuse-disconnect">
              <rect x={c.x - 25} y={c.y - 18} width={50} height={36} rx={3} className="as-lab-board__body" />
              <line x1={a.x} y1={a.y} x2={c.x - 12} y2={c.y} className="as-lab-board__lever" />
              <rect x={c.x - 12} y={c.y - 5} width={24} height={10} className="as-lab-board__body" />
              {!interrupted && <line x1={c.x - 9} y1={c.y} x2={c.x + 9} y2={c.y} className="as-lab-board__lever" />}
              <line x1={c.x + 12} y1={c.y} x2={b.x} y2={b.y} className="as-lab-board__lever" />
              <text x={c.x} y={c.y + 31} textAnchor="middle" className="as-lab-board__glyph-sub">{label}</text>
            </g>
          )
        }
        if (spec.model === 'PHOENIX_UT4_MT') {
          const [a, b] = points
          const interrupted = Boolean(spec.open)
          return (
            <g data-terminal-symbol="knife-disconnect">
              <rect x={c.x - 25} y={c.y - 18} width={50} height={36} rx={3} className="as-lab-board__body" />
              <line x1={a.x} y1={a.y} x2={c.x - 8} y2={c.y} className="as-lab-board__lever" />
              <circle cx={c.x - 8} cy={c.y} r={2.5} className="as-lab-board__terminal" />
              <circle cx={c.x + 10} cy={c.y} r={2.5} className="as-lab-board__terminal" />
              <line x1={c.x - 8} y1={c.y} x2={c.x + 9} y2={interrupted ? c.y - 10 : c.y} className="as-lab-board__lever" />
              <line x1={c.x + 10} y1={c.y} x2={b.x} y2={b.y} className="as-lab-board__lever" />
              <text x={c.x} y={c.y + 31} textAnchor="middle" className="as-lab-board__glyph-sub">{label}</text>
            </g>
          )
        }
        if (spec.model === 'PHOENIX_UT25_TWIN' || spec.model === 'PHOENIX_UT25_QUATTRO') {
          const minY = Math.min(...points.map((point) => point.y))
          const maxY = Math.max(...points.map((point) => point.y))
          return (
            <g data-terminal-symbol="common-potential">
              <rect x={c.x - 25} y={c.y - 20} width={50} height={40} rx={3} className="as-lab-board__body" />
              <line x1={c.x} y1={minY} x2={c.x} y2={maxY} className="as-lab-board__lever" />
              {points.map((point, index) => (
                <line key={index} x1={point.x} y1={point.y} x2={c.x} y2={point.y} className="as-lab-board__lever" />
              ))}
              <circle cx={c.x} cy={c.y} r={3} className="as-lab-board__terminal" />
              <text x={c.x} y={c.y + 33} textAnchor="middle" className="as-lab-board__glyph-sub">{label}</text>
            </g>
          )
        }
        if (spec.model === 'PHOENIX_UT25_PE_L_L') {
          return (
            <g data-terminal-symbol="three-level">
              <rect x={c.x - 25} y={c.y - 31} width={50} height={62} rx={3} className="as-lab-board__body" />
              {[[0, 1], [2, 3], [4, 5]].map(([from, to], level) => (
                <g key={level}>
                  <line x1={points[from].x} y1={points[from].y} x2={points[to].x} y2={points[to].y} className="as-lab-board__lever" />
                  <text x={c.x} y={points[from].y - 3} textAnchor="middle" className="as-lab-board__glyph-sub">
                    {level === 0 ? 'PE' : `L${level}`}
                  </text>
                </g>
              ))}
              <text x={c.x} y={c.y + 45} textAnchor="middle" className="as-lab-board__glyph-sub">{label}</text>
            </g>
          )
        }
        const [a, b] = points
        return (
          <g data-terminal-symbol={spec.model === 'PHOENIX_UT25_PE' ? 'protective-earth' : 'feed-through'}>
            <rect x={c.x - 25} y={c.y - 15} width={50} height={30} rx={3} className="as-lab-board__body" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="as-lab-board__lever" />
            <circle cx={c.x} cy={c.y} r={3} className="as-lab-board__terminal" />
            <text x={c.x} y={c.y + 29} textAnchor="middle" className="as-lab-board__glyph-sub">{label}</text>
          </g>
        )
      })()
      return disconnectable
        ? clickWrap(symbol, `${label} ${spec.open || spec.fuseBlown ? 'terbuka' : 'tertutup'}. Klik untuk mengubah.`, spec.open || spec.fuseBlown)
        : staticWrap(symbol)
    }
    if (spec.kind === 'CONTACTOR' || spec.kind === 'RELAY' || spec.kind === 'TIMER') {
      const label =
        spec.kind === 'CONTACTOR'
          ? 'KM'
          : spec.kind === 'RELAY'
            ? relayDefinition(spec).family
            : 'KT'
      const energized =
        spec.kind === 'CONTACTOR'
          ? state.contactorEnergized[component.id] ?? false
          : spec.kind === 'RELAY'
            ? state.relayEnergized[component.id] ?? false
            : state.timerRuntime[component.id]?.running ?? false
      const coilA1 = terminalAt(0)
      const coilA2 = terminalAt(1)
      const relayContacts = spec.kind === 'RELAY' ? relayDefinition(spec).contacts : []
      const contactPairs =
        spec.kind === 'CONTACTOR'
          ? [[8, 9], [10, 11]]
          : spec.kind === 'RELAY'
            ? relayContacts.length > 0
              ? []
              : [[2, 3], [4, 5]]
            : []
      const timerRuntime = spec.kind === 'TIMER' ? state.timerRuntime[component.id] : undefined
      const timerState = spec.kind === 'TIMER' && timerRuntime?.running
        ? spec.model === 'OMRON_H3CR_A8'
          ? multifunctionTimerOutputOn(timerRuntime.elapsedMs, spec) ? 'OUTPUT_ON' : 'OUTPUT_OFF'
          : timerPhase(timerRuntime.elapsedMs, spec)
        : 'IDLE'
      const content = (
        <g
          className={spec.kind === 'TIMER' ? 'as-lab-board__timer' : undefined}
          data-timer-phase={spec.kind === 'TIMER' ? timerState : undefined}
          data-timer-setting={spec.kind === 'TIMER' ? formatTimerDuration(spec.starDurationMs) : undefined}
        >
          <rect x={body.minX} y={body.minY} width={bodyWidth} height={bodyHeight} rx={3} className="as-lab-board__body" />
          <rect
            x={body.minX + 8}
            y={c.y - 15}
            width={Math.min(30, bodyWidth * 0.3)}
            height={30}
            rx={2}
            className="as-lab-board__body"
            data-energized={energized || undefined}
          />
          <line x1={coilA1.x} y1={coilA1.y} x2={body.minX + 8} y2={c.y - 8} className="as-lab-board__lever" />
          <line x1={coilA2.x} y1={coilA2.y} x2={body.minX + 8} y2={c.y + 8} className="as-lab-board__lever" />
          {spec.kind === 'CONTACTOR' &&
            [2, 4, 6].map((inputIndex) => {
              const input = terminalAt(inputIndex)
              const output = terminalAt(inputIndex + 1)
              const x = input.x
              return (
                <g key={inputIndex}>
                  <line x1={x} y1={input.y} x2={x} y2={c.y - 14} className="as-lab-board__lever" />
                  <line
                    x1={x}
                    y1={c.y - 14}
                    x2={energized ? x : x + 7}
                    y2={energized ? c.y + 14 : c.y + 5}
                    className="as-lab-board__lever"
                  />
                  <line x1={x} y1={c.y + 14} x2={x} y2={output.y} className="as-lab-board__lever" />
                </g>
              )
            })}
          {spec.kind === 'RELAY' && relayContacts.map((contact) => {
            const common = terminalAt(contact.common)
            const nc = terminalAt(contact.nc)
            const no = terminalAt(contact.no)
            const side = layout.terminals[contact.common]?.side ?? 'top'
            const fromTop = side === 'top'
            const fixedY = fromTop ? body.minY + 12 : body.maxY - 12
            const commonY = fromTop ? body.minY + 25 : body.maxY - 25
            const commonNode = { x: common.x, y: commonY }
            const ncNode = { x: nc.x, y: fixedY }
            const noNode = { x: no.x, y: fixedY }
            const selected = energized ? noNode : ncNode
            return (
              <g key={`relay-pole-${contact.pole}`} data-relay-pole={contact.pole}>
                <line x1={common.x} y1={common.y} x2={commonNode.x} y2={commonNode.y} className="as-lab-board__lever" />
                <line x1={nc.x} y1={nc.y} x2={ncNode.x} y2={ncNode.y} className="as-lab-board__lever" />
                <line x1={no.x} y1={no.y} x2={noNode.x} y2={noNode.y} className="as-lab-board__lever" />
                <circle cx={ncNode.x} cy={ncNode.y} r={2.2} className="as-lab-board__body" />
                <circle cx={noNode.x} cy={noNode.y} r={2.2} className="as-lab-board__body" />
                <line x1={commonNode.x} y1={commonNode.y} x2={selected.x} y2={selected.y} className="as-lab-board__lever" />
              </g>
            )
          })}
          {spec.kind === 'TIMER' && [
            {
              id: spec.model === 'OMRON_H3CR_A8' ? 'contact-1' : 'star',
              common: 2,
              nc: 3,
              no: 6,
              noSelected: spec.model === 'OMRON_H3CR_A8' ? timerState === 'OUTPUT_ON' : timerState === 'STAR',
            },
            {
              id: spec.model === 'OMRON_H3CR_A8' ? 'contact-2' : 'delta',
              common: 4,
              nc: 7,
              no: 5,
              noSelected: spec.model === 'OMRON_H3CR_A8' ? timerState === 'OUTPUT_ON' : timerState === 'DELTA',
            },
          ].map((contact) => {
            const common = terminalAt(contact.common)
            const nc = terminalAt(contact.nc)
            const no = terminalAt(contact.no)
            const commonNode = { x: body.maxX - 28, y: common.y }
            const ncNode = { x: body.maxX - 12, y: nc.y }
            const noNode = { x: body.maxX - 12, y: no.y }
            const selected = contact.noSelected ? noNode : ncNode
            return (
              <g
                key={`timer-contact-${contact.id}`}
                data-timer-contact={contact.id}
                data-selected-throw={contact.noSelected ? 'no' : 'nc'}
              >
                <line x1={common.x} y1={common.y} x2={commonNode.x} y2={commonNode.y} className="as-lab-board__lever" />
                <line x1={nc.x} y1={nc.y} x2={ncNode.x} y2={ncNode.y} className="as-lab-board__lever" />
                <line x1={no.x} y1={no.y} x2={noNode.x} y2={noNode.y} className="as-lab-board__lever" />
                <circle cx={ncNode.x} cy={ncNode.y} r={2.2} className="as-lab-board__body" />
                <circle cx={noNode.x} cy={noNode.y} r={2.2} className="as-lab-board__body" />
                <line x1={commonNode.x} y1={commonNode.y} x2={selected.x} y2={selected.y} className="as-lab-board__lever" />
              </g>
            )
          })}
          {contactPairs.map(([a, b], index) => <g key={index}>
            {contactPair(a, b, index === 0 ? energized : !energized,
              index === 0 ? 'aux-no' : 'aux-nc', body.maxX - 10)}
          </g>)}
          {spec.kind === 'TIMER' && (
            <>
              <circle cx={c.x - 3} cy={c.y} r={14} className="as-lab-board__body" />
              <text x={c.x} y={body.maxY - 8} textAnchor="middle" className="as-lab-board__glyph-sub">
                {formatTimerDuration(spec.starDurationMs)}
              </text>
            </>
          )}
          <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={9} className="as-lab-board__glyph-value">{label}</text>
        </g>
      )
      return spec.kind === 'TIMER'
        ? selectWrap(
            content,
            spec.model === 'OMRON_H3CR_A8'
              ? `Timer H3CR-A8 ${component.id}, mode ${spec.mode ?? 'A'}, set ${formatTimerDuration(spec.starDurationMs)}. Klik untuk mengatur.`
              : `Timer ${component.id}, STAR ${formatTimerDuration(spec.starDurationMs)}, jeda ${formatTimerDuration(spec.transitionDelayMs)}. Klik untuk mengatur.`,
          )
        : staticWrap(content)
    }
    if (spec.kind === 'SOURCE_3PH') {
      return staticWrap(
        <g>
          <circle cx={c.x} cy={c.y} r={Math.min(24, bodyWidth / 2 - 2)} className="as-lab-board__body" />
          <text x={c.x} y={c.y + 4} textAnchor="middle" className="as-lab-board__glyph-value">3~</text>
        </g>,
      )
    }
    if (spec.kind === 'GROUND') {
      return staticWrap(
        <g>
          <line x1={c.x} y1={c.y - 28} x2={c.x} y2={c.y} className="as-lab-board__lever" />
          <line x1={c.x - 15} y1={c.y} x2={c.x + 15} y2={c.y} className="as-lab-board__lever" />
          <line x1={c.x - 9} y1={c.y + 6} x2={c.x + 9} y2={c.y + 6} className="as-lab-board__lever" />
          <line x1={c.x - 3} y1={c.y + 12} x2={c.x + 3} y2={c.y + 12} className="as-lab-board__lever" />
        </g>,
      )
    }
    if (spec.kind === 'CAPACITOR') {
      return staticWrap(
        <g>
          {twoPortLeads(20)}
          <line x1={c.x - 4} y1={c.y - 12} x2={c.x - 4} y2={c.y + 12} className="as-lab-board__lever" />
          <line x1={c.x + 4} y1={c.y - 12} x2={c.x + 4} y2={c.y + 12} className="as-lab-board__lever" />
          <line x1={c.x - 20} y1={c.y} x2={c.x - 4} y2={c.y} className="as-lab-board__lever" />
          <line x1={c.x + 4} y1={c.y} x2={c.x + 20} y2={c.y} className="as-lab-board__lever" />
        </g>,
      )
    }
    if (spec.kind === 'OVERLOAD_RELAY') {
      return staticWrap(
        <g>
          <rect x={body.minX} y={body.minY} width={bodyWidth} height={bodyHeight} rx={3} className="as-lab-board__body" />
          {[0, 2, 4].map((inputIndex) => {
            const input = terminalAt(inputIndex)
            const output = terminalAt(inputIndex + 1)
            return (
              <g key={inputIndex}>
                <line x1={input.x} y1={input.y} x2={input.x} y2={c.y - 3} className="as-lab-board__lever" />
                <path d={`M ${input.x - 6} ${c.y - 3} q 6 -10 12 0 q -6 10 -12 0`} className="as-lab-board__lever" fill="none" />
                <line x1={output.x} y1={c.y - 3} x2={output.x} y2={output.y} className="as-lab-board__lever" />
              </g>
            )
          })}
          {contactPair(6, 7, !(state.overloadRuntime[component.id]?.tripped ?? false), 'overload-nc', body.maxX - 10)}
          {contactPair(8, 9, state.overloadRuntime[component.id]?.tripped ?? false, 'overload-no', body.maxX - 10)}
          <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={8} className="as-lab-board__glyph-sub">OL</text>
        </g>,
      )
    }
    return null
  }
  function renderComponent(component: PlacedComponent) {
    const centre = footprintCentre(component, projection)
    const spec = component.spec
    const dragProps = {
      onPointerDown: (event: PointerEvent) => startDrag(event, component),
    }
    if (projection === 'virtual') {
      return renderVirtual(component)
    }
    if (projection === 'iec') {
      const iec = renderIec(component)
      if (iec) return iec
    }

    if (spec.kind === 'SOURCE') {
      return (
        <g key={component.id} className="as-lab-board__source" data-draggable={draggable || undefined} {...dragProps}>
          <rect
            x={centre.x - 30}
            y={centre.y - 20}
            width={60}
            height={40}
            rx={4}
            className="as-lab-board__body"
          />
          <text x={centre.x} y={centre.y - 2} className="as-lab-board__glyph-value">
            {spec.emfVolts} V
          </text>
          <text x={centre.x} y={centre.y + 13} className="as-lab-board__glyph-sub">
            L · N
          </text>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'LOAD') {
      // Brightness is relative to the current the lamp would draw at full supply
      // voltage, so series lamps (half the voltage each) read visibly dimmer than
      // one lamp or two in parallel.
      const src = Object.values(board.components).find((c) => c.spec.kind === 'SOURCE')
      // The supply that feeds this load's circuit, so a 24 V load is lit at 24 V (L3).
      const emf = state.solution.supplyVolts?.[component.id] ?? (src && src.spec.kind === 'SOURCE' ? src.spec.emfVolts : 220)
      const nominal = spec.resistanceOhms > 0 ? emf / spec.resistanceOhms : spec.ratedCurrentAmps
      const brightness = Math.max(
        0,
        Math.min(1, (state.display.loadCurrent[component.id] ?? 0) / nominal),
      )
      const lit = brightness > 0.05
      const loadSym = spec.symbol ?? 'lamp'
      if (loadSym !== 'lamp') {
        const cx = centre.x
        const cy = centre.y
        const title = loadSym === 'resistor' ? 'Resistor' : loadSym === 'heater' ? (lit ? 'Pemanas aktif' : 'Elemen pemanas') : (lit ? 'Bel berbunyi' : 'Bel')
        return (
          <g
            key={component.id}
            className="as-lab-board__lamp"
            data-lit={lit || undefined}
            data-draggable={draggable || undefined}
            data-testid={`load-${component.id}`}
            {...dragProps}
          >
            <title>{title}</title>
            {loadSym === 'bell' ? (
              <>
                <path d={`M ${cx - 16} ${cy + 8} A 16 16 0 0 1 ${cx + 16} ${cy + 8} Z`} className="as-lab-board__body" />
                <path d={`M ${cx - 16} ${cy + 8} A 16 16 0 0 1 ${cx + 16} ${cy + 8} Z`} className="as-lab-board__lamp-fill" style={{ opacity: brightness }} />
                <circle cx={cx} cy={cy + 11} r={2} className="as-lab-board__lamp-cross" />
              </>
            ) : (
              <>
                <rect x={cx - 20} y={cy - 10} width={40} height={20} rx={2} className="as-lab-board__body" />
                <rect x={cx - 20} y={cy - 10} width={40} height={20} rx={2} className="as-lab-board__lamp-fill" style={{ opacity: brightness }} />
                {loadSym === 'heater' && (
                  <path d={`M ${cx - 12} ${cy + 4} q 4 -9 8 0 t 8 0`} className="as-lab-board__lamp-cross" fill="none" />
                )}
              </>
            )}
            {renderTerminals(component)}
          </g>
        )
      }
      return (
        <g
          key={component.id}
          className="as-lab-board__lamp"
          data-lit={lit || undefined}
          data-draggable={draggable || undefined}
          data-testid={`lamp-${component.id}`}
          {...dragProps}
        >
          <title>{lit ? 'Lampu menyala' : 'Lampu padam'}</title>
          <circle cx={centre.x} cy={centre.y} r={20} className="as-lab-board__body" />
          <circle
            cx={centre.x}
            cy={centre.y}
            r={16}
            className="as-lab-board__lamp-fill"
            style={{ opacity: brightness }}
          />
          <line
            x1={centre.x - 11}
            y1={centre.y - 11}
            x2={centre.x + 11}
            y2={centre.y + 11}
            className="as-lab-board__lamp-cross"
          />
          <line
            x1={centre.x + 11}
            y1={centre.y - 11}
            x2={centre.x - 11}
            y2={centre.y + 11}
            className="as-lab-board__lamp-cross"
          />
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'MOTOR') {
      const status = state.solution.motorStatus[component.id] ?? 'IDLE'
      return (
        <g
          key={component.id}
          className="as-lab-board__motor"
          data-status={status.toLowerCase()}
          data-draggable={draggable || undefined}
          data-testid={`motor-${component.id}`}
          {...dragProps}
        >
          <title>
            {status === 'RUNNING'
              ? 'Motor berputar'
              : status === 'HUMMING'
                ? 'Motor berdengung'
                : 'Motor diam'}
          </title>
          <circle cx={centre.x} cy={centre.y} r={20} className="as-lab-board__body" />
          <text x={centre.x} y={centre.y + 5} className="as-lab-board__glyph-value">
            M
          </text>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'GROUND') {
      return (
        <g key={component.id} className="as-lab-board__ground" data-draggable={draggable || undefined} {...dragProps}>
          <title>Pembumian (PE)</title>
          <line x1={centre.x} y1={centre.y - 28} x2={centre.x} y2={centre.y} className="as-lab-board__lever" />
          <line x1={centre.x - 15} y1={centre.y} x2={centre.x + 15} y2={centre.y} className="as-lab-board__lever" />
          <line x1={centre.x - 9} y1={centre.y + 6} x2={centre.x + 9} y2={centre.y + 6} className="as-lab-board__lever" />
          <line x1={centre.x - 3} y1={centre.y + 12} x2={centre.x + 3} y2={centre.y + 12} className="as-lab-board__lever" />
          {renderTerminals(component)}
        </g>
      )
    }
    if (spec.kind === 'CAPACITOR') {
      return (
        <g
          key={component.id}
          className="as-lab-board__capacitor"
          data-draggable={draggable || undefined}
          {...dragProps}
        >
          <line
            x1={centre.x - 28}
            y1={centre.y}
            x2={centre.x - 5}
            y2={centre.y}
            className="as-lab-board__cap-lead"
          />
          <line
            x1={centre.x + 5}
            y1={centre.y}
            x2={centre.x + 28}
            y2={centre.y}
            className="as-lab-board__cap-lead"
          />
          <line
            x1={centre.x - 5}
            y1={centre.y - 13}
            x2={centre.x - 5}
            y2={centre.y + 13}
            className="as-lab-board__cap-plate"
          />
          <line
            x1={centre.x + 5}
            y1={centre.y - 13}
            x2={centre.x + 5}
            y2={centre.y + 13}
            className="as-lab-board__cap-plate"
          />
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'INDICATOR') {
      const on = (state.display.loadCurrent[component.id] ?? 0) > spec.ratedCurrentAmps * 0.05
      return (
        <g
          key={component.id}
          className="as-lab-board__indicator"
          data-on={on || undefined}
          data-draggable={draggable || undefined}
          data-testid={`indicator-${component.id}`}
          {...dragProps}
        >
          <title>{on ? 'Indikator nyala' : 'Indikator padam'}</title>
          <circle cx={centre.x} cy={centre.y} r={13} className="as-lab-board__body" />
          <circle
            cx={centre.x}
            cy={centre.y}
            r={9}
            className="as-lab-board__indicator-fill"
            style={{ opacity: on ? 1 : 0 }}
          />
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'RELAY') {
      const energized = state.relayEnergized[component.id] ?? false
      return (
        <g
          key={component.id}
          className="as-lab-board__relay"
          data-energized={energized || undefined}
          data-draggable={draggable || undefined}
          data-testid={`relay-${component.id}`}
          {...dragProps}
        >
          <title>{energized ? 'Relay aktif' : 'Relay idle'}</title>
          <rect
            x={centre.x - 22}
            y={centre.y - 26}
            width={44}
            height={52}
            rx={4}
            className="as-lab-board__body"
          />
          <text x={centre.x} y={centre.y - 8} className="as-lab-board__glyph-sub">
            RLY
          </text>
          <text x={centre.x} y={centre.y + 8} className="as-lab-board__glyph-value">
            {component.id}
          </text>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'PUSHBUTTON') {
      const pressed = spec.pressed
      const label = spec.normallyOpen ? 'START (NO)' : 'STOP (NC)'
      const tap = () => {
        onPressButton(component.id, true)
        onPressButton(component.id, false)
      }
      // Two SEPARATE hit-zones (no long-press timer — the distinction is spatial):
      //   • the bezel rect = BODY → drag handle (startDrag, never presses);
      //   • the round cap = ACTUATOR → momentary press only (never starts a drag).
      // The cap stops pointerdown propagation so a press can never seed a body drag,
      // captures the pointer locally so movement while held stays a press (the
      // component never follows the cursor), and releases + clears on up / cancel /
      // lost-capture. pointerleave does NOT release: a held, captured press stays
      // pressed even if the pointer wanders off the cap.
      const releaseActuator = (event: PointerEvent) => {
        onPressButton(component.id, false)
        try {
          event.currentTarget.releasePointerCapture(event.pointerId)
        } catch {
          /* jsdom / already released */
        }
      }
      return (
        <g
          key={component.id}
          className="as-lab-board__pushbutton"
          data-pressed={pressed || undefined}
          data-nc={spec.normallyOpen ? undefined : true}
          data-draggable={draggable || undefined}
        >
          <g
            role="button"
            tabIndex={0}
            aria-label={`Tombol ${label}${pressed ? ' (ditekan)' : ''}. Enter untuk menekan sesaat.`}
            aria-pressed={pressed}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                tap()
              }
            }}
          >
            {/* BODY / frame — drag handle only. Never presses the button. */}
            <rect
              x={centre.x - 20}
              y={centre.y - 16}
              width={40}
              height={32}
              rx={4}
              className="as-lab-board__button-hit"
              data-role="body"
              onPointerDown={(event) => startDrag(event, component)}
            />
            {/* ACTUATOR / cap — momentary press only. Never starts a drag. */}
            <circle
              cx={centre.x}
              cy={centre.y}
              r={9}
              className="as-lab-board__button-cap"
              data-role="actuator"
              data-testid={`pushbutton-cap-${component.id}`}
              onPointerDown={(event) => {
                // Do NOT seed a drag: keep this a pure momentary press.
                event.stopPropagation()
                onPressButton(component.id, true)
                try {
                  event.currentTarget.setPointerCapture(event.pointerId)
                } catch {
                  /* jsdom / unsupported: press still works, just no capture */
                }
              }}
              onPointerUp={releaseActuator}
              onPointerCancel={releaseActuator}
              onLostPointerCapture={releaseActuator}
            />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'SOURCE_3PH') {
      const fc = footprintCentre(component, projection)
      return (
        <g
          key={component.id}
          className="as-lab-board__source"
          data-draggable={draggable || undefined}
          data-testid={`source3ph-${component.id}`}
          {...dragProps}
        >
          <rect x={fc.x - 30} y={fc.y - 66} width={52} height={132} rx={4} className="as-lab-board__body" />
          <text x={fc.x - 4} y={fc.y - 4} className="as-lab-board__glyph-value">
            3~
          </text>
          <text x={fc.x - 4} y={fc.y + 14} className="as-lab-board__glyph-sub">
            {spec.vLineToLineVolts} V
          </text>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'MOTOR_3PH') {
      const fc = footprintCentre(component, projection)
      // Running is DERIVED from the solved winding currents (finite & balanced) — the
      // 3-phase analogue of the 1-phase motor status. Gated on RUNNING (the AC phasor
      // solve is always "on", so without the gate the ring would light before Jalankan —
      // same gate as the flow markers and the 1-phase motor). Reuses the shared
      // `.as-lab-board__motor[data-status='running']` ring (green body), so no new CSS.
      const running =
        state.status === 'RUNNING' && state.threePhase
          ? isMotor3phRunning(state.threePhase, component.id)
          : false
      return (
        <g
          key={component.id}
          className="as-lab-board__motor"
          data-status={running ? 'running' : undefined}
          data-draggable={draggable || undefined}
          data-testid={`motor3ph-${component.id}`}
          {...dragProps}
        >
          <circle cx={fc.x} cy={fc.y} r={30} className="as-lab-board__body" />
          <text x={fc.x} y={fc.y + 4} className="as-lab-board__glyph-value">
            M
          </text>
          <text x={fc.x} y={fc.y - 14} className="as-lab-board__glyph-sub">
            3~
          </text>
          {/* Three separate winding hints (U/V/W) — NO star/delta tie drawn. */}
          {[-50, 0, 50].map((dx) => (
            <line
              key={dx}
              x1={fc.x + dx}
              y1={fc.y - 26}
              x2={fc.x + dx}
              y2={fc.y - 8}
              className="as-lab-board__cap-lead"
            />
          ))}
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'CONTACTOR') {
      const fc = footprintCentre(component, projection)
      // Voltage-driven state (M3-B2): coil, main poles and aux all follow ONE state.
      const energized = state.contactorEnergized[component.id] ?? false
      return (
        <g
          key={component.id}
          className="as-lab-board__relay"
          data-energized={energized || undefined}
          data-draggable={draggable || undefined}
          data-testid={`contactor-${component.id}`}
          {...dragProps}
        >
          <title>{energized ? 'Kontaktor energized (A1–A2 di atas pickup)' : 'Kontaktor de-energized'}</title>
          <rect x={fc.x - 64} y={fc.y - 64} width={128} height={128} rx={4} className="as-lab-board__body" />
          <text x={fc.x} y={fc.y - 40} className="as-lab-board__glyph-sub">
            KM · {energized ? 'ON' : 'OFF'}
          </text>
          <text x={fc.x} y={fc.y + 6} className="as-lab-board__glyph-value">
            {component.id}
          </text>
          {/* Coil A1/A2 (left): filled when energized. */}
          <rect
            x={fc.x - 60}
            y={fc.y - 14}
            width={14}
            height={28}
            rx={2}
            className="as-lab-board__cap-plate"
            data-energized={energized || undefined}
          />
          {/* Three main poles (centre): straight-closed when energized, gapped-open when not. */}
          {[-50, 0, 50].map((dx) => (
            <line
              key={dx}
              x1={fc.x + dx}
              y1={fc.y - 34}
              x2={energized ? fc.x + dx : fc.x + dx + 12}
              y2={energized ? fc.y + 34 : fc.y + 2}
              className="as-lab-board__cap-lead"
            />
          ))}
          {/* Aux state by SHAPE (● closed / ○ open), not colour alone. */}
          <text x={fc.x + 44} y={fc.y - 34} className="as-lab-board__glyph-sub">
            NO {energized ? '●' : '○'}
          </text>
          <text x={fc.x + 44} y={fc.y + 40} className="as-lab-board__glyph-sub">
            NC {energized ? '○' : '●'}
          </text>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'BREAKER_1P') {
      // MCB module (1×1), L_IN(0) left / L_OUT(1) right. Body = SELECT (opens the
      // rating panel); the handle = manual ON/OFF toggle. Internal kind unchanged.
      const on = spec.on
      const tripped = state.mcbRuntime[component.id]?.tripped ?? false
      const rating = mcbRatedAmps(spec)
      const handleToggle = () => {
        if (suppressClick.current === component.id) {
          suppressClick.current = null
          return
        }
        onToggleSwitch(component.id)
      }
      const selectMe = () => {
        if (suppressClick.current === component.id) {
          suppressClick.current = null
          return
        }
        onSelectComponent?.(component.id)
      }
      return (
        <g
          key={component.id}
          className="as-lab-board__breaker"
          data-on={on || undefined}
          data-tripped={tripped || undefined}
          data-selected={selectedId === component.id || undefined}
          data-draggable={draggable || undefined}
          data-testid={`breaker-${component.id}`}
          {...dragProps}
        >
          {/* Body = selection target. */}
          <rect
            x={centre.x - 28}
            y={centre.y - 22}
            width={56}
            height={44}
            rx={4}
            className="as-lab-board__body"
            role="button"
            tabIndex={0}
            aria-label={`MCB 1-fasa ${rating} A${tripped ? ' (TRIP)' : ''}. Klik untuk memilih.`}
            onClick={selectMe}
            onKeyDown={activateOnKey(() => onSelectComponent?.(component.id))}
          />
          <text x={centre.x} y={centre.y - 8} className="as-lab-board__glyph-sub">
            {tripped ? 'MCB · TRIP' : 'MCB · 1P'}
          </text>
          <text x={centre.x} y={centre.y + 4} className="as-lab-board__glyph-value">
            {rating} A
          </text>
          {/* Handle = manual toggle. One pole: closed = straight; open = lifted. */}
          <g
            className="as-lab-board__breaker-handle"
            role="button"
            tabIndex={0}
            aria-label={`Sakelar MCB 1-fasa ${on ? 'ON (tertutup)' : 'OFF (terbuka)'}. Klik untuk mengubah.`}
            aria-pressed={on}
            onClick={(event) => {
              event.stopPropagation()
              handleToggle()
            }}
            onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}
          >
            <rect x={centre.x - 20} y={centre.y + 8} width={40} height={16} className="as-lab-board__breaker-hit" />
            <circle cx={centre.x - 14} cy={centre.y + 16} r={2.5} className="as-lab-board__pivot" />
            <circle cx={centre.x + 14} cy={centre.y + 16} r={2.5} className="as-lab-board__pivot" />
            <line
              x1={centre.x - 14}
              y1={centre.y + 16}
              x2={centre.x + 14}
              y2={tripped ? centre.y + 11 : on ? centre.y + 16 : centre.y + 6}
              className="as-lab-board__lever"
            />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'BREAKER_3P') {
      const fc = footprintCentre(component, projection)
      const on = spec.on
      const tripped = state.mcbRuntime[component.id]?.tripped ?? false
      const rating = mcbRatedAmps(spec)
      const handleToggle = () => {
        if (suppressClick.current === component.id) {
          suppressClick.current = null
          return
        }
        onToggleSwitch(component.id)
      }
      const selectMe = () => {
        if (suppressClick.current === component.id) {
          suppressClick.current = null
          return
        }
        onSelectComponent?.(component.id)
      }
      return (
        <g
          key={component.id}
          className="as-lab-board__breaker"
          data-on={on || undefined}
          data-tripped={tripped || undefined}
          data-selected={selectedId === component.id || undefined}
          data-draggable={draggable || undefined}
          data-testid={`breaker-${component.id}`}
          {...dragProps}
        >
          {/* Body = selection target (the whole module). */}
          <rect
            x={fc.x - 64}
            y={fc.y - 40}
            width={128}
            height={80}
            rx={4}
            className="as-lab-board__body"
            role="button"
            tabIndex={0}
            aria-label={`MCB 3-fasa ${rating} A${tripped ? ' (TRIP)' : ''}. Klik untuk memilih.`}
            onClick={selectMe}
            onKeyDown={activateOnKey(() => onSelectComponent?.(component.id))}
          />
          <text x={fc.x} y={fc.y - 26} className="as-lab-board__glyph-sub">
            {tripped ? `MCB ${rating} A · TRIP` : `MCB ${rating} A · 3P`}
          </text>
          {['R', 'S', 'T'].map((phase, i) => (
            <text key={phase} x={fc.x + [-50, 0, 50][i]} y={fc.y - 12} className="as-lab-board__glyph-sub">
              {phase}
            </text>
          ))}
          {/* ONE shared handle toggling all three poles together. */}
          <g
            className="as-lab-board__breaker-handle"
            role="button"
            tabIndex={0}
            aria-label={`Sakelar MCB 3-fasa ${on ? 'ON (tertutup)' : 'OFF (terbuka)'}. Klik untuk mengubah.`}
            aria-pressed={on}
            onClick={(event) => {
              event.stopPropagation()
              handleToggle()
            }}
            onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}
          >
            <rect x={fc.x - 62} y={fc.y - 4} width={124} height={30} className="as-lab-board__breaker-hit" />
            {[-50, 0, 50].map((dx) => (
              <g key={dx}>
                <circle cx={fc.x + dx} cy={fc.y + 2} r={2.5} className="as-lab-board__pivot" />
                <circle cx={fc.x + dx} cy={fc.y + 22} r={2.5} className="as-lab-board__pivot" />
                <line
                  x1={fc.x + dx}
                  y1={fc.y + 2}
                  x2={tripped ? fc.x + dx + 5 : on ? fc.x + dx : fc.x + dx + 9}
                  y2={tripped ? fc.y + 16 : on ? fc.y + 22 : fc.y + 10}
                  className="as-lab-board__lever"
                />
              </g>
            ))}
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'SWITCH_2WAY') {
      const toL2 = spec.toL2
      const handle2 = () => {
        if (suppressClick.current === component.id) { suppressClick.current = null; return }
        onToggleSwitch(component.id)
      }
      const travY = toL2 ? centre.y + 14 : centre.y - 14
      return (
        <g
          key={component.id}
          className="as-lab-board__switch"
          data-closed={undefined}
          data-draggable={draggable || undefined}
          {...dragProps}
        >
          <g
            role="button"
            tabIndex={0}
            aria-label={`Saklar tukar, arah ${toL2 ? 'L2' : 'L1'}. Klik untuk mengubah.`}
            aria-pressed={toL2}
            onClick={handle2}
            onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}
          >
            <rect x={centre.x - 26} y={centre.y - 22} width={52} height={44} rx={4} className="as-lab-board__switch-hit" />
            <circle cx={centre.x - 16} cy={centre.y} r={3} className="as-lab-board__pivot" />
            <circle cx={centre.x + 16} cy={centre.y - 14} r={3} className="as-lab-board__pivot" />
            <circle cx={centre.x + 16} cy={centre.y + 14} r={3} className="as-lab-board__pivot" />
            <line x1={centre.x - 16} y1={centre.y} x2={centre.x + 16} y2={travY} className="as-lab-board__lever" />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'SWITCH_CROSS') {
      const crossed = spec.crossed
      const tog = () => { if (suppressClick.current === component.id) { suppressClick.current = null; return } onToggleSwitch(component.id) }
      return (
        <g key={component.id} className="as-lab-board__switch" data-draggable={draggable || undefined} {...dragProps}>
          <g role="button" tabIndex={0} aria-label={`Saklar silang, ${crossed ? 'silang' : 'lurus'}. Klik untuk mengubah.`} aria-pressed={crossed} onClick={tog} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
            <rect x={centre.x - 26} y={centre.y - 22} width={52} height={44} rx={4} className="as-lab-board__switch-hit" />
            <line x1={centre.x - 16} y1={centre.y - 14} x2={centre.x + 16} y2={crossed ? centre.y + 14 : centre.y - 14} className="as-lab-board__lever" />
            <line x1={centre.x - 16} y1={centre.y + 14} x2={centre.x + 16} y2={crossed ? centre.y - 14 : centre.y + 14} className="as-lab-board__lever" />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'CONTACT_2STATE') {
      const act = component.modelId === 'PHASE_MONITOR_RM17TG20'
        ? automaticProductState[component.id] ?? false
        : spec.actuated
      const tog = () => { if (suppressClick.current === component.id) { suppressClick.current = null; return } onToggleSwitch(component.id) }
      if (component.modelId === 'AUX_CONTACT_LADN22') {
        const pairs = [
          { a: 0, b: 1, closed: act, role: 'NO' },
          { a: 2, b: 3, closed: !act, role: 'NC' },
          { a: 4, b: 5, closed: !act, role: 'NC' },
          { a: 6, b: 7, closed: act, role: 'NO' },
        ] as const
        return (
          <g key={component.id} className="as-lab-board__switch" data-draggable={draggable || undefined} {...dragProps}>
            <g role="button" tabIndex={0} aria-label={`LADN22 2NO+2NC, ${act ? 'actuated' : 'normal'}. Klik untuk mengubah state mekanis.`} aria-pressed={act} onClick={tog} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
              <rect x={centre.x - 48} y={centre.y - 22} width={96} height={44} rx={4} className="as-lab-board__switch-hit" />
              {pairs.map((pair) => {
                const a = displayPoint(component, pair.a)
                const b = displayPoint(component, pair.b)
                const midY = (a.y + b.y) / 2
                return (
                  <g key={pair.a} data-contact-role={pair.role} data-contact-closed={pair.closed || undefined}>
                    <line x1={a.x} y1={a.y + 5} x2={a.x} y2={midY - 5} className="as-lab-board__lever" />
                    <line x1={a.x} y1={midY - 5} x2={b.x + (pair.closed ? 0 : 8)} y2={midY + 5} className="as-lab-board__lever" />
                    <line x1={b.x} y1={midY + 5} x2={b.x} y2={b.y - 5} className="as-lab-board__lever" />
                  </g>
                )
              })}
              <text x={centre.x} y={centre.y + 4} textAnchor="middle" className="as-lab-board__glyph-sub">2NO+2NC</text>
            </g>
            {renderTerminals(component)}
          </g>
        )
      }
      if (component.modelId === 'PHASE_MONITOR_RM17TG20') {
        return (
          <g key={component.id} className="as-lab-board__switch" data-draggable={draggable || undefined} {...dragProps}>
            <g aria-label={`RM17TG20 phase monitor, output otomatis ${act ? 'healthy/energized' : 'fault/de-energized'}.`}>
              <rect x={centre.x - 34} y={centre.y - 25} width={68} height={50} rx={3} className="as-lab-board__body" />
              <text x={centre.x} y={centre.y - 3} textAnchor="middle" className="as-lab-board__glyph-value">3~</text>
              <text x={centre.x} y={centre.y + 13} textAnchor="middle" className="as-lab-board__glyph-sub">2CO {act ? 'OK' : 'FAULT'}</text>
            </g>
            {renderTerminals(component)}
          </g>
        )
      }
      if (
        component.modelId === 'FLOAT_SWITCH_9037HG33' ||
        component.modelId === 'PRESSURE_SWITCH_XMLB004' ||
        component.modelId === 'THERMOSTAT_NSYCCOTHC'
      ) {
        const pairs = component.modelId === 'THERMOSTAT_NSYCCOTHC'
          ? [{ a: 0, b: 1, closed: !act, role: 'NC' }]
          : component.modelId === 'FLOAT_SWITCH_9037HG33'
            ? [
                { a: 0, b: 1, closed: !act, role: 'POLE 1' },
                { a: 2, b: 3, closed: !act, role: 'POLE 2' },
              ]
            : [
                { a: 0, b: 1, closed: act, role: 'NO' },
                { a: 2, b: 3, closed: !act, role: 'NC' },
              ]
        const label = component.modelId === 'FLOAT_SWITCH_9037HG33'
          ? 'FLOAT · DPST'
          : component.modelId === 'PRESSURE_SWITCH_XMLB004'
            ? 'PRESSURE · NO/NC'
            : 'THERMOSTAT · NC'
        return (
          <g key={component.id} className="as-lab-board__switch" data-draggable={draggable || undefined} {...dragProps}>
            <g role="button" tabIndex={0} aria-label={`${label}, ${act ? 'ambang tercapai' : 'normal'}. Klik untuk mengubah kondisi uji.`} aria-pressed={act} onClick={tog} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
              <rect x={centre.x - 46} y={centre.y - 24} width={92} height={48} rx={4} className="as-lab-board__switch-hit" />
              {pairs.map((pair) => {
                const a = displayPoint(component, pair.a)
                const b = displayPoint(component, pair.b)
                const horizontal = Math.abs(a.x - b.x) > Math.abs(a.y - b.y)
                const dx = horizontal && !pair.closed ? 7 : 0
                const dy = !horizontal && !pair.closed ? 7 : 0
                return (
                  <g key={pair.a} data-contact-role={pair.role} data-contact-closed={pair.closed || undefined}>
                    <line x1={a.x} y1={a.y} x2={b.x + dx} y2={b.y + dy} className="as-lab-board__lever" />
                  </g>
                )
              })}
              <text x={centre.x} y={centre.y + 4} textAnchor="middle" className="as-lab-board__glyph-sub">{label}</text>
            </g>
            {renderTerminals(component)}
          </g>
        )
      }
      return (
        <g key={component.id} className="as-lab-board__switch" data-closed={!act || undefined} data-draggable={draggable || undefined} {...dragProps}>
          <g role="button" tabIndex={0} aria-label={`Kontak, ${act ? 'aktif (COM-NO)' : 'normal (COM-NC)'}. Klik untuk mengubah.`} aria-pressed={act} onClick={tog} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
            <rect x={centre.x - 26} y={centre.y - 22} width={52} height={44} rx={4} className="as-lab-board__switch-hit" />
            <circle cx={centre.x - 16} cy={centre.y} r={3} className="as-lab-board__pivot" />
            <circle cx={centre.x + 16} cy={centre.y - 14} r={3} className="as-lab-board__pivot" />
            <circle cx={centre.x + 16} cy={centre.y + 14} r={3} className="as-lab-board__pivot" />
            <line x1={centre.x - 16} y1={centre.y} x2={centre.x + 16} y2={act ? centre.y + 14 : centre.y - 14} className="as-lab-board__lever" />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'SELECTOR_3POS') {
      const pos = spec.pos
      const tog = () => { if (suppressClick.current === component.id) { suppressClick.current = null; return } onToggleSwitch(component.id) }
      const ang = pos === 0 ? -0.7 : pos === 2 ? 0.7 : 0
      const kx = centre.x + Math.sin(ang) * 16
      const ky = centre.y - Math.cos(ang) * 16
      return (
        <g key={component.id} className="as-lab-board__switch" data-draggable={draggable || undefined} {...dragProps}>
          <g role="button" tabIndex={0} aria-label={`Selektor posisi ${pos === 0 ? 'kiri' : pos === 2 ? 'kanan' : 'tengah (OFF)'}. Klik untuk memutar.`} aria-pressed={pos !== 1} onClick={tog} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
            <rect x={centre.x - 26} y={centre.y - 22} width={52} height={44} rx={4} className="as-lab-board__switch-hit" />
            <circle cx={centre.x} cy={centre.y} r={3} className="as-lab-board__pivot" />
            <line x1={centre.x} y1={centre.y} x2={kx} y2={ky} className="as-lab-board__lever" />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'FUSE') {
      const blown = spec.blown
      const tog = () => { if (suppressClick.current === component.id) { suppressClick.current = null; return } onToggleSwitch(component.id) }
      return (
        <g key={component.id} className="as-lab-board__switch" data-closed={!blown || undefined} data-draggable={draggable || undefined} {...dragProps}>
          <g role="button" tabIndex={0} aria-label={`Sekring, ${blown ? 'putus' : 'normal'}. Klik untuk mengubah.`} aria-pressed={blown} onClick={tog} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
            <rect x={centre.x - 22} y={centre.y - 10} width={44} height={20} rx={3} className="as-lab-board__body" />
            {blown ? (
              <>
                <line x1={centre.x - 18} y1={centre.y} x2={centre.x - 4} y2={centre.y} className="as-lab-board__lever" />
                <line x1={centre.x + 4} y1={centre.y} x2={centre.x + 18} y2={centre.y} className="as-lab-board__lever" />
              </>
            ) : (
              <line x1={centre.x - 18} y1={centre.y} x2={centre.x + 18} y2={centre.y} className="as-lab-board__lever" />
            )}
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    if (spec.kind === 'ESTOP') {
      const pressed = spec.pressed
      const tog = () => { if (suppressClick.current === component.id) { suppressClick.current = null; return } onToggleSwitch(component.id) }
      return (
        <g key={component.id} className="as-lab-board__switch" data-closed={!pressed || undefined} data-draggable={draggable || undefined} {...dragProps}>
          <g role="button" tabIndex={0} aria-label={`Emergency stop, ${pressed ? 'ditekan (terkunci terbuka)' : 'normal (tertutup)'}. Klik untuk ${pressed ? 'reset' : 'menekan'}.`} aria-pressed={pressed} onClick={tog} onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}>
            <rect x={centre.x - 24} y={centre.y - 20} width={48} height={40} rx={4} className="as-lab-board__switch-hit" />
            <circle cx={centre.x} cy={centre.y} r={pressed ? 13 : 15} className="as-lab-board__body" />
            <circle cx={centre.x} cy={centre.y} r={pressed ? 6 : 8} className="as-lab-board__pivot" />
          </g>
          {renderTerminals(component)}
        </g>
      )
    }

    // Any other (future) kind: no glyph in this phase.
    if (spec.kind !== 'SWITCH') return null

    // SWITCH — the body is a button that toggles open/closed (unless it was
    // just dragged, in which case the toggle is suppressed).
    const closed = spec.closed
    const handleToggle = () => {
      if (suppressClick.current === component.id) {
        suppressClick.current = null
        return
      }
      onToggleSwitch(component.id)
    }
    return (
      <g
        key={component.id}
        className="as-lab-board__switch"
        data-closed={closed || undefined}
        data-draggable={draggable || undefined}
        {...dragProps}
      >
        <g
          role="button"
          tabIndex={0}
          aria-label={`Saklar ${closed ? 'tertutup' : 'terbuka'}. Klik untuk mengubah.`}
          aria-pressed={closed}
          onClick={handleToggle}
          onKeyDown={activateOnKey(() => onToggleSwitch(component.id))}
        >
          <rect
            x={centre.x - 26}
            y={centre.y - 18}
            width={52}
            height={36}
            rx={4}
            className="as-lab-board__switch-hit"
          />
          <circle cx={centre.x - 16} cy={centre.y} r={3} className="as-lab-board__pivot" />
          <circle cx={centre.x + 16} cy={centre.y} r={3} className="as-lab-board__pivot" />
          <line
            x1={centre.x - 16}
            y1={centre.y}
            x2={centre.x + 16}
            y2={closed ? centre.y : centre.y - 14}
            className="as-lab-board__lever"
          />
        </g>
        {renderTerminals(component)}
      </g>
    )
  }

  return (
    <>
      <div
        className="as-lab-board__ruler-layer"
        aria-hidden="true"
        style={{ width: extent.width * zoom, height: extent.height * zoom }}
      >
        <div className="as-lab-board__ruler as-lab-board__ruler--x">
          {Array.from({ length: Math.ceil(extent.cols / gridStride) }, (_unused, index) => { const column = index * gridStride; return (
            <span
              key={`ruler-column-${column}`}
              style={{
                left: (PAD + (column + 0.5) * CELL - extent.x) * zoom,
                width: CELL * zoom,
              }}
            >
              {column + 1}
            </span>
          )})}
        </div>
        <div className="as-lab-board__ruler as-lab-board__ruler--y">
          {Array.from({ length: Math.ceil(extent.rows / gridStride) }, (_unused, index) => { const row = index * gridStride; return (
            <span
              key={`ruler-row-${row}`}
              style={{
                top: (PAD + (row + 0.5) * CELL - extent.y) * zoom,
                height: CELL * zoom,
              }}
            >
              {row + 1}
            </span>
          )})}
        </div>
      </div>
      <svg
      ref={svgRef}
      className="as-lab-board"
      // viewBox in board coords; the whole grid fills the workspace via the camera
      // extent. The origin is 0,0 unless a conductor was routed above/left of the grid,
      // in which case the camera opens that far so the wire stays inside the frame
      // instead of being cut off. getScreenCTM captures BOTH the scale and this origin,
      // so clientToSvg (drag, wiring, placement) needs no adjustment.
      viewBox={`${extent.x} ${extent.y} ${extent.width} ${extent.height}`}
      // P1-C: render at board-px × zoom; the wrapper (overflow:auto) scrolls when the
      // board is larger than the viewport.
      width={extent.width * zoom}
      height={extent.height * zoom}
      style={{ width: extent.width * zoom, height: extent.height * zoom }}
      role="group"
      aria-label={
        projection === 'virtual' ? 'Papan simulasi virtual' : 'Papan diagram IEC 60617'
      }
      data-projection={projection}
      data-content-bounds={JSON.stringify(contentBounds)}
      data-routing-ready={!routingPending}
      data-zoom={zoom}
      data-faulted={faulted || undefined}
      data-erase={eraseMode || undefined}
      data-drag-active={drag ? drag.id : undefined}
      onPointerDownCapture={onBoardPointerDownCapture}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finishPointer(event)}
      onPointerCancel={(event) => finishPointer(event, true)}
    >
      <rect
        x={extent.x}
        y={extent.y}
        width={extent.width}
        height={extent.height}
        className="as-lab-board__field"
        onClick={(event) => {
          if (placingSpec && zoom < 0.25) {
            const point = clientToSvg(event.clientX, event.clientY)
            if (point) {
              const cell = cellAtPoint(point)
              if (!footprintCollides(board, placingSpec.kind, cell, undefined, projection)) onPlaceCell(cell)
            }
          }
          if (pendingTerminal) onCancelWiring()
        }}
      />
      {gridLines}

      {placingSpec && zoom >= 0.25 &&
        emptyCells(board, extent, projection)
          .filter((cell) => !footprintCollides(board, placingSpec.kind, cell, undefined, projection))
          .map((cell) => {
          const centre = cellCentre(cell)
          return (
            <rect
              key={`cell-${cell.x}-${cell.y}`}
              className="as-lab-board__cell"
              x={centre.x - CELL / 2}
              y={centre.y - CELL / 2}
              width={CELL}
              height={CELL}
              role="button"
              tabIndex={0}
              aria-label={`Letakkan di kolom ${cell.x + 1} baris ${cell.y + 1}${
                projection === 'iec' ? ' — papan IEC' : ''
              }`}
              onClick={() => onPlaceCell(cell)}
              onKeyDown={activateOnKey(() => onPlaceCell(cell))}
            />
          )
          })}

      <g data-layer="mechanical-interlocks" pointerEvents="none">
        {(board.mechanicalInterlocks ?? []).map(({ contactorA, contactorB }) => {
          const a = componentById.get(contactorA)
          const b = componentById.get(contactorB)
          if (!a || !b) return null
          const pa = footprintCentre(a, projection)
          const pb = footprintCentre(b, projection)
          return (
            <g key={`${contactorA}-${contactorB}`} className="as-lab-board__mechanical-interlock">
              <line x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} />
              <text x={(pa.x + pb.x) / 2} y={(pa.y + pb.y) / 2 - 5} textAnchor="middle">
                MECH
              </text>
            </g>
          )
        })}
      </g>

      <g data-layer="components">
        {components.map(renderComponent)}
      </g>

      {routingPending && (
        <g className="as-lab-board__routing-pending" aria-label="Menata kabel" role="status">
          <rect x={PAD} y={PAD} width={150} height={30} rx={6} />
          <text x={PAD + 75} y={PAD + 20} textAnchor="middle">Menata kabel…</text>
        </g>
      )}

      <g data-layer="wires">
        {renderGeoms.map((geom) => {
        const flow = trace[geom.id]
        const wire = board.wires[geom.id]
        const wireNet = wire ? netOfTerminal(wire.from) : undefined
        const wireNetColor = netColorIndex(wireNet)
        const protectiveEarth = isProtectiveEarthWire(geom.id)
        // Arrows ride the SAME path that is drawn — hop arcs included — so they climb
        // over each crossing instead of cutting through the bump (and never pile at
        // the crossing as a false junction). Run it in the current's direction so the
        // arrow points the way current flows (L → loads → N).
        const flowPath = buildFlowPath(geom.points, hops[geom.id])
        // DC has a conventional direction (L→N); 3-phase AC does not, so 3-phase
        // arrows just ride the drawn path order (consistent per wire).
        const directed =
          !phaseClass && flow?.direction === -1 ? [...flowPath].reverse() : flowPath
        // Bug1: 3-phase wires use the SAME legacy arrow markers as 1-phase — gated on
        // real current (`flowing`) AND a running board — instead of a moving dash.
        const wirePhase = phaseClass?.[geom.id]
        const showMarkers = phaseClass
          ? Boolean(wirePhase?.flowing)
          : Boolean(flow?.onPath) && energised
        const markers = showMarkers
            ? flowMarkersPolyline(
              directed,
              state.display.sourceCurrent,
              state.timeMs,
              prefersReducedMotion,
              renderProfile?.markerSpacingPx,
            )
          : []
        return (
          <g key={geom.id}>
            <path
              className="as-lab-board__wire"
              data-wire-id={geom.id}
              data-from-terminal={wire ? terminalKey(wire.from) : undefined}
              data-to-terminal={wire ? terminalKey(wire.to) : undefined}
              data-tap-wire={wire?.tap?.wireId}
              // 3-phase: colour by node phase (Pack 2A); animation is via the legacy
              // arrow markers below (gated on real current), NOT a data-flowing dash.
              // DC: keep the L/N conductor class + directional flow markers unchanged.
              data-conductor={
                protectiveEarth
                  ? 'pe'
                  : phaseClass
                    ? undefined
                    : conductor[geom.id]?.toLowerCase()
              }
              data-phase={
                protectiveEarth
                  ? undefined
                  : phaseClass
                    ? phaseClass[geom.id]?.phase.toLowerCase()
                    : undefined
              }
              data-net={wireNet}
              data-net-color={wireNetColor}
              data-energised={phaseClass ? undefined : flow?.onPath || undefined}
              d={routeToPath(geom.points, hops[geom.id])}
              fill="none"
            />
            {protectiveEarth && (
              <path
                className="as-lab-board__wire-pe-stripe"
                d={routeToPath(geom.points, hops[geom.id])}
                fill="none"
                pointerEvents="none"
              />
            )}
            {markers.map((marker, index) => (
              <path
                key={index}
                className="as-lab-board__arrow"
                data-fault={faulted || undefined}
                data-conductor={
                  protectiveEarth
                    ? 'pe'
                    : phaseClass
                      ? undefined
                      : conductor[geom.id]?.toLowerCase()
                }
                data-phase={
                  protectiveEarth
                    ? undefined
                    : phaseClass
                      ? phaseClass[geom.id]?.phase.toLowerCase()
                      : undefined
                }
                data-net-color={wireNetColor}
                data-signal={sharedWires[geom.id]?.signal}
                d={sharedWires[geom.id]?.signal === 'ac-trace' ? "M -3 0 A 3 3 0 1 0 3 0 A 3 3 0 1 0 -3 0" : "M -3 -3.2 L 4 0 L -3 3.2 Z"}
                transform={`translate(${marker.x} ${marker.y}) rotate(${marker.angle})`}
              />
            ))}
            {eraseMode && (
              <path
                className="as-lab-board__wire-erase"
                d={routeToPath(geom.points)}
                fill="none"
                role="button"
                tabIndex={0}
                aria-label={
                  projection === 'virtual'
                    ? `Hapus kabel ${geom.id}`
                    : `Papan IEC: hapus kabel ${geom.id}`
                }
                onClick={() => onDeleteWire(geom.id)}
                onKeyDown={activateOnKey(() => onDeleteWire(geom.id))}
              />
            )}
            {/* While a terminal is pending, the wire itself is a tap target: click
                it to branch onto its node. Skipped only when the pending terminal
                is already one of this wire's ends (nothing to join). */}
            {pendingTerminal &&
              board.wires[geom.id] &&
              !isPending(board.wires[geom.id].from) &&
              !isPending(board.wires[geom.id].to) && (
                <path
                  className="as-lab-board__wire-tap"
                  d={routeToPath(geom.points, hops[geom.id])}
                  fill="none"
                  role="button"
                  tabIndex={0}
                  aria-label={`Sambungkan ke kabel ${geom.id}${
                    projection === 'iec' ? ' — papan IEC' : ''
                  }`}
                  onClick={(event) => tapWire(geom.id, event.clientX, event.clientY)}
                  onKeyDown={activateOnKey(() => tapWire(geom.id))}
                />
              )}
          </g>
        )
        })}
      </g>

      <g data-layer="junctions">
        {allJunctions.map((junction, index) => (
          <circle
            key={`j${index}`}
            className="as-lab-board__junction"
            cx={junction.x}
            cy={junction.y}
            r={4}
          />
        ))}
      </g>

      {/* Preview wire while pulling from a terminal toward the cursor. */}
      {(() => {
        if (!pendingTerminal || !cursor) return null
        const comp = componentById.get(pendingTerminal.componentId)
        if (!comp) return null
        const from = displayPoint(comp, pendingTerminal.index)
        const preview = simplifyRoute([from, { x: cursor.x, y: from.y }, cursor])
        return (
          <path
            className="as-lab-board__preview"
            d={routeToPath(preview)}
            fill="none"
            pointerEvents="none"
          />
        )
      })()}

      <g data-layer="component-annotations">
        {components.map((component) => renderBreakerAnnotation(component))}
        {components.filter((component) => component.source).map((component) => {
          const centre = footprintCentre(component, projection)
          const bounds = projectionComponentBox(component, projection)
          return <text key={`source-${component.id}`} x={centre.x} y={bounds.minY - 22} textAnchor="middle" fontSize={11} fill="currentColor" pointerEvents="none">
            <title>{component.source?.description} · p.{component.source?.pages.join(', ')}</title>
            {component.id}
          </text>
        })}
      </g>

      <g data-layer="wire-labels">
        {renderGeoms.flatMap((geometry) => {
          const wire = board.wires[geometry.id]
          const net = wire ? netOfTerminal(wire.from) : undefined
          if (!wire || !net) return []
          const color = netColorIndex(net)
          return (wireLabels.get(geometry.id) ?? []).map((placement) => (
            <g
              key={`${geometry.id}-${placement.position}`}
              className="as-lab-board__net-badge as-lab-board__wire-label"
              data-wire-label={geometry.id}
              data-label-position={placement.position}
              data-net={net}
              data-net-color={color}
              data-label-min-x={placement.rect.minX}
              data-label-min-y={placement.rect.minY}
              data-label-max-x={placement.rect.maxX}
              data-label-max-y={placement.rect.maxY}
              data-label-orientation={
                placement.angle === 0 ? 'horizontal' : 'vertical'
              }
              pointerEvents="none"
            >
              <text
                x={placement.point.x}
                y={
                  placement.angle === 0
                    ? placement.point.y + 3
                    : placement.point.y
                }
                textAnchor="middle"
                dominantBaseline={placement.angle === 0 ? undefined : 'middle'}
                style={
                  placement.angle === 0
                    ? undefined
                    : {
                        writingMode: 'vertical-rl',
                        textOrientation: 'upright',
                      }
                }
              >
                {wire.source?.number ?? net}
              </text>
            </g>
          ))
        })}
      </g>

      <g data-layer="terminal-labels">
        {components.flatMap((component) => renderTerminalOverlays(component))}
      </g>

      {/* Erase overlays sit ON TOP so a click deletes rather than toggles/wires. */}
      {eraseMode &&
        components.map((component) => {
          const centre = footprintCentre(component, projection)
          const footprint = componentFootprint(component.spec.kind, projection)
          return (
            <rect
              key={`erase-${component.id}`}
              className="as-lab-board__erase"
              x={centre.x - (footprint.cols * CELL) / 2}
              y={centre.y - (footprint.rows * CELL) / 2}
              width={footprint.cols * CELL}
              height={footprint.rows * CELL}
              role="button"
              tabIndex={0}
              aria-label={
                projection === 'virtual'
                  ? `Hapus ${COMPONENT_LABEL[component.spec.kind]} ${component.id}`
                  : `Papan IEC: hapus ${COMPONENT_LABEL[component.spec.kind]} ${component.id}`
              }
              onClick={() => onDeleteComponent(component.id)}
              onKeyDown={activateOnKey(() => onDeleteComponent(component.id))}
            />
          )
        })}
      </svg>
    </>
  )
}

/**
 * A hidden projection stays mounted so its independent camera position survives,
 * but no simulation tick is allowed to rebuild its large SVG tree. Transitioning
 * either into or out of the active projection always renders once with fresh props.
 */
export function areCircuitBoardPropsEqual(
  previous: CircuitBoardProps,
  next: CircuitBoardProps,
): boolean {
  return previous.active === false && next.active === false
}

export const CircuitBoard = memo(CircuitBoardView, areCircuitBoardPropsEqual)
CircuitBoard.displayName = 'CircuitBoard'
