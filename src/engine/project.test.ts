import { describe, expect, it } from 'vitest'
import {
  canonicalCircuitProjectJson,
  attachVerifiedCircuitProjectReview,
  checkCircuitProject,
  computeCircuitProjectHash,
  createCircuitProject,
  createCircuitProjectReviewManifest,
  emptyBoard,
  parseCircuitProject,
  setCircuitProjectStatus,
  updateCircuitProject,
  verifyCircuitProjectReviewManifest,
} from './index'

describe('offline Wiring project envelope', () => {
  it('migrates a legacy board envelope and refuses unavailable standard profiles', () => {
    const parsed = parseCircuitProject({
      name: 'Panel A',
      standardProfile: 'NEMA_NFPA',
      board: emptyBoard(),
    })
    expect(parsed?.schemaVersion).toBe(1)
    expect(parsed?.standardProfile).toBe('IEC_PUIL')
    expect(parsed?.name).toBe('Panel A')
  })

  it('uses canonical JSON and SHA-256 independent of object insertion order', async () => {
    const a = createCircuitProject(emptyBoard(), { id: 'p1', name: 'Panel', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
    const b = { ...a, board: { wires: {}, components: {} } }
    expect(canonicalCircuitProjectJson(a)).toBe(canonicalCircuitProjectJson(b))
    expect(await computeCircuitProjectHash(a)).toMatch(/^[a-f0-9]{64}$/)
    expect(await computeCircuitProjectHash(a)).toBe(await computeCircuitProjectHash(b))
  })

  it('invalidates a review manifest when the project revision changes', async () => {
    const project = createCircuitProject(emptyBoard(), { id: 'p2', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
    const manifest = await createCircuitProjectReviewManifest(project, 'Reviewer', { reviewedAt: '2026-01-02T00:00:00.000Z' })
    expect(await verifyCircuitProjectReviewManifest(project, manifest)).toBe(true)
    const changed = updateCircuitProject(project, { name: 'Revisi' }, '2026-01-03T00:00:00.000Z')
    expect(await verifyCircuitProjectReviewManifest(changed, manifest)).toBe(false)
    const reviewed = await attachVerifiedCircuitProjectReview(project, manifest)
    expect(reviewed.status).toBe('PRO_REVIEWED_OFFLINE')
    expect(await verifyCircuitProjectReviewManifest(reviewed, manifest)).toBe(true)
    expect(await attachVerifiedCircuitProjectReview(changed, manifest)).toBe(changed)
  })

  it('requires app check before owner acceptance', () => {
    const project = createCircuitProject({
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 24, tripAmps: 5 } },
        L: { id: 'L', cell: { x: 2, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 24, ratedCurrentAmps: 2 } },
      },
      wires: {
        w1: { id: 'w1', from: { componentId: 'S', index: 0 }, to: { componentId: 'L', index: 0 } },
        w2: { id: 'w2', from: { componentId: 'L', index: 1 }, to: { componentId: 'S', index: 1 } },
      },
    }, { updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(checkCircuitProject(project).acceptable).toBe(true)
    expect(setCircuitProjectStatus(project, 'OWNER_ACCEPTED')).toBe(project)
    const checked = setCircuitProjectStatus(project, 'APP_CHECKED')
    expect(checked.status).toBe('APP_CHECKED')
    expect(setCircuitProjectStatus(checked, 'OWNER_ACCEPTED').status).toBe('OWNER_ACCEPTED')
  })

  it('does not let an empty board look engineering-checked', () => {
    const project = createCircuitProject(emptyBoard())
    expect(checkCircuitProject(project)).toEqual(expect.objectContaining({
      acceptable: false,
      errors: [expect.objectContaining({ code: 'PROJECT_EMPTY' })],
    }))
    expect(setCircuitProjectStatus(project, 'APP_CHECKED')).toBe(project)
  })

  it('does not trust a professional-review label merely because imported JSON says so', () => {
    const imported = parseCircuitProject({
      ...createCircuitProject(emptyBoard()),
      status: 'PRO_REVIEWED_OFFLINE',
      review: { format: 'TAKAR_WIRING_REVIEW_V1', sha256: 'fake' },
    })
    expect(imported?.status).toBe('DRAFT')
    expect(imported?.review).toBeUndefined()
  })
})
