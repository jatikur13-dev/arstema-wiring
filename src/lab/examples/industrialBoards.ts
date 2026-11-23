import type { Board, PlacedComponent, Terminal, WiringModelId } from '../../engine/index'
import {
  CONTACTOR_SPEC,
  CONTROL_TRANSFORMER_24VAC_SPEC,
  DIN_PSU_24V_SPEC,
  DISCONNECTOR_3P_SPEC,
  GROUND_SPEC,
  H3CR_A8_SPEC,
  HEATER_SPEC,
  INDICATOR_SPEC,
  MOTOR_3PH_SPEC,
  MOTOR_BREAKER_GV2ME14_SPEC,
  OVERLOAD_SPEC,
  RELAY_SPEC,
  SENSOR_E2E_NPN_NO_SPEC,
  SENSOR_E2E_PNP_NO_SPEC,
  SOURCE_3PH_SPEC,
  PALETTE,
  SOLENOID_VXE21_SPEC,
} from '../scenario/topic1a'
import { buildCircuitTestFixture } from './circuitBoards'

const t = (componentId: string, index: number): Terminal => ({ componentId, index })
const w = (id: string, from: Terminal, to: Terminal) => ({ id, from, to })
const RELAY_24V = { ...RELAY_SPEC, coilResistanceOhms: 288, pickupAmps: 0.04 }

/** Place an already-published, source-backed palette product without copying its
 * terminal contract into an example. The palette remains the single definition
 * of product identity, solver scope, and nominal values. */
function product(
  id: string,
  modelId: WiringModelId,
  x: number,
  y: number,
): PlacedComponent {
  const item = PALETTE.find((candidate) => candidate.key === modelId)
  if (!item) throw new Error(`Unknown Wiring model ${modelId}`)
  return {
    id,
    modelId,
    cell: { x, y },
    spec: { ...item.spec },
  }
}

function sensorRelay(output: 'PNP' | 'NPN'): Board {
  const sensor = output === 'PNP' ? SENSOR_E2E_PNP_NO_SPEC : SENSOR_E2E_NPN_NO_SPEC
  const components: Board['components'] = {
    PS: { id: 'PS', cell: { x: 0, y: 1 }, spec: { ...DIN_PSU_24V_SPEC } },
    B1: { id: 'B1', cell: { x: 3, y: 1 }, spec: { ...sensor } },
    K1: { id: 'K1', cell: { x: 6, y: 1 }, spec: { ...RELAY_24V } },
    H1: { id: 'H1', cell: { x: 9, y: 1 }, spec: { ...INDICATOR_SPEC, resistanceOhms: 480 } },
  }
  const wires: Board['wires'] = {
    p1: w('p1', t('PS', 0), t('B1', 0)),
    n1: w('n1', t('PS', 1), t('B1', 1)),
    kContact: w('kContact', t('PS', 0), t('K1', 2)),
    lamp: w('lamp', t('K1', 3), t('H1', 0)),
    lampN: w('lampN', t('H1', 1), t('PS', 1)),
  }
  if (output === 'PNP') {
    wires.out = w('out', t('B1', 2), t('K1', 0))
    wires.coilN = w('coilN', t('K1', 1), t('PS', 1))
  } else {
    wires.coilP = w('coilP', t('PS', 0), t('K1', 0))
    wires.out = w('out', t('K1', 1), t('B1', 2))
  }
  return { components, wires }
}

