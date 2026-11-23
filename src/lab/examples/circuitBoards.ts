/**
 * Internal circuit boards used only by solver, reducer, and projection tests.
 * These builders are deliberately kept outside production scenario code.
 */

import type { Board, ComponentSpec, Terminal } from '../../engine/index'
import {
  BREAKER_1P_SPEC,
  BREAKER_3P_SPEC,
  CAPACITOR_SPEC,
  CONTACTOR_SPEC,
  INDICATOR_SPEC,
  OVERLOAD_SPEC,
  OVERLOAD_STAR_DELTA_SPEC,
  TIMER_SPEC,
  LAMP_SPEC,
  RESISTOR_SPEC,
  HEATER_SPEC,
  BELL_SPEC,
  GROUND_SPEC,
  MOTOR_3PH_SPEC,
  MOTOR_3PH_STAR_DELTA_SPEC,
  MOTOR_SPEC,
  RELAY_SPEC,
  SOURCE_3PH_SPEC,
  SOURCE_SPEC,
  SWITCH_SPEC,
} from '../scenario/topic1a'

const t = (componentId: string, index: number): Terminal => ({ componentId, index })
function w(id: string, from: Terminal, to: Terminal) {
  return { id, from, to }
}

export function buildTopic1aBoard(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { ...SOURCE_SPEC } },
      SW: { id: 'SW', cell: { x: 2, y: 0 }, spec: { ...SWITCH_SPEC } },
      L1: { id: 'L1', cell: { x: 4, y: 1 }, spec: { ...LAMP_SPEC } },
    },
    wires: {
      w1: { id: 'w1', from: t('S', 0), to: t('SW', 0) },
      w2: { id: 'w2', from: t('SW', 1), to: t('L1', 0) },
      w3: { id: 'w3', from: t('L1', 1), to: t('S', 1) },
    },
  }
}
const PB_NO: ComponentSpec = { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true }
const PB_NC: ComponentSpec = { kind: 'PUSHBUTTON', pressed: false, normallyOpen: false }

/** Seri: L → lampu1 → lampu2 → N. Both lamps share one (smaller) current → dim. */
function seriesLamps(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { ...SOURCE_SPEC } },
      L1: { id: 'L1', cell: { x: 2, y: 1 }, spec: { ...LAMP_SPEC } },
      L2: { id: 'L2', cell: { x: 4, y: 1 }, spec: { ...LAMP_SPEC } },
    },
    wires: {
      w1: w('w1', t('S', 0), t('L1', 0)),
      w2: w('w2', t('L1', 1), t('L2', 0)),
      w3: w('w3', t('L2', 1), t('S', 1)),
    },
  }
}

/** Paralel: each lamp straight across L–N → each at full voltage, both bright. */
function parallelLamps(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { ...SOURCE_SPEC } },
      L1: { id: 'L1', cell: { x: 3, y: 0 }, spec: { ...LAMP_SPEC } },
      L2: { id: 'L2', cell: { x: 3, y: 2 }, spec: { ...LAMP_SPEC } },
    },
    wires: {
      a1: w('a1', t('S', 0), t('L1', 0)),
      a2: w('a2', t('L1', 1), t('S', 1)),
      b1: w('b1', t('S', 0), t('L2', 0)),
      b2: w('b2', t('L2', 1), t('S', 1)),
    },
  }
}

/** Motor across L–N with no capacitor → hums, cannot start. */
function motorNoCapacitor(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { ...SOURCE_SPEC } },
      M: { id: 'M', cell: { x: 3, y: 1 }, spec: { ...MOTOR_SPEC } },
    },
    wires: {
      w1: w('w1', t('S', 0), t('M', 0)),
      w2: w('w2', t('M', 1), t('S', 1)),
    },
  }
}

/** Motor with a start capacitor bridging aux ↔ the live main → runs. */
function motorWithCapacitor(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { ...SOURCE_SPEC } },
      M: { id: 'M', cell: { x: 3, y: 1 }, spec: { ...MOTOR_SPEC } },
      C: { id: 'C', cell: { x: 3, y: 3 }, spec: { ...CAPACITOR_SPEC } },
    },
    wires: {
      w1: w('w1', t('S', 0), t('M', 0)),
      w2: w('w2', t('M', 1), t('S', 1)),
      w3: w('w3', t('M', 2), t('C', 0)),
      w4: w('w4', t('C', 1), t('M', 0)),
    },
  }
}

/** Relay basics: hold START → coil energizes → NO closes → indicator lights. */
function relayBasic(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 2 }, spec: { ...SOURCE_SPEC } },
      START: { id: 'START', cell: { x: 2, y: 0 }, spec: { ...PB_NO } },
      K: { id: 'K', cell: { x: 4, y: 1 }, spec: { ...RELAY_SPEC } },
      IND: { id: 'IND', cell: { x: 6, y: 1 }, spec: { ...INDICATOR_SPEC } },
    },
    wires: {
      w1: w('w1', t('S', 0), t('START', 0)),
      w2: w('w2', t('START', 1), t('K', 0)), // → coil_a
      w3: w('w3', t('K', 1), t('S', 1)), // coil_b → N
      w4: w('w4', t('S', 0), t('K', 2)), // L → NO_a
      w5: w('w5', t('K', 3), t('IND', 0)), // NO_b → indicator
      w6: w('w6', t('IND', 1), t('S', 1)),
    },
  }
}

