/**
 * CircuitLabPage — the M0 lab, mounted on the dev-only /internal entry.
 *
 * Composes the palette (place), the board (place + wire + run), the readout (the
 * state BEFORE anything breaks — the current you watch climb), and the diagnose
 * panel (the WHY, after). It owns only interaction intent (which tool is armed,
 * which terminal is pending); all circuit state lives in the engine via the hook.
 */

import {
  Fragment,
  lazy,
  Suspense,
  useCallback,
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type {
  Board,
  BoardProjection,
  BreakerOnePoleSpec,
  BreakerThreePoleSpec,
  Cell,
  McbRatedCurrent,
  NodeStatus,
  Terminal,
  TimerSpec,
} from '../engine/index'
import {
  buildCircuitRuntimeNodes,
  CONTACTOR_TERMINAL,
  emptyBoard,
  formatTimerDuration,
  isMotor3phRunning,
  mcbProtection,
  mcbRatedAmps,
  multifunctionTimerOutputOn,
  MOTOR_3PH_TERMINAL,
  terminalKey,
  TIMER_TRANSFER_OPTIONS_MS,
  timerDurationFromParts,
  timerDurationParts,
  timerPhase,
} from '../engine/index'
import { useCircuitLab } from './state/useCircuitLab'
import {
  CircuitBoard,
  type CircuitBoardViewportMetrics,
} from './board/CircuitBoard'
import { virtualAssetFor } from './board/virtualAssets'
import { useWiringServices } from '../runtime/services'
import { useContentPackAsset, useContentPacks } from '../runtime/assets'
import { IEC_PALETTE, IEC_PALETTE_GROUPS } from './scenario/iecPalette'
import { CIRCUIT_EXAMPLES, EXAMPLE_GROUPS } from './examples/exampleCatalog'
import { GlobalTekPanel } from './GlobalTekPanel'
import { circuitRunRequirements } from '../engine/runRequirements'
import { IecTileSymbol } from './scenario/IecTileSymbol'
import { matchesPaletteSearch } from './scenario/paletteSearch'
import { wiringModelManifest } from './scenario/wiringModelManifest'
import {
  CELL,
  PAD,
  collidingComponentPairs,
  projectionComponentBox,
  footprintCollides,
} from './board/geometry'
import type { Point } from './board/geometry'
import {
  BOARD_ZOOM_MAX,
  BOARD_ZOOM_MIN,
  EMPTY_CAMERA_INSETS,
  fitDownZoom,
  fitZoom,
  spaciousCanvasInsets,
  insetsForExactViewportCentre,
  expandCanvas,
  scrollForContentCentre,
  steppedButtonZoom,
  type CameraInsets,
} from './board/viewportGestures'
import { InitialCameraRequests } from './board/initialCamera'
import { DiagnosePanel } from './diagnose/DiagnosePanel'
import { motorHummingAdvisory } from './diagnose/motorAdvisory'
import { classifyMotorTopology } from './diagnose/topologyClassify'
import { useBackActions, useBack } from '../runtime/back'
import {
  PALETTE,
  PALETTE_CATEGORIES,
  TOPIC_1A_COPY,
  type PaletteItem,
} from './scenario/topic1a'
import './CircuitLab.css'
import { normalizeBoard3DView, panelMoveAllowed, boardExploded, type Board3DView } from '../engine/board3d'
const Board3DPanel = lazy(() => import('./board3d/Board3DPanel'))

const STATUS_TEXT: Record<string, string> = {
  IDLE: 'Siap',
  RUNNING: 'Berjalan',
  PAUSED: 'Dijeda',
  FAULTED: 'Meledak',
}

const KIND_NAME: Record<string, string> = {
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
  INDICATOR: 'lampu indikator',
  SOURCE_3PH: 'sumber 3-fasa',
  MOTOR_3PH: 'motor 3-fasa',
  CONTACTOR: 'kontaktor',
  TIMER: 'timer',
  BREAKER_1P: 'MCB 1-fasa',
  BREAKER_3P: 'MCB 3-fasa',
  GROUND: 'pembumian (PE)',
}

/** MCB rated-current choices for the property dropdown (closed set). */
const MCB_RATINGS: McbRatedCurrent[] = [6, 10, 16, 20, 25, 32, 40, 50, 63]

/** Display-only zoom. Buttons and Ctrl/Cmd+wheel move by an exact ten percentage
 * points; a two-finger gesture may use every value between the limits so it never
 * feels stepped. */
const ZOOM_DEFAULT = 1
const useClientLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function clampZoom(value: number): number {
  return Math.min(BOARD_ZOOM_MAX, Math.max(BOARD_ZOOM_MIN, value))
}

interface ReplaceRequest {
  draggedId: string
  occupantId: string
  cell: Cell
  projection: BoardProjection
}

interface PendingManualFit {
  board: Board
  projection: BoardProjection
  zoom: number
}

export interface CircuitLabPageProps {
  initialBoard?: Board
  variant?: 'arstema' | 'takar'
  onClose?: () => void
  onBoardChange?: (board: Board) => void
  projectSummary?: {
    name: string
    status: string
    saveLabel: string
  }
  onOpenProject?: () => void
  /** false: tuan rumah sudah punya tombol kembali sendiri (situs ARSTEMA, keputusan pemilik 6 Okt 2026). */
  showBack?: boolean
  /** 'fine-pointer': tombol zoom hanya untuk mouse/trackpad; di layar sentuh cubit dua jari sudah memperbesar. */
  zoomControls?: 'always' | 'fine-pointer'
}

/** Mouse atau trackpad, dibaca sekali saat pasang lalu diikuti bila perangkat berganti. */
function pointerFine(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' ? true : window.matchMedia('(pointer: fine)').matches
}

/** Apakah tombol zoom tampil. 'always' selalu; 'fine-pointer' hanya untuk mouse/trackpad. */
export function useZoomControls(mode: 'always' | 'fine-pointer' = 'always'): boolean {
  const [fine, setFine] = useState(pointerFine)
  useEffect(() => {
    if (mode !== 'fine-pointer' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(pointer: fine)')
    setFine(query.matches)
    const change = (event: MediaQueryListEvent) => setFine(event.matches)
    query.addEventListener?.('change', change)
    return () => query.removeEventListener?.('change', change)
  }, [mode])
  return mode !== 'fine-pointer' || fine
}

interface PaletteDrag {
  item: PaletteItem
  x: number
  y: number
}

interface PalettePress {
  item: PaletteItem
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  x: number
  y: number
  active: boolean
  timer: number
  target: HTMLButtonElement
}

interface ProjectionTabsProps {
  active3d: boolean
  on3d(): void
  activeProjection: BoardProjection
  ariaLabel: string
  className?: string
  onChange: (projection: BoardProjection) => void
  virtualAvailable: boolean
}

/**
 * One projection selector rendered in both the board dock and the component
 * drawer. Both instances receive the same state and callback, so the palette
 * face and the visible board can never drift into different projections.
 */
function ProjectionTabs({
  active3d, on3d,
  activeProjection,
  ariaLabel,
  className = '',
  onChange,
  virtualAvailable,
}: ProjectionTabsProps) {
  return (
    <div
      className={`as-lab__board-tabs ${className}`.trim()}
      role="tablist"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        role="tab"
        onClick={() => onChange('virtual')}
        aria-selected={!active3d && activeProjection === 'virtual'}
        title={virtualAvailable ? 'Tampilkan papan virtual' : 'Unduh paket Papan Virtual'}
      >
        {virtualAvailable ? 'Papan Virtual' : 'Papan Virtual · Unduh'}
      </button>
      <button
        type="button"
        role="tab"
        onClick={() => onChange('iec')}
        aria-selected={!active3d && activeProjection === 'iec'}
        title="Tampilkan diagram IEC 60617"
      >
        Diagram IEC 60617
      </button>
      <button type="button" role="tab" aria-selected={active3d} onClick={on3d}>Papan 3D</button>
    </div>
  )
}

function PackedPaletteImage({ path }: { path: string }) {
  const host=useRef<HTMLSpanElement>(null),[visible,setVisible]=useState(false)
  useEffect(()=>{if(typeof IntersectionObserver==='undefined'){setVisible(true);return}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){setVisible(true);observer.disconnect()}});if(host.current)observer.observe(host.current);return()=>observer.disconnect()},[])
  const src = useContentPackAsset('wiring-virtual', visible ? path : undefined)
  return <span ref={host}>{src ? <img alt="" className="as-lab__tool-photo" src={src} /> : <span aria-hidden="true">▧</span>}</span>
}