function transformerStartStop(): Board {
  return {
    components: {
      T1: { id: 'T1', cell: { x: 0, y: 1 }, spec: { ...CONTROL_TRANSFORMER_24VAC_SPEC } },
      STOP: { id: 'STOP', cell: { x: 3, y: 0 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: false } },
      START: { id: 'START', cell: { x: 3, y: 3 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true } },
      K1: { id: 'K1', cell: { x: 6, y: 1 }, spec: { ...RELAY_24V } },
      H1: { id: 'H1', cell: { x: 9, y: 1 }, spec: { ...INDICATOR_SPEC, resistanceOhms: 480 } },
    },
    wires: {
      a: w('a', t('T1', 0), t('STOP', 0)),
      b: w('b', t('STOP', 1), t('START', 0)),
      sealIn: w('sealIn', t('STOP', 1), t('K1', 2)),
      start: w('start', t('START', 1), t('K1', 0)),
      sealOut: w('sealOut', t('K1', 3), t('K1', 0)),
      return: w('return', t('K1', 1), t('T1', 1)),
      h1: w('h1', t('K1', 0), t('H1', 0)),
      h2: w('h2', t('H1', 1), t('T1', 1)),
    },
  }
}

function completeMotorFeeder(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 1 }, spec: { ...SOURCE_3PH_SPEC } },
      QS: { id: 'QS', cell: { x: 3, y: 1 }, spec: { ...DISCONNECTOR_3P_SPEC, on: true } },
      QF: { id: 'QF', cell: { x: 6, y: 1 }, spec: { ...MOTOR_BREAKER_GV2ME14_SPEC, on: true } },
      KM: { id: 'KM', cell: { x: 9, y: 1 }, spec: { ...CONTACTOR_SPEC } },
      OL: { id: 'OL', cell: { x: 12, y: 1 }, spec: { ...OVERLOAD_SPEC } },
      M: { id: 'M', cell: { x: 15, y: 1 }, spec: { ...MOTOR_3PH_SPEC } },
      PE: { id: 'PE', cell: { x: 15, y: 4 }, spec: { ...GROUND_SPEC } },
    },
    wires: {
      r1: w('r1', t('Q', 0), t('QS', 0)), r2: w('r2', t('QS', 1), t('QF', 0)), r3: w('r3', t('QF', 1), t('KM', 2)), r4: w('r4', t('KM', 3), t('OL', 0)), r5: w('r5', t('OL', 1), t('M', 0)),
      s1: w('s1', t('Q', 1), t('QS', 2)), s2: w('s2', t('QS', 3), t('QF', 2)), s3: w('s3', t('QF', 3), t('KM', 4)), s4: w('s4', t('KM', 5), t('OL', 2)), s5: w('s5', t('OL', 3), t('M', 2)),
      t1: w('t1', t('Q', 2), t('QS', 4)), t2: w('t2', t('QS', 5), t('QF', 4)), t3: w('t3', t('QF', 5), t('KM', 6)), t4: w('t4', t('KM', 7), t('OL', 4)), t5: w('t5', t('OL', 5), t('M', 4)),
      star1: w('star1', t('M', 1), t('M', 3)), star2: w('star2', t('M', 3), t('M', 5)),
      control1: w('control1', t('Q', 0), t('OL', 6)), control2: w('control2', t('OL', 7), t('KM', 0)), controlN: w('controlN', t('KM', 1), t('Q', 3)),
      pe: w('pe', t('PE', 0), t('M', 6)),
    },
  }
}

function phaseMonitorDropout(): Board {
  return {
    domain: 'ac-three-phase-balanced',
    components: {
      Q: { id: 'Q', cell: { x: 0, y: 1 }, spec: { ...SOURCE_3PH_SPEC } },
      PM: product('PM', 'PHASE_MONITOR_RM17TG20', 4, 1),
      H_OK: { id: 'H_OK', cell: { x: 8, y: 0 }, spec: { ...INDICATOR_SPEC } },
      H_FAULT: { id: 'H_FAULT', cell: { x: 8, y: 3 }, spec: { ...INDICATOR_SPEC } },
    },
    wires: {
      senseL1: w('senseL1', t('Q', 0), t('PM', 0)),
      senseL2: w('senseL2', t('Q', 1), t('PM', 1)),
      senseL3: w('senseL3', t('Q', 2), t('PM', 2)),
      healthyCom: w('healthyCom', t('Q', 0), t('PM', 3)),
      healthyOut: w('healthyOut', t('PM', 5), t('H_OK', 0)),
      healthyN: w('healthyN', t('H_OK', 1), t('Q', 3)),
      faultCom: w('faultCom', t('Q', 0), t('PM', 6)),
      faultOut: w('faultOut', t('PM', 7), t('H_FAULT', 0)),
      faultN: w('faultN', t('H_FAULT', 1), t('Q', 3)),
    },
  }
}

