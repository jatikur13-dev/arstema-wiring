import { analyzeSemanticNets, validateProjectionTopologyParity, type SemanticValidationIssue } from './semanticNets'
import {
  DEFAULT_WIRING_STANDARD_PROFILE,
  canSelectWiringStandardProfile,
  isWiringStandardProfileId,
  type WiringStandardProfileId,
} from './standards'
import type { Board } from './types'
import { normalizeBoard3DView, validPanelPlacement } from './board3d'
import { isWiringModelId } from './componentModels'

export const CIRCUIT_PROJECT_SCHEMA_VERSION = 1 as const

export type CircuitProjectStatus = 'DRAFT' | 'APP_CHECKED' | 'OWNER_ACCEPTED' | 'PRO_REVIEWED_OFFLINE'

export type CircuitElectricalSystem =
  | 'AC_1PH_2W'
  | 'AC_1PH_3W'
  | 'AC_3PH_3W'
  | 'AC_3PH_4W'
  | 'DC_2W'
  | 'CONTROL_MIXED'

export type CircuitGroundingSystem = 'NOT_DECLARED' | 'TT' | 'TN_S' | 'TN_C' | 'TN_C_S' | 'IT'

export interface CircuitProjectReviewManifest {
  format: 'TAKAR_WIRING_REVIEW_V1'
  projectId: string
  revision: number
  sha256: string
  reviewer: string
  organization?: string
  reviewedAt: string
  note?: string
}

export interface CircuitProject {
  schemaVersion: typeof CIRCUIT_PROJECT_SCHEMA_VERSION
  id: string
  name: string
  standardProfile: WiringStandardProfileId
  electricalSystem: CircuitElectricalSystem
  groundingSystem: CircuitGroundingSystem
  status: CircuitProjectStatus
  board: Board
  createdAt: string
  updatedAt: string
  revision: number
  evidenceIds: string[]
  review?: CircuitProjectReviewManifest
}

export interface CircuitProjectCheck {
  acceptable: boolean
  errors: SemanticValidationIssue[]
  warnings: SemanticValidationIssue[]
  info: SemanticValidationIssue[]
}

