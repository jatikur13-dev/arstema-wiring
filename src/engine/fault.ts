/**
 * Faults — the engine names WHY a circuit broke; it never phrases it.
 *
 * A FaultRecord carries a machine `code` and the measured values captured at the
 * instant of the trip. The human sentence ("L and N are joined with no load, so
 * the current is unlimited…") is assembled in the feature layer (diagnose/), not
 * here. That separation is the core of the diagnosable requirement: the state
 * that caused the failure is visible before, and the explanation is derived
 * after — and neither is baked into the mathematics.
 */

import type { ComponentId } from './types'

/** SHORT_CIRCUIT_TRIPPED: an MCB or fuse on the short's path opened it (L2).
 *  SHORT_CIRCUIT_NO_LOAD: nothing on the path could, so the source protection did. */
export type FaultCode = 'SHORT_CIRCUIT_NO_LOAD' | 'SHORT_CIRCUIT_TRIPPED' | 'LOAD_OVERCURRENT'

export interface FaultRecord {
  code: FaultCode
  /** Virtual time (ms) at which the trip occurred. Never a wall clock. */
  atMs: number
  measured: {
    /** The current that crossed the threshold (amperes). */
    currentAmps: number
    /** The threshold it crossed (amperes). */
    limitAmps: number
    /** LOAD_OVERCURRENT: which load. SHORT_CIRCUIT_TRIPPED: the first device opened. */
    componentId?: ComponentId
    /** Rating of `componentId` (load rating, or the MCB's rated current). */
    ratedAmps?: number
  }
  /** Short circuits: the source terminals joined (R, S, T, N, L, +, −). */
  conductors?: string[]
  /** SHORT_CIRCUIT_TRIPPED: every MCB and fuse on the short's path, all opened. */
  devices?: Array<{ id: ComponentId; kind: 'MCB' | 'FUSE' }>
}
