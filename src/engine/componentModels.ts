import { relayDefinition } from './relayModels'
import {
  terminalCountForSpec,
  type PlacedComponent,
} from './types'

/** Every currently published wiring palette identity. Kept in the neutral
 * engine layer so save/reload, Virtual, IEC, and the solver use the same key. */
export const WIRING_MODEL_IDS = [
  'SOURCE', 'BATTERY_24V', 'SWITCH', 'SWITCH_2WAY', 'SWITCH_CROSS',
  'SELECTOR_3POS', 'CONTACT_2STATE', 'LIMIT_SWITCH_D4N',
  'SENSOR_E2E_PNP_NO', 'SENSOR_E2E_NPN_NO', 'SENSOR_E2E_PNP_NC',
  'SENSOR_E2E_NPN_NC', 'SENSOR_E2K_PNP_NO', 'SENSOR_E3Z_PNP_LIGHT_ON',
  'TERMINAL_BLOCK', 'ESTOP', 'FUSE', 'BREAKER_1P', 'LOAD',
  'LOAD_RESISTOR', 'LOAD_HEATER', 'LOAD_BELL', 'SOLENOID_VXE21', 'GROUND',
  'MOTOR', 'CAPACITOR', 'PUSHBUTTON_NO', 'PUSHBUTTON_NC', 'RELAY',
  'RELAY_MY3', 'RELAY_MY4', 'RELAY_G5V2', 'INDICATOR', 'SOURCE_3PH',
  'BREAKER_3P', 'MOTOR_3PH', 'CONTACTOR', 'TIMER', 'OVERLOAD_RELAY',
  'DIN_PSU_HDR3024', 'CONTROL_TRANSFORMER_ABL6TS25B', 'DISCONNECTOR_VCF1',
  'MOTOR_BREAKER_GV2ME14', 'PHASE_MONITOR_RM17TG20', 'AUX_CONTACT_LADN22',
  'TIMER_H3CR_A8', 'SELECTOR_XB5AD21', 'KEY_SELECTOR_XB5AG21',
  'PUSHBUTTON_STATION_XB5AL73415', 'ILLUMINATED_PB_XB5AW33B5',
  'FLOAT_SWITCH_9037HG33', 'PRESSURE_SWITCH_XMLB004', 'THERMOSTAT_NSYCCOTHC',
  'SENSOR_E3Z_D61_NPN_LIGHT', 'SENSOR_E3Z_D61_NPN_DARK',
  'SENSOR_E3Z_D81_PNP_DARK', 'SENSOR_E2K_X4ME1', 'TERMINAL_UT25_BU',
  'TERMINAL_UT25_PE', 'TERMINAL_UT4_HESI', 'TERMINAL_UT4_MT',
  'TERMINAL_UT25_TWIN', 'TERMINAL_UT25_QUATTRO', 'TERMINAL_UT25_PE_LL',
] as const

export type WiringModelId = (typeof WIRING_MODEL_IDS)[number]

const WIRING_MODEL_SET: ReadonlySet<string> = new Set(WIRING_MODEL_IDS)

export function isWiringModelId(value: unknown): value is WiringModelId {
  return typeof value === 'string' && WIRING_MODEL_SET.has(value)
}

export interface TerminalDefinition {
  /** Marking printed by the manufacturer/standard; never the solver index. */
  designation: string
  role: string
  description: string
}

const terminal = (
  designation: string,
  role: string,
  description: string,
): TerminalDefinition => ({ designation, role, description })

