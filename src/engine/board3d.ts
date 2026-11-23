import type { Board, PlacedComponent } from './types'

export interface PanelPlacement3D { x: number; y: number; rotation: number }
export interface PanelCamera3D { position: [number, number, number]; target: [number, number, number]; up: [number, number, number]; projection?: 'perspective' | 'orthographic' }
export interface Board3DView {
  version: 1; level: number; overrides: Record<string, number>; conceptual: boolean; paths: boolean;
  selected: string; mode: 'navigate' | 'operate' | 'move' | 'wire'; quality: 'auto' | 'low' | 'high';
  camera?: PanelCamera3D;
  placements?: Record<string, PanelPlacement3D>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const stageIndex = (n: unknown) => typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(20, Math.floor(n))) : 0
export function normalizeBoard3DView(value: unknown): Board3DView {
  const v = object(value) ? value : {}
  const overrides: Record<string, number> = Object.create(null)
  const placements: Record<string, PanelPlacement3D> = Object.create(null)
  if (object(v.placements)) for (const [id, p] of Object.entries(v.placements)) if (validPanelPlacement(p)) placements[id] = { ...p }
  if (object(v.overrides)) for (const [id, level] of Object.entries(v.overrides)) overrides[id] = stageIndex(level)
  const vector = (a: unknown): a is [number, number, number] => Array.isArray(a) && a.length === 3 && a.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e9)
  let camera: PanelCamera3D | undefined
  if (object(v.camera) && vector(v.camera.position) && vector(v.camera.target) && vector(v.camera.up)) {
    const { position, target, up } = v.camera
    if (Math.hypot(...up) > 1e-6 && Math.hypot(...position.map((n, i) => n - target[i])) > 1e-6) {
      // Proyeksi ikut diingat: pembaca yang memilih ortografis tidak dilempar
      // balik ke perspektif setiap kali papan dibuka lagi.
      const projection = v.camera.projection === 'orthographic' || v.camera.projection === 'perspective' ? v.camera.projection : undefined
      camera = projection ? { position, target, up, projection } : { position, target, up }
    }
  }
  return { version: 1, level: stageIndex(v.level), overrides, conceptual: v.conceptual === true, paths: v.paths === true,
    selected: typeof v.selected === 'string' ? v.selected : '', mode: ['operate','move','wire'].includes(String(v.mode)) ? v.mode as Board3DView['mode'] : 'navigate',
    quality: v.quality === 'low' || v.quality === 'high' ? v.quality : 'auto', ...(camera ? { camera } : {}), ...(Object.keys(placements).length ? { placements } : {}) }
}
export function validPanelPlacement(v: unknown): v is PanelPlacement3D {
  return object(v) && ['x','y','rotation'].every(k => typeof v[k] === 'number' && Number.isFinite(v[k]) && Math.abs(v[k] as number) < 1e7)
}
/** Presentation units, NOT manufacturer millimetres. Old grids stay untouched. */
export function panelPlacement(c: PlacedComponent, view?: Board3DView): PanelPlacement3D {
  if (validPanelPlacement(c.panel3d)) return c.panel3d
  if (validPanelPlacement(view?.placements?.[c.id])) return view!.placements![c.id]
  const cell = c.projectionCells?.virtual ?? c.cell
  return { x: cell.x * 4, y: -cell.y * 4, rotation: 0 }
}
/** Explicit educational assembly stages, not manufacturer teardown instructions. */
export function assemblyStages(c: PlacedComponent): readonly string[] {
  if (['GROUND','SOURCE_3PH'].includes(c.spec.kind)) return []
  if(c.spec.kind==='SOURCE') return c.spec.transformer||c.spec.sourceType==='control_transformer_24vac' ? ['Selubung ilustratif','Lilitan konsep','Koneksi primer / sekunder'] : []
  if(c.spec.kind==='CAPACITOR') return ['Selubung ilustratif','Elektroda konsep','Dielektrik konsep']
  if(c.spec.kind==='TERMINAL_BLOCK') return ['Rumah isolasi ilustratif','Penjepit konsep','Bar konduktif konsep']
  if(c.spec.kind==='SENSOR_3WIRE') return ['Rumah ilustratif','Blok sensor konsep','Koneksi output logis']
  if(c.spec.kind==='LOAD') return ['Selubung ilustratif','Blok beban konsep','Koneksi beban logis']
  if (['MOTOR','MOTOR_3PH'].includes(c.spec.kind)) return ['Penutup ilustratif', 'Pelindung terminal', 'Stator konsep', 'Rotor konsep', 'Poros konsep']
  if (['RELAY','CONTACTOR','TIMER','OVERLOAD_RELAY','BREAKER_1P','BREAKER_3P'].includes(c.spec.kind)) return ['Penutup ilustratif', 'Pembawa mekanisme', 'Kontak konsep', 'Aktuator konsep', 'Jalur logis']
  return ['Penutup ilustratif', 'Aktuator / bagian aktif konsep', 'Jalur logis']
}
export function componentStage(c: PlacedComponent, view: Board3DView): number {
  return Math.min(assemblyStages(c).length, view.overrides[c.id] ?? view.level)
}
export function boardExploded(board: Board, view: Board3DView): boolean {
  return Object.values(board.components).some(c => componentStage(c, view) > 0)
}
export function panelMoveAllowed(board: Board, id: string, placement: PanelPlacement3D): boolean {
  return validPanelPlacement(placement) && Object.values(board.components).every(c => c.id === id || Math.hypot(panelPlacement(c,board.view?.three).x-placement.x, panelPlacement(c,board.view?.three).y-placement.y) >= 3.2)
}