function projectId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `wiring-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createCircuitProject(
  board: Board,
  options: Partial<Pick<CircuitProject, 'id' | 'name' | 'standardProfile' | 'electricalSystem' | 'groundingSystem' | 'status' | 'createdAt' | 'updatedAt' | 'revision' | 'evidenceIds'>> = {},
): CircuitProject {
  const now = options.updatedAt ?? options.createdAt ?? new Date().toISOString()
  const standardProfile = options.standardProfile && canSelectWiringStandardProfile(options.standardProfile)
    ? options.standardProfile
    : DEFAULT_WIRING_STANDARD_PROFILE
  return {
    schemaVersion: CIRCUIT_PROJECT_SCHEMA_VERSION,
    id: options.id ?? projectId(),
    name: options.name?.trim() || 'Proyek Wiring',
    standardProfile,
    electricalSystem: options.electricalSystem ?? 'CONTROL_MIXED',
    groundingSystem: options.groundingSystem ?? 'NOT_DECLARED',
    status: options.status ?? 'DRAFT',
    board,
    createdAt: options.createdAt ?? now,
    updatedAt: now,
    revision: Math.max(1, Math.trunc(options.revision ?? 1)),
    evidenceIds: [...new Set(options.evidenceIds ?? [])],
  }
}

export function checkCircuitProject(project: CircuitProject): CircuitProjectCheck {
  const issues: SemanticValidationIssue[] = [
    ...(Object.keys(project.board.components).length === 0
      ? [{
          code: 'PROJECT_EMPTY' as const,
          severity: 'ERROR' as const,
          message: 'Papan masih kosong; proyek kosong tidak dapat diberi status APP_CHECKED.',
        }]
      : []),
    ...analyzeSemanticNets(project.board).issues,
    ...validateProjectionTopologyParity(project.board),
  ]
  const errors = issues.filter((issue) => issue.severity === 'ERROR')
  const warnings = issues.filter((issue) => issue.severity === 'WARNING')
  const info = issues.filter((issue) => issue.severity === 'INFO')
  return { acceptable: errors.length === 0, errors, warnings, info }
}

export function updateCircuitProject(
  project: CircuitProject,
  patch: Partial<Pick<CircuitProject, 'name' | 'electricalSystem' | 'groundingSystem' | 'board' | 'evidenceIds'>>,
  now = new Date().toISOString(),
): CircuitProject {
  return {
    ...project,
    ...patch,
    name: patch.name === undefined ? project.name : patch.name.trim() || 'Proyek Wiring',
    evidenceIds: patch.evidenceIds === undefined ? project.evidenceIds : [...new Set(patch.evidenceIds)],
    status: 'DRAFT',
    review: undefined,
    updatedAt: now,
    revision: project.revision + 1,
  }
}

export function setCircuitProjectStatus(
  project: CircuitProject,
  status: CircuitProjectStatus,
  now = new Date().toISOString(),
): CircuitProject {
  // A professional-review label is never a local button state. It can only be
  // attached after the offline manifest hash has been verified below.
  if (status === 'PRO_REVIEWED_OFFLINE') return project
  if ((status === 'APP_CHECKED' || status === 'OWNER_ACCEPTED') && !checkCircuitProject(project).acceptable) {
    return project
  }
  if (status === 'OWNER_ACCEPTED' && project.status !== 'APP_CHECKED' && project.status !== 'OWNER_ACCEPTED') {
    return project
  }
  return { ...project, status, updatedAt: now }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoardLike(value: unknown): value is Board {
  if (!isPlainObject(value) || !isPlainObject(value.components) || !isPlainObject(value.wires)) return false
  if (value.reference !== undefined) {
    const r=value.reference
    if (!isPlainObject(r) || !['document','corrected'].includes(String(r.variant)) ||
      !['templateId','title','document'].every(k=>typeof r[k]==='string') ||
      !Array.isArray(r.notes) || !r.notes.every(n=>typeof n==='string') || !Array.isArray(r.conflicts) ||
      !r.conflicts.every(c=>isPlainObject(c)&&typeof c.id==='string'&&typeof c.description==='string'&&typeof c.resolved==='boolean')) return false
  }
  if (value.view !== undefined) {
    const v=value.view
    if (!isPlainObject(v) || typeof v.zoom!=='number' || !Number.isFinite(v.zoom) ||
      !['iec','virtual'].includes(String(v.projection)) || !isPlainObject(v.cameras)) return false
    if (!Object.values(v.cameras).every(c=>isPlainObject(c)&&typeof c.x==='number'&&Number.isFinite(c.x)&&typeof c.y==='number'&&Number.isFinite(c.y)&&
      isPlainObject(c.insets)&&['left','top','right','bottom'].every(k=>typeof (c.insets as Record<string,unknown>)[k]==='number'&&Number.isFinite((c.insets as Record<string,number>)[k])))) return false
  }
  return Object.values(value.components).every((component) => {
    if (!isPlainObject(component) || typeof component.id !== 'string' || !isPlainObject(component.cell) || !isPlainObject(component.spec)) return false
    return (component.panel3d === undefined || validPanelPlacement(component.panel3d)) && typeof component.spec.kind === 'string' &&
      (component.modelId === undefined || typeof component.modelId === 'string')
  }) && Object.values(value.wires).every((wire) => {
    if (!isPlainObject(wire) || typeof wire.id !== 'string' || !isPlainObject(wire.from) || !isPlainObject(wire.to)) return false
    return typeof wire.from.componentId === 'string' && typeof wire.to.componentId === 'string'
  })
}

const ELECTRICAL_SYSTEMS = new Set<CircuitElectricalSystem>(['AC_1PH_2W', 'AC_1PH_3W', 'AC_3PH_3W', 'AC_3PH_4W', 'DC_2W', 'CONTROL_MIXED'])
const GROUNDING_SYSTEMS = new Set<CircuitGroundingSystem>(['NOT_DECLARED', 'TT', 'TN_S', 'TN_C', 'TN_C_S', 'IT'])
const PROJECT_STATUSES = new Set<CircuitProjectStatus>(['DRAFT', 'APP_CHECKED', 'OWNER_ACCEPTED', 'PRO_REVIEWED_OFFLINE'])

function normalizeBoardModelIds(board: Board): Board {
  const components: Board['components'] = {}
  for (const component of Object.values(board.components)) {
    // Unknown imported identifiers must not select a branded render or terminal
    // map. Preserve the component electrically, but reopen it as generic.
    if (component.modelId && !isWiringModelId(component.modelId)) {
      const { modelId: _unknown, ...generic } = component
      components[component.id] = generic
    } else {
      components[component.id] = component
    }
  }
  return { ...board, components, ...(board.view ? { view: { ...board.view, ...(board.view.active3d !== undefined ? { active3d: board.view.active3d === true } : {}),
    ...(board.view.three ? { three: normalizeBoard3DView(board.view.three) } : {}) } } : {}) }
}

/** Parse the current envelope and migrate a legacy `{board,...}` project safely. */
export function parseCircuitProject(value: unknown): CircuitProject | null {
  let decoded = value
  if (typeof decoded === 'string') {
    try {
      decoded = JSON.parse(decoded) as unknown
    } catch {
      return null
    }
  }
  if (!isPlainObject(decoded) || !isBoardLike(decoded.board)) return null

  const profile = isWiringStandardProfileId(decoded.standardProfile) && canSelectWiringStandardProfile(decoded.standardProfile)
    ? decoded.standardProfile
    : DEFAULT_WIRING_STANDARD_PROFILE
  const electricalSystem = ELECTRICAL_SYSTEMS.has(decoded.electricalSystem as CircuitElectricalSystem)
    ? decoded.electricalSystem as CircuitElectricalSystem
    : 'CONTROL_MIXED'
  const groundingSystem = GROUNDING_SYSTEMS.has(decoded.groundingSystem as CircuitGroundingSystem)
    ? decoded.groundingSystem as CircuitGroundingSystem
    : 'NOT_DECLARED'
  const status = PROJECT_STATUSES.has(decoded.status as CircuitProjectStatus)
    ? decoded.status as CircuitProjectStatus
    : 'DRAFT'
  const now = new Date().toISOString()
  const parsed: CircuitProject = {
    schemaVersion: CIRCUIT_PROJECT_SCHEMA_VERSION,
    id: typeof decoded.id === 'string' && decoded.id ? decoded.id : projectId(),
    name: typeof decoded.name === 'string' && decoded.name.trim() ? decoded.name.trim() : 'Proyek Wiring',
    standardProfile: profile,
    electricalSystem,
    groundingSystem,
    status,
    board: normalizeBoardModelIds(decoded.board),
    createdAt: typeof decoded.createdAt === 'string' ? decoded.createdAt : now,
    updatedAt: typeof decoded.updatedAt === 'string' ? decoded.updatedAt : now,
    revision: typeof decoded.revision === 'number' && Number.isFinite(decoded.revision) ? Math.max(1, Math.trunc(decoded.revision)) : 1,
    evidenceIds: Array.isArray(decoded.evidenceIds) ? decoded.evidenceIds.filter((id): id is string => typeof id === 'string') : [],
    ...(status !== 'PRO_REVIEWED_OFFLINE' && isPlainObject(decoded.review)
      ? { review: decoded.review as unknown as CircuitProjectReviewManifest }
      : {}),
  }
  // A JSON field alone cannot assert professional review. Import/reload must
  // verify the manifest against the canonical hash before restoring that label.
  if (status === 'PRO_REVIEWED_OFFLINE') parsed.status = 'DRAFT'
  return parsed
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) {
    const child = value[key]
    if (child !== undefined) out[key] = canonicalize(child)
  }
  return out
}

export function canonicalCircuitProjectJson(project: CircuitProject): string {
  // Workflow labels and save timestamps do not change the engineering revision.
  // The revision, netlist, profile, declared system, evidence, and project name do.
  const { review: _review, status: _status, updatedAt: _updatedAt, ...payload } = project
  const { view: _view, ...engineeringBoard } = payload.board
  return JSON.stringify(canonicalize({ ...payload, board: engineeringBoard }))
}

export async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 tidak tersedia pada runtime ini.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function computeCircuitProjectHash(project: CircuitProject): Promise<string> {
  return sha256Hex(canonicalCircuitProjectJson(project))
}

export async function createCircuitProjectReviewManifest(
  project: CircuitProject,
  reviewer: string,
  options: { organization?: string; note?: string; reviewedAt?: string } = {},
): Promise<CircuitProjectReviewManifest> {
  const name = reviewer.trim()
  if (!name) throw new Error('Nama reviewer wajib diisi.')
  return {
    format: 'TAKAR_WIRING_REVIEW_V1',
    projectId: project.id,
    revision: project.revision,
    sha256: await computeCircuitProjectHash(project),
    reviewer: name,
    ...(options.organization?.trim() ? { organization: options.organization.trim() } : {}),
    reviewedAt: options.reviewedAt ?? new Date().toISOString(),
    ...(options.note?.trim() ? { note: options.note.trim() } : {}),
  }
}

export async function verifyCircuitProjectReviewManifest(
  project: CircuitProject,
  manifest: CircuitProjectReviewManifest,
): Promise<boolean> {
  if (manifest.format !== 'TAKAR_WIRING_REVIEW_V1' || manifest.projectId !== project.id || manifest.revision !== project.revision) return false
  return manifest.sha256 === await computeCircuitProjectHash(project)
}

export async function attachVerifiedCircuitProjectReview(
  project: CircuitProject,
  manifest: CircuitProjectReviewManifest,
): Promise<CircuitProject> {
  if (!await verifyCircuitProjectReviewManifest(project, manifest)) return project
  return {
    ...project,
    status: 'PRO_REVIEWED_OFFLINE',
    review: manifest,
    updatedAt: manifest.reviewedAt,
  }
}
