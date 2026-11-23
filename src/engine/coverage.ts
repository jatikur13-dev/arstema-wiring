import { missingWiringEvidence } from './evidence'
import type { WiringStandardProfileId } from './standards'

export type WiringCoverageStatus = 'CURRENT' | 'PARTIAL' | 'SOURCE_GATED' | 'PLANNED'

export type WiringCoverageFamily =
  | 'SUPPLY_AND_EARTHING'
  | 'PROTECTION'
  | 'MANUAL_CONTROL'
  | 'RELAYS_AND_CONTACTORS'
  | 'MOTOR_CONTROL'
  | 'SENSORS_AND_LIMITS'
  | 'TERMINALS_AND_DISTRIBUTION'
  | 'MEASUREMENT'
  | 'DRIVES_AND_SOFT_STARTERS'
  | 'PLC_AND_SAFETY'
  | 'BUILDING_CONTROL'
  | 'DC_AND_BATTERY'

export interface WiringCoverageEntry {
  family: WiringCoverageFamily
  label: string
  profile: WiringStandardProfileId
  status: WiringCoverageStatus
  playableComponentKinds: readonly string[]
  playableExampleIds: readonly string[]
  evidenceIds: readonly string[]
  note: string
}

const IEC_SOURCE_GATED_NOTE = 'Belum boleh disebut lengkap sebelum simbol, terminal, perilaku, animasi, dan contoh rangkaian lolos review.'

export const WIRING_COVERAGE_REGISTRY: readonly WiringCoverageEntry[] = [
  {
    family: 'SUPPLY_AND_EARTHING',
    label: 'Sumber, neutral, PE, dan pembumian',
    profile: 'IEC_PUIL',
    status: 'PARTIAL',
    playableComponentKinds: ['SOURCE', 'SOURCE_3PH', 'GROUND'],
    playableExampleIds: [],
    evidenceIds: ['PUIL_2020_ESDM', 'IEC_60445'],
    note: IEC_SOURCE_GATED_NOTE,
  },
  {
    family: 'PROTECTION',
    label: 'Fuse, MCB, overload, dan proteksi dasar',
    profile: 'IEC_PUIL',
    status: 'PARTIAL',
    playableComponentKinds: ['FUSE', 'BREAKER_1P', 'BREAKER_3P', 'OVERLOAD_RELAY'],
    playableExampleIds: [],
    evidenceIds: ['PUIL_2020_ESDM', 'IEC_60947_SERIES'],
    note: 'Perilaku trip bersifat edukatif dan tidak boleh dipakai untuk koordinasi proteksi nyata.',
  },
  {
    family: 'MANUAL_CONTROL',
    label: 'Saklar, pushbutton, selector, dan E-stop',
    profile: 'IEC_PUIL',
    status: 'CURRENT',
    playableComponentKinds: ['SWITCH', 'SWITCH_2WAY', 'SWITCH_CROSS', 'PUSHBUTTON', 'SELECTOR_3POS', 'ESTOP'],
    playableExampleIds: [],
    evidenceIds: ['IEC_60617_DB', 'IEC_60204_1'],
    note: 'Simulasi fungsi kontak; bukan validasi safety function.',
  },
  {
    family: 'RELAYS_AND_CONTACTORS',
    label: 'Relay, timer, kontaktor, dan interlock',
    profile: 'IEC_PUIL',
    status: 'PARTIAL',
    playableComponentKinds: ['RELAY', 'TIMER', 'CONTACTOR'],
    playableExampleIds: [],
    evidenceIds: ['IEC_60617_DB', 'IEC_60947_SERIES'],
    note: IEC_SOURCE_GATED_NOTE,
  },
  {
    family: 'MOTOR_CONTROL',
    label: 'Motor 1/3 fasa dan starter',
    profile: 'IEC_PUIL',
    status: 'PARTIAL',
    playableComponentKinds: ['MOTOR', 'MOTOR_3PH', 'CAPACITOR', 'CONTACTOR', 'TIMER', 'OVERLOAD_RELAY'],
    playableExampleIds: [],
    evidenceIds: ['IEC_60034_SERIES', 'IEC_60204_1', 'IEC_60947_SERIES'],
    note: 'Model motor masih edukatif; arus start, torsi, harmonisa, dan koordinasi nyata tidak dihitung.',
  },
  {
    family: 'SENSORS_AND_LIMITS',
    label: 'Sensor proses dan limit switch',
    profile: 'IEC_PUIL',
    status: 'PARTIAL',
    playableComponentKinds: ['SENSOR_3WIRE', 'LIMIT_SWITCH', 'CONTACT_2STATE'],
    playableExampleIds: [],
    evidenceIds: ['IEC_60617_DB', 'IEC_60204_1'],
    note: IEC_SOURCE_GATED_NOTE,
  },
  {
    family: 'TERMINALS_AND_DISTRIBUTION',
    label: 'Terminal block dan distribusi',
    profile: 'IEC_PUIL',
    status: 'PARTIAL',
    playableComponentKinds: ['TERMINAL_BLOCK'],
    playableExampleIds: [],
    evidenceIds: ['IEC_60445', 'IEC_61082_1'],
    note: IEC_SOURCE_GATED_NOTE,
  },
  ...(['MEASUREMENT', 'DRIVES_AND_SOFT_STARTERS', 'PLC_AND_SAFETY', 'BUILDING_CONTROL', 'DC_AND_BATTERY'] as const).map(
    (family): WiringCoverageEntry => ({
      family,
      label: family.replace(/_/g, ' '),
      profile: 'IEC_PUIL',
      status: 'PLANNED',
      playableComponentKinds: [],
      playableExampleIds: [],
      evidenceIds: [],
      note: 'Belum dipublikasikan sebagai komponen playable.',
    }),
  ),
  ...(['NEMA_NFPA', 'JIS'] as const).flatMap((profile) =>
    (['SUPPLY_AND_EARTHING', 'PROTECTION', 'MANUAL_CONTROL', 'RELAYS_AND_CONTACTORS', 'MOTOR_CONTROL', 'SENSORS_AND_LIMITS', 'TERMINALS_AND_DISTRIBUTION', 'MEASUREMENT', 'DRIVES_AND_SOFT_STARTERS', 'PLC_AND_SAFETY', 'BUILDING_CONTROL', 'DC_AND_BATTERY'] as const).map(
      (family): WiringCoverageEntry => ({
        family,
        label: family.replace(/_/g, ' '),
        profile,
        status: 'SOURCE_GATED',
        playableComponentKinds: [],
        playableExampleIds: [],
        evidenceIds: profile === 'NEMA_NFPA' ? ['NFPA_79_2024', 'NEMA_ESPG'] : ['JISC_STANDARD_REGISTRY'],
        note: 'Tidak dirender memakai aset IEC. Menunggu pack standar yang terpisah dan terverifikasi.',
      }),
    ),
  ),
] as const

