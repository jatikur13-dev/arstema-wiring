import {
  WIRING_MODEL_IDS,
  type WiringModelId,
} from '../../engine/index'
import { PALETTE } from './topic1a'

export type ModelVerificationState = 'VERIFIED' | 'LIMITED' | 'PENDING'

export interface WiringModelManifestEntry {
  modelId: WiringModelId
  representation: 'GENERIC' | 'CATALOG_PRODUCT'
  manufacturer?: string
  catalogModel?: string
  primarySource: string
  virtualAsset: ModelVerificationState
  terminalContract: ModelVerificationState
  iecProjection: ModelVerificationState
  solverBehaviour: ModelVerificationState
  animation: ModelVerificationState
  publication: 'READY' | 'LIMITED'
  limitation?: string
}

/** Product bodies that have a dedicated, source-referenced Virtual asset. */
const VERIFIED_PRODUCT_VIRTUAL = new Set<WiringModelId>([
  'DIN_PSU_HDR3024',
  'CONTROL_TRANSFORMER_ABL6TS25B',
  'DISCONNECTOR_VCF1',
  'MOTOR_BREAKER_GV2ME14',
  'PHASE_MONITOR_RM17TG20',
  'AUX_CONTACT_LADN22',
  'SELECTOR_XB5AD21',
  'KEY_SELECTOR_XB5AG21',
  'PUSHBUTTON_STATION_XB5AL73415',
  'ILLUMINATED_PB_XB5AW33B5',
  'FLOAT_SWITCH_9037HG33',
  'PRESSURE_SWITCH_XMLB004',
  'THERMOSTAT_NSYCCOTHC',
  'TIMER_H3CR_A8',
  'TERMINAL_UT25_BU',
  'TERMINAL_UT25_PE',
  'TERMINAL_UT4_HESI',
  'TERMINAL_UT4_MT',
  'TERMINAL_UT25_TWIN',
  'TERMINAL_UT25_QUATTRO',
  'TERMINAL_UT25_PE_LL',
  'SENSOR_E3Z_D61_NPN_LIGHT',
  'SENSOR_E3Z_D61_NPN_DARK',
  'SENSOR_E3Z_D81_PNP_DARK',
  'SENSOR_E2K_X4ME1',
])

const EXACT_MODEL_TERMINALS = new Set<WiringModelId>([
  'DISCONNECTOR_VCF1',
  'MOTOR_BREAKER_GV2ME14',
  'PHASE_MONITOR_RM17TG20',
  'AUX_CONTACT_LADN22',
  'TIMER_H3CR_A8',
  'SELECTOR_XB5AD21',
  'KEY_SELECTOR_XB5AG21',
  'PUSHBUTTON_STATION_XB5AL73415',
  'ILLUMINATED_PB_XB5AW33B5',
  'SENSOR_E3Z_D61_NPN_LIGHT',
  'SENSOR_E3Z_D61_NPN_DARK',
  'SENSOR_E3Z_D81_PNP_DARK',
  'SENSOR_E2K_X4ME1',
  'TERMINAL_UT25_BU',
  'TERMINAL_UT25_PE',
  'TERMINAL_UT4_HESI',
  'TERMINAL_UT4_MT',
  'TERMINAL_UT25_TWIN',
  'TERMINAL_UT25_QUATTRO',
  'TERMINAL_UT25_PE_LL',
  'FLOAT_SWITCH_9037HG33',
  'PRESSURE_SWITCH_XMLB004',
  'THERMOSTAT_NSYCCOTHC',
])

const SOLVER_LIMITED = new Set<WiringModelId>([
  'CONTROL_TRANSFORMER_ABL6TS25B',
])

const GENERIC_PRIMARY_SOURCE = 'IEC 60617 / IEC 60445 functional teaching contract'

export const WIRING_MODEL_MANIFEST: Readonly<Record<WiringModelId, WiringModelManifestEntry>> =
  Object.freeze(Object.fromEntries(PALETTE.map((item) => {
    const product = Boolean(item.manufacturer && item.model)
    const virtualAsset: ModelVerificationState = !product || VERIFIED_PRODUCT_VIRTUAL.has(item.key)
      ? 'VERIFIED'
      : 'PENDING'
    const terminalContract: ModelVerificationState = !product || EXACT_MODEL_TERMINALS.has(item.key)
      ? 'VERIFIED'
      : 'LIMITED'
    const solverBehaviour: ModelVerificationState = SOLVER_LIMITED.has(item.key)
      ? 'LIMITED'
      : 'VERIFIED'
    const ready = virtualAsset === 'VERIFIED' && terminalContract === 'VERIFIED' && solverBehaviour === 'VERIFIED'
    return [item.key, {
      modelId: item.key,
      representation: product ? 'CATALOG_PRODUCT' : 'GENERIC',
      ...(item.manufacturer ? { manufacturer: item.manufacturer } : {}),
      ...(item.model ? { catalogModel: item.model } : {}),
      primarySource: item.datasheetUrl ?? GENERIC_PRIMARY_SOURCE,
      virtualAsset,
      terminalContract,
      iecProjection: terminalContract,
      solverBehaviour,
      animation: solverBehaviour,
      publication: ready ? 'READY' : 'LIMITED',
      ...(!ready ? {
        limitation: virtualAsset === 'PENDING'
          ? 'Badan Virtual khusus produk belum lolos verifikasi; fungsi listrik tetap memakai kontrak yang dinyatakan.'
          : 'Model bersifat edukasional terbatas sesuai batas simulasi pada panel info.',
      } : {}),
    } satisfies WiringModelManifestEntry]
  })) as Record<WiringModelId, WiringModelManifestEntry>)

/** Startup/test assertion used as a deterministic publication boundary. */
export function validateWiringModelManifest(): string[] {
  const issues: string[] = []
  const paletteIds = new Set(PALETTE.map((item) => item.key))
  for (const id of WIRING_MODEL_IDS) {
    const entry = WIRING_MODEL_MANIFEST[id]
    if (!paletteIds.has(id)) issues.push(`${id}: tidak ada di palette`)
    if (!entry) issues.push(`${id}: manifest hilang`)
    else if (!entry.primarySource.trim()) issues.push(`${id}: sumber primer kosong`)
  }
  for (const item of PALETTE) {
    if (!WIRING_MODEL_MANIFEST[item.key]) issues.push(`${item.key}: tidak ada di manifest`)
  }
  return issues
}

export function wiringModelManifest(modelId: WiringModelId): WiringModelManifestEntry {
  return WIRING_MODEL_MANIFEST[modelId]
}
