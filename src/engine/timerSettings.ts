/**
 * User-facing timer setting helpers.
 *
 * The engine stores milliseconds because stepping is deterministic. The editor
 * exposes the same value as minutes + seconds (0.1 s resolution) and converts
 * only at this boundary, so display changes never alter timerPhase semantics.
 */

/** Omron H3DT-G star-time range and selectable transfer times. */
export const TIMER_MAX_MINUTES = 2
export const TIMER_MAX_SECONDS = 59.9
export const TIMER_MAX_DURATION_MS = 120_000
export const TIMER_STAR_MIN_MS = 1_000
export const TIMER_TRANSFER_OPTIONS_MS = [50, 100, 250, 500] as const

export interface TimerDurationParts {
  minutes: number
  seconds: number
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/** Clamp to the physical editor range and a stable 0.1-second resolution. */
export function clampTimerDurationMs(value: number, minimumMs = 0): number {
  const minimum = Math.max(0, finiteOrZero(minimumMs))
  const clamped = Math.min(
    TIMER_MAX_DURATION_MS,
    Math.max(minimum, finiteOrZero(value)),
  )
  return Math.round(clamped / 100) * 100
}

/** Clamp the H3DT-G STAR dial to its documented 1–120 second range. */
export function clampTimerStarDurationMs(value: number): number {
  return clampTimerDurationMs(value, TIMER_STAR_MIN_MS)
}

/** Snap transfer time to the closest real H3DT-G selector position. */
export function clampTimerTransferDelayMs(value: number): number {
  const safe = Math.max(0, finiteOrZero(value))
  return TIMER_TRANSFER_OPTIONS_MS.reduce((closest, option) =>
    Math.abs(option - safe) < Math.abs(closest - safe) ? option : closest,
  )
}

/** Convert editor fields into deterministic engine milliseconds. */
export function timerDurationFromParts(
  minutes: number,
  seconds: number,
  minimumMs = 0,
): number {
  const safeMinutes = Math.min(
    TIMER_MAX_MINUTES,
    Math.max(0, Math.trunc(finiteOrZero(minutes))),
  )
  const safeSeconds = Math.min(
    TIMER_MAX_SECONDS,
    Math.max(0, finiteOrZero(seconds)),
  )
  return clampTimerDurationMs(
    safeMinutes * 60_000 + safeSeconds * 1000,
    minimumMs,
  )
}

/** Convert stored milliseconds back to minute/second fields without drift. */
export function timerDurationParts(valueMs: number): TimerDurationParts {
  const safe = clampTimerDurationMs(valueMs)
  const minutes = Math.floor(safe / 60_000)
  const seconds = Math.round(((safe - minutes * 60_000) / 1000) * 10) / 10
  return { minutes, seconds }
}

/** Compact device/readout text: 05.0 s below one minute, otherwise 01:05.0. */
export function formatTimerDuration(valueMs: number): string {
  const { minutes, seconds } = timerDurationParts(valueMs)
  if (minutes === 0) return `${seconds.toFixed(1)} s`
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`
}
