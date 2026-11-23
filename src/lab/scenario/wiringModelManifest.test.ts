import { describe, expect, it } from 'vitest'
import { WIRING_MODEL_IDS } from '../../engine/index'
import { PALETTE } from './topic1a'
import {
  validateWiringModelManifest,
  WIRING_MODEL_MANIFEST,
} from './wiringModelManifest'

describe('wiring model publication manifest', () => {
  it('covers all 64 palette identities exactly once', () => {
    expect(WIRING_MODEL_IDS).toHaveLength(64)
    expect(PALETTE).toHaveLength(64)
    expect(new Set(PALETTE.map((item) => item.key)).size).toBe(64)
    expect(Object.keys(WIRING_MODEL_MANIFEST)).toHaveLength(64)
    expect(validateWiringModelManifest()).toEqual([])
  })

  it('publishes only source-referenced dedicated product bodies as verified', () => {
    expect(WIRING_MODEL_MANIFEST.PHASE_MONITOR_RM17TG20.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.AUX_CONTACT_LADN22.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.KEY_SELECTOR_XB5AG21.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.ILLUMINATED_PB_XB5AW33B5.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.MOTOR_BREAKER_GV2ME14.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.TERMINAL_UT25_BU.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.TERMINAL_UT25_PE.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.TERMINAL_UT4_HESI.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.TERMINAL_UT4_MT.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.TERMINAL_UT25_TWIN.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.TERMINAL_UT25_QUATTRO.virtualAsset).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.TERMINAL_UT25_PE_LL.virtualAsset).toBe('VERIFIED')

    const catalogProducts = Object.values(WIRING_MODEL_MANIFEST)
      .filter((entry) => entry.representation === 'CATALOG_PRODUCT')
    expect(catalogProducts.every((entry) => entry.virtualAsset === 'VERIFIED')).toBe(true)
  })

  it('keeps only the two explicitly output-side source models limited', () => {
    const limited = Object.values(WIRING_MODEL_MANIFEST)
      .filter((entry) => entry.publication === 'LIMITED')
      .map((entry) => entry.modelId)
    expect(limited).toEqual(['DIN_PSU_HDR3024', 'CONTROL_TRANSFORMER_ABL6TS25B'])
    expect(WIRING_MODEL_MANIFEST.PHASE_MONITOR_RM17TG20.solverBehaviour).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.PUSHBUTTON_STATION_XB5AL73415.solverBehaviour).toBe('VERIFIED')
    expect(WIRING_MODEL_MANIFEST.ILLUMINATED_PB_XB5AW33B5.solverBehaviour).toBe('VERIFIED')
  })
})