/** Schneider XB5AL73415 double-head station: STOP 21-22 is in series with
 * START 13-14. The first MY2 NO pole seals the coil; the second drives RUN. */
function productStartStopSelfHold(): Board {
  return {
    components: {
      PS: { id: 'PS', cell: { x: 0, y: 2 }, spec: { ...DIN_PSU_24V_SPEC } },
      S1: product('S1', 'PUSHBUTTON_STATION_XB5AL73415', 3, 1),
      K1: { id: 'K1', cell: { x: 6, y: 2 }, spec: { ...RELAY_24V } },
      RUN: { id: 'RUN', cell: { x: 10, y: 2 }, spec: { ...INDICATOR_SPEC, resistanceOhms: 480 } },
    },
    wires: {
      controlP: w('controlP', t('PS', 0), t('S1', 0)),
      stopOut: w('stopOut', t('S1', 1), t('S1', 2)),
      startOut: w('startOut', t('S1', 3), t('K1', 0)),
      sealCom: w('sealCom', t('S1', 1), t('K1', 2)),
      sealOut: w('sealOut', t('K1', 3), t('K1', 0)),
      coilN: w('coilN', t('K1', 1), t('PS', 1)),
      runCom: w('runCom', t('PS', 0), t('K1', 4)),
      runOut: w('runOut', t('K1', 7), t('RUN', 0)),
      runN: w('runN', t('RUN', 1), t('PS', 1)),
    },
  }
}

/** The XB5AW33B5 contact and its integral LED are separate circuits. Both the
 * solenoid and X1-X2 LED are deliberately placed after 13-14, so they energize
 * together only while the spring-return operator is held. */
function illuminatedPushbuttonSolenoid(): Board {
  return {
    components: {
      PS: { id: 'PS', cell: { x: 0, y: 2 }, spec: { ...DIN_PSU_24V_SPEC } },
      S1: product('S1', 'ILLUMINATED_PB_XB5AW33B5', 4, 1),
      Y1: { id: 'Y1', cell: { x: 8, y: 2 }, spec: { ...SOLENOID_VXE21_SPEC } },
    },
    wires: {
      contactP: w('contactP', t('PS', 0), t('S1', 2)),
      command: w('command', t('S1', 3), t('Y1', 0)),
      solenoidN: w('solenoidN', t('Y1', 1), t('PS', 1)),
      ledP: w('ledP', t('S1', 3), t('S1', 4)),
      ledN: w('ledN', t('S1', 5), t('PS', 1)),
    },
  }
}

/** D4N slow-action 1NC/1NO example. The 33-34 NO position contact drives a
 * 24 V relay; one relay NO pole drives the indicator. */
function limitSwitchPositionRelay(): Board {
  return {
    components: {
      PS: { id: 'PS', cell: { x: 0, y: 2 }, spec: { ...DIN_PSU_24V_SPEC } },
      B1: product('B1', 'LIMIT_SWITCH_D4N', 3, 1),
      K1: { id: 'K1', cell: { x: 6, y: 2 }, spec: { ...RELAY_24V } },
      H1: { id: 'H1', cell: { x: 10, y: 2 }, spec: { ...INDICATOR_SPEC, resistanceOhms: 480 } },
    },
    wires: {
      positionP: w('positionP', t('PS', 0), t('B1', 2)),
      positionOut: w('positionOut', t('B1', 3), t('K1', 0)),
      coilN: w('coilN', t('K1', 1), t('PS', 1)),
      lampP: w('lampP', t('PS', 0), t('K1', 2)),
      lampOut: w('lampOut', t('K1', 3), t('H1', 0)),
      lampN: w('lampN', t('H1', 1), t('PS', 1)),
    },
  }
}

