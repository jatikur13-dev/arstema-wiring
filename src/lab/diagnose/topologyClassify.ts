/**
 * Motor winding topology (M3-C1) — DERIVED, never stored. A three-phase motor is
 * wired in star or delta purely by external contacts/wire (there is NO `motor.mode`
 * and NO internal tie on MOTOR_3PH). This reads the ACTUAL node membership of the
 * six winding terminals — U1/U2, V1/V2, W1/W2 — from the resolved topology and
 * classifies what the wiring currently forms:
 *
 *   STAR   KMY closed → U2=V2=W2 share one common node that is NOT a line node.
 *   DELTA  KMD closed → a complete cyclic end-to-start connection. The defaults use
 *          clockwise U2=W1, V2=U1, W2=V1; the reverse cycle is also recognized.
 *   OPEN   winding ends are not interconnected into either pattern (both mode
 *          contactors open, or the star/delta wiring is broken — never a fake STAR).
 *   INVALID both patterns at once, an unconverged fixpoint (contradictory command),
 *          or a structured source conflict (e.g. a mis-crossed delta shorting phases).
 *
 * Pure and read-only: it takes an already-built node map + solver flags and returns
 * a label. It builds no runtime state and changes no electrical behaviour.
 */
import { MOTOR_3PH_TERMINAL, terminalKey, type NodeMap } from '../../engine/index'

export type MotorTopology = 'STAR' | 'DELTA' | 'OPEN' | 'INVALID'

export interface TopologyFlags {
  /** The contactor closure↔voltage fixpoint settled (false ⇒ contradictory command). */
  converged: boolean
  /** A structured source conflict was detected (e.g. a delta mis-cross shorting phases). */
  hasFault: boolean
}

export function classifyMotorTopology(
  motorId: string,
  nodes: NodeMap,
  flags: TopologyFlags,
): MotorTopology {
  // A contradictory command (never settles) or a real source conflict is not a
  // valid single topology — say so, never guess a winner.
  if (flags.hasFault || !flags.converged) return 'INVALID'

  const nodeOf = (index: number): string | undefined =>
    nodes.nodeOf.get(terminalKey({ componentId: motorId, index }))
  const u1 = nodeOf(MOTOR_3PH_TERMINAL.U1)
  const u2 = nodeOf(MOTOR_3PH_TERMINAL.U2)
  const v1 = nodeOf(MOTOR_3PH_TERMINAL.V1)
  const v2 = nodeOf(MOTOR_3PH_TERMINAL.V2)
  const w1 = nodeOf(MOTOR_3PH_TERMINAL.W1)
  const w2 = nodeOf(MOTOR_3PH_TERMINAL.W2)

  // STAR: the three winding ENDS share one node, and it is not one of the winding
  // STARTS (which carry the line phases) — otherwise it is not a genuine star point.
  const star =
    u2 !== undefined &&
    u2 === v2 &&
    v2 === w2 &&
    u2 !== u1 &&
    u2 !== v1 &&
    u2 !== w1

  // DELTA: each winding END joins another winding's START in one complete cycle.
  const deltaClockwise =
    u2 !== undefined &&
    v2 !== undefined &&
    w2 !== undefined &&
    u2 === w1 &&
    v2 === u1 &&
    w2 === v1
  const deltaReverse =
    u2 !== undefined &&
    v2 !== undefined &&
    w2 !== undefined &&
    u2 === v1 &&
    v2 === w1 &&
    w2 === u1
  const delta = deltaClockwise || deltaReverse

  if (star && delta) return 'INVALID' // structurally impossible as a single mode
  if (star) return 'STAR'
  if (delta) return 'DELTA'
  return 'OPEN'
}

