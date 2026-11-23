import type { Board } from './types'
import { boardDomain } from './types'

export function circuitRunRequirements(board: Board): string[] {
  const issues = board.reference?.conflicts.filter((c) => !c.resolved).map((c) => c.description) ?? []
  const ac = boardDomain(board) === 'ac-three-phase-balanced'
  for (const c of Object.values(board.components)) {
    const s = c.spec
    if (s.kind === 'TIMER' && s.model === 'GENERIC_CONFIGURABLE' &&
      (!s.configured || !['A','B','B2','E','J'].includes(s.mode ?? '') || !Number.isFinite(s.starDurationMs) || s.starDurationMs <= 0 || s.starDurationMs > 86400000)) {
      issues.push(`${c.id}: pilih mode dan isi waktu timer simulasi sebelum Run.`)
    }
    if (s.kind === 'SOURCE' && s.transformer && (!ac ||
      !Number.isFinite(s.transformer.primaryVolts) || s.transformer.primaryVolts <= 0 ||
      !Array.isArray(s.transformer.tapVolts) || s.transformer.tapVolts.length !== 2 || !s.transformer.tapVolts.every(v=>Number.isFinite(v)&&v>0))) {
      issues.push(`${c.id}: trafo membutuhkan domain AC tiga fasa dan rasio tap positif yang sah.`)
    }
    if (s.kind === 'LOAD' && s.threePhase && (!ac ||
      !Number.isFinite(s.threePhase.powerWatts) || s.threePhase.powerWatts <= 0 || !Number.isFinite(s.threePhase.lineVolts) || s.threePhase.lineVolts <= 0)) {
      issues.push(`${c.id}: beban tiga fasa membutuhkan daya/tegangan positif dan domain AC tiga fasa.`)
    }
    if (s.kind === 'CONTACT_2STATE' && s.drivenBy &&
      board.components[s.drivenBy.id]?.spec.kind !== (s.drivenBy.kind === 'relay' ? 'RELAY' : 'CONTACTOR')) {
      issues.push(`${c.id}: koil penggerak ${s.drivenBy.id} tidak tersedia.`)
    }
  }
  return issues
}
