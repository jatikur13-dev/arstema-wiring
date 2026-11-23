import { describe, expect, it } from 'vitest'
import { WIRING_ENGINEERING_SCOPE, WIRING_ROADMAP, duplicateWiringRoadmapIds, wiringRoadmapSummary } from './roadmap'

describe('bounded Wiring field map', () => {
  it('defines the LV/industrial voltage boundary and phased delivery map', () => {
    expect(WIRING_ENGINEERING_SCOPE.maxVac).toBe(1000)
    expect(WIRING_ENGINEERING_SCOPE.maxVdc).toBe(1500)
    expect(WIRING_ROADMAP.map((phase) => phase.id)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])
  })

  it('has stable unique identifiers and never silently calls source-gated work playable', () => {
    expect(duplicateWiringRoadmapIds()).toEqual([])
    const summary = wiringRoadmapSummary()
    expect(summary.PLAYABLE_VERIFIED).toBeGreaterThan(20)
    expect(summary.SOURCE_GATED).toBeGreaterThan(20)
  })
})