function h3cr(mode: 'A' | 'B'): Board {
  return {
    components: {
      PS: { id: 'PS', cell: { x: 0, y: 1 }, spec: { ...DIN_PSU_24V_SPEC } },
      KT: { id: 'KT', cell: { x: 4, y: 1 }, spec: { ...H3CR_A8_SPEC, mode, starDurationMs: mode === 'A' ? 3_000 : 1_000 } },
      H1: { id: 'H1', cell: { x: 8, y: 1 }, spec: { ...INDICATOR_SPEC, resistanceOhms: 480 } },
    },
    wires: {
      coilP: w('coilP', t('PS', 0), t('KT', 0)), coilN: w('coilN', t('KT', 1), t('PS', 1)),
      com: w('com', t('PS', 0), t('KT', 2)), out: w('out', t('KT', 6), t('H1', 0)), loadN: w('loadN', t('H1', 1), t('PS', 1)),
    },
  }
}

function manualOffAutoPump(): Board {
  return {
    components: {
      PS: { id: 'PS', cell: { x: 0, y: 2 }, spec: { ...DIN_PSU_24V_SPEC } },
      SEL: { id: 'SEL', cell: { x: 3, y: 2 }, spec: { kind: 'SELECTOR_3POS', pos: 1 } },
      FLOAT: { id: 'FLOAT', cell: { x: 5, y: 4 }, spec: { kind: 'CONTACT_2STATE', actuated: false } },
      K1: { id: 'K1', cell: { x: 8, y: 2 }, spec: { ...RELAY_24V } },
      PUMP: { id: 'PUMP', cell: { x: 11, y: 2 }, spec: { ...INDICATOR_SPEC, resistanceOhms: 480 } },
    },
    wires: {
      p: w('p', t('PS', 0), t('SEL', 0)), manual: w('manual', t('SEL', 1), t('K1', 0)),
      auto: w('auto', t('SEL', 2), t('FLOAT', 0)), level: w('level', t('FLOAT', 2), t('K1', 0)), n: w('n', t('K1', 1), t('PS', 1)),
      contact: w('contact', t('PS', 0), t('K1', 2)), command: w('command', t('K1', 3), t('PUMP', 0)), commandN: w('commandN', t('PUMP', 1), t('PS', 1)),
    },
  }
}

function thermostatHeater(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 } },
      TH: { id: 'TH', cell: { x: 3, y: 1 }, spec: { kind: 'CONTACT_2STATE', actuated: false } },
      EH: { id: 'EH', cell: { x: 6, y: 1 }, spec: { ...HEATER_SPEC } },
    },
    wires: {
      p: w('p', t('S', 0), t('TH', 0)), nc: w('nc', t('TH', 1), t('EH', 0)), n: w('n', t('EH', 1), t('S', 1)),
    },
  }
}

export const INDUSTRIAL_CIRCUIT_EXAMPLES = {
  'psu-pnp-relay': () => sensorRelay('PNP'),
  'psu-npn-relay': () => sensorRelay('NPN'),
  'trafo-start-stop-relay': transformerStartStop,
  'motor-feeder-lengkap': completeMotorFeeder,
  'forward-reverse-interlock': () => buildCircuitTestFixture('interlock-2km'),
  'phase-monitor-dropout': phaseMonitorDropout,
  'product-start-stop-selfhold': productStartStopSelfHold,
  'illuminated-pb-solenoid': illuminatedPushbuttonSolenoid,
  'limit-switch-position-relay': limitSwitchPositionRelay,
  'h3cr-on-delay': () => h3cr('A'),
  'h3cr-flicker': () => h3cr('B'),
  'moa-pump-float': manualOffAutoPump,
  'heater-thermostat': thermostatHeater,
} satisfies Record<string, () => Board>

export type IndustrialCircuitExampleKey = keyof typeof INDUSTRIAL_CIRCUIT_EXAMPLES
