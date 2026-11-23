/**
 * Rendering policy for the Wiring lab.
 *
 * Electrical time and topology never depend on this profile. The profile only
 * changes how often React commits a frame, how many moving current markers are
 * drawn, and how aggressively drag-routing jobs are coalesced. That distinction
 * keeps a low-end Android device electrically identical to a fast phone.
 */

export type CircuitRenderTier = 'economy' | 'balanced' | 'performance'

export interface CircuitRenderProfile {
  tier: CircuitRenderTier
  maxFps: number
  markerSpacingPx: number
  routingDebounceMs: number
}

export interface CircuitDeviceSignals {
  hardwareConcurrency?: number
  deviceMemoryGb?: number
}

export const CIRCUIT_RENDER_PROFILES: Readonly<Record<CircuitRenderTier, CircuitRenderProfile>> = {
  economy: {
    tier: 'economy',
    maxFps: 24,
    markerSpacingPx: 44,
    routingDebounceMs: 56,
  },
  balanced: {
    tier: 'balanced',
    maxFps: 30,
    markerSpacingPx: 32,
    routingDebounceMs: 32,
  },
  performance: {
    tier: 'performance',
    maxFps: 30,
    markerSpacingPx: 22,
    routingDebounceMs: 24,
  },
}

/**
 * Conservative, deterministic classification. Missing browser hints select the
 * balanced path; they never make us assume a powerful device. `deviceMemory` is
 * a Chromium/WebView hint (not a measurement), so it is used only to reduce
 * visual work and never to change solver behaviour.
 */
export function selectCircuitRenderProfile(
  signals: CircuitDeviceSignals,
): CircuitRenderProfile {
  const cores = finitePositive(signals.hardwareConcurrency)
  const memory = finitePositive(signals.deviceMemoryGb)

  if ((cores !== undefined && cores <= 4) || (memory !== undefined && memory <= 3)) {
    return CIRCUIT_RENDER_PROFILES.economy
  }
  if (
    cores === undefined ||
    memory === undefined ||
    cores <= 6 ||
    memory <= 4
  ) {
    return CIRCUIT_RENDER_PROFILES.balanced
  }
  return CIRCUIT_RENDER_PROFILES.performance
}

function finitePositive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}

interface NavigatorWithDeviceMemory extends Navigator {
  readonly deviceMemory?: number
}

export function browserCircuitDeviceSignals(): CircuitDeviceSignals {
  if (typeof navigator === 'undefined') return {}
  const browser = navigator as NavigatorWithDeviceMemory
  return {
    hardwareConcurrency: browser.hardwareConcurrency,
    deviceMemoryGb: browser.deviceMemory,
  }
}
