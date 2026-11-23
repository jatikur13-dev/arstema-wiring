import { describe, expect, it } from 'vitest'
import { evaluateWiringPublication, wiringCoverageSummary } from './coverage'

describe('Wiring publication gate', () => {
  it('allows a CURRENT family only when every engineering seam has coverage', () => {
    const result = evaluateWiringPublication({
      profile: 'IEC_PUIL',
      family: 'MANUAL_CONTROL',
      evidenceIds: ['IEC_60617_DB', 'IEC_60204_1'],
      hasTerminalContract: true,
      hasSolverBehaviour: true,
      hasVirtualProjection: true,
      hasDiagramProjection: true,
      hasAnimationCoverage: true,
      hasPersistenceCoverage: true,
      hasRegressionTests: true,
    })
    expect(result).toEqual({ allowed: true, reasons: [] })
  })

  it('blocks a partial pack even if its booleans are optimistically set', () => {
    const result = evaluateWiringPublication({
      profile: 'IEC_PUIL',
      family: 'MOTOR_CONTROL',
      evidenceIds: ['IEC_60034_SERIES'],
      hasTerminalContract: true,
      hasSolverBehaviour: true,
      hasVirtualProjection: true,
      hasDiagramProjection: true,
      hasAnimationCoverage: true,
      hasPersistenceCoverage: true,
      hasRegressionTests: true,
    })
    expect(result.allowed).toBe(false)
    expect(result.reasons).toContain('Coverage masih PARTIAL.')
  })

  it('keeps every NEMA/JIS family source-gated', () => {
    expect(wiringCoverageSummary('NEMA_NFPA')).toEqual({ CURRENT: 0, PARTIAL: 0, SOURCE_GATED: 12, PLANNED: 0 })
    expect(wiringCoverageSummary('JIS')).toEqual({ CURRENT: 0, PARTIAL: 0, SOURCE_GATED: 12, PLANNED: 0 })
  })
})