/** Self-holding: L → STOP(NC) → [START(NO) ∥ relay NO] → coil → N, indicator on
 *  the coil. Tap START → latched on; tap STOP → off. */
function selfHolding(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 2 }, spec: { ...SOURCE_SPEC } },
      STOP: { id: 'STOP', cell: { x: 2, y: 0 }, spec: { ...PB_NC } },
      START: { id: 'START', cell: { x: 2, y: 3 }, spec: { ...PB_NO } },
      K: { id: 'K', cell: { x: 4, y: 1 }, spec: { ...RELAY_SPEC } },
      IND: { id: 'IND', cell: { x: 6, y: 1 }, spec: { ...INDICATOR_SPEC } },
    },
    wires: {
      w1: w('w1', t('S', 0), t('STOP', 0)),
      w2: w('w2', t('STOP', 1), t('START', 0)),
      w3: w('w3', t('STOP', 1), t('K', 2)), // node A → NO_a
      w4: w('w4', t('START', 1), t('K', 0)), // START → coil_a
      w5: w('w5', t('K', 3), t('K', 0)), // NO_b → coil_a (latch)
      w6: w('w6', t('K', 1), t('S', 1)), // coil_b → N
      i1: w('i1', t('K', 0), t('IND', 0)), // indicator across the coil
      i2: w('i2', t('IND', 1), t('S', 1)),
    },
  }
}

// --- M3-B1.5 breaker + 3-phase fixtures -------------------------------------

/** A (1φ): L → breaker 1P → lampu → N. Loads ON (lamp lit); toggle the breaker off
 *  and the lamp goes dark. Fully editable after load. */
function breaker1pLamp(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { ...SOURCE_SPEC } },
      QF: { id: 'QF', cell: { x: 2, y: 0 }, spec: { ...BREAKER_1P_SPEC, on: true } },
      L1: { id: 'L1', cell: { x: 4, y: 1 }, spec: { ...LAMP_SPEC } },
    },
    wires: {
      w1: w('w1', t('S', 0), t('QF', 0)), // L → L_IN
      w2: w('w2', t('QF', 1), t('L1', 0)), // L_OUT → lampu
      w3: w('w3', t('L1', 1), t('S', 1)), // lampu → N
    },
  }
}

/** C (3φ, power-only TOPOLOGY): SOURCE_3PH → breaker 3P → contactor → motor 3P.
 *  Breaker loads ON, but the contactor is de-energized by default (its mechanical
 *  seam is NOT part of the Board), so the motor is IDLE until the poles close —
 *  interactive closing arrives with M3-B2 (voltage-driven contactor). */
function dolPowerOnly(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { ...BREAKER_3P_SPEC, on: true } },
      KM: { id: 'KM', cell: { x: 5, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      OL: { id: 'OL', cell: { x: 8, y: 0 }, spec: { ...OVERLOAD_SPEC } },
      M3: { id: 'M3', cell: { x: 11, y: 0 }, spec: { ...MOTOR_3PH_SPEC } },
      PE: { id: 'PE', cell: { x: 11, y: 3 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      r1: w('r1', t('Q', 0), t('QF3', 0)), r2: w('r2', t('QF3', 1), t('KM', 2)), r3: w('r3', t('KM', 3), t('OL', 0)), r4: w('r4', t('OL', 1), t('M3', 0)),
      s1: w('s1', t('Q', 1), t('QF3', 2)), s2: w('s2', t('QF3', 3), t('KM', 4)), s3: w('s3', t('KM', 5), t('OL', 2)), s4: w('s4', t('OL', 3), t('M3', 2)),
      t1: w('t1', t('Q', 2), t('QF3', 4)), t2: w('t2', t('QF3', 5), t('KM', 6)), t3: w('t3', t('KM', 7), t('OL', 4)), t4: w('t4', t('OL', 5), t('M3', 4)),
      star1: w('star1', t('M3', 1), t('M3', 3)), star2: w('star2', t('M3', 3), t('M3', 5)),
      pe: w('pe', t('PE', 0), t('M3', 6)),
    },
  }
}

/** E (3φ): SOURCE_3PH → motor 3P directly (no breaker/contactor) — the baseline
 *  current/topology to compare against C. Balanced ⇒ ~10 A per winding. */
function motor3phDirect(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      M3: { id: 'M3', cell: { x: 2, y: 0 }, spec: { ...MOTOR_3PH_SPEC } },
      PE: { id: 'PE', cell: { x: 2, y: 3 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      u1: w('u1', t('Q', 0), t('M3', 0)),
      v1: w('v1', t('Q', 1), t('M3', 2)),
      w1: w('w1', t('Q', 2), t('M3', 4)),
      star1: w('star1', t('M3', 1), t('M3', 3)), star2: w('star2', t('M3', 3), t('M3', 5)),
      pe: w('pe', t('PE', 0), t('M3', 6)),
    },
  }
}

// --- M3-B2 Gate C fixtures --------------------------------------------------

/** B (1φ control): L → breaker 1P → STOP(NC) → START(NO) → relay coil → N, with the
 *  relay's own NO sealing START in and an indicator on the coil. Breaker OFF kills
 *  the whole control; ON + tap START latches the relay (real M2 relay, unchanged). */
function relaySelfHoldBreaker(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 2 }, spec: { ...SOURCE_SPEC } },
      QF: { id: 'QF', cell: { x: 2, y: 2 }, spec: { ...BREAKER_1P_SPEC, on: true } },
      STOP: { id: 'STOP', cell: { x: 4, y: 0 }, spec: { ...PB_NC } },
      START: { id: 'START', cell: { x: 4, y: 3 }, spec: { ...PB_NO } },
      K: { id: 'K', cell: { x: 6, y: 1 }, spec: { ...RELAY_SPEC } },
      IND: { id: 'IND', cell: { x: 8, y: 1 }, spec: { ...INDICATOR_SPEC } },
    },
    wires: {
      b0: w('b0', t('S', 0), t('QF', 0)), // L → breaker
      w1: w('w1', t('QF', 1), t('STOP', 0)), // breaker → STOP
      w2: w('w2', t('STOP', 1), t('START', 0)), // STOP → node
      w3: w('w3', t('STOP', 1), t('K', 2)), // node → relay NO_a (seal path)
      w4: w('w4', t('START', 1), t('K', 0)), // START → coil_a
      w5: w('w5', t('K', 3), t('K', 0)), // relay NO_b → coil_a (latch)
      w6: w('w6', t('K', 1), t('S', 1)), // coil_b → N
      i1: w('i1', t('K', 0), t('IND', 0)), // indicator across the coil
      i2: w('i2', t('IND', 1), t('S', 1)),
    },
  }
}

