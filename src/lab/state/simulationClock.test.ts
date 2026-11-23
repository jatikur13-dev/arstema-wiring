import { describe, expect, it } from 'vitest'
import {
  advanceSimulationClock,
  CIRCUIT_SIMULATION_STEP_MS,
  INITIAL_SIMULATION_CLOCK,
} from './simulationClock'

describe('Circuit Lab simulation clock', () => {
  it.each([30, 60, 90, 120])(
    'keeps approximately one real second at a %d Hz display without per-refresh acceleration',
    (refreshRate) => {
      let clock = INITIAL_SIMULATION_CLOCK
      let steps = 0
      let commits = 0
      for (let frame = 0; frame < refreshRate; frame += 1) {
        const batch = advanceSimulationClock(clock, 1000 / refreshRate)
        clock = batch.clock
        steps += batch.steps
        if (batch.steps > 0) commits += 1
      }
      expect(steps * CIRCUIT_SIMULATION_STEP_MS).toBeGreaterThanOrEqual(960)
      expect(steps * CIRCUIT_SIMULATION_STEP_MS).toBeLessThanOrEqual(1000)
      expect(commits).toBeLessThanOrEqual(30)
    },
  )

  it('caps catch-up after a background or suspended frame', () => {
    const batch = advanceSimulationClock(INITIAL_SIMULATION_CLOCK, 10_000)
    expect(batch.steps).toBe(5)
  })

  it('does not request a React commit before the render interval', () => {
    expect(advanceSimulationClock(INITIAL_SIMULATION_CLOCK, 8).steps).toBe(0)
  })

  it('can lower visual commit cadence without changing fixed 20 ms solver steps', () => {
    let clock = INITIAL_SIMULATION_CLOCK
    let steps = 0
    for (let frame = 0; frame < 60; frame += 1) {
      const batch = advanceSimulationClock(clock, 1000 / 60, 1000 / 24)
      clock = batch.clock
      steps += batch.steps
    }
    expect(steps).toBe(50)
  })
})