const MODEL_TERMINALS: Partial<Record<WiringModelId, readonly TerminalDefinition[]>> = {
  SELECTOR_XB5AD21: [
    terminal('13', 'NO', 'XB5AD21 kontak NO 13'),
    terminal('14', 'NO', 'XB5AD21 kontak NO 14'),
  ],
  KEY_SELECTOR_XB5AG21: [
    terminal('13', 'NO', 'XB5AG21 kontak NO 13'),
    terminal('14', 'NO', 'XB5AG21 kontak NO 14'),
  ],
  PUSHBUTTON_STATION_XB5AL73415: [
    terminal('21', 'STOP NC', 'XB5AL73415 STOP normally closed 21'),
    terminal('22', 'STOP NC', 'XB5AL73415 STOP normally closed 22'),
    terminal('13', 'START NO', 'XB5AL73415 START normally open 13'),
    terminal('14', 'START NO', 'XB5AL73415 START normally open 14'),
  ],
  ILLUMINATED_PB_XB5AW33B5: [
    terminal('21', 'NC', 'XB5AW33B5 kontak normally closed 21'),
    terminal('22', 'NC', 'XB5AW33B5 kontak normally closed 22'),
    terminal('13', 'NO', 'XB5AW33B5 kontak normally open 13'),
    terminal('14', 'NO', 'XB5AW33B5 kontak normally open 14'),
    terminal('X1', 'PILOT LIGHT', 'XB5AW33B5 integral LED terminal X1'),
    terminal('X2', 'PILOT LIGHT', 'XB5AW33B5 integral LED terminal X2'),
  ],
  AUX_CONTACT_LADN22: [
    terminal('53', 'NO', 'LADN22 NO pole 1 terminal 53'),
    terminal('54', 'NO', 'LADN22 NO pole 1 terminal 54'),
    terminal('61', 'NC', 'LADN22 NC pole 1 terminal 61'),
    terminal('62', 'NC', 'LADN22 NC pole 1 terminal 62'),
    terminal('71', 'NC', 'LADN22 NC pole 2 terminal 71'),
    terminal('72', 'NC', 'LADN22 NC pole 2 terminal 72'),
    terminal('83', 'NO', 'LADN22 NO pole 2 terminal 83'),
    terminal('84', 'NO', 'LADN22 NO pole 2 terminal 84'),
  ],
  PHASE_MONITOR_RM17TG20: [
    terminal('L1', 'PHASE INPUT', 'RM17TG20 monitored phase L1'),
    terminal('L2', 'PHASE INPUT', 'RM17TG20 monitored phase L2'),
    terminal('L3', 'PHASE INPUT', 'RM17TG20 monitored phase L3'),
    terminal('11', 'COM', 'RM17TG20 output relay R1 common 11'),
    terminal('12', 'NC', 'RM17TG20 output relay R1 NC 12'),
    terminal('14', 'NO', 'RM17TG20 output relay R1 NO 14'),
    terminal('21', 'COM', 'RM17TG20 output relay R2 common 21'),
    terminal('22', 'NC', 'RM17TG20 output relay R2 NC 22'),
    terminal('24', 'NO', 'RM17TG20 output relay R2 NO 24'),
  ],
  FLOAT_SWITCH_9037HG33: [
    terminal('1', 'LINE', '9037HG33RZ20 DPST pole 1 line terminal 1'),
    terminal('2', 'LOAD', '9037HG33RZ20 DPST pole 1 load terminal 2'),
    terminal('3', 'LOAD', '9037HG33RZ20 DPST pole 2 load terminal 3'),
    terminal('4', 'LINE', '9037HG33RZ20 DPST pole 2 line terminal 4'),
  ],
  PRESSURE_SWITCH_XMLB004: [
    terminal('13', 'NO', 'XMLB004A2S11 normally open terminal 13'),
    terminal('14', 'NO', 'XMLB004A2S11 normally open terminal 14'),
    terminal('11', 'NC', 'XMLB004A2S11 normally closed terminal 11'),
    terminal('12', 'NC', 'XMLB004A2S11 normally closed terminal 12'),
  ],
  THERMOSTAT_NSYCCOTHC: [
    terminal('1', 'NC', 'NSYCCOTHC normally closed thermostat terminal 1'),
    terminal('2', 'NC', 'NSYCCOTHC normally closed thermostat terminal 2'),
  ],
  // CLIPLINE terminal blocks accept project markers; these letters are
  // explicit simulator endpoint aliases, not claimed factory-printed numbers.
  TERMINAL_UT25_BU: [
    terminal('A', 'COMMON', 'UT 2,5 BU endpoint A — simulator alias; project marker is user-defined'),
    terminal('B', 'COMMON', 'UT 2,5 BU endpoint B — simulator alias; project marker is user-defined'),
  ],
  TERMINAL_UT25_PE: [
    terminal('PE-A', 'PE', 'UT 2,5-PE endpoint A — simulator alias on the PE potential'),
    terminal('PE-B', 'PE', 'UT 2,5-PE endpoint B — simulator alias on the PE potential'),
  ],
  TERMINAL_UT4_HESI: [
    terminal('A', 'FUSED', 'UT 4-HESI endpoint A — simulator alias before the fuse carrier'),
    terminal('B', 'FUSED', 'UT 4-HESI endpoint B — simulator alias after the fuse carrier'),
  ],
  TERMINAL_UT4_MT: [
    terminal('A', 'DISCONNECT', 'UT 4-MT endpoint A — simulator alias before the knife disconnect'),
    terminal('B', 'DISCONNECT', 'UT 4-MT endpoint B — simulator alias after the knife disconnect'),
  ],
  TERMINAL_UT25_TWIN: ['A', 'B', 'C'].map((designation) =>
    terminal(designation, 'COMMON', `UT 2,5-TWIN endpoint ${designation} — simulator alias on one potential`),
  ),
  TERMINAL_UT25_QUATTRO: ['A', 'B', 'C', 'D'].map((designation) =>
    terminal(designation, 'COMMON', `UT 2,5-QUATTRO endpoint ${designation} — simulator alias on one potential`),
  ),
  TERMINAL_UT25_PE_LL: [
    terminal('PE-A', 'PE', 'UT 2,5-PE/L/L lowest PE level, endpoint A — simulator alias'),
    terminal('PE-B', 'PE', 'UT 2,5-PE/L/L lowest PE level, endpoint B — simulator alias'),
    terminal('L1-A', 'L1', 'UT 2,5-PE/L/L line level 1, endpoint A — simulator alias'),
    terminal('L1-B', 'L1', 'UT 2,5-PE/L/L line level 1, endpoint B — simulator alias'),
    terminal('L2-A', 'L2', 'UT 2,5-PE/L/L line level 2, endpoint A — simulator alias'),
    terminal('L2-B', 'L2', 'UT 2,5-PE/L/L line level 2, endpoint B — simulator alias'),
  ],
  TIMER_H3CR_A8: [
    terminal('2', 'POWER', 'H3CR-A8 pin 2: catu timer'),
    terminal('7', 'POWER', 'H3CR-A8 pin 7: catu timer'),
    terminal('1', 'COM', 'H3CR-A8 pin 1: common kontak 1'),
    terminal('4', 'NC', 'H3CR-A8 pin 4: normally closed kontak 1'),
    terminal('8', 'COM', 'H3CR-A8 pin 8: common kontak 2'),
    terminal('6', 'NO', 'H3CR-A8 pin 6: normally open kontak 2'),
    terminal('3', 'NO', 'H3CR-A8 pin 3: normally open kontak 1'),
    terminal('5', 'NC', 'H3CR-A8 pin 5: normally closed kontak 2'),
  ],
  DISCONNECTOR_VCF1: ['1/L1', '2/T1', '3/L2', '4/T2', '5/L3', '6/T3'].map(
    (designation, index) => terminal(designation, index % 2 === 0 ? 'LINE' : 'LOAD', `VCF1 pole ${Math.floor(index / 2) + 1} ${designation}`),
  ),
  MOTOR_BREAKER_GV2ME14: ['1/L1', '2/T1', '3/L2', '4/T2', '5/L3', '6/T3'].map(
    (designation, index) => terminal(designation, index % 2 === 0 ? 'LINE' : 'LOAD', `GV2ME14 pole ${Math.floor(index / 2) + 1} ${designation}`),
  ),
}

