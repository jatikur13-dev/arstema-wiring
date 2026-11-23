import { describe, expect, it } from 'vitest'
import {
  WIRING_STANDARD_PROFILES,
  canSelectWiringStandardProfile,
  selectableWiringStandardProfiles,
  wiringEvidenceForProfile,
} from './index'

describe('Wiring standard profile boundary', () => {
  it('only exposes the evidence-backed IEC/PUIL profile as selectable', () => {
    expect(selectableWiringStandardProfiles().map((profile) => profile.id)).toEqual(['IEC_PUIL'])
    expect(canSelectWiringStandardProfile('IEC_PUIL')).toBe(true)
    expect(canSelectWiringStandardProfile('NEMA_NFPA')).toBe(false)
    expect(canSelectWiringStandardProfile('JIS')).toBe(false)
  })

  it('never disguises source-gated NEMA/JIS as IEC output', () => {
    expect(WIRING_STANDARD_PROFILES.NEMA_NFPA.availability).toBe('SOURCE_GATED')
    expect(WIRING_STANDARD_PROFILES.JIS.availability).toBe('SOURCE_GATED')
    expect(wiringEvidenceForProfile('NEMA_NFPA').every((source) => source.authority === 'NFPA' || source.authority === 'NEMA')).toBe(true)
    expect(wiringEvidenceForProfile('JIS').every((source) => source.authority === 'JISC')).toBe(true)
  })
})
