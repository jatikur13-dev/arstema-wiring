/**
 * Wiring standard profiles.
 *
 * A profile is a presentation/validation boundary, not a theme.  The simulator
 * must never draw an IEC symbol and label it as NEMA or JIS merely because the
 * user changed a selector.  Profiles that do not yet have an evidence-backed
 * symbol + terminal + behaviour pack therefore remain SOURCE_GATED.
 */

export type WiringStandardProfileId = 'IEC_PUIL' | 'NEMA_NFPA' | 'JIS'

export type WiringStandardAvailability = 'AVAILABLE' | 'SOURCE_GATED'

export interface WiringStandardProfile {
  id: WiringStandardProfileId
  shortLabel: string
  label: string
  region: string
  availability: WiringStandardAvailability
  /** Evidence records that establish the pack boundary. */
  evidenceIds: readonly string[]
  /** Deliberately plain-language: this is displayed inside the app. */
  note: string
}

export const DEFAULT_WIRING_STANDARD_PROFILE: WiringStandardProfileId = 'IEC_PUIL'

export const WIRING_STANDARD_PROFILES: Readonly<Record<WiringStandardProfileId, WiringStandardProfile>> = {
  IEC_PUIL: {
    id: 'IEC_PUIL',
    shortLabel: 'IEC / PUIL',
    label: 'IEC 60617 + PUIL (Indonesia)',
    region: 'IEC / Indonesia',
    availability: 'AVAILABLE',
    evidenceIds: ['PUIL_2020_ESDM', 'IEC_60617_DB', 'IEC_60445', 'IEC_61082_1'],
    note: 'Profil aktif. Cakupan tiap keluarga tetap diperiksa sebelum dipublikasikan.',
  },
  NEMA_NFPA: {
    id: 'NEMA_NFPA',
    shortLabel: 'NEMA / NFPA',
    label: 'NEMA / NFPA 79 (North America)',
    region: 'North America',
    availability: 'SOURCE_GATED',
    evidenceIds: ['NFPA_79_2024', 'NEMA_ESPG'],
    note: 'Belum dapat dipilih sampai simbol, penomoran terminal, perilaku, dan contoh rangkaiannya diverifikasi sebagai satu pack.',
  },
  JIS: {
    id: 'JIS',
    shortLabel: 'JIS',
    label: 'JIS (Japan)',
    region: 'Japan',
    availability: 'SOURCE_GATED',
    evidenceIds: ['JISC_STANDARD_REGISTRY'],
    note: 'Belum dapat dipilih sampai sumber primer dan pack JIS lengkap tersedia.',
  },
} as const

export function isWiringStandardProfileId(value: unknown): value is WiringStandardProfileId {
  return value === 'IEC_PUIL' || value === 'NEMA_NFPA' || value === 'JIS'
}

export function selectableWiringStandardProfiles(): readonly WiringStandardProfile[] {
  return Object.values(WIRING_STANDARD_PROFILES).filter((profile) => profile.availability === 'AVAILABLE')
}

export function canSelectWiringStandardProfile(id: WiringStandardProfileId): boolean {
  return WIRING_STANDARD_PROFILES[id].availability === 'AVAILABLE'
}