/** C (3φ): SOURCE_3PH → breaker 3P → motor, with U2/V2/W2 tied as a FLOATING star
 *  (not to N). Balanced ⇒ star ≈ 0 V, neutral current 0. Break a star wire to see
 *  it shift/open. Breaker OFF ⇒ all line currents 0. */
function breaker3phFloatingStar(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { ...BREAKER_3P_SPEC, on: true } },
      M3: { id: 'M3', cell: { x: 5, y: 0 }, spec: { ...MOTOR_3PH_SPEC } },
      PE: { id: 'PE', cell: { x: 5, y: 3 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      r1: w('r1', t('Q', 0), t('QF3', 0)), r2: w('r2', t('QF3', 1), t('M3', 0)),
      s1: w('s1', t('Q', 1), t('QF3', 2)), s2: w('s2', t('QF3', 3), t('M3', 2)),
      t1: w('t1', t('Q', 2), t('QF3', 4)), t2: w('t2', t('QF3', 5), t('M3', 4)),
      star1: w('star1', t('M3', 1), t('M3', 3)), star2: w('star2', t('M3', 3), t('M3', 5)),
      pe: w('pe', t('PE', 0), t('M3', 6)),
    },
  }
}

/** D (3φ): DOL power with the coil energized straight from a control breaker (no
 *  START/STOP). Both breakers ON ⇒ coil sees ~230 V ⇒ contactor picks up ⇒ motor
 *  runs (floating star). Turn the control breaker off ⇒ contactor drops ⇒ motor idle. */