export function CircuitLabPage({
  initialBoard,
  variant = 'arstema',
  onClose,
  onBoardChange,
  projectSummary,
  onOpenProject,
  showBack = true,
  zoomControls = 'always',
}: CircuitLabPageProps) {
  const takar = variant === 'takar'
  const zoomVisible = useZoomControls(zoomControls)
  const exampleInputId=useId()
  const { progress: contentPackProgress } = useContentPacks()
  const {captureBackEditor,dispatchBack}=useBackActions()
  const runtime=useWiringServices()
  const requestContentPackDownload=(ids:readonly string[])=>runtime.assets.requestDownload(ids).catch(error=>{runtime.onError(error);return false;})
  const virtualInstalled = runtime.assets.delivery === 'automatic' || contentPackProgress.get('wiring-virtual')?.state === 'installed'
  const animationInstalled = contentPackProgress.get('wiring-animation')?.state === 'installed'
  const lab = useCircuitLab(initialBoard)
  const { state } = lab
  const savedViewRef = useRef(initialBoard?.view)
  const [active3d, setActive3d] = useState(initialBoard?.view?.active3d ?? false)
  const [threeView, setThreeView] = useState(() => normalizeBoard3DView(initialBoard?.view?.three))
  const [threeEpoch, setThreeEpoch] = useState(0)
  const structuralLocked = boardExploded(state.board, threeView) || state.status === 'RUNNING'
  lab.setStructuralLocked(structuralLocked)
  useEffect(() => {
    if(active3d && Object.values(state.board.components).some(c=>!c.panel3d && !state.board.view?.three?.placements?.[c.id])) lab.initialize3d()
    const placements = state.board.view?.three?.placements
    if (placements) setThreeView(v => v.placements === placements ? v : { ...v, placements })
  }, [active3d,state.board])
  const restoreViewRef = useRef(new Set<BoardProjection>(Object.keys(initialBoard?.view?.cameras ?? {}) as BoardProjection[]))
  const [armedTool, setArmedTool] = useState<PaletteItem | null>(null)
  const [pending, setPending] = useState<Terminal | null>(null)
  const [eraseMode, setEraseMode] = useState(false)
  const [replaceRequest, setReplaceRequest] = useState<ReplaceRequest | null>(null)
  // --- M3-UX1 workspace UI state (no electrical meaning) --------------------
  // Either vocabulary: the field palette's categories or the IEC palette's
  // drawing groups. Switching board resets it, since the words differ.
  const [category, setCategory] = useState<string>('Semua')
  const [focusMode, setFocusMode] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteDrag, setPaletteDrag] = useState<PaletteDrag | null>(null)
  const [introOpen, setIntroOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(!takar)
  // The component whose full description a touch user has opened (info button).
  const [infoItem, setInfoItem] = useState<PaletteItem | null>(null)
  // Tapping a configurable component opens its product-accurate property panel.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // --- P1-C view zoom (display only) ---------------------------------------
  const [zoom, setZoom] = useState(() => Math.max(BOARD_ZOOM_MIN, Math.min(BOARD_ZOOM_MAX, initialBoard?.view?.zoom || ZOOM_DEFAULT)))
  // Installed-pack discovery is asynchronous. Do not overwrite a saved Virtual
  // choice with IEC during that initial metadata-loading frame.
  const [activeProjection, setActiveProjection] = useState<BoardProjection>(() => initialBoard?.view?.projection === 'virtual' ? 'virtual' : 'iec')
  const [sourceOpen, setSourceOpen] = useState(initialBoard?.view?.sourceOpen ?? false)
  // Do not construct both heavy SVG/router trees on first open. A projection is
  // mounted only after the learner visits it, then kept mounted so its independent
  // scroll/gesture state survives later tab switches. This is especially important
  // for the automatic STAR–DELTA example, whose two-pass common-net routing is large.
  const mountedProjectionsRef = useRef(new Set<BoardProjection>([activeProjection]))
  // Which worked example is on the board, so the hint line can describe it.
  const [exampleKey, setExampleKey] = useState<string>(() => initialBoard?.reference?.templateId ?? '')
  const virtualWrapRef = useRef<HTMLDivElement | null>(null)
  const iecWrapRef = useRef<HTMLDivElement | null>(null)
  const [cameraInsets, setCameraInsets] = useState<Record<BoardProjection, CameraInsets>>({
    virtual: initialBoard?.view?.cameras.virtual?.insets ?? { ...EMPTY_CAMERA_INSETS },
    iec: initialBoard?.view?.cameras.iec?.insets ?? { ...EMPTY_CAMERA_INSETS },
  })
  const cameraInsetsRef = useRef(cameraInsets)
  const zoomRef = useRef(zoom)
  const pendingPinchZoomRef = useRef(zoom)
  const currentBoardRef = useRef(state.board)
  const latestViewportMetricsRef = useRef(
    new Map<BoardProjection, CircuitBoardViewportMetrics>(),
  )
  const pendingInitialCameraRef = useRef<InitialCameraRequests<Board> | null>(null)
  const pendingManualFitRef = useRef<PendingManualFit | null>(null)
  const cameraFrameRef = useRef(new Map<BoardProjection, number>())
  // Virtual is lazy-mounted. Its request remains dormant until the first visit,
  // without constructing the expensive hidden tree at startup.
  if (!pendingInitialCameraRef.current) {
    pendingInitialCameraRef.current = new InitialCameraRequests(state.board)
  }
  zoomRef.current = zoom
  currentBoardRef.current = state.board
  cameraInsetsRef.current = cameraInsets
  const saveView = useCallback((projection?: BoardProjection, element?: HTMLDivElement) => {
    const cameras = { ...savedViewRef.current?.cameras }
    if (projection && element && !restoreViewRef.current.has(projection)) {
      cameras[projection] = { x: element.scrollLeft, y: element.scrollTop, insets: cameraInsetsRef.current[projection] }
    }
    savedViewRef.current = { ...savedViewRef.current, zoom: zoomRef.current, projection: activeProjection, sourceOpen, cameras, active3d, three: threeView }
    onBoardChange?.({ ...currentBoardRef.current, view: savedViewRef.current })
  }, [activeProjection, sourceOpen, onBoardChange, active3d, threeView])
  const sceneGeneration = useRef(0)
  const saveThreeView = useCallback((view: Board3DView, generation = sceneGeneration.current) => {
    if (generation !== sceneGeneration.current) return
    setThreeView(view)
    const saved = { zoom: zoomRef.current, projection: activeProjection, cameras: {}, ...savedViewRef.current, active3d, three: view }
    savedViewRef.current = saved
    onBoardChange?.({ ...currentBoardRef.current, view: saved })
  }, [onBoardChange, active3d, activeProjection])
  useEffect(() => { saveView() }, [state.board, zoom, activeProjection, saveView])
  const paletteDragRef = useRef<PalettePress | null>(null)
  const suppressPaletteClickRef = useRef(false)

  useBack(60, () => {
    if (!takar) return false
    if (replaceRequest) {
      setReplaceRequest(null)
      return true
    }
    if (infoItem) {
      setInfoItem(null)
      return true
    }
    if (paletteOpen) {
      setPaletteOpen(false)
      return true
    }
    if (statusOpen) {
      setStatusOpen(false)
      return true
    }
    return false
  })
  // Bug 2 camera: the measured workspace size drives how much grid the board shows so
  // `extent × zoom` fills the workspace on zoom-out (native scroll pans a larger
  // circuit) — never a shrunken thumbnail. Headless (no ResizeObserver) stays {0,0} →
  // the board falls back to its logical 12×8 floor, so nothing in tests depends on layout.
  const [viewport, setViewport] = useState({ vw: 0, vh: 0 })
  // useLayoutEffect + a ResizeObserver AND a window-resize fallback: measure synchronously
  // before paint and on every size change, so the grid always grows to fill the workspace
  // (a stale/narrow measurement is what leaves the board only partly gridded). The
  // functional update skips no-op renders. Headless (no ResizeObserver, clientWidth 0) →
  // {0,0} → the logical 12×8 floor, so tests stay layout-free.
  useClientLayoutEffect(() => {
    const wraps = [virtualWrapRef.current, iecWrapRef.current].filter(
      (wrap): wrap is HTMLDivElement => Boolean(wrap),
    )
    if (wraps.length === 0) return
    const measure = () =>
      setViewport((prev) => {
        const vw = Math.max(...wraps.map((wrap) => wrap.clientWidth))
        const vh = Math.max(...wraps.map((wrap) => wrap.clientHeight))
        return prev.vw === vw && prev.vh === vh ? prev : { vw, vh }
      })
    measure()
    // ResizeObserver may fire while React is rendering the heavy SVG child. Queue
    // the state update to the next frame so layout measurement never updates the
    // parent in the middle of CircuitBoard render.
    let measureFrame = 0
    const scheduleMeasure = () => {
      if (measureFrame) cancelAnimationFrame(measureFrame)
      measureFrame = requestAnimationFrame(() => {
        measureFrame = 0
        measure()
      })
    }
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleMeasure) : null
    for (const wrap of wraps) observer?.observe(wrap)
    window.addEventListener('resize', scheduleMeasure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', scheduleMeasure)
      if (measureFrame) cancelAnimationFrame(measureFrame)
    }
  }, [])

  const cancelCameraFrame = useCallback((projection: BoardProjection) => {
    const frame = cameraFrameRef.current.get(projection)
    if (frame) cancelAnimationFrame(frame)
    cameraFrameRef.current.delete(projection)
  }, [])

  /** User pan/zoom always wins. Structural edits deliberately do not call this and
   * also do not request a new centre, so adding/moving a component cannot make the
   * canvas jump. */
  const cancelPendingCamera = useCallback((projection: BoardProjection) => {
    restoreViewRef.current.delete(projection)
    pendingInitialCameraRef.current?.cancel(projection)
    if (pendingManualFitRef.current?.projection === projection) {
      pendingManualFitRef.current = null
    }
    cancelCameraFrame(projection)
  }, [cancelCameraFrame])

  const zoomAnchors = useRef(new Map<BoardProjection, { x: number; y: number; zoom: number }>())
  // Keep the same absolute board point at the viewport centre even when zooming
  // changes the viewBox origin or requires leading room at a distant scale.
  const changeZoom = useCallback((nextZoom: number) => {
    const clamped = clampZoom(nextZoom)
    const previous = zoomRef.current
    if (Math.abs(clamped - previous) < 1e-9) return
    for (const projection of ['virtual', 'iec'] as const) {
      const wrap = projection === 'virtual' ? virtualWrapRef.current : iecWrapRef.current
      const metrics = latestViewportMetricsRef.current.get(projection)
      if (!wrap || !metrics || !wrap.clientWidth) continue
      zoomAnchors.current.set(projection, {
        x: metrics.extent.x + (wrap.scrollLeft + wrap.clientWidth / 2) / previous,
        y: metrics.extent.y + (wrap.scrollTop + wrap.clientHeight / 2) / previous,
        zoom: clamped,
      })
    }
    zoomRef.current = clamped
    setZoom(clamped)
  }, [])

  const changeZoomByStep = useCallback(
    (direction: -1 | 1) => {
      cancelPendingCamera(activeProjection)
      changeZoom(steppedButtonZoom(zoomRef.current, direction))
    },
    [activeProjection, cancelPendingCamera, changeZoom],
  )

  const changeZoomByPinch = useCallback((nextZoom: number) => {
    cancelPendingCamera(activeProjection)
    const clamped = clampZoom(nextZoom)
    if (Math.abs(clamped - zoomRef.current) < 1e-9) return
    zoomRef.current = clamped
    pendingPinchZoomRef.current = clamped
    // CircuitBoard invokes this once at the end of its compositor-only preview.
    // Commit in this same turn: an extra rAF here used to leave one stale SVG frame
    // between the preview transform and the settled scroll position on Android.
    setZoom(clamped)
  }, [activeProjection, cancelPendingCamera])

  useEffect(
    () => () => {
      for (const frame of cameraFrameRef.current.values()) cancelAnimationFrame(frame)
      cameraFrameRef.current.clear()
    },
    [],
  )

  // Ctrl/Cmd + wheel zooms — ONLY over the workspace, and preventDefault stops the
  // browser's own page zoom. A plain wheel scrolls the wrapper as usual.
  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      event.preventDefault()
      changeZoomByStep(event.deltaY < 0 ? 1 : -1)
    }
    const wraps = [virtualWrapRef.current, iecWrapRef.current].filter(
      (wrap): wrap is HTMLDivElement => Boolean(wrap),
    )
    for (const wrap of wraps) wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      for (const wrap of wraps) wrap.removeEventListener('wheel', onWheel)
    }
  }, [changeZoomByStep])

  /*
   * Scroll synchronisation between the two projections was REMOVED on the
   * owner's decision: the virtual board and the IEC board are read as separate
   * workspaces, and mirroring one pane's scroll into the other coupled two
   * layouts that have different footprints and therefore different natural
   * scroll extents. Each pane now keeps its own scroll position.
   *
   * The refs stay — zoom and viewport measurement still read both wrappers.
   * Nothing about wiring, geometry, the palette or the solver changed.
   */

  const wrapForProjection = useCallback((projection: BoardProjection) =>
    projection === 'virtual' ? virtualWrapRef.current : iecWrapRef.current, [])

  // Owner-defined centre: the literal intersection of the viewport's horizontal
  // and vertical axes. Overlay docks do not redefine this mathematical point.
  const viewportAxesFor = useCallback((wrap: HTMLDivElement) => ({
    left: 0,
    top: 0,
    right: wrap.clientWidth,
    bottom: wrap.clientHeight,
  }), [])

  const setProjectionCameraInsets = useCallback((
    projection: BoardProjection,
    next: CameraInsets,
  ): boolean => {
    const current = cameraInsetsRef.current[projection]
    const unchanged =
      Math.abs(current.left - next.left) < 0.01 &&
      Math.abs(current.top - next.top) < 0.01 &&
      Math.abs(current.right - next.right) < 0.01 &&
      Math.abs(current.bottom - next.bottom) < 0.01
    if (unchanged) return false
    const updated = { ...cameraInsetsRef.current, [projection]: next }
    cameraInsetsRef.current = updated
    setCameraInsets(updated)
    return true
  }, [])

  const prepareExactCentre = useCallback((
    metrics: CircuitBoardViewportMetrics,
    wrap: HTMLDivElement,
  ): boolean => {
    const next = spaciousCanvasInsets(
      metrics.contentBounds,
      metrics.baseExtent,
      metrics.zoom,
      wrap.clientWidth,
      wrap.clientHeight,
      cameraInsetsRef.current[metrics.projection],
    )
    return !setProjectionCameraInsets(metrics.projection, next)
  }, [setProjectionCameraInsets])

  const expandWorkspace = useCallback(() => {
    const projection = activeProjection
    const wrap = wrapForProjection(projection)
    if (!wrap) return
    cancelPendingCamera(projection)
    const expanded = expandCanvas(cameraInsetsRef.current[projection], zoomRef.current,
      wrap.clientWidth, wrap.clientHeight, { x: wrap.scrollLeft, y: wrap.scrollTop })
    setProjectionCameraInsets(projection, expanded.insets)
    cancelCameraFrame(projection)
    cameraFrameRef.current.set(projection, requestAnimationFrame(() => {
      cameraFrameRef.current.delete(projection)
      wrap.scrollLeft = expanded.scroll.x
      wrap.scrollTop = expanded.scroll.y
      saveView(projection, wrap)
    }))
  }, [activeProjection, wrapForProjection, cancelPendingCamera,
    setProjectionCameraInsets, cancelCameraFrame, saveView])

  const applyCameraScroll = useCallback((
    metrics: CircuitBoardViewportMetrics,
    onApplied?: () => void,
  ) => {
    const wrap = wrapForProjection(metrics.projection)
    if (!wrap || wrap.clientWidth <= 0 || wrap.clientHeight <= 0) return false
    cancelCameraFrame(metrics.projection)
    const frame = requestAnimationFrame(() => {
      cameraFrameRef.current.delete(metrics.projection)
      const current = latestViewportMetricsRef.current.get(metrics.projection)
      if (!current || current.board !== metrics.board) return
      const activeWrap = wrapForProjection(metrics.projection)
      if (!activeWrap || activeWrap.clientWidth <= 0 || activeWrap.clientHeight <= 0) return
      const viewportAxes = viewportAxesFor(activeWrap)
      const scroll = scrollForContentCentre(
        current.contentBounds,
        current.extent,
        zoomRef.current,
        viewportAxes,
        activeWrap.clientWidth,
        activeWrap.clientHeight,
        activeWrap.scrollWidth,
        activeWrap.scrollHeight,
      )
      activeWrap.scrollLeft = scroll.x
      activeWrap.scrollTop = scroll.y
      onApplied?.()
    })
    cameraFrameRef.current.set(metrics.projection, frame)
    return true
  }, [cancelCameraFrame, viewportAxesFor, wrapForProjection])

  const handleViewportMetrics = useCallback((metrics: CircuitBoardViewportMetrics) => {
    if (metrics.board !== currentBoardRef.current) return
    latestViewportMetricsRef.current.set(metrics.projection, metrics)
    const wrap = wrapForProjection(metrics.projection)
    if (!wrap || wrap.clientWidth <= 0 || wrap.clientHeight <= 0) return

    const anchor = zoomAnchors.current.get(metrics.projection)
    if (anchor && Math.abs(anchor.zoom - metrics.zoom) < 1e-9) {
      const bounds = { minX: anchor.x, maxX: anchor.x, minY: anchor.y, maxY: anchor.y }
      const insets = insetsForExactViewportCentre(bounds, metrics.baseExtent, metrics.zoom, wrap.clientWidth, wrap.clientHeight)
      if (setProjectionCameraInsets(metrics.projection, insets)) return
      const scroll = scrollForContentCentre(bounds, metrics.extent, metrics.zoom,
        viewportAxesFor(wrap), wrap.clientWidth, wrap.clientHeight, wrap.scrollWidth, wrap.scrollHeight)
      wrap.scrollLeft = scroll.x
      wrap.scrollTop = scroll.y
      zoomAnchors.current.delete(metrics.projection)
      return
    }

    const savedCamera = savedViewRef.current?.cameras[metrics.projection]
    if (restoreViewRef.current.has(metrics.projection) && savedCamera) {
      pendingInitialCameraRef.current?.cancel(metrics.projection)
      wrap.scrollLeft = savedCamera.x
      wrap.scrollTop = savedCamera.y
      // Routes may enlarge the canvas. Restore once more when they are final.
      if (metrics.routingReady) restoreViewRef.current.delete(metrics.projection)
      return
    }

    const manual = pendingManualFitRef.current
    if (
      manual &&
      manual.board === metrics.board &&
      manual.projection === metrics.projection
    ) {
      if (Math.abs(metrics.zoom - manual.zoom) > 1e-9) return
      if (!prepareExactCentre(metrics, wrap)) return
      applyCameraScroll(metrics, () => {
        if (pendingManualFitRef.current === manual) pendingManualFitRef.current = null
      })
      return
    }

    const pending = pendingInitialCameraRef.current?.pending(
      metrics.projection,
      metrics.board,
    )
    if (!pending) return
    // A first component-only pass makes the board useful immediately. A second,
    // one-time pass uses final worker routes. The second pass is cancelled as soon
    // as the learner pans/touches/zooms the board.
    if (pending.provisionalApplied && !metrics.routingReady) return
    const viewportAxes = viewportAxesFor(wrap)
    const fitted = fitDownZoom(
      metrics.contentBounds,
      viewportAxes,
      BOARD_ZOOM_MIN,
      Math.min(1, zoomRef.current),
    )
    if (Math.abs(metrics.zoom - fitted) > 1e-9) {
      zoomRef.current = fitted
      pendingPinchZoomRef.current = fitted
      setZoom(fitted)
      return
    }
    if (!prepareExactCentre(metrics, wrap)) return
    applyCameraScroll(metrics, () => {
      pendingInitialCameraRef.current?.applied(
        metrics.projection,
        pending,
        metrics.routingReady,
      )
    })
  }, [applyCameraScroll, prepareExactCentre, viewportAxesFor, wrapForProjection, setProjectionCameraInsets])

  // Child layout effects can report metrics before the wrapper ref is attached.
  // Replay after parent commit; do not wait for the (possibly large) routing job.
  useClientLayoutEffect(() => {
    const metrics = latestViewportMetricsRef.current.get(activeProjection)
    if (metrics) handleViewportMetrics(metrics)
  }, [activeProjection, handleViewportMetrics, viewport.vw, viewport.vh])

  const jumpToSourceArea = (id: string) => {
    const component=state.board.components[id]
    const metrics=latestViewportMetricsRef.current.get(activeProjection)
    const wrap=wrapForProjection(activeProjection)
    if(!component || !metrics || !wrap) return
    cancelPendingCamera(activeProjection)
    const scroll=scrollForContentCentre(projectionComponentBox(component,activeProjection),metrics.extent,zoomRef.current,
      viewportAxesFor(wrap),wrap.clientWidth,wrap.clientHeight,wrap.scrollWidth,wrap.scrollHeight)
    wrap.scrollLeft=scroll.x;wrap.scrollTop=scroll.y
    saveView(activeProjection,wrap)
  }

  const requestInitialCamera = useCallback((board: Board) => {
    sceneGeneration.current++
    setThreeView(normalizeBoard3DView(board.view?.three))
    setThreeEpoch(n=>n+1)
    savedViewRef.current = undefined
    restoreViewRef.current.clear()
    pendingManualFitRef.current = null
    latestViewportMetricsRef.current.clear()
    const clearedInsets = {
      virtual: { ...EMPTY_CAMERA_INSETS },
      iec: { ...EMPTY_CAMERA_INSETS },
    }
    cameraInsetsRef.current = clearedInsets
    setCameraInsets(clearedInsets)
    for (const projection of ['iec', 'virtual'] as const) {
      cancelCameraFrame(projection)
      pendingInitialCameraRef.current?.request(projection, board)
    }
    zoomRef.current = ZOOM_DEFAULT
    pendingPinchZoomRef.current = ZOOM_DEFAULT
    setZoom(ZOOM_DEFAULT)
  }, [cancelCameraFrame])

  const fitViewportToCircuit = useCallback(() => {
    cancelPendingCamera(activeProjection)
    const metrics = latestViewportMetricsRef.current.get(activeProjection)
    const wrap = wrapForProjection(activeProjection)
    if (!metrics || metrics.board !== state.board || !wrap || wrap.clientWidth <= 0) return
    const fitted = clampZoom(fitZoom(metrics.contentBounds, viewportAxesFor(wrap)))
    const request: PendingManualFit = {
      board: state.board,
      projection: activeProjection,
      zoom: fitted,
    }
    pendingManualFitRef.current = request
    if (Math.abs(zoomRef.current - fitted) > 1e-9) {
      zoomRef.current = fitted
      pendingPinchZoomRef.current = fitted
      setZoom(fitted)
      return
    }
    if (!prepareExactCentre(metrics, wrap)) return
    applyCameraScroll(metrics, () => {
      if (pendingManualFitRef.current === request) pendingManualFitRef.current = null
    })
  }, [
    activeProjection,
    applyCameraScroll,
    cancelPendingCamera,
    prepareExactCentre,
    state.board,
    viewportAxesFor,
    wrapForProjection,
  ])

  const running = state.status === 'RUNNING'
  const faulted = state.status === 'FAULTED'

  /*
   * The two boards no longer share a component list. The field palette keeps
   * its shopping categories and its photographs; the IEC palette carries
   * reference designations (QF, KM, FR, …) and is filed the way a schematic is
   * organised — supply, protection, power circuit, control circuit, earth.
   *
   * Only the FACE and the filing differ: both lists place the same `spec`, so
   * the board model, the wiring rules and the solver see one component set.
   */
  const activeExample = CIRCUIT_EXAMPLES.find((item) => item.key === exampleKey) ?? null
  const iecBoard = !active3d && activeProjection === 'iec'
  const paletteSource = iecBoard ? IEC_PALETTE : PALETTE
  const paletteChips = iecBoard ? IEC_PALETTE_GROUPS : PALETTE_CATEGORIES
  const visiblePalette = paletteSource.filter((item) => {
    const inCategory =
      category === 'Semua' || ('group' in item ? item.group === category : item.category === category)
    return inCategory && matchesPaletteSearch(item, paletteQuery)
  })

  const selectProjection = useCallback((projection: BoardProjection) => {
    setActive3d(false)
    if (projection === 'virtual' && !virtualInstalled) {
      void requestContentPackDownload(['wiring-virtual'])
    }
    const firstVisit = !mountedProjectionsRef.current.has(projection)
    if (firstVisit) {
      cancelCameraFrame(projection)
      latestViewportMetricsRef.current.delete(projection)
      pendingInitialCameraRef.current?.request(projection, state.board)
    }
    mountedProjectionsRef.current.add(projection)
    setActiveProjection(projection)
    // The Virtual and IEC palettes use different category vocabularies. Keep
    // the selected component/tool intact, but return the list to a valid common
    // category so switching views never produces an apparently empty drawer.
    setCategory('Semua')
  }, [cancelCameraFrame, state.board, virtualInstalled])

  // Missing optional media does not erase the user's projection or block editing.

  // Keyboard: Esc has a fixed PRIORITY — cancel wiring first (existing behaviour);
  // only when nothing is being wired does Esc exit focus mode (L-2). Ctrl+Z undo,
  // Ctrl+Y / Ctrl+Shift+Z redo.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if(!runtime.active||!runtime.ownsEvent(event))return
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName))) return
      if (event.key === 'Escape') {
        if (pending !== null || replaceRequest !== null) {
          setPending(null)
          setReplaceRequest(null)
          return
        }
        if (focusMode) setFocusMode(false)
        return
      }
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase()
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault()
          lab.undo()
        } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
          event.preventDefault()
          lab.redo()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lab, pending, replaceRequest, focusMode,runtime])

  const source = Object.values(state.board.components).find(
    (component) => component.spec.kind === 'SOURCE',
  )
  const sourceVolts =
    source && source.spec.kind === 'SOURCE' ? source.spec.emfVolts : null
  // Every supply on the board, not only the first (L3): "400 V 3~ · 24 V".
  const sourceVoltsText =
    Object.values(state.board.components)
      .flatMap(({ spec }) =>
        spec.kind === 'SOURCE_3PH'
          ? [`${spec.vLineToLineVolts} V 3~`]
          : spec.kind === 'SOURCE' && !spec.transformer
            ? [`${spec.emfVolts} V`]
            : [],
      )
      .join(' · ') || '—'
  const lamps = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'LOAD',
  )
  const motors = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'MOTOR',
  )
  // Live status from the ramped current: idle until powered, then running (if a
  // capacitor lets it start) or humming.
  const motorLiveStatus = (id: string): 'diam' | 'berputar' | 'berdengung' => {
    if ((state.display.loadCurrent[id] ?? 0) < 0.05) return 'diam'
    return state.solution.motorRunning[id] ? 'berputar' : 'berdengung'
  }
  const hummingMotor = motors.some(
    (motor) => motorLiveStatus(motor.id) === 'berdengung',
  )
  const relays = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'RELAY',
  )
  const indicators = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'INDICATOR',
  )
  // --- M3-B3 three-phase readout (read-only) ---------------------------------
  const contactors = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'CONTACTOR',
  )
  const motors3 = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'MOTOR_3PH',
  )
  const mcbs = Object.values(state.board.components).filter(
    (component) =>
      component.spec.kind === 'BREAKER_1P' || component.spec.kind === 'BREAKER_3P',
  )
  const timers = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'TIMER',
  )
  const overloads = Object.values(state.board.components).filter(
    (component) => component.spec.kind === 'OVERLOAD_RELAY',
  )
  // The node VOLTAGES + referencing status ride on state.threePhase; only the
  // terminal→node map is not threaded, so rebuild the (pure, matrix-free) topology
  // to key into it. This distinguishes "0 V RESOLVED" from "indeterminate/floating"
  // by STATUS, never by the number alone. No solve, no mutation.
  const tp = state.threePhase
  const acNodes = tp ? buildCircuitRuntimeNodes(state) : null
  const nodeStatusOf = (componentId: string, index: number): NodeStatus | undefined => {
    if (!tp || !acNodes) return undefined
    const node = acNodes.nodeOf.get(terminalKey({ componentId, index }))
    return node ? tp.nodeVoltage[node]?.status : undefined
  }
  const windingAmps = (motorId: string, local: number): number => {
    const current = tp?.branchCurrentPhasor[`${motorId}#${local}`]
    return current ? Math.hypot(current.re, current.im) : 0
  }

  function selectTool(item: PaletteItem) {
    setPending(null)
    setEraseMode(false)
    setSelectedId(null)
    setArmedTool((current) => (current?.key === item.key ? null : item))
  }

  function cancelPalettePress() {
    const drag = paletteDragRef.current
    if (!drag) return
    window.clearTimeout(drag.timer)
    if (drag.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId)
    }
    paletteDragRef.current = null
    setPaletteDrag(null)
  }

  useEffect(() => cancelPalettePress, [])

  function activatePalettePress(drag: PalettePress) {
    if (paletteDragRef.current !== drag || drag.active) return
    drag.active = true
    suppressPaletteClickRef.current = true
    try {
      drag.target.setPointerCapture(drag.pointerId)
    } catch {
      // Pointer capture is an enhancement; the click-to-place path still works.
    }
    setArmedTool(null)
    setEraseMode(false)
    setPaletteOpen(false)
    setPaletteDrag({ item: drag.item, x: drag.x, y: drag.y })
  }

  function beginPalettePress(item: PaletteItem, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || running) return
    cancelPalettePress()
    const target = event.currentTarget
    const drag = {
      item,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
      timer: 0,
      target,
    }
    if (event.pointerType === 'touch') {
      drag.timer = window.setTimeout(() => activatePalettePress(drag), 220)
    } else {
      try {
        target.setPointerCapture(drag.pointerId)
      } catch {
        // Moving outside the tile may end the drag on older WebViews.
      }
    }
    paletteDragRef.current = drag
  }

  function movePalettePress(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = paletteDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.x = event.clientX
    drag.y = event.clientY
    if (!drag.active) {
      const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY)
      if (drag.pointerType === 'touch') {
        if (distance > 10) cancelPalettePress()
        return
      }
      if (distance < 6) return
      activatePalettePress(drag)
    }
    if (!drag.active) return
    event.preventDefault()
    setPaletteDrag({ item: drag.item, x: drag.x, y: drag.y })
  }

  function dropPaletteItem(item: PaletteItem, clientX: number, clientY: number) {
    const wrap =
      activeProjection === 'virtual' ? virtualWrapRef.current : iecWrapRef.current
    if (!wrap) return
    const svg = wrap.querySelector<SVGSVGElement>('svg.as-lab-board')
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const viewBox = svg.viewBox.baseVal
    if (
      rect.width <= 0 ||
      rect.height <= 0 ||
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return
    }
    const boardX = viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width
    const boardY = viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height
    const cell = {
      x: Math.floor((boardX - PAD) / CELL),
      y: Math.floor((boardY - PAD) / CELL),
    }
    if (
      cell.x < 0 ||
      cell.y < 0 ||
      footprintCollides(state.board, item.spec.kind, cell, undefined, activeProjection)
    ) {
      return
    }
    lab.place(item.spec, cell, item.key)
    setPaletteOpen(false)
  }

  function finishPalettePress(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = paletteDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    window.clearTimeout(drag.timer)
    if (drag.active) {
      event.preventDefault()
      dropPaletteItem(drag.item, event.clientX, event.clientY)
    }
    cancelPalettePress()
  }

  function handlePaletteClick(item: PaletteItem) {
    if (suppressPaletteClickRef.current) {
      suppressPaletteClickRef.current = false
      return
    }
    selectTool(item)
    if (takar) setPaletteOpen(false)
  }

  function handleSelectComponent(id: string) {
    setArmedTool(null)
    // The 3D inspector must be able to select the destination component
    // without discarding the first terminal of an in-progress connection.
    if (!active3d || threeView.mode !== 'wire') setPending(null)
    setSelectedId(id)
    setStatusOpen(!active3d)
  }

  const selectedComponent = selectedId ? state.board.components[selectedId] : undefined
  const selectedMcbSpec: BreakerOnePoleSpec | BreakerThreePoleSpec | undefined =
    selectedComponent &&
    (selectedComponent.spec.kind === 'BREAKER_1P' || selectedComponent.spec.kind === 'BREAKER_3P')
      ? selectedComponent.spec
      : undefined
  const selectedTimerSpec: TimerSpec | undefined =
    selectedComponent?.spec.kind === 'TIMER' ? selectedComponent.spec : undefined
  const selectedTimerStar = selectedTimerSpec
    ? timerDurationParts(selectedTimerSpec.starDurationMs)
    : undefined

  function setSelectedTimerPart(
    part: 'minutes' | 'seconds',
    rawValue: number,
  ) {
    if (!selectedComponent || !selectedTimerSpec || !selectedTimerStar) {
      return
    }
    const star = { ...selectedTimerStar }
    star[part] = rawValue
    lab.setTimerTiming(
      selectedComponent.id,
      timerDurationFromParts(star.minutes, star.seconds),
      selectedTimerSpec.transitionDelayMs,
    )
  }

  function setSelectedTimerTransfer(transitionDelayMs: number) {
    if (!selectedComponent || !selectedTimerSpec) return
    lab.setTimerTiming(
      selectedComponent.id,
      selectedTimerSpec.starDurationMs,
      transitionDelayMs,
    )
  }

  function toggleErase() {
    setArmedTool(null)
    setPending(null)
    setEraseMode((current) => !current)
  }

  function handlePlaceCell(cell: Cell) {
    if (!armedTool) return
    if (footprintCollides(state.board, armedTool.spec.kind, cell, undefined, activeProjection)) return
    lab.place(armedTool.spec, cell, armedTool.key)
    setArmedTool(null)
  }

  function confirmReplace() {
    if (replaceRequest) {
      lab.replace(
        replaceRequest.draggedId,
        replaceRequest.occupantId,
        replaceRequest.cell,
        replaceRequest.projection,
      )
    }
    setReplaceRequest(null)
  }

  const kindName = (id: string) => {
    const component = state.board.components[id]
    return component ? (KIND_NAME[component.spec.kind] ?? 'komponen') : 'komponen'
  }

  function handleDeleteComponent(id: string) {
    lab.removeComponent(id)
  }

  function handleDeleteWire(id: string) {
    lab.disconnect(id)
  }

  function handleTerminalClick(terminal: Terminal) {
    setArmedTool(null)
    if (!pending) {
      setPending(terminal)
      return
    }
    if (
      pending.componentId === terminal.componentId &&
      pending.index === terminal.index
    ) {
      setPending(null)
      return
    }
    lab.connect(pending, terminal)
    setPending(null)
  }

  // Tap the pending terminal onto an existing wire's LINE (mid-span). Electrically
  // this unions the pending terminal with the wire's node (via `anchor`, one of its
  // terminals); `near` records where on the line to draw the new wire's end.
  function handleTapWire(
    projection: BoardProjection,
    targetWireId: string,
    anchor: Terminal,
    position: number,
    near: Point,
  ) {
    setArmedTool(null)
    if (!pending) return
    lab.connect(pending, anchor, {
      wireId: targetWireId,
      projectionPositions: { [projection]: position },
      near,
    })
    setPending(null)
  }

  function clearBoard() {
    setArmedTool(null)
    setPending(null)
    setSelectedId(null)
    const board = emptyBoard()
    requestInitialCamera(board)
    lab.loadBoard(board)
  }

  const guidance = eraseMode
    ? 'Mode hapus: klik komponen atau kabel untuk menghapusnya. Klik "Hapus" lagi untuk berhenti.'
    : armedTool
      ? `Klik sel kosong untuk meletakkan ${armedTool.label}.`
      : pending
        ? 'Pilih terminal kedua untuk menyambung kabel — atau klik terminal yang sama untuk batal.'
        : 'Pilih komponen lalu klik papan, atau sambungkan dua terminal dengan mengeklik keduanya.'
  const layoutCollisions = collidingComponentPairs(state.board, activeProjection)

  return (
    <div
      className={`as-lab ${takar ? 'as-lab--takar' : ''}`}
      data-focus={focusMode || undefined}
      data-intro-open={introOpen || undefined}
      data-status-open={statusOpen || undefined}
      data-palette-open={paletteOpen || undefined}
      data-animation-pack={animationInstalled || undefined}
      data-board3d={active3d || undefined}
    >
      {takar && (
        <header className="as-lab__appbar" data-host-back={showBack ? undefined : ''}>
          {showBack && (
            <button
              type="button"
              className="as-lab__appbar-btn as-lab__appbar-back"
              aria-label="Kembali dari Wiring"
              onPointerDown={captureBackEditor}
              onClick={() => {
                if (!dispatchBack()) onClose?.()
              }}
            >
              ←
            </button>
          )}
          <div className="as-lab__appbar-title">
            <strong>Wiring</strong>
            <span>Simulator lokal</span>
          </div>
          {projectSummary && onOpenProject && (
            <button
              type="button"
              className="as-lab__appbar-btn as-lab__project-trigger"
              aria-label="Buka proyek dan standar Wiring"
              title={`${projectSummary.name} · ${projectSummary.status} · ${projectSummary.saveLabel}`}
              onClick={onOpenProject}
            >
              <span className="as-lab__project-trigger-name">{projectSummary.name}</span>
              <span className="as-lab__project-trigger-state">{projectSummary.status}</span>
            </button>
          )}
          <button
            type="button"
            className="as-lab__appbar-btn"
            aria-label="Buka komponen"
            aria-expanded={paletteOpen}
            onClick={() => setPaletteOpen((open) => !open)}
          >
            Komponen
          </button>
          <button
            type="button"
            className="as-lab__appbar-btn as-lab__appbar-icon"
            aria-label="Tampilkan panel status"
            aria-expanded={statusOpen}
            onClick={() => setStatusOpen((open) => !open)}
          >
            ⓘ
          </button>
        </header>
      )}
      {takar && paletteOpen && (
        <button
          type="button"
          className="as-lab__drawer-backdrop"
          aria-label="Tutup panel komponen"
          onClick={() => setPaletteOpen(false)}
        />
      )}
      <header className="as-lab__head">
        <div className="as-lab__head-row">
          <div className="as-lab__head-titles">
            <p className="as-lab__eyebrow">{TOPIC_1A_COPY.eyebrow}</p>
            <h1 className="as-lab__title">{TOPIC_1A_COPY.title}</h1>
          </div>
          <button
            type="button"
            className="as-lab__btn as-lab__intro-toggle"
            aria-expanded={introOpen}
            onClick={() => setIntroOpen((open) => !open)}
          >
            {introOpen ? 'Ringkas' : 'Selengkapnya'}
          </button>
        </div>
        <div className="as-lab__intro-body">
          <p className="as-lab__intro">{TOPIC_1A_COPY.intro}</p>
          <p className="as-lab__goal">
            <span className="as-lab__goal-label">{TOPIC_1A_COPY.goalLabel}: </span>
            {TOPIC_1A_COPY.goal}
          </p>
        </div>
      </header>

      <div className="as-lab__toolbar" role="toolbar" aria-label="Alat papan">
        {takar && (
          <div className="as-lab__drawer-head">
            <div>
              <strong>Komponen</strong>
              <span>Ketuk untuk memilih · tahan lalu seret ke grid</span>
            </div>
            <button
              type="button"
              className="as-lab__drawer-close"
              aria-label="Tutup komponen"
              onClick={() => setPaletteOpen(false)}
            >
              ×
            </button>
          </div>
        )}
        <div className="as-lab__palette-panel">
          {takar && (
            <ProjectionTabs
              active3d={active3d} on3d={() => { setActive3d(true); setCategory('Semua'); setPending(null) }}
              activeProjection={activeProjection}
              ariaLabel="Pilih papan dari panel komponen"
              className="as-lab__board-tabs--drawer"
              onChange={selectProjection}
              virtualAvailable={virtualInstalled}
            />
          )}
          {takar && (
            <label className="as-lab__palette-search">
              <span aria-hidden="true" className="as-lab__palette-search-icon">⌕</span>
              <input
                type="search"
                aria-label="Cari komponen Wiring"
                value={paletteQuery}
                onChange={(event) => setPaletteQuery(event.target.value)}
                placeholder="Cari nama, model, terminal…"
                autoComplete="off"
                spellCheck={false}
              />
              {paletteQuery && (
                <button type="button" aria-label="Hapus pencarian" onClick={() => setPaletteQuery('')}>×</button>
              )}
            </label>
          )}
          <div className="as-lab__chips" role="group" aria-label="Kategori komponen">
            {(['Semua', ...paletteChips] as const).map((chip) => (
              <button
                key={chip}
                type="button"
                className="as-lab__chip"
                aria-pressed={category === chip}
                onClick={() => setCategory(chip)}
              >
                {chip}
              </button>
            ))}
          </div>
          {/*
            The palette follows the active projection. On the field board a
            technician recognises the device by how it LOOKS, so the tile
            carries the same photograph the board places; on the IEC board the
            reference glyph is what matches the drawing. Same components, same
            specs — only the face changes.
          */}
          <div
            className="as-lab__palette"
            data-projection={activeProjection}
            role="group"
            aria-label="Komponen"
          >
            {visiblePalette.map((item) => (
              <div className="as-lab__tool-cell" key={item.key}>
                <button
                  type="button"
                  className="as-lab__tool"
                  aria-pressed={armedTool?.key === item.key}
                  aria-label={item.label}
                  onClick={() => handlePaletteClick(item)}
                  onPointerDown={(event) => beginPalettePress(item, event)}
                  onPointerMove={movePalettePress}
                  onPointerUp={finishPalettePress}
                  onPointerCancel={finishPalettePress}
                >
                  <span className="as-lab__tool-icon" aria-hidden="true">
                    {iecBoard ? (
                      <IecTileSymbol kind={item.kind} paletteKey={item.key} />
                    ) : (
                      <PackedPaletteImage path={virtualAssetFor(item.spec, item.key)} />
                    )}
                  </span>
                  {iecBoard && 'designation' in item ? (
                    <span className="as-lab__tool-designation" aria-hidden="true">
                      {item.designation}
                    </span>
                  ) : null}
                  <span className="as-lab__tool-label">
                    {iecBoard && 'iecLabel' in item ? item.iecLabel : item.label}
                  </span>
                  {/* Desktop hover tooltip (CSS-delayed); never intercepts the click. */}
                  <span className="as-lab__tool-tip" role="tooltip">
                    {item.hint}
                  </span>
                </button>
                {/* Touch/keyboard info affordance — opens a description panel, no long-press. */}
                <button
                  type="button"
                  className="as-lab__tool-info"
                  aria-label="Info"
                  onClick={() => setInfoItem(item)}
                >
                  i
                </button>
              </div>
            ))}
            {visiblePalette.length === 0 && (
              <p className="as-lab__palette-empty" role="status">
                Tidak ada komponen yang cocok. Coba nama umum, model, atau terminal.
              </p>
            )}
          </div>
        </div>

        <div className="as-lab__actions">
          <button
            type="button"
            className="as-lab__btn as-lab__btn--erase"
            aria-pressed={eraseMode}
            onClick={toggleErase}
          >
            Hapus
          </button>
          <button type="button" className="as-lab__btn" onClick={clearBoard}>
            Kosongkan papan
          </button>
        </div>

        {/*
          Worked examples. These are the same boards the test suites drive, so
          what a learner opens here is a circuit whose behaviour is asserted —
          not a drawing that merely renders. Loading one REPLACES the board, so
          the control says so rather than surprising anyone mid-build.
        */}
        <div className="as-lab__examples">
          <label className="as-lab__examples-label" htmlFor={exampleInputId}>
            Contoh rangkaian
          </label>
          <select
            className="as-lab__examples-select"
            id={exampleInputId}
            onChange={(event) => {
              const key = event.target.value
              if (key.startsWith('globaltek-') && Object.keys(state.board.components).length > 0 && !window.confirm('Muat template Global-Tek menggantikan papan aktif? Simpan atau ekspor proyek terlebih dahulu jika diperlukan.')) return
              setExampleKey(key)
              const chosen = CIRCUIT_EXAMPLES.find((item) => item.key === key)
              if (chosen) {
                const board = chosen.build()
                requestInitialCamera(board)
                lab.loadBoard(board)
                setArmedTool(null)
                setPending(null)
                setSelectedId(null)
              }
            }}
            value={exampleKey}
          >
            <option value="">Papan kosong — pilih contoh…</option>
            {EXAMPLE_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {CIRCUIT_EXAMPLES.filter((item) => item.group === group).map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.title}
                    {!item.verified && item.key === 'globaltek-document' ? ' (Run diblokir)' : ''}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {activeExample ? (
            <p className="as-lab__examples-hint">
              <strong>{activeExample.summary}</strong> {activeExample.tryIt}
              {activeExample.references?.map((reference) => (
                <Fragment key={reference.url}>
                  {' '}
                  <a
                    className="as-lab__examples-source"
                    href={reference.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Sumber: {reference.label}
                  </a>
                </Fragment>
              ))}
            </p>
          ) : null}
        </div>
      </div>

      <GlobalTekPanel board={state.board} timing={lab.setTimerTiming} mode={lab.setTimerMode} open={sourceOpen} onOpenChange={setSourceOpen} />
      <div className="as-lab__run" role="group" aria-label="Kendali jalan">
        {state.board.reference && <select className="as-lab__area-nav" aria-label="Lompat ke area wiring" defaultValue="" onChange={(event)=>jumpToSourceArea(event.target.value)}>
          <option value="" disabled>Area…</option>
          <option value="TR">Trafo</option><option value="5KM">Motor</option><option value="1KM">Heater</option>
          <option value="LEVEL-HIGH">Level / fill</option><option value="START">START / STOP</option><option value="AUX-41-43">Rinse</option>
          <option value="X-AA-1">Terminal A–A</option>
        </select>}
        <button
          type="button"
          className="as-lab__btn as-lab__btn--primary"
          onClick={() => lab.setRunning(!running)}
          disabled={faulted || (!running && circuitRunRequirements(state.board).length > 0)}
          aria-label={running ? 'Jeda simulasi' : 'Jalankan simulasi'}
        >
          {takar ? (running ? 'Ⅱ' : '▶') : running ? 'Jeda' : 'Jalankan'}
        </button>
        <button
          type="button"
          className="as-lab__btn"
          onClick={lab.reset}
          disabled={state.status === 'IDLE'}
          aria-label="Atur ulang simulasi"
        >
          {takar ? '↺' : 'Atur ulang'}
        </button>
        <button
          type="button"
          className="as-lab__btn"
          onClick={lab.undo}
          disabled={state.undoStack.length === 0 || structuralLocked}
          aria-label="Urungkan"
        >
          {takar ? '↶' : 'Urungkan'}
        </button>
        <button
          type="button"
          className="as-lab__btn"
          onClick={lab.redo}
          disabled={state.redoStack.length === 0 || structuralLocked}
          aria-label="Ulangi"
        >
          {takar ? '↷' : 'Ulangi'}
        </button>
        <button
          type="button"
          className="as-lab__btn as-lab__btn--erase"
          aria-label="Hapus komponen atau kabel"
          aria-pressed={eraseMode}
          onClick={toggleErase}
        >
          {takar ? '⌫' : 'Hapus'}
        </button>
        <button
          type="button"
          className="as-lab__btn as-lab__focus-toggle"
          aria-pressed={focusMode}
          onClick={() => setFocusMode((on) => !on)}
        >
          {focusMode ? 'Keluar fokus' : 'Mode fokus'}
        </button>
        <p className="as-lab__guidance" aria-live="polite">
          {guidance}
        </p>
      </div>
      {!active3d && boardExploded(state.board, threeView) && <p className="as-lab__layout-warning" role="status">
        Komponen 3D masih dibongkar; perubahan pemasangan/kabel terkunci di semua tampilan.
        <button type="button" className="as-lab__btn" onClick={() => saveThreeView({ ...threeView, level: 0, overrides: {} })}>Rakit untuk edit</button>
      </p>}
      {layoutCollisions.length > 0 && (
        <p className="as-lab__layout-warning" role="alert">
          Tata letak bertumpuk: {layoutCollisions.map((pair) => pair.join(' ↔ ')).join(', ')}.
          Pindahkan perangkat; koneksi listrik tidak diubah otomatis.
        </p>
      )}

      <div className="as-lab__stage">
        {/* P1.2: zoom controls + board share ONE grid column (the workspace). Without
            this wrapper the zoom control became a third grid item and auto-placement
            pushed the board into the narrow sidebar column. */}
        <div className="as-lab__workspace">
          {zoomVisible && <div className="as-lab__zoom" role="group" aria-label="Perbesaran papan" style={{ display: active3d ? 'none' : undefined }}>
            <button
              type="button"
              className="as-lab__zoom-btn"
              onClick={() => changeZoomByStep(-1)}
              disabled={zoom <= BOARD_ZOOM_MIN + 1e-9}
              aria-label="Perkecil"
            >
              −
            </button>
            <span className="as-lab__zoom-pct" aria-live="polite">
              {Number((zoom * 100).toPrecision(3))}%
            </span>
            <button
              type="button"
              className="as-lab__zoom-btn"
              onClick={() => changeZoomByStep(1)}
              disabled={zoom >= BOARD_ZOOM_MAX - 0.0001}
              aria-label="Perbesar"
            >
              +
            </button>
            <button
              type="button"
              className="as-lab__zoom-btn as-lab__zoom-fit"
              onClick={fitViewportToCircuit}
              aria-label="Sesuaikan rangkaian ke layar"
              title="Sesuaikan rangkaian ke layar"
            >
              ⛶
            </button>
            <button
              type="button"
              className="as-lab__zoom-btn"
              onClick={expandWorkspace}
              aria-label="Perluas kanvas"
              title="Perluas kanvas tanpa mengubah zoom atau rangkaian"
            >
              ⤢
            </button>
          </div>}
          <ProjectionTabs
            active3d={active3d} on3d={() => { setActive3d(true); setCategory('Semua'); setPending(null) }}
            activeProjection={activeProjection}
            ariaLabel="Pilih papan"
            onChange={selectProjection}
            virtualAvailable={virtualInstalled}
          />
        <div className="as-lab__boards">
          {active3d && <Suspense fallback={<p>Menyiapkan Papan 3D…</p>}><Board3DPanel key={threeEpoch}
            state={state} view={threeView} onView={view => saveThreeView(view, threeEpoch)} reduced={lab.prefersReducedMotion}
            placing={!!armedTool} erase={eraseMode} pending={pending}
            onSelect={handleSelectComponent} onTerminal={handleTerminalClick} onCancel={() => setPending(null)}
            onWire={id => { if (pending && state.board.wires[id]) { lab.connect(pending, state.board.wires[id].from, { wireId: id, panel3dPosition: .5 }); setPending(null) } }}
            onPlace={(x,y) => {
              if (!armedTool) return
              const placement={x:Math.round(x),y:Math.round(y),rotation:0}
              if (!panelMoveAllowed(state.board,'',placement)) return
              for(let n=0;n<10000;n++) { const cell={x:(n%100)*5,y:Math.floor(n/100)*5};
                if (footprintCollides(state.board,armedTool.spec.kind,cell,undefined,'virtual') || footprintCollides(state.board,armedTool.spec.kind,cell,undefined,'iec')) continue
                const id=lab.place(armedTool.spec,cell,armedTool.key);if(id)lab.move3d(id,placement);setArmedTool(null);break
              }
            }}
            onMove={lab.move3d} onToggle={lab.toggle} onPress={lab.press} onProduct={lab.pressProductControl}
            onResetOverload={lab.resetOverload} onResetMcb={lab.resetMcb}
            onDelete={handleDeleteComponent} onDeleteWire={handleDeleteWire}
          /></Suspense>}
          <section
            className="as-lab__board-panel"
            data-projection="virtual"
            data-active={!active3d && activeProjection === 'virtual' || undefined}
            aria-label="Papan simulasi virtual"
          >
            <header className="as-lab__board-title">
              <strong>Perangkat Lapangan 2D</strong>
              <span>Lubang terminal dan aktuator aktif</span>
            </header>
            <div
              className="as-lab__board-wrap"
              ref={virtualWrapRef}
              onScroll={(event) => saveView('virtual', event.currentTarget)}
              onPointerDownCapture={() => cancelPendingCamera('virtual')}
              onWheelCapture={() => cancelPendingCamera('virtual')}
            >
              {mountedProjectionsRef.current.has('virtual') && <CircuitBoard
                active={!active3d && activeProjection === 'virtual'}
                state={state}
                zoom={zoom}
                onPinchZoom={changeZoomByPinch}
                projection="virtual"
                cameraInsets={cameraInsets.virtual}
                onViewportMetrics={handleViewportMetrics}
                viewport={viewport}
                prefersReducedMotion={lab.prefersReducedMotion}
                renderProfile={lab.renderProfile}
                placingSpec={armedTool?.spec ?? null}
                pendingTerminal={pending}
                eraseMode={eraseMode}
                onPlaceCell={handlePlaceCell}
                onTerminalClick={handleTerminalClick}
                onTapWire={(targetWireId, anchor, position, near) =>
                  handleTapWire('virtual', targetWireId, anchor, position, near)
                }
                onToggleSwitch={lab.toggle}
                onSelectComponent={handleSelectComponent}
                selectedId={selectedId}
                onPressButton={lab.press}
                onPressProductControl={lab.pressProductControl}
                onDeleteComponent={handleDeleteComponent}
                onDeleteWire={handleDeleteWire}
                onMoveComponent={(id, cell) => lab.move(id, cell, 'virtual')}
                onReplaceRequest={(draggedId, occupantId, cell) =>
                  setReplaceRequest({ draggedId, occupantId, cell, projection: 'virtual' })
                }
                onCancelWiring={() => setPending(null)}
              />}
            </div>
          </section>
          <section
            className="as-lab__board-panel"
            data-projection="iec"
            data-active={!active3d && activeProjection === 'iec' || undefined}
            aria-label="Papan diagram IEC 60617"
          >
            <header className="as-lab__board-title">
              <strong>Diagram IEC 60617</strong>
              <span>Terminal logis identik · tata letak independen</span>
            </header>
            <div
              className="as-lab__board-wrap"
              ref={iecWrapRef}
              onScroll={(event) => saveView('iec', event.currentTarget)}
              onPointerDownCapture={() => cancelPendingCamera('iec')}
              onWheelCapture={() => cancelPendingCamera('iec')}
            >
              {mountedProjectionsRef.current.has('iec') && <CircuitBoard
                active={!active3d && activeProjection === 'iec'}
                state={state}
                zoom={zoom}
                onPinchZoom={changeZoomByPinch}
                projection="iec"
                cameraInsets={cameraInsets.iec}
                onViewportMetrics={handleViewportMetrics}
                viewport={viewport}
                prefersReducedMotion={lab.prefersReducedMotion}
                renderProfile={lab.renderProfile}
                placingSpec={armedTool?.spec ?? null}
                pendingTerminal={pending}
                eraseMode={eraseMode}
                onPlaceCell={handlePlaceCell}
                onTerminalClick={handleTerminalClick}
                onTapWire={(targetWireId, anchor, position, near) =>
                  handleTapWire('iec', targetWireId, anchor, position, near)
                }
                onToggleSwitch={lab.toggle}
                onSelectComponent={handleSelectComponent}
                selectedId={selectedId}
                onPressButton={lab.press}
                onPressProductControl={lab.pressProductControl}
                onDeleteComponent={handleDeleteComponent}
                onDeleteWire={handleDeleteWire}
                onMoveComponent={(id, cell) => lab.move(id, cell, 'iec')}
                onReplaceRequest={(draggedId, occupantId, cell) =>
                  setReplaceRequest({ draggedId, occupantId, cell, projection: 'iec' })
                }
                onCancelWiring={() => setPending(null)}
              />}
            </div>
          </section>
        </div>
        </div>

        <aside className="as-lab__side">
          <div className="as-lab__side-head">
            <span className="as-lab__side-title">Panel status</span>
            <button
              type="button"
              className="as-lab__btn as-lab__status-toggle"
              aria-expanded={statusOpen}
              onClick={() => setStatusOpen((open) => !open)}
            >
              {statusOpen ? 'Sembunyikan' : 'Tampilkan'}
            </button>
          </div>
          <section className="as-lab__readout" aria-label="Pembacaan" hidden={!statusOpen}>
            {takar && (
              <div className="as-lab__reading as-lab__reading--content-pack">
                <span className="as-lab__reading-label">Animasi kabel</span>
                <span className="as-lab__reading-value">{lab.prefersReducedMotion ? 'Penanda statis · kurangi gerakan' : 'Aktif tanpa unduhan'}</span>
              </div>
            )}
            <div className="as-lab__reading">
              <span className="as-lab__reading-label">Status</span>
              <span className="as-lab__reading-value" data-faulted={faulted || undefined}>
                {faulted && state.fault?.code === 'SHORT_CIRCUIT_TRIPPED'
                  ? 'Proteksi trip'
                  : STATUS_TEXT[state.status]}
              </span>
            </div>
            <div className="as-lab__reading">
              <span className="as-lab__reading-label">Tegangan sumber</span>
              <span className="as-lab__reading-value">{sourceVoltsText}</span>
            </div>
            <div className="as-lab__reading">
              <span className="as-lab__reading-label">Arus</span>
              <span className="as-lab__reading-value as-lab__reading-value--measure">
                {state.display.sourceCurrent.toFixed(2)} A
              </span>
            </div>
            {lamps.map((lamp) => {
              // Status by fraction of full-voltage current: series lamps sit near
              // half → "redup"; single/parallel near full → "menyala".
              const resistance =
                lamp.spec.kind === 'LOAD' ? lamp.spec.resistanceOhms : 1
              // Judged against the supply that feeds this lamp's circuit (L3).
              const volts = state.solution.supplyVolts?.[lamp.id] ?? sourceVolts
              const nominal =
                volts && resistance > 0 ? volts / resistance : 0
              const fraction =
                nominal > 0 ? (state.display.loadCurrent[lamp.id] ?? 0) / nominal : 0
              const status =
                fraction < 0.05 ? 'padam' : fraction < 0.7 ? 'redup' : 'menyala'
              return (
                <div className="as-lab__reading" key={lamp.id}>
                  <span className="as-lab__reading-label">Lampu {lamp.id}</span>
                  <span className="as-lab__reading-value">{status}</span>
                </div>
              )
            })}
            {motors.map((motor) => (
              <div className="as-lab__reading" key={motor.id}>
                <span className="as-lab__reading-label">Motor {motor.id}</span>
                <span className="as-lab__reading-value">
                  {motorLiveStatus(motor.id)}
                </span>
              </div>
            ))}
            {relays.map((relay) => (
              <div className="as-lab__reading" key={relay.id}>
                <span className="as-lab__reading-label">Relay {relay.id}</span>
                <span className="as-lab__reading-value">
                  {state.relayEnergized[relay.id] ? 'aktif' : 'idle'}
                </span>
              </div>
            ))}
            {indicators.map((indicator) => (
              <div className="as-lab__reading" key={indicator.id}>
                <span className="as-lab__reading-label">
                  Indikator {indicator.id}
                </span>
                <span className="as-lab__reading-value">
                  {(state.display.loadCurrent[indicator.id] ?? 0) > 0.01
                    ? 'nyala'
                    : 'padam'}
                </span>
              </div>
            ))}
            {contactors.map((km) => {
              const on = state.contactorEnergized[km.id] ?? false
              // Coil reading is meaningful only when BOTH coil ends are referenced;
              // a floating A1/A2 reads "tak tentu", not a misleading 0 V.
              const referenced =
                nodeStatusOf(km.id, CONTACTOR_TERMINAL.A1) === 'RESOLVED' &&
                nodeStatusOf(km.id, CONTACTOR_TERMINAL.A2) === 'RESOLVED'
              const coil = referenced
                ? `${(state.coilVoltage[km.id] ?? 0).toFixed(1)} V`
                : 'tak tentu'
              return (
                <div className="as-lab__reading" key={km.id}>
                  <span className="as-lab__reading-label">Kontaktor {km.id}</span>
                  <span className="as-lab__reading-value">
                    {/* When the fixpoint did not settle, the per-contactor state is
                        NOT a valid result — show it as unstable, never a claimed ON/OFF. */}
                    {state.contactorConverged ? `${on ? 'ON' : 'OFF'} · ${coil}` : 'tidak stabil'}
                  </span>
                </div>
              )
            })}
            {contactors.length > 0 && !state.contactorConverged && (
              <div className="as-lab__reading">
                <span className="as-lab__reading-label">Kontaktor</span>
                <span className="as-lab__reading-value">
                  tidak stabil: kontaktor saling memutus koilnya (mis. dua START ditekan bersamaan)
                </span>
              </div>
            )}
            {motors3.map((motor) => {
              const star = nodeStatusOf(motor.id, MOTOR_3PH_TERMINAL.U2)
              const starText =
                star === 'RESOLVED'
                  ? 'tertaut'
                  : star === 'UNREFERENCED'
                    ? 'melayang'
                    : '—'
              // Topology is DERIVED from the actual node membership — never stored.
              const mode = acNodes
                ? classifyMotorTopology(motor.id, acNodes, {
                    converged: state.contactorConverged,
                    hasFault: tp?.fault !== undefined,
                  })
                : 'OPEN'
              return (
                <Fragment key={motor.id}>
                  <div className="as-lab__reading">
                    <span className="as-lab__reading-label">
                      Motor {motor.id} — arus jala R/S/T
                    </span>
                    <span className="as-lab__reading-value as-lab__reading-value--measure">
                      {tp
                        ? `${tp.lineCurrent.R.toFixed(2)} / ${tp.lineCurrent.S.toFixed(2)} / ${tp.lineCurrent.T.toFixed(2)} A`
                        : '—'}
                    </span>
                  </div>
                  <div className="as-lab__reading">
                    <span className="as-lab__reading-label">
                      Motor {motor.id} — arus belitan U/V/W
                    </span>
                    <span className="as-lab__reading-value as-lab__reading-value--measure">
                      {`${windingAmps(motor.id, 0).toFixed(2)} / ${windingAmps(motor.id, 1).toFixed(2)} / ${windingAmps(motor.id, 2).toFixed(2)} A`}
                    </span>
                  </div>
                  <div className="as-lab__reading">
                    <span className="as-lab__reading-label">
                      Motor {motor.id} — putaran
                    </span>
                    <span className="as-lab__reading-value">
                      {running && tp && isMotor3phRunning(tp, motor.id) ? 'berputar' : 'diam'}
                    </span>
                  </div>
                  <div className="as-lab__reading">
                    <span className="as-lab__reading-label">
                      Motor {motor.id} — titik bintang
                    </span>
                    <span className="as-lab__reading-value">{starText}</span>
                  </div>
                  <div className="as-lab__reading">
                    <span className="as-lab__reading-label">
                      Motor {motor.id} — mode topologi
                    </span>
                    <span className="as-lab__reading-value">{mode}</span>
                  </div>
                </Fragment>
              )
            })}
            {mcbs.map((mcb) => {
              const spec = mcb.spec
              if (spec.kind !== 'BREAKER_1P' && spec.kind !== 'BREAKER_3P') return null
              const poles = spec.kind === 'BREAKER_3P' ? '3P' : '1P'
              const rt = state.mcbRuntime[mcb.id]
              const prot = mcbProtection(spec)
              const tripped = rt?.tripped ?? false
              // Three visual states: OFF / ON / TRIPPED (reason distinguished, M3-C3).
              const stateText = tripped
                ? `TRIP (${rt?.tripReason === 'INSTANTANEOUS' ? 'seketika' : 'termal'})`
                : spec.on
                  ? 'ON'
                  : 'OFF'
              const pct = Math.min(100, Math.round(((rt?.thermalLevel ?? 0) / prot.thermalTripThreshold) * 100))
              const poleI = (rt?.poleCurrents ?? []).map((c) => c.toFixed(1)).join('/')
              // Reset only when tripped, the handle is OFF, and it has cooled.
              const resettable = tripped && !spec.on && (rt?.thermalLevel ?? 0) <= prot.resetThreshold
              return (
                <div className="as-lab__reading" key={mcb.id}>
                  <span className="as-lab__reading-label">
                    {spec.protectionDisabled ? 'Disconnector' : 'MCB'} {mcb.id} · {poles}
                  </span>
                  <span className="as-lab__reading-value">
                    {stateText} · {mcbRatedAmps(spec)} A
                    {spec.protectionDisabled ? ' · tanpa trip arus' : ` · panas ${pct}%`}
                    {poleI ? ` · I ${poleI} A` : ''}
                    {!spec.protectionDisabled && tripped && (
                      <button
                        type="button"
                        className="as-lab__ol-reset"
                        disabled={!resettable}
                        onClick={() => lab.resetMcb(mcb.id)}
                        title={
                          resettable ? 'Reset trip' : 'Matikan handle & tunggu dingin untuk mereset'
                        }
                      >
                        {resettable ? 'Reset' : 'kunci'}
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
            {timers.map((timer) => {
              const spec = timer.spec.kind === 'TIMER' ? timer.spec : null
              const rt = state.timerRuntime[timer.id]
              // Phase is DERIVED from elapsed; a de-energized timer shows IDLE.
              const phase =
                rt?.running && spec
                  ? spec.model === 'OMRON_H3CR_A8'
                    ? multifunctionTimerOutputOn(rt.elapsedMs, spec) ? 'OUTPUT ON' : 'MENUNGGU/OFF'
                    : timerPhase(rt.elapsedMs, spec)
                  : 'IDLE'
              return (
                <div className="as-lab__reading" key={timer.id}>
                  <span className="as-lab__reading-label">Timer {timer.id}</span>
                  <span className="as-lab__reading-value">
                    {phase} · {((rt?.elapsedMs ?? 0) / 1000).toFixed(1)} s
                    {spec && (spec.model === 'OMRON_H3CR_A8'
                      ? <> · mode {spec.mode ?? 'A'} · set {formatTimerDuration(spec.starDurationMs)}</>
                      : <> · STAR {formatTimerDuration(spec.starDurationMs)} · jeda {formatTimerDuration(spec.transitionDelayMs)}</>)}
                  </span>
                </div>
              )
            })}
            {overloads.map((ol) => {
              const spec = ol.spec.kind === 'OVERLOAD_RELAY' ? ol.spec : null
              const rt = state.overloadRuntime[ol.id]
              const tripped = rt?.tripped ?? false
              const level = rt?.thermalLevel ?? 0
              const threshold = spec && spec.tripMultiplier > 0 ? spec.tripMultiplier : 1
              const pct = Math.min(100, Math.round((level / threshold) * 100))
              const resettable = tripped && spec ? level <= spec.resetThreshold : false
              return (
                <div className="as-lab__reading" key={ol.id}>
                  <span className="as-lab__reading-label">Beban-lebih {ol.id}</span>
                  <span className="as-lab__reading-value">
                    {tripped ? 'TRIP' : 'normal'} · panas {pct}%
                    {tripped && (
                      <button
                        type="button"
                        className="as-lab__ol-reset"
                        disabled={!resettable}
                        onClick={() => lab.resetOverload(ol.id)}
                        title={resettable ? 'Reset trip' : 'Belum dapat direset — masih panas'}
                      >
                        {resettable ? 'Reset' : 'belum dingin'}
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </section>

          {selectedComponent && (selectedMcbSpec || selectedTimerSpec) && (
            <section className="as-lab__props" aria-label="Komponen terpilih">
              <div className="as-lab__side-head">
                <span className="as-lab__side-title">Komponen terpilih</span>
                <button
                  type="button"
                  className="as-lab__btn"
                  onClick={() => setSelectedId(null)}
                >
                  Tutup
                </button>
              </div>
              {selectedMcbSpec && (
                <>
                  <div className="as-lab__reading">
                    <span className="as-lab__reading-label">Jenis</span>
                    <span className="as-lab__reading-value">
                      {selectedMcbSpec.protectionDisabled
                        ? 'Switch-disconnector 3-fasa'
                        : selectedMcbSpec.kind === 'BREAKER_1P' ? 'MCB 1-fasa' : 'MCB 3-fasa'}
                    </span>
                  </div>
                  <label className="as-lab__prop-field">
                    <span className="as-lab__reading-label">Rating</span>
                    <select
                      className="as-lab__property-select"
                      value={mcbRatedAmps(selectedMcbSpec)}
                      onChange={(event) =>
                        lab.setMcbRating(
                          selectedComponent.id,
                          Number(event.target.value) as McbRatedCurrent,
                        )
                      }
                    >
                      {MCB_RATINGS.map((amps) => (
                        <option key={amps} value={amps}>
                          {amps} A
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {selectedTimerSpec && selectedTimerStar && (
                <>
                  <div className="as-lab__reading">
                    <span className="as-lab__reading-label">Jenis</span>
                    <span className="as-lab__reading-value">
                      {selectedTimerSpec.model === 'OMRON_H3CR_A8' ? 'Timer multifungsi H3CR-A8' : 'Timer STAR–DELTA'}
                    </span>
                  </div>
                  <div className="as-lab__timer-fields">
                    <fieldset className="as-lab__duration-field">
                      <legend>{selectedTimerSpec.model === 'OMRON_H3CR_A8' ? 'Waktu set' : 'Waktu STAR'}</legend>
                      <label>
                        <span>Menit</span>
                        <input
                          className="as-lab__duration-input"
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={2}
                          step={1}
                          aria-label={selectedTimerSpec.model === 'OMRON_H3CR_A8' ? 'Menit timer' : 'Menit STAR'}
                          value={selectedTimerStar.minutes}
                          onChange={(event) => setSelectedTimerPart('minutes', Number(event.target.value))}
                        />
                      </label>
                      <label>
                        <span>Detik</span>
                        <input
                          className="as-lab__duration-input"
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={59.9}
                          step={0.1}
                          aria-label={selectedTimerSpec.model === 'OMRON_H3CR_A8' ? 'Detik timer' : 'Detik STAR'}
                          value={selectedTimerStar.seconds}
                          onChange={(event) => setSelectedTimerPart('seconds', Number(event.target.value))}
                        />
                      </label>
                    </fieldset>
                    {selectedTimerSpec.model === 'OMRON_H3CR_A8' ? (
                      <fieldset className="as-lab__duration-field">
                        <legend>Mode fungsi</legend>
                        <label>
                          <span>Selector</span>
                          <select
                            className="as-lab__property-select"
                            aria-label="Mode timer H3CR-A8"
                            value={selectedTimerSpec.mode ?? 'A'}
                            onChange={(event) => lab.setTimerMode(selectedComponent.id, event.target.value as 'A' | 'B' | 'B2' | 'E' | 'J')}
                          >
                            <option value="A">A · ON-delay</option>
                            <option value="B">B · Flicker OFF-start</option>
                            <option value="B2">B2 · Flicker ON-start</option>
                            <option value="E">E · Interval</option>
                            <option value="J">J · One-shot</option>
                          </select>
                        </label>
                      </fieldset>
                    ) : (
                      <fieldset className="as-lab__duration-field">
                        <legend>Jeda perpindahan</legend>
                        <label>
                          <span>Selector</span>
                          <select
                            className="as-lab__property-select"
                            aria-label="Jeda perpindahan star ke delta"
                            value={selectedTimerSpec.transitionDelayMs}
                            onChange={(event) => setSelectedTimerTransfer(Number(event.target.value))}
                          >
                            {TIMER_TRANSFER_OPTIONS_MS.map((milliseconds) => (
                              <option key={milliseconds} value={milliseconds}>
                                {(milliseconds / 1000).toLocaleString('id-ID')} s
                              </option>
                            ))}
                          </select>
                        </label>
                      </fieldset>
                    )}
                  </div>
                  <p className="as-lab__prop-note">
                    {selectedTimerSpec.model === 'OMRON_H3CR_A8'
                      ? <>Mode {selectedTimerSpec.mode ?? 'A'} · set {formatTimerDuration(selectedTimerSpec.starDurationMs)}. Kedua changeover bergerak bersama; perubahan mode/waktu mengulang timer.</>
                      : <>STAR {formatTimerDuration(selectedTimerSpec.starDurationMs)} · jeda {formatTimerDuration(selectedTimerSpec.transitionDelayMs)}. Model terminal dan selector mengikuti Omron H3DT-G; perubahan waktu mengulang urutan timer dari kondisi aman.</>}
                  </p>
                </>
              )}
            </section>
          )}

          {hummingMotor && !faulted && (
            <section className="as-lab-advisory" aria-label="Peringatan motor">
              <p className="as-lab-advisory__tag">Perlu diperbaiki</p>
              <h3 className="as-lab-advisory__title">
                {motorHummingAdvisory().title}
              </h3>
              <p className="as-lab-advisory__why">{motorHummingAdvisory().why}</p>
            </section>
          )}

          {faulted && state.fault && <DiagnosePanel fault={state.fault} />}
        </aside>
      </div>

      {replaceRequest && (
        <div
          className="as-lab-replace"
          role="dialog"
          aria-modal="true"
          aria-label="Konfirmasi ganti komponen"
        >
          <div className="as-lab-replace__panel">
            <p className="as-lab-replace__text">
              Ganti {kindName(replaceRequest.occupantId)} dengan{' '}
              {kindName(replaceRequest.draggedId)}?
            </p>
            <div className="as-lab-replace__actions">
              {/* Ya & Tidak are deliberately identical (no default/highlight) so
                  the choice is read, not reflexed. */}
              <button type="button" className="as-lab-replace__btn" onClick={confirmReplace}>
                Ya
              </button>
              <button
                type="button"
                className="as-lab-replace__btn"
                onClick={() => setReplaceRequest(null)}
              >
                Tidak
              </button>
            </div>
          </div>
        </div>
      )}

      {paletteDrag && (
        <div
          className="as-lab__drag-ghost"
          style={{ left: paletteDrag.x, top: paletteDrag.y }}
          aria-hidden="true"
        >
          {activeProjection === 'virtual' ? (
            <PackedPaletteImage path={virtualAssetFor(paletteDrag.item.spec, paletteDrag.item.key)} />
          ) : (
            <IecTileSymbol kind={paletteDrag.item.kind} paletteKey={paletteDrag.item.key} />
          )}
          <span>{paletteDrag.item.label}</span>
        </div>
      )}

      {infoItem && (
        <div
          className="as-lab-replace"
          role="dialog"
          aria-modal="true"
          aria-label={`Keterangan ${infoItem.label}`}
        >
          <div className="as-lab-replace__panel">
            <p className="as-lab-replace__text as-lab-info__title">{infoItem.label}</p>
            <p className="as-lab-replace__text">{infoItem.hint}</p>
            {wiringModelManifest(infoItem.key).limitation && (
              <p className="as-lab-replace__text" data-model-publication="limited">
                Batas verifikasi: {wiringModelManifest(infoItem.key).limitation}
              </p>
            )}
            {(infoItem.manufacturer || infoItem.model || infoItem.simulationScope) && (
              <dl className="as-lab-info__facts">
                {infoItem.manufacturer && <><dt>Produsen rujukan</dt><dd>{infoItem.manufacturer}</dd></>}
                {infoItem.model && <><dt>Model / keluarga</dt><dd>{infoItem.model}</dd></>}
                {infoItem.simulationScope && <><dt>Yang disimulasikan</dt><dd>{infoItem.simulationScope}</dd></>}
              </dl>
            )}
            {infoItem.datasheetUrl && (
              <a className="as-lab-info__datasheet" href={infoItem.datasheetUrl} target="_blank" rel="noreferrer">
                Buka halaman produk/datasheet resmi
              </a>
            )}
            <div className="as-lab-replace__actions">
              <button
                type="button"
                className="as-lab-replace__btn"
                onClick={() => setInfoItem(null)}
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
