import { describe, expect, it } from 'vitest'
import {
  formatTimerDuration,
  clampTimerTransferDelayMs,
  TIMER_MAX_DURATION_MS,
  timerDurationFromParts,
  timerDurationParts,
} from './timerSettings'

describe('timer minute/second editor boundary', () => {
  it('round-trips minute and second fields at 0.1-second resolution', () => {
    expect(timerDurationFromParts(1, 5.5)).toBe(65_500)
    expect(timerDurationParts(65_500)).toEqual({ minutes: 1, seconds: 5.5 })
  })

  it('clamps the STAR editor to the H3DT-G 120 second ceiling', () => {
    expect(timerDurationFromParts(120, 80)).toBe(TIMER_MAX_DURATION_MS)
    expect(timerDurationFromParts(-1, -5)).toBe(0)
  })

  it('snaps transfer delay to a real H3DT-G selector position', () => {
    expect(clampTimerTransferDelayMs(40)).toBe(50)
    expect(clampTimerTransferDelayMs(230)).toBe(250)
    expect(clampTimerTransferDelayMs(420)).toBe(500)
  })

  it('formats the exact configured number for the device face', () => {
    expect(formatTimerDuration(5_000)).toBe('5.0 s')
    expect(formatTimerDuration(65_500)).toBe('01:05.5')
  })
})
