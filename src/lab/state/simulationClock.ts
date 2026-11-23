/** Fixed electrical-engine step. Do not change without re-validating timers/protection. */
export const CIRCUIT_SIMULATION_STEP_MS = 20

/**
 * React/SVG commits are intentionally capped near 30 fps. The engine still receives
 * every 20 ms fixed step, so a 60/90/120 Hz screen cannot make electrical time run
 * faster and a slower phone does not lose timer/protection steps.
 */
export const CIRCUIT_RENDER_INTERVAL_MS = 1000 / 30

/** Never fast-forward a long background/suspended interval on resume. */
const MAX_FRAME_GAP_MS = 100

export interface SimulationClockState {
  simulationRemainderMs: number
  renderRemainderMs: number
}

export const INITIAL_SIMULATION_CLOCK: SimulationClockState = {
  simulationRemainderMs: 0,
  renderRemainderMs: 0,
}

export interface SimulationFrameBatch {
  clock: SimulationClockState
  steps: number
}

export function advanceSimulationClock(
  clock: SimulationClockState,
  elapsedMs: number,
  renderIntervalMs = CIRCUIT_RENDER_INTERVAL_MS,
): SimulationFrameBatch {
  const elapsed = Number.isFinite(elapsedMs)
    ? Math.min(MAX_FRAME_GAP_MS, Math.max(0, elapsedMs))
    : 0
  const simulationRemainderMs = clock.simulationRemainderMs + elapsed
  const renderElapsed = clock.renderRemainderMs + elapsed

  const commitInterval =
    Number.isFinite(renderIntervalMs) && renderIntervalMs > 0
      ? renderIntervalMs
      : CIRCUIT_RENDER_INTERVAL_MS

  if (renderElapsed + Number.EPSILON < commitInterval) {
    return {
      clock: { simulationRemainderMs, renderRemainderMs: renderElapsed },
      steps: 0,
    }
  }

  const steps = Math.floor(simulationRemainderMs / CIRCUIT_SIMULATION_STEP_MS)
  return {
    clock: {
      simulationRemainderMs:
        simulationRemainderMs - steps * CIRCUIT_SIMULATION_STEP_MS,
      renderRemainderMs: renderElapsed % commitInterval,
    },
    steps,
  }
}
