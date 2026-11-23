import { describe, expect, it } from 'vitest'
import {
  CIRCUIT_RENDER_PROFILES,
  selectCircuitRenderProfile,
} from './renderProfile'

describe('adaptive Wiring render profile', () => {
  it('uses the economy profile for a four-core or memory-constrained phone', () => {
    expect(selectCircuitRenderProfile({ hardwareConcurrency: 4, deviceMemoryGb: 8 }))
      .toBe(CIRCUIT_RENDER_PROFILES.economy)
    expect(selectCircuitRenderProfile({ hardwareConcurrency: 8, deviceMemoryGb: 3 }))
      .toBe(CIRCUIT_RENDER_PROFILES.economy)
  })

  it('defaults unknown and mid-range devices to the balanced profile', () => {
    expect(selectCircuitRenderProfile({})).toBe(CIRCUIT_RENDER_PROFILES.balanced)
    expect(selectCircuitRenderProfile({ hardwareConcurrency: 8, deviceMemoryGb: 4 }))
      .toBe(CIRCUIT_RENDER_PROFILES.balanced)
  })

  it('uses the full visual profile only when both available hints are strong', () => {
    expect(selectCircuitRenderProfile({ hardwareConcurrency: 8, deviceMemoryGb: 8 }))
      .toBe(CIRCUIT_RENDER_PROFILES.performance)
  })

  it('reduces visual work without changing any electrical-step constant', () => {
    expect(CIRCUIT_RENDER_PROFILES.economy.maxFps)
      .toBeLessThan(CIRCUIT_RENDER_PROFILES.performance.maxFps)
    expect(CIRCUIT_RENDER_PROFILES.economy.markerSpacingPx)
      .toBeGreaterThan(CIRCUIT_RENDER_PROFILES.performance.markerSpacingPx)
    expect(CIRCUIT_RENDER_PROFILES.economy.routingDebounceMs)
      .toBeGreaterThan(CIRCUIT_RENDER_PROFILES.performance.routingDebounceMs)
  })
})