/** Exact terminal contract where the catalog model changes the generic kind. */
export function modelTerminalDefinitions(
  component: Pick<PlacedComponent, 'modelId'>,
): readonly TerminalDefinition[] | undefined {
  return isWiringModelId(component.modelId)
    ? MODEL_TERMINALS[component.modelId]
    : undefined
}

export function terminalCountForComponent(component: PlacedComponent): number {
  return modelTerminalDefinitions(component)?.length ?? terminalCountForSpec(component.spec)
}

/** Terminal definitions for models whose pin map already lives in the spec. */
export function resolvedTerminalDefinitions(
  component: PlacedComponent,
): readonly TerminalDefinition[] | undefined {
  if (component.spec.kind === 'SOURCE' && component.spec.transformer) {
    return ['P1', 'P2', '0', ...component.spec.transformer.tapVolts.map(String)].map((name) => terminal(name, '', `Trafo ideal ${name}`))
  }
  if (component.spec.kind === 'LOAD' && component.spec.threePhase) {
    return ['U', 'V', 'W', 'PE'].map((name) => terminal(name, '', `Heater tiga fasa ${name}`))
  }
  if (component.spec.kind === 'TIMER' && component.spec.model === 'GENERIC_CONFIGURABLE') {
    return ['A1', 'A2', 'COM1', 'NC1', 'COM2', 'NO2', 'NO1', 'NC2'].map((name) => terminal(name, '', `Timer generik ${name}`))
  }
  const exact = modelTerminalDefinitions(component)
  if (exact) return exact
  if (component.spec.kind === 'RELAY') {
    const definition = relayDefinition(component.spec)
    return definition.terminals.map((item) =>
      terminal(item.pin, item.role, `${definition.family} pin ${item.pin}: ${item.role}`),
    )
  }
  return undefined
}