export interface WiringPublicationCandidate {
  profile: WiringStandardProfileId
  family: WiringCoverageFamily
  evidenceIds: readonly string[]
  hasTerminalContract: boolean
  hasSolverBehaviour: boolean
  hasVirtualProjection: boolean
  hasDiagramProjection: boolean
  hasAnimationCoverage: boolean
  hasPersistenceCoverage: boolean
  hasRegressionTests: boolean
}

export interface WiringPublicationGateResult {
  allowed: boolean
  reasons: string[]
}

/** A deterministic gate: no UI override can turn a partial pack into published. */
export function evaluateWiringPublication(candidate: WiringPublicationCandidate): WiringPublicationGateResult {
  const reasons: string[] = []
  const coverage = WIRING_COVERAGE_REGISTRY.find(
    (entry) => entry.profile === candidate.profile && entry.family === candidate.family,
  )
  if (!coverage) reasons.push('Coverage family tidak terdaftar.')
  else if (coverage.status !== 'CURRENT') reasons.push(`Coverage masih ${coverage.status}.`)

  for (const missing of missingWiringEvidence(candidate.evidenceIds)) {
    reasons.push(`Evidence tidak dikenal: ${missing}.`)
  }
  if (candidate.evidenceIds.length === 0) reasons.push('Evidence primer belum ditautkan.')
  if (!candidate.hasTerminalContract) reasons.push('Kontrak terminal belum lengkap.')
  if (!candidate.hasSolverBehaviour) reasons.push('Perilaku solver belum lengkap.')
  if (!candidate.hasVirtualProjection) reasons.push('Proyeksi papan virtual belum lengkap.')
  if (!candidate.hasDiagramProjection) reasons.push('Proyeksi diagram belum lengkap.')
  if (!candidate.hasAnimationCoverage) reasons.push('Animasi state belum diuji.')
  if (!candidate.hasPersistenceCoverage) reasons.push('Save/reload belum diuji.')
  if (!candidate.hasRegressionTests) reasons.push('Regression test belum lengkap.')
  return { allowed: reasons.length === 0, reasons }
}

export function wiringCoverageSummary(profile: WiringStandardProfileId): Record<WiringCoverageStatus, number> {
  const result: Record<WiringCoverageStatus, number> = { CURRENT: 0, PARTIAL: 0, SOURCE_GATED: 0, PLANNED: 0 }
  for (const entry of WIRING_COVERAGE_REGISTRY) {
    if (entry.profile === profile) result[entry.status] += 1
  }
  return result
}