function dolContactorDriven(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { ...BREAKER_3P_SPEC, on: true } },
      KM: { id: 'KM', cell: { x: 5, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      OL: { id: 'OL', cell: { x: 8, y: 0 }, spec: { ...OVERLOAD_SPEC } },
      M3: { id: 'M3', cell: { x: 11, y: 0 }, spec: { ...MOTOR_3PH_SPEC } },
      QF1: { id: 'QF1', cell: { x: 2, y: 3 }, spec: { ...BREAKER_1P_SPEC, on: true } },
      PE: { id: 'PE', cell: { x: 11, y: 3 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      r1: w('r1', t('Q', 0), t('QF3', 0)), r2: w('r2', t('QF3', 1), t('KM', 2)), r3: w('r3', t('KM', 3), t('OL', 0)), r4: w('r4', t('OL', 1), t('M3', 0)),
      s1: w('s1', t('Q', 1), t('QF3', 2)), s2: w('s2', t('QF3', 3), t('KM', 4)), s3: w('s3', t('KM', 5), t('OL', 2)), s4: w('s4', t('OL', 3), t('M3', 2)),
      t1: w('t1', t('Q', 2), t('QF3', 4)), t2: w('t2', t('QF3', 5), t('KM', 6)), t3: w('t3', t('KM', 7), t('OL', 4)), t4: w('t4', t('OL', 5), t('M3', 4)),
      star1: w('star1', t('M3', 1), t('M3', 3)), star2: w('star2', t('M3', 3), t('M3', 5)),
      c1: w('c1', t('QF3', 1), t('QF1', 0)), c2: w('c2', t('QF1', 1), t('OL', 6)), c3: w('c3', t('OL', 7), t('KM', 0)), c4: w('c4', t('KM', 1), t('Q', 3)),
      pe: w('pe', t('PE', 0), t('M3', 6)),
    },
  }
}

/** E (3φ): full DOL — breaker 3P + contactor + overload, with the control breaker
 *  feeding STOP(NC) → overload 95–96 → START(NO) → coil. Contactor 13–14 seals
 *  START in and the indicator sits across the coil (RUN lamp). The
 *  contactor is voltage-driven (Gate A): tap START to run, STOP to stop. Floating star. */
function dolFullControl(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { ...BREAKER_3P_SPEC, on: false } },
      KM: { id: 'KM', cell: { x: 5, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      OL: { id: 'OL', cell: { x: 8, y: 0 }, spec: { ...OVERLOAD_SPEC } },
      M3: { id: 'M3', cell: { x: 11, y: 0 }, spec: { ...MOTOR_3PH_SPEC } },
      QF1: { id: 'QF1', cell: { x: 2, y: 3 }, spec: { ...BREAKER_1P_SPEC, on: false } },
      STOP: { id: 'STOP', cell: { x: 4, y: 3 }, spec: { ...PB_NC } },
      START: { id: 'START', cell: { x: 6, y: 3 }, spec: { ...PB_NO } },
      IND: { id: 'IND', cell: { x: 8, y: 3 }, spec: { ...INDICATOR_SPEC } },
      TRIP: { id: 'TRIP', cell: { x: 10, y: 5 }, spec: { ...INDICATOR_SPEC } },
      PE: { id: 'PE', cell: { x: 13, y: 3 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      r1: w('r1', t('Q', 0), t('QF3', 0)), r2: w('r2', t('QF3', 1), t('KM', 2)), r3: w('r3', t('KM', 3), t('OL', 0)), r4: w('r4', t('OL', 1), t('M3', 0)),
      s1: w('s1', t('Q', 1), t('QF3', 2)), s2: w('s2', t('QF3', 3), t('KM', 4)), s3: w('s3', t('KM', 5), t('OL', 2)), s4: w('s4', t('OL', 3), t('M3', 2)),
      t1: w('t1', t('Q', 2), t('QF3', 4)), t2: w('t2', t('QF3', 5), t('KM', 6)), t3: w('t3', t('KM', 7), t('OL', 4)), t4: w('t4', t('OL', 5), t('M3', 4)),
      star1: w('star1', t('M3', 1), t('M3', 3)), star2: w('star2', t('M3', 3), t('M3', 5)),
      k1: w('k1', t('QF3', 1), t('QF1', 0)), k2: w('k2', t('QF1', 1), t('STOP', 0)),
      k3: w('k3', t('STOP', 1), t('OL', 6)), k4: w('k4', t('OL', 7), t('START', 0)), k5: w('k5', t('START', 1), t('KM', 0)),
      seal1: w('seal1', t('OL', 7), t('KM', 8)), seal2: w('seal2', t('KM', 9), t('KM', 0)),
      k6: w('k6', t('KM', 1), t('Q', 3)),
      // Indicator sits literally across the coil A1(0)–A2(1) — same node as N via k5,
      // so RUN follows the real coil voltage, not a hardcoded contactor flag.
      i1: w('i1', t('KM', 0), t('IND', 0)), i2: w('i2', t('IND', 1), t('KM', 1)),
      tl1: w('tl1', t('QF1', 1), t('OL', 8)), tl2: w('tl2', t('OL', 9), t('TRIP', 0)), tl3: w('tl3', t('TRIP', 1), t('Q', 3)),
      pe: w('pe', t('PE', 0), t('M3', 6)),
    },
  }
}

/**
 * Electrical interlock (M3-B4) — two contactors KM1/KM2 whose NC auxiliary (21–22)
 * sits in the OTHER coil's supply path, so at most one can be energized. Control
 * circuit only (two coils + two indicators); forward-reverse motor power is a
 * non-goal. The interlock is pure contacts + real wire: because each NC is placed
 * BEFORE its coil's START∥seal-in junction, energizing KM1 opens its 21–22 and cuts
 * both the START and the hold path of KM2 (and vice-versa). Pressing both STARTs at
 * once from all-off is rejected by the physical interlock instead of inventing a
 * winner. The dashed MECH link is not an electrical conductor.
 */
function interlockTwoContactors(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    mechanicalInterlocks: [{ contactorA: 'KM1', contactorB: 'KM2' }],
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      QF1: { id: 'QF1', cell: { x: 2, y: 3 }, spec: { ...BREAKER_1P_SPEC, on: false } },
      STOP: { id: 'STOP', cell: { x: 4, y: 3 }, spec: { ...PB_NC } },
      S1: { id: 'S1', cell: { x: 6, y: 3 }, spec: { ...PB_NO } },
      S2: { id: 'S2', cell: { x: 6, y: 5 }, spec: { ...PB_NO } },
      KM1: { id: 'KM1', cell: { x: 9, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      KM2: { id: 'KM2', cell: { x: 9, y: 3 }, spec: { ...CONTACTOR_SPEC } },
      IND1: { id: 'IND1', cell: { x: 12, y: 0 }, spec: { ...INDICATOR_SPEC } },
      IND2: { id: 'IND2', cell: { x: 12, y: 3 }, spec: { ...INDICATOR_SPEC } },
    },
    wires: {
      c0: w('c0', t('Q', 0), t('QF1', 0)),
      c1: w('c1', t('QF1', 1), t('STOP', 0)),
      // KM1 coil, gated by KM2's NC 21–22 (BEFORE the START∥hold junction j1).
      k1a: w('k1a', t('STOP', 1), t('KM2', 10)),
      k1b: w('k1b', t('KM2', 11), t('S1', 0)),
      k1c: w('k1c', t('S1', 1), t('KM1', 0)),
      k1d: w('k1d', t('KM2', 11), t('KM1', 8)),
      k1e: w('k1e', t('KM1', 9), t('KM1', 0)),
      k1f: w('k1f', t('KM1', 1), t('Q', 3)),
      // KM2 coil, gated by KM1's NC 21–22 (BEFORE junction j2).
      k2a: w('k2a', t('STOP', 1), t('KM1', 10)),
      k2b: w('k2b', t('KM1', 11), t('S2', 0)),
      k2c: w('k2c', t('S2', 1), t('KM2', 0)),
      k2d: w('k2d', t('KM1', 11), t('KM2', 8)),
      k2e: w('k2e', t('KM2', 9), t('KM2', 0)),
      k2f: w('k2f', t('KM2', 1), t('Q', 3)),
      // Indicators sit across each coil (A1–A2), following the real coil voltage.
      i1a: w('i1a', t('KM1', 0), t('IND1', 0)),
      i1b: w('i1b', t('IND1', 1), t('KM1', 1)),
      i2a: w('i2a', t('KM2', 0), t('IND2', 0)),
      i2b: w('i2b', t('IND2', 1), t('KM2', 1)),
    },
  }
}

/**
 * Manual star–delta (M3-C1) — three contactors form the star or delta connection
 * from REAL wire + contacts; there is NO motor.mode and NO internal winding tie.
 *   KM1  main: R/S/T → KM1 → U1/V1/W1.
 *   KMY  star: closes U2/V2/W2 onto one common star node (KMY.T1–T2–T3 wired).
 *   KMD  delta: preferred clockwise connection U2→W1, V2→U1, W2→V1.
 * KMY/KMD carry a cross NC (21–22) interlock, so only one can be energized; the mode
 * changeover goes through an OPEN condition (STOP_YD) — no timer, no auto transition.
 * A physical interlock supplements the cross-NC electrical interlock. Simultaneous
 * STAR/DELTA pickup from rest is therefore blocked safely.
 */
function starDeltaManual(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    mechanicalInterlocks: [{ contactorA: 'KMY', contactorB: 'KMD' }],
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { ...BREAKER_3P_SPEC, on: false } },
      KM1: { id: 'KM1', cell: { x: 5, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      OL: { id: 'OL', cell: { x: 8, y: 0 }, spec: { ...OVERLOAD_STAR_DELTA_SPEC } },
      M1: { id: 'M1', cell: { x: 11, y: 0 }, spec: { ...MOTOR_3PH_STAR_DELTA_SPEC } },
      KMY: { id: 'KMY', cell: { x: 14, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      KMD: { id: 'KMD', cell: { x: 14, y: 3 }, spec: { ...CONTACTOR_SPEC } },
      QF1: { id: 'QF1', cell: { x: 2, y: 3 }, spec: { ...BREAKER_1P_SPEC, on: false } },
      STOP1: { id: 'STOP1', cell: { x: 4, y: 3 }, spec: { ...PB_NC } },
      START1: { id: 'START1', cell: { x: 6, y: 3 }, spec: { ...PB_NO } },
      IND1: { id: 'IND1', cell: { x: 8, y: 3 }, spec: { ...INDICATOR_SPEC } },
      STOP_YD: { id: 'STOP_YD', cell: { x: 4, y: 5 }, spec: { ...PB_NC } },
      SY: { id: 'SY', cell: { x: 6, y: 5 }, spec: { ...PB_NO } },
      SD: { id: 'SD', cell: { x: 8, y: 5 }, spec: { ...PB_NO } },
      INDY: { id: 'INDY', cell: { x: 17, y: 0 }, spec: { ...INDICATOR_SPEC } },
      INDD: { id: 'INDD', cell: { x: 17, y: 3 }, spec: { ...INDICATOR_SPEC } },
      TRIP: { id: 'TRIP', cell: { x: 14, y: 6 }, spec: { ...INDICATOR_SPEC } },
      PE: { id: 'PE', cell: { x: 17, y: 6 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      // --- power: main (KM1) ---
      pr1: w('pr1', t('Q', 0), t('QF3', 0)), pr2: w('pr2', t('QF3', 1), t('KM1', 2)), pr3: w('pr3', t('KM1', 3), t('OL', 0)), pr4: w('pr4', t('OL', 1), t('M1', 0)),
      ps1: w('ps1', t('Q', 1), t('QF3', 2)), ps2: w('ps2', t('QF3', 3), t('KM1', 4)), ps3: w('ps3', t('KM1', 5), t('OL', 2)), ps4: w('ps4', t('OL', 3), t('M1', 2)),
      pt1: w('pt1', t('Q', 2), t('QF3', 4)), pt2: w('pt2', t('QF3', 5), t('KM1', 6)), pt3: w('pt3', t('KM1', 7), t('OL', 4)), pt4: w('pt4', t('OL', 5), t('M1', 4)),
      // --- power: star short (KMY) — U2/V2/W2 → one star node when KMY closes ---
      y1: w('y1', t('M1', 1), t('KMY', 2)), y2: w('y2', t('M1', 3), t('KMY', 4)), y3: w('y3', t('M1', 5), t('KMY', 6)),
      ystar1: w('ystar1', t('KMY', 3), t('KMY', 5)), ystar2: w('ystar2', t('KMY', 5), t('KMY', 7)),
      // --- preferred clockwise delta: U2→W1, V2→U1, W2→V1 ---
      d1a: w('d1a', t('M1', 1), t('KMD', 2)), d1b: w('d1b', t('KMD', 3), t('M1', 4)),
      d2a: w('d2a', t('M1', 3), t('KMD', 4)), d2b: w('d2b', t('KMD', 5), t('M1', 0)),
      d3a: w('d3a', t('M1', 5), t('KMD', 6)), d3b: w('d3b', t('KMD', 7), t('M1', 2)),
      // --- control supply ---
      c0: w('c0', t('Q', 0), t('QF1', 0)), c1: w('c1', t('QF1', 1), t('STOP1', 0)), c2: w('c2', t('STOP1', 1), t('OL', 6)),
      // --- KM1: START/STOP self-hold (bus A = OL.96) ---
      m1a: w('m1a', t('OL', 7), t('START1', 0)), m1b: w('m1b', t('START1', 1), t('KM1', 0)),
      m1c: w('m1c', t('OL', 7), t('KM1', 8)), m1d: w('m1d', t('KM1', 9), t('KM1', 0)),
      m1e: w('m1e', t('KM1', 1), t('Q', 3)),
      // --- mode bus B = STOP_YD.1 (dropping it OPENs both KMY and KMD) ---
      mb: w('mb', t('OL', 7), t('STOP_YD', 0)),
      // --- KMY coil, gated by KMD's NC (21–22) before the START∥hold junction ---
      ky1: w('ky1', t('STOP_YD', 1), t('KMD', 10)), ky2: w('ky2', t('KMD', 11), t('SY', 0)),
      ky3: w('ky3', t('SY', 1), t('KMY', 0)), ky4: w('ky4', t('KMD', 11), t('KMY', 8)),
      ky5: w('ky5', t('KMY', 9), t('KMY', 0)), ky6: w('ky6', t('KMY', 1), t('Q', 3)),
      // --- KMD coil, gated by KMY's NC (21–22) ---
      kd1: w('kd1', t('STOP_YD', 1), t('KMY', 10)), kd2: w('kd2', t('KMY', 11), t('SD', 0)),
      kd3: w('kd3', t('SD', 1), t('KMD', 0)), kd4: w('kd4', t('KMY', 11), t('KMD', 8)),
      kd5: w('kd5', t('KMD', 9), t('KMD', 0)), kd6: w('kd6', t('KMD', 1), t('Q', 3)),
      // --- indicators across each coil (A1–A2), following real coil voltage ---
      i1a: w('i1a', t('KM1', 0), t('IND1', 0)), i1b: w('i1b', t('IND1', 1), t('KM1', 1)),
      iya: w('iya', t('KMY', 0), t('INDY', 0)), iyb: w('iyb', t('INDY', 1), t('KMY', 1)),
      ida: w('ida', t('KMD', 0), t('INDD', 0)), idb: w('idb', t('INDD', 1), t('KMD', 1)),
      tl1: w('tl1', t('QF1', 1), t('OL', 8)), tl2: w('tl2', t('OL', 9), t('TRIP', 0)), tl3: w('tl3', t('TRIP', 1), t('Q', 3)),
      pe: w('pe', t('PE', 0), t('M1', 6)),
    },
  }
}

/**
 * Automatic star–delta (M3-C2) — the star→delta changeover is driven by a
 * TIME-STEPPED TIMER (no manual mode buttons), and an OVERLOAD relay sits in series
 * in the power path and in the control path. Sequence: START latches KM1 (self-hold)
 * → the timer coil energizes with KM1 → STAR NO 15–18 feeds KMY → after
 * `starDurationMs` that command opens → after the transfer delay DELTA NO 25–28
 * feeds KMD. KMY/KMD have NO self-hold, an electrical cross-NC interlock, and a
 * separate physical interlock. The overload's 95–96 sits in
 * the KM1 coil path, so a thermal trip drops everything; its 97–98 lights a trip lamp.
 * All timer/thermal numbers are EDUCATIONAL (see TIMER_SPEC / OVERLOAD_SPEC).
 */
function starDeltaAuto(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    mechanicalInterlocks: [{ contactorA: 'KMY', contactorB: 'KMD' }],
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 0 }, spec: { ...SOURCE_3PH_SPEC } },
      QF3: { id: 'QF3', cell: { x: 2, y: 0 }, spec: { ...BREAKER_3P_SPEC, on: false } },
      KM1: { id: 'KM1', cell: { x: 5, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      OL: { id: 'OL', cell: { x: 8, y: 0 }, spec: { ...OVERLOAD_STAR_DELTA_SPEC } },
      M1: { id: 'M1', cell: { x: 11, y: 0 }, spec: { ...MOTOR_3PH_STAR_DELTA_SPEC } },
      KMY: { id: 'KMY', cell: { x: 14, y: 0 }, spec: { ...CONTACTOR_SPEC } },
      KMD: { id: 'KMD', cell: { x: 14, y: 3 }, spec: { ...CONTACTOR_SPEC } },
      QF1: { id: 'QF1', cell: { x: 2, y: 4 }, spec: { ...BREAKER_1P_SPEC, on: false } },
      STOP: { id: 'STOP', cell: { x: 4, y: 4 }, spec: { ...PB_NC } },
      START: { id: 'START', cell: { x: 6, y: 4 }, spec: { ...PB_NO } },
      KT: { id: 'KT', cell: { x: 8, y: 4 }, spec: { ...TIMER_SPEC } },
      TRIP: { id: 'TRIP', cell: { x: 10, y: 4 }, spec: { ...INDICATOR_SPEC } },
      PE: { id: 'PE', cell: { x: 12, y: 6 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      // --- power: main (KM1) → overload (OL, in series) → motor mains ---
      pr1: w('pr1', t('Q', 0), t('QF3', 0)), pr2: w('pr2', t('QF3', 1), t('KM1', 2)),
      pr3: w('pr3', t('KM1', 3), t('OL', 0)), pr4: w('pr4', t('OL', 1), t('M1', 0)),
      ps1: w('ps1', t('Q', 1), t('QF3', 2)), ps2: w('ps2', t('QF3', 3), t('KM1', 4)),
      ps3: w('ps3', t('KM1', 5), t('OL', 2)), ps4: w('ps4', t('OL', 3), t('M1', 2)),
      pt1: w('pt1', t('Q', 2), t('QF3', 4)), pt2: w('pt2', t('QF3', 5), t('KM1', 6)),
      pt3: w('pt3', t('KM1', 7), t('OL', 4)), pt4: w('pt4', t('OL', 5), t('M1', 4)),
      // --- star short (KMY) — unites U2/V2/W2 when closed ---
      y1: w('y1', t('M1', 1), t('KMY', 2)), y2: w('y2', t('M1', 3), t('KMY', 4)), y3: w('y3', t('M1', 5), t('KMY', 6)),
      ystar1: w('ystar1', t('KMY', 3), t('KMY', 5)), ystar2: w('ystar2', t('KMY', 5), t('KMY', 7)),
      // --- preferred clockwise delta: U2→W1, V2→U1, W2→V1 ---
      d1a: w('d1a', t('M1', 1), t('KMD', 2)), d1b: w('d1b', t('KMD', 3), t('M1', 4)),
      d2a: w('d2a', t('M1', 3), t('KMD', 4)), d2b: w('d2b', t('KMD', 5), t('M1', 0)),
      d3a: w('d3a', t('M1', 5), t('KMD', 6)), d3b: w('d3b', t('KMD', 7), t('M1', 2)),
      // --- control supply: Q.R → QF1 → STOP → OL 95–96 → bus A (OL.96) ---
      c0: w('c0', t('Q', 0), t('QF1', 0)), c1: w('c1', t('QF1', 1), t('STOP', 0)),
      c2: w('c2', t('STOP', 1), t('OL', 6)),
      // --- KM1 self-hold (bus A = OL.96) ---
      m1a: w('m1a', t('OL', 7), t('START', 0)), m1b: w('m1b', t('START', 1), t('KM1', 0)),
      m1c: w('m1c', t('OL', 7), t('KM1', 8)), m1d: w('m1d', t('KM1', 9), t('KM1', 0)),
      m1e: w('m1e', t('KM1', 1), t('Q', 3)),
      // --- timer coil, in lockstep with KM1's coil node ---
      // Q.N is drawn as one control-return trunk (m1e) with explicit branches.
      // Electrically every branch still terminates at Q.N; `tap` changes drawing
      // topology only and avoids five long conductors fighting for one terminal.
      kt1: w('kt1', t('KT', 0), t('KM1', 0)),
      kt2: {
        ...w('kt2', t('KT', 1), t('Q', 3)),
        tap: { wireId: 'm1e', projectionPositions: { virtual: 0.35, iec: 0.35 } },
      },
      // --- KMY (star): KM1.A1 → KT 15–18 NO → KMD NC 21–22 → KMY.A1 ---
      ky1: w('ky1', t('KM1', 0), t('KT', 2)), ky2: w('ky2', t('KT', 6), t('KMD', 10)),
      ky3: w('ky3', t('KMD', 11), t('KMY', 0)),
      ky4: {
        ...w('ky4', t('KMY', 1), t('Q', 3)),
        tap: { wireId: 'm1e', projectionPositions: { virtual: 0.5, iec: 0.5 } },
      },
      // --- KMD (delta): KM1.A1 → KT DELTA_NO → KMY NC 21–22 → KMD.A1 (no self-hold) ---
      kd1: w('kd1', t('KM1', 0), t('KT', 4)), kd2: w('kd2', t('KT', 5), t('KMY', 10)),
      kd3: w('kd3', t('KMY', 11), t('KMD', 0)),
      kd4: {
        ...w('kd4', t('KMD', 1), t('Q', 3)),
        tap: { wireId: 'm1e', projectionPositions: { virtual: 0.65, iec: 0.65 } },
      },
      // --- trip lamp across OL 97–98 (closes on trip) ---
      tl1: w('tl1', t('QF1', 1), t('OL', 8)), tl2: w('tl2', t('OL', 9), t('TRIP', 0)),
      tl3: {
        ...w('tl3', t('TRIP', 1), t('Q', 3)),
        tap: { wireId: 'm1e', projectionPositions: { virtual: 0.8, iec: 0.8 } },
      },
      pe: w('pe', t('PE', 0), t('M1', 6)),
    },
  }
}

/**
 * MCB protection (M3-C3) — an EDUCATIONAL overload-and-trip demo. A 1-phase source
 * feeds a 10 A MCB into a load drawing ~15 A: a real finite over-current (NOT a
 * short). Turn the MCB ON and run: the pole current is sensed, `thermalLevel` climbs,
 * and after enough time the MCB THERMAL-trips (contacts open, current → 0). It cools
 * while open; bring the handle to OFF and, once cool, it can be reset — then switched
 * ON again. All numbers are educational, not an IEC curve.
 */
function mcbOverloadTrip(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
      QF: {
        id: 'QF',
        cell: { x: 2, y: 0 },
        spec: {
          kind: 'BREAKER_1P',
          on: false,
          ratedAmps: 10,
          heatingRate: 0.0005,
          coolingRate: 0.0002,
          thermalTripThreshold: 1,
          resetThreshold: 0.2,
        },
      },
      // ~15 A: a finite over-current, not a short. Rated high so the LOAD never faults
      // — the MCB is what trips.
      RL: { id: 'RL', cell: { x: 4, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 14.7, ratedCurrentAmps: 50 } },
    },
    wires: {
      w1: w('w1', t('S', 0), t('QF', 0)),
      w2: w('w2', t('QF', 1), t('RL', 0)),
      w3: w('w3', t('RL', 1), t('S', 1)),
    },
  }
}

/** Simbol baru: beban resistif (resistor, pemanas), bel via saklar, dan titik
 *  pembumian (PE). Resistor + pemanas menyala saat Run; bel berbunyi lewat saklar
 *  tertutup. PE sengaja berdiri sendiri: contoh ini tidak memodelkan titik pemisahan
 *  PEN, jadi PE tidak boleh disatukan dengan netral beban. */
function newSymbolsDemo(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { ...SOURCE_SPEC } },
      R: { id: 'R', cell: { x: 3, y: 0 }, spec: { ...RESISTOR_SPEC } },
      H: { id: 'H', cell: { x: 3, y: 2 }, spec: { ...HEATER_SPEC } },
      SW: { id: 'SW', cell: { x: 2, y: 4 }, spec: { kind: 'SWITCH', closed: true } },
      B: { id: 'B', cell: { x: 4, y: 4 }, spec: { ...BELL_SPEC } },
      PE: { id: 'PE', cell: { x: 0, y: 4 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      r1: w('r1', t('S', 0), t('R', 0)),
      r2: w('r2', t('R', 1), t('S', 1)),
      h1: w('h1', t('S', 0), t('H', 0)),
      h2: w('h2', t('H', 1), t('S', 1)),
      s1: w('s1', t('S', 0), t('SW', 0)),
      s2: w('s2', t('SW', 1), t('B', 0)),
      b1: w('b1', t('B', 1), t('S', 1)),
    },
  }
}

export const CIRCUIT_TEST_FIXTURES = {
  seri: seriesLamps,
  paralel: parallelLamps,
  'breaker-1p': breaker1pLamp,
  'motor-tanpa-kapasitor': motorNoCapacitor,
  'motor-kapasitor': motorWithCapacitor,
  'relay-dasar': relayBasic,
  'self-holding': selfHolding,
  'relay-selfhold-breaker': relaySelfHoldBreaker,
  'motor-3f-langsung': motor3phDirect,
  'breaker-3f-motor': breaker3phFloatingStar,
  'dol-power': dolPowerOnly,
  'dol-driven': dolContactorDriven,
  'dol-full': dolFullControl,
  'interlock-2km': interlockTwoContactors,
  'star-delta-manual': starDeltaManual,
  'star-delta-auto': starDeltaAuto,
  'mcb-overload-trip': mcbOverloadTrip,
  'simbol-baru': newSymbolsDemo,
} satisfies Record<string, () => Board>

export type CircuitTestFixtureKey = keyof typeof CIRCUIT_TEST_FIXTURES

export function buildCircuitTestFixture(key: CircuitTestFixtureKey): Board {
  return CIRCUIT_TEST_FIXTURES[key]()
}

export function circuitTestFixtureBuilder(key: CircuitTestFixtureKey): () => Board {
  return CIRCUIT_TEST_FIXTURES[key]
}
