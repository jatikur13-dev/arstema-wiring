import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PALETTE } from '../scenario/topic1a'

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const inventory = json('assets/blender/wiring-catalog-v1/inventory.json')
const ledger = json('assets/blender/wiring-evidence-v2/sources.json')
const audit = json('assets/blender/wiring-evidence-v2/audit.json')
type Identity = { id: string; terminals: { index: number; designation: string; role: string }[] }
const identities: Identity[] = inventory.items.flatMap((item: { models: Identity[] }) => item.models)

describe('wiring evidence register (not manufacturer certification)', () => {
  it('covers every palette and template identity without changing engine terminal order', () => {
    expect(audit.entries.map((e: Identity) => e.id).sort()).toEqual(identities.map(e => e.id).sort())
    expect(new Set(audit.entries.map((e: Identity) => e.id)).size).toBe(identities.length)
    for (const p of PALETTE) expect(identities.some(e => e.id === p.key)).toBe(true)
    for (const e of audit.entries) {
      expect(e.currentEngineTerminals).toEqual(identities.find(i => i.id === e.id)!.terminals.map(t => ({ index: t.index, designation: t.designation, role: t.role })))
    }
  })
  it('keeps incomplete evidence and mass-render gate explicit', () => {
    expect(audit.complete).toBe(false)
    expect(audit.massRenderApproved).toBe(false)
    expect(ledger.massRenderApproved).toBe(false)
    for (const e of audit.entries) {
      expect(e.evidence).toEqual({ terminals: 'pending-visual-audit', exterior: 'unverified', anatomy: 'conceptual-only' })
      expect(e.renderGate).toBe('blocked-pending-evidence-and-reference-review')
    }
  })
  it('has traceable unique sources linked to actual identities, never an implicit certification', () => {
    expect(new Set(ledger.sources.map((s: { id: string }) => s.id)).size).toBe(ledger.sources.length)
    for (const source of ledger.sources) {
      expect(new URL(source.url).protocol).toBe('https:')
      expect(source.locator.length).toBeGreaterThan(0)
      expect(source.review.length).toBeGreaterThan(0)
      expect(source.openIssues.length).toBeGreaterThan(0)
      for (const id of source.models) expect(identities.some(e => e.id === id)).toBe(true)
    }
    for (const e of audit.entries) {
      expect(e.sourceIds).toEqual(ledger.sources.filter((s: { models: string[] }) => s.models.includes(e.id)).map((s: { id: string }) => s.id))
    }
  })
})
