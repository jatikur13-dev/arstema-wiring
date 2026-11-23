import type {
  ComponentKind,
  PlacedComponent,
} from '../../engine/index'

// Media Papan Virtual tidak lagi diimpor oleh APK. Nilai `src` di bawah adalah
// logical path dalam paket opsional `wiring-virtual`; geometri dan terminal tetap
// berada di core agar IEC, solver, dan project tidak bergantung pada media.
const bell = 'bell.webp'
const battery24v = 'battery-24v.webp'
const dinPsu24v = 'din-psu-24v.webp'
const controlTransformer24vac = 'control-transformer-24vac.webp'
const breaker1p = 'breaker-1p.webp'
const breaker3p = 'breaker-3p.webp'
const motorBreakerGv2me14 = 'motor-breaker-gv2me14.webp'
const disconnectorVcf1 = 'disconnector-vcf1.webp'
const selectorXb5ad21 = 'selector-xb5ad21.webp'
const keySelectorXb5ag21 = 'key-selector-xb5ag21.webp'
const pushbuttonStationXb5al73415 = 'pushbutton-station-xb5al73415.webp'
const illuminatedPushbuttonXb5aw33b5 = 'illuminated-pushbutton-xb5aw33b5.webp'
const phaseMonitorRm17tg20 = 'phase-monitor-rm17tg20.webp'
const auxContactLadn22 = 'aux-contact-ladn22.webp'
const timerH3crA8 = 'timer-h3cr-a8.webp'
const floatSwitch9037hg33 = 'float-switch-9037hg33.webp'
const pressureSwitchXmlb004 = 'pressure-switch-xmlb004.webp'
const thermostatNsyccothc = 'thermostat-nsyccothc.webp'
const terminalUt25Bu = 'terminal-ut25-bu.webp'
const terminalUt25Pe = 'terminal-ut25-pe.webp'
const terminalUt4Hesi = 'terminal-ut4-hesi.webp'
const terminalUt4Mt = 'terminal-ut4-mt.webp'
const terminalUt25Twin = 'terminal-ut25-twin.webp'
const terminalUt25Quattro = 'terminal-ut25-quattro.webp'
const terminalUt25PeLl = 'terminal-ut25-pe-ll.webp'
const capacitor = 'capacitor.webp'
const contact2state = 'contact-2state.webp'
const contactor = 'contactor.webp'
const estop = 'estop.webp'
const fuse = 'fuse.webp'
const ground = 'ground.webp'
const heater = 'heater.webp'
const indicator = 'indicator.webp'
const lamp = 'lamp.webp'
const limitSwitchD4n = 'limit-switch-d4n.webp'
const motor = 'motor.webp'
const motor3ph = 'motor-3ph.webp'
const overload = 'overload.webp'
const pushbuttonNc = 'pushbutton-nc.webp'
const pushbuttonNo = 'pushbutton-no.webp'
const relay = 'relay.webp'
const relayMy2 = 'relay-my2.webp'
const relayMy3 = 'relay-my3.webp'
const relayMy4 = 'relay-my4.webp'
const relayG5v2 = 'relay-g5v2.webp'
const resistor = 'resistor.webp'
const selector3pos = 'selector-3pos.webp'
const source = 'source.webp'
const source3ph = 'source-3ph.webp'
const sensorCapacitiveE2k = 'sensor-capacitive-e2k.webp'
const sensorInductiveE2e = 'sensor-inductive-e2e.webp'
const sensorPhotoelectricE3z = 'sensor-photoelectric-e3z.webp'
const solenoidVxe21 = 'solenoid-vxe21.webp'
const switch1p = 'switch.webp'
const switch2way = 'switch-2way.webp'
const switchCross = 'switch-cross.webp'
const timer = 'timer.webp'
const terminalBlock = 'terminal-block.webp'

export interface AssetViewBox {
  x: number
  y: number
  width: number
  height: number
}

export interface AssetPoint {
  x: number
  y: number
}

export interface AssetRect extends AssetPoint {
  width: number
  height: number
}

export interface VirtualAssetLayer {
  id: string
  src: string
  viewBox: AssetViewBox
  /** Placement inside the complete instrument, normalized 0..1. */
  placement: AssetRect
}

export interface VirtualStatusLayer {
  id: 'state' | 'glow' | 'motion' | 'energized' | 'trip'
  rect: AssetRect
  layer?: string
}

export interface VirtualTerminalAnchor extends AssetPoint {
  layer?: string
  /** Direction in which the physical cable leaves this terminal. */
  exit: AssetPoint
}

export interface VirtualAssetDefinition {
  kind: ComponentKind
  src: string
  /** Tight source-pixel viewBox; the original assets are 1254×1254. */
  viewBox: AssetViewBox
  /** Preferred physical drawing size in board-cell units. */
  displayCells: { width: number; height: number }
  terminals: readonly VirtualTerminalAnchor[]
  actuator?: AssetRect
  layers?: readonly VirtualAssetLayer[]
  /** Source-pixel regions used by state animation and status overlays. */
  statusLayers?: readonly VirtualStatusLayer[]
}

const SOURCE_SIZE = 1254
const layer = (
  id: string,
  src: string,
  viewBox: AssetViewBox,
  placement: AssetRect,
): VirtualAssetLayer => ({ id, src, viewBox, placement })
const terminal = (
  x: number,
  y: number,
  exit: AssetPoint,
  layerId?: string,
): VirtualTerminalAnchor => ({ x, y, exit, layer: layerId })
const statusLayer = (
  id: VirtualStatusLayer['id'],
  rect: AssetRect,
  layerId?: string,
): VirtualStatusLayer => ({ id, rect, layer: layerId })
const top = { x: 0, y: -1 }
const bottom = { x: 0, y: 1 }
const left = { x: -1, y: 0 }
const right = { x: 1, y: 0 }

const ASSETS = {
  SOURCE_TRANSFORMER_TAPPED: {
    kind: 'SOURCE', src: 'globaltek-transformer-tapped.webp',
    viewBox: { x: 85, y: 85, width: 1084, height: 1084 }, displayCells: { width: 2.2, height: 2.2 },
    terminals: [terminal(209,412.029,left),terminal(209,937.515,left),terminal(1045,376.2,right),terminal(1045,674.772,right),terminal(1045,973.343,right)],
  },
  LOAD_HEATER_3PH: {
    kind: 'LOAD', src: 'globaltek-heater-3ph.webp',
    viewBox: { x: 125, y: 100, width: 1004, height: 914 }, displayCells: { width: 2.4, height: 2.2 },
    terminals: [terminal(285,900.6,bottom),terminal(513,900.6,bottom),terminal(741,900.6,bottom),terminal(969,900.6,bottom)],
    statusLayers: [statusLayer('glow', {x:250,y:130,width:740,height:580})],
  },
  LOAD_FAN: {
    kind: 'LOAD', src: 'globaltek-fan.webp',
    viewBox: { x: 170, y: 105, width: 914, height: 1035 }, displayCells: { width: 1.8, height: 2 },
    terminals: [terminal(447.857,1080.829,bottom),terminal(806.143,1080.829,bottom)],
  },
  SOURCE: {
    kind: 'SOURCE',
    src: source,
    viewBox: { x: 334, y: 40, width: 587, height: 1153 },
    displayCells: { width: 0.78, height: 1.38 },
    terminals: [
      terminal(545, 600, left),
      terminal(690, 930, right),
    ],
  },
  SOURCE_BATTERY_24V: {
    kind: 'SOURCE',
    src: battery24v,
    viewBox: { x: 120, y: 130, width: 1014, height: 900 },
    displayCells: { width: 1.48, height: 1.28 },
    terminals: [
      terminal(230, 627, left),
      terminal(1024, 627, right),
    ],
  },
  SOURCE_DIN_PSU_24V: {
    kind: 'SOURCE',
    src: dinPsu24v,
    viewBox: { x: 200, y: 70, width: 854, height: 1110 },
    displayCells: { width: 1.18, height: 1.45 },
    terminals: [terminal(280, 780, left), terminal(974, 780, right)],
  },
  SOURCE_CONTROL_TRANSFORMER_24VAC: {
    kind: 'SOURCE',
    src: controlTransformer24vac,
    viewBox: { x: 155, y: 105, width: 944, height: 1050 },
    displayCells: { width: 1.45, height: 1.45 },
    terminals: [terminal(205, 930, left), terminal(1049, 930, right)],
  },
  GROUND: {
    kind: 'GROUND',
    src: ground,
    viewBox: { x: 389, y: 124, width: 474, height: 965 },
    displayCells: { width: 0.72, height: 1.18 },
    terminals: [terminal(625, 620, top)],
  },
  LOAD_LAMP: {
    kind: 'LOAD',
    src: lamp,
    viewBox: { x: 391, y: 115, width: 471, height: 954 },
    displayCells: { width: 0.72, height: 1.18 },
    terminals: [
      terminal(625, 245, top),
      terminal(625, 930, bottom),
    ],
    statusLayers: [
      statusLayer('glow', { x: 410, y: 330, width: 430, height: 430 }),
    ],
  },
  LOAD_RESISTOR: {
    kind: 'LOAD',
    src: resistor,
    viewBox: { x: 446, y: 80, width: 362, height: 1094 },
    displayCells: { width: 0.6, height: 1.3 },
    terminals: [
      terminal(625, 320, top),
      terminal(625, 1010, bottom),
    ],
  },
  LOAD_HEATER: {
    kind: 'LOAD',
    src: heater,
    viewBox: { x: 377, y: 45, width: 501, height: 1159 },
    displayCells: { width: 0.72, height: 1.3 },
    terminals: [
      terminal(520, 1025, bottom),
      terminal(740, 1025, bottom),
    ],
  },
  LOAD_BELL: {
    kind: 'LOAD',
    src: bell,
    viewBox: { x: 383, y: 53, width: 487, height: 1064 },
    displayCells: { width: 0.72, height: 1.22 },
    terminals: [
      terminal(625, 280, top),
      terminal(625, 850, bottom),
    ],
  },
  LOAD_SOLENOID: {
    kind: 'LOAD',
    src: solenoidVxe21,
    viewBox: { x: 150, y: 130, width: 954, height: 1025 },
    displayCells: { width: 1.52, height: 1.52 },
    terminals: [
      terminal(430, 1020, bottom),
      terminal(824, 1020, bottom),
    ],
    statusLayers: [
      statusLayer('energized', { x: 400, y: 185, width: 454, height: 295 }),
    ],
  },
  SWITCH: {
    kind: 'SWITCH',
    src: switch1p,
    viewBox: { x: 463, y: 26, width: 328, height: 1179 },
    displayCells: { width: 0.58, height: 1.32 },
    terminals: [
      terminal(625, 240, top),
      terminal(625, 990, bottom),
    ],
    actuator: { x: 520, y: 430, width: 210, height: 390 },
    statusLayers: [
      statusLayer('state', { x: 520, y: 430, width: 210, height: 390 }),
    ],
  },
  SWITCH_2WAY: {
    kind: 'SWITCH_2WAY',
    src: switch2way,
    viewBox: { x: 269, y: 46, width: 715, height: 1160 },
    displayCells: { width: 0.86, height: 1.34 },
    terminals: [
      terminal(405, 265, top),
      terminal(625, 265, top),
      terminal(845, 265, top),
    ],
    actuator: { x: 500, y: 480, width: 250, height: 360 },
    statusLayers: [
      statusLayer('state', { x: 500, y: 480, width: 250, height: 360 }),
    ],
  },
  SWITCH_CROSS: {
    kind: 'SWITCH_CROSS',
    src: switchCross,
    viewBox: { x: 320, y: 35, width: 603, height: 1163 },
    displayCells: { width: 0.82, height: 1.34 },
    terminals: [
      terminal(480, 270, top),
      terminal(770, 270, top),
      terminal(480, 970, bottom),
      terminal(770, 970, bottom),
    ],
    actuator: { x: 525, y: 450, width: 210, height: 390 },
    statusLayers: [
      statusLayer('state', { x: 525, y: 450, width: 210, height: 390 }),
    ],
  },
  CONTACT_2STATE: {
    kind: 'CONTACT_2STATE',
    src: contact2state,
    viewBox: { x: 199, y: 106, width: 860, height: 952 },
    displayCells: { width: 0.94, height: 1.16 },
    terminals: [
      terminal(360, 880, bottom),
      terminal(625, 880, bottom),
      terminal(890, 880, bottom),
    ],
    actuator: { x: 515, y: 145, width: 225, height: 190 },
    statusLayers: [
      statusLayer('state', { x: 515, y: 145, width: 225, height: 190 }),
    ],
  },
  LIMIT_SWITCH: {
    kind: 'LIMIT_SWITCH',
    src: limitSwitchD4n,
    viewBox: { x: 205, y: 35, width: 844, height: 1115 },
    displayCells: { width: 1.72, height: 1.68 },
    terminals: [
      terminal(300, 1000, bottom),
      terminal(480, 1000, bottom),
      terminal(774, 1000, bottom),
      terminal(954, 1000, bottom),
    ],
    actuator: { x: 740, y: 35, width: 285, height: 315 },
    statusLayers: [
      statusLayer('state', { x: 740, y: 35, width: 285, height: 315 }),
    ],
  },
  SENSOR_INDUCTIVE: {
    kind: 'SENSOR_3WIRE',
    src: sensorInductiveE2e,
    viewBox: { x: 140, y: 220, width: 970, height: 940 },
    displayCells: { width: 1.68, height: 1.58 },
    terminals: [
      terminal(350, 1020, bottom),
      terminal(627, 1020, bottom),
      terminal(904, 1020, bottom),
    ],
    actuator: { x: 180, y: 370, width: 180, height: 370 },
    statusLayers: [
      statusLayer('state', { x: 180, y: 370, width: 180, height: 370 }),
      statusLayer('glow', { x: 170, y: 385, width: 180, height: 340 }),
    ],
  },
  SENSOR_CAPACITIVE: {
    kind: 'SENSOR_3WIRE',
    src: sensorCapacitiveE2k,
    viewBox: { x: 140, y: 220, width: 970, height: 940 },
    displayCells: { width: 1.68, height: 1.58 },
    terminals: [
      terminal(350, 1020, bottom),
      terminal(627, 1020, bottom),
      terminal(904, 1020, bottom),
    ],
    actuator: { x: 195, y: 380, width: 225, height: 355 },
    statusLayers: [
      statusLayer('state', { x: 195, y: 380, width: 225, height: 355 }),
      statusLayer('glow', { x: 190, y: 385, width: 220, height: 340 }),
    ],
  },
  SENSOR_PHOTOELECTRIC: {
    kind: 'SENSOR_3WIRE',
    src: sensorPhotoelectricE3z,
    viewBox: { x: 140, y: 175, width: 970, height: 985 },
    displayCells: { width: 1.7, height: 1.62 },
    terminals: [
      terminal(350, 1020, bottom),
      terminal(627, 1020, bottom),
      terminal(904, 1020, bottom),
    ],
    actuator: { x: 245, y: 305, width: 300, height: 470 },
    statusLayers: [
      statusLayer('state', { x: 245, y: 305, width: 300, height: 470 }),
      statusLayer('glow', { x: 285, y: 365, width: 210, height: 210 }),
    ],
  },
  TERMINAL_BLOCK: {
    kind: 'TERMINAL_BLOCK',
    src: terminalBlock,
    viewBox: { x: 125, y: 220, width: 1004, height: 935 },
    displayCells: { width: 1.55, height: 1.28 },
    terminals: [
      terminal(220, 627, left),
      terminal(1034, 627, right),
    ],
  },
  TERMINAL_UT25_BU: {
    kind: 'TERMINAL_BLOCK',
    src: terminalUt25Bu,
    viewBox: { x: 145, y: 145, width: 965, height: 965 },
    displayCells: { width: 1.28, height: 1.28 },
    terminals: [
      terminal(420, 260, top),
      terminal(835, 260, top),
    ],
  },
  TERMINAL_UT25_PE: {
    kind: 'TERMINAL_BLOCK',
    src: terminalUt25Pe,
    viewBox: { x: 145, y: 145, width: 965, height: 965 },
    displayCells: { width: 1.28, height: 1.28 },
    terminals: [
      terminal(420, 260, top),
      terminal(835, 260, top),
    ],
  },
  TERMINAL_UT4_HESI: {
    kind: 'TERMINAL_BLOCK',
    src: terminalUt4Hesi,
    viewBox: { x: 150, y: 80, width: 955, height: 1090 },
    displayCells: { width: 1.12, height: 1.55 },
    terminals: [
      terminal(430, 965, bottom),
      terminal(825, 965, bottom),
    ],
    actuator: { x: 300, y: 165, width: 660, height: 490 },
    statusLayers: [
      statusLayer('state', { x: 300, y: 165, width: 660, height: 490 }),
    ],
  },
  TERMINAL_UT4_MT: {
    kind: 'TERMINAL_BLOCK',
    src: terminalUt4Mt,
    viewBox: { x: 115, y: 135, width: 1025, height: 955 },
    displayCells: { width: 1.32, height: 1.28 },
    terminals: [
      terminal(420, 270, top),
      terminal(835, 270, top),
    ],
    actuator: { x: 540, y: 255, width: 180, height: 380 },
    statusLayers: [
      statusLayer('state', { x: 540, y: 255, width: 180, height: 380 }),
    ],
  },
  TERMINAL_UT25_TWIN: {
    kind: 'TERMINAL_BLOCK',
    src: terminalUt25Twin,
    viewBox: { x: 115, y: 125, width: 1025, height: 1000 },
    displayCells: { width: 1.42, height: 1.35 },
    terminals: [
      terminal(360, 235, top),
      terminal(790, 235, top),
      terminal(950, 235, top),
    ],
  },
  TERMINAL_UT25_QUATTRO: {
    kind: 'TERMINAL_BLOCK',
    src: terminalUt25Quattro,
    viewBox: { x: 105, y: 120, width: 1045, height: 1010 },
    displayCells: { width: 1.48, height: 1.38 },
    terminals: [
      terminal(330, 230, top),
      terminal(485, 230, top),
      terminal(775, 230, top),
      terminal(930, 230, top),
    ],
  },
  TERMINAL_UT25_PE_LL: {
    kind: 'TERMINAL_BLOCK',
    src: terminalUt25PeLl,
    viewBox: { x: 150, y: 70, width: 955, height: 1100 },
    displayCells: { width: 1.32, height: 1.68 },
    // Contract order remains pair-per-level. The lowest pair is PE; the two
    // upper pairs are separate line potentials. Code-rendered designations
    // identify the simulator endpoints without pretending factory markings.
    terminals: [
      terminal(315, 915, left), terminal(940, 915, right),
      terminal(350, 585, left), terminal(905, 585, right),
      terminal(390, 265, left), terminal(865, 265, right),
    ],
  },
  SELECTOR_3POS: {
    kind: 'SELECTOR_3POS',
    src: selector3pos,
    viewBox: { x: 283, y: 52, width: 687, height: 1085 },
    displayCells: { width: 0.88, height: 1.3 },
    terminals: [
      terminal(430, 1020, bottom),
      terminal(625, 1020, bottom),
      terminal(820, 1020, bottom),
    ],
    actuator: { x: 400, y: 230, width: 450, height: 560 },
    statusLayers: [
      statusLayer('state', { x: 400, y: 230, width: 450, height: 560 }),
    ],
  },
  FUSE: {
    kind: 'FUSE',
    src: fuse,
    viewBox: { x: 456, y: 19, width: 340, height: 1205 },
    displayCells: { width: 0.58, height: 1.35 },
    terminals: [
      terminal(625, 150, top),
      terminal(625, 1050, bottom),
    ],
    statusLayers: [
      statusLayer('state', { x: 510, y: 335, width: 230, height: 545 }),
    ],
  },
  ESTOP: {
    kind: 'ESTOP',
    src: estop,
    viewBox: { x: 281, y: 53, width: 691, height: 1121 },
    displayCells: { width: 0.9, height: 1.3 },
    terminals: [
      terminal(425, 950, bottom),
      terminal(850, 950, bottom),
    ],
    actuator: { x: 300, y: 53, width: 655, height: 562 },
    statusLayers: [
      statusLayer('state', { x: 300, y: 53, width: 655, height: 562 }),
    ],
  },
  MOTOR: {
    kind: 'MOTOR',
    src: motor,
    viewBox: { x: 261, y: 123, width: 729, height: 961 },
    displayCells: { width: 1.18, height: 1.2 },
    terminals: [
      terminal(500, 275, top),
      terminal(625, 275, top),
      terminal(750, 275, top),
    ],
    statusLayers: [
      statusLayer('motion', { x: 350, y: 455, width: 560, height: 450 }),
    ],
  },
  CAPACITOR: {
    kind: 'CAPACITOR',
    src: capacitor,
    viewBox: { x: 357, y: 96, width: 540, height: 1045 },
    displayCells: { width: 0.74, height: 1.22 },
    terminals: [
      terminal(625, 210, top),
      terminal(625, 1040, bottom),
    ],
  },
  PUSHBUTTON_NO: {
    kind: 'PUSHBUTTON',
    src: pushbuttonNo,
    viewBox: { x: 409, y: 114, width: 435, height: 967 },
    displayCells: { width: 0.7, height: 1.18 },
    terminals: [
      terminal(625, 295, top),
      terminal(625, 890, bottom),
    ],
    actuator: { x: 420, y: 380, width: 410, height: 410 },
    statusLayers: [
      statusLayer('state', { x: 420, y: 380, width: 410, height: 410 }),
    ],
  },
  PUSHBUTTON_NC: {
    kind: 'PUSHBUTTON',
    src: pushbuttonNc,
    viewBox: { x: 386, y: 133, width: 469, height: 919 },
    displayCells: { width: 0.72, height: 1.16 },
    terminals: [
      terminal(625, 245, top),
      terminal(625, 925, bottom),
    ],
    actuator: { x: 400, y: 365, width: 450, height: 450 },
    statusLayers: [
      statusLayer('state', { x: 400, y: 365, width: 450, height: 450 }),
    ],
  },
  RELAY: {
    kind: 'RELAY',
    src: relay,
    viewBox: { x: 318, y: 109, width: 619, height: 996 },
    displayCells: { width: 0.86, height: 1.28 },
    terminals: [
      terminal(450, 230, top),
      terminal(450, 970, bottom),
      terminal(625, 230, top),
      terminal(625, 970, bottom),
      terminal(800, 230, top),
      terminal(800, 970, bottom),
    ],
    statusLayers: [
      statusLayer('energized', { x: 420, y: 410, width: 410, height: 390 }),
    ],
  },
  RELAY_MY2: {
    kind: 'RELAY',
    src: relayMy2,
    viewBox: { x: 70, y: 70, width: 1114, height: 1114 },
    displayCells: { width: 1.8, height: 2 },
    terminals: [
      terminal(260, 930, left),
      terminal(994, 930, right),
      terminal(260, 710, left),
      terminal(260, 490, left),
      terminal(994, 710, right),
      terminal(994, 270, right),
      terminal(260, 270, left),
      terminal(994, 490, right),
    ],
    statusLayers: [statusLayer('energized', { x: 465, y: 430, width: 324, height: 390 })],
  },
  RELAY_MY3: {
    kind: 'RELAY',
    src: relayMy3,
    viewBox: { x: 70, y: 70, width: 1114, height: 1114 },
    displayCells: { width: 1.9, height: 2 },
    terminals: [
      terminal(465, 930, bottom),
      terminal(789, 930, bottom),
      terminal(300, 720, left),
      terminal(300, 500, left),
      terminal(300, 280, left),
      terminal(627, 720, bottom),
      terminal(627, 500, top),
      terminal(627, 280, top),
      terminal(954, 720, right),
      terminal(954, 500, right),
      terminal(954, 280, right),
    ],
    statusLayers: [statusLayer('energized', { x: 465, y: 430, width: 324, height: 390 })],
  },
  RELAY_MY4: {
    kind: 'RELAY',
    src: relayMy4,
    viewBox: { x: 70, y: 70, width: 1114, height: 1114 },
    displayCells: { width: 2, height: 2 },
    terminals: [
      terminal(495, 930, bottom),
      terminal(759, 930, bottom),
      terminal(230, 715, left),
      terminal(230, 500, left),
      terminal(230, 285, left),
      terminal(495, 715, bottom),
      terminal(495, 500, top),
      terminal(495, 285, top),
      terminal(759, 715, bottom),
      terminal(759, 500, top),
      terminal(759, 285, top),
      terminal(1024, 715, right),
      terminal(1024, 500, right),
      terminal(1024, 285, right),
    ],
    statusLayers: [statusLayer('energized', { x: 465, y: 430, width: 324, height: 390 })],
  },
  RELAY_G5V2: {
    kind: 'RELAY',
    src: relayG5v2,
    viewBox: { x: 70, y: 70, width: 1114, height: 1114 },
    displayCells: { width: 1.8, height: 2 },
    terminals: [
      terminal(260, 270, left),
      terminal(994, 270, right),
      terminal(260, 490, left),
      terminal(260, 930, left),
      terminal(260, 710, left),
      terminal(994, 490, right),
      terminal(994, 930, right),
      terminal(994, 710, right),
    ],
    statusLayers: [statusLayer('energized', { x: 465, y: 430, width: 324, height: 390 })],
  },
  INDICATOR: {
    kind: 'INDICATOR',
    src: indicator,
    viewBox: { x: 366, y: 111, width: 519, height: 938 },
    displayCells: { width: 0.74, height: 1.18 },
    terminals: [
      terminal(625, 245, top),
      terminal(625, 925, bottom),
    ],
    actuator: { x: 390, y: 320, width: 470, height: 480 },
    statusLayers: [
      statusLayer('glow', { x: 390, y: 320, width: 470, height: 480 }),
    ],
  },
  SOURCE_3PH: {
    kind: 'SOURCE_3PH',
    src: source3ph,
    viewBox: { x: 157, y: 212, width: 940, height: 808 },
    displayCells: { width: 1.7, height: 1.15 },
    terminals: [
      terminal(310, 655, bottom),
      terminal(500, 655, bottom),
      terminal(700, 655, bottom),
      terminal(900, 655, bottom),
    ],
  },
  MOTOR_3PH: {
    kind: 'MOTOR_3PH',
    src: motor3ph,
    viewBox: { x: 254, y: 107, width: 743, height: 999 },
    displayCells: { width: 1.42, height: 1.38 },
    terminals: [
      terminal(510, 275, top),
      terminal(510, 365, bottom),
      terminal(625, 275, top),
      terminal(625, 365, bottom),
      terminal(740, 275, top),
      terminal(740, 365, bottom),
      // Generic frame-bond screw. It is separate from all six winding studs.
      terminal(430, 930, left),
    ],
    statusLayers: [
      statusLayer('motion', { x: 340, y: 480, width: 575, height: 430 }),
    ],
  },
  CONTACTOR: {
    kind: 'CONTACTOR',
    src: contactor,
    viewBox: { x: 279, y: 41, width: 696, height: 1148 },
    displayCells: { width: 1.68, height: 1.82 },
    terminals: [
      terminal(365, 620, left),
      terminal(365, 725, left),
      terminal(400, 230, top),
      terminal(400, 1015, bottom),
      terminal(625, 230, top),
      terminal(625, 1015, bottom),
      terminal(850, 230, top),
      terminal(850, 1015, bottom),
      terminal(885, 620, right),
      terminal(885, 725, right),
      terminal(885, 620, right, 'aux-nc'),
      terminal(885, 725, right, 'aux-nc'),
    ],
    layers: [
      layer(
        'aux-nc',
        contactor,
        { x: 810, y: 500, width: 145, height: 310 },
        { x: 0.8, y: 0.48, width: 0.2, height: 0.32 },
      ),
    ],
    statusLayers: [
      statusLayer('energized', { x: 455, y: 445, width: 335, height: 390 }),
    ],
  },
  BREAKER_1P: {
    kind: 'BREAKER_1P',
    src: breaker1p,
    viewBox: { x: 448, y: 21, width: 357, height: 1186 },
    displayCells: { width: 0.62, height: 1.34 },
    terminals: [
      terminal(625, 165, top),
      terminal(625, 1010, bottom),
    ],
    actuator: { x: 520, y: 430, width: 210, height: 350 },
    statusLayers: [
      statusLayer('state', { x: 520, y: 430, width: 210, height: 350 }),
    ],
  },
  BREAKER_3P: {
    kind: 'BREAKER_3P',
    src: breaker3p,
    viewBox: { x: 260, y: 52, width: 733, height: 1113 },
    displayCells: { width: 1.28, height: 1.48 },
    terminals: [
      terminal(400, 175, top),
      terminal(400, 1010, bottom),
      terminal(625, 175, top),
      terminal(625, 1010, bottom),
      terminal(850, 175, top),
      terminal(850, 1010, bottom),
    ],
    actuator: { x: 330, y: 470, width: 590, height: 300 },
    statusLayers: [
      statusLayer('state', { x: 330, y: 470, width: 590, height: 300 }),
    ],
  },
  MOTOR_BREAKER_GV2ME14: {
    kind: 'BREAKER_3P',
    src: motorBreakerGv2me14,
    viewBox: { x: 150, y: 25, width: 1040, height: 1205 },
    displayCells: { width: 1.38, height: 1.72 },
    terminals: [
      terminal(520, 250, top),
      terminal(520, 1080, bottom),
      terminal(705, 250, top),
      terminal(705, 1080, bottom),
      terminal(895, 250, top),
      terminal(895, 1080, bottom),
    ],
    actuator: { x: 465, y: 480, width: 500, height: 260 },
    statusLayers: [
      statusLayer('state', { x: 465, y: 480, width: 500, height: 260 }),
      statusLayer('trip', { x: 620, y: 475, width: 190, height: 270 }),
    ],
  },
  DISCONNECTOR_VCF1: {
    kind: 'BREAKER_3P',
    src: disconnectorVcf1,
    viewBox: { x: 145, y: 110, width: 980, height: 960 },
    displayCells: { width: 1.45, height: 1.45 },
    terminals: [
      terminal(385, 215, top),
      terminal(385, 1015, bottom),
      terminal(550, 215, top),
      terminal(550, 1015, bottom),
      terminal(710, 215, top),
      terminal(710, 1015, bottom),
    ],
    actuator: { x: 395, y: 385, width: 680, height: 460 },
    statusLayers: [
      statusLayer('state', { x: 395, y: 385, width: 680, height: 460 }),
    ],
  },
  SELECTOR_XB5AD21: {
    kind: 'SWITCH',
    src: selectorXb5ad21,
    viewBox: { x: 155, y: 125, width: 975, height: 930 },
    displayCells: { width: 1.25, height: 1.12 },
    terminals: [
      terminal(275, 360, left),
      terminal(275, 795, left),
    ],
    actuator: { x: 610, y: 360, width: 500, height: 480 },
    statusLayers: [
      statusLayer('state', { x: 610, y: 360, width: 500, height: 480 }),
    ],
  },
  KEY_SELECTOR_XB5AG21: {
    kind: 'SWITCH',
    src: keySelectorXb5ag21,
    viewBox: { x: 85, y: 70, width: 1090, height: 1080 },
    displayCells: { width: 1.35, height: 1.22 },
    terminals: [
      terminal(245, 430, left),
      terminal(245, 795, left),
    ],
    actuator: { x: 570, y: 390, width: 590, height: 570 },
    statusLayers: [
      statusLayer('state', { x: 570, y: 390, width: 590, height: 570 }),
    ],
  },
  PUSHBUTTON_STATION_XB5AL73415: {
    kind: 'LIMIT_SWITCH',
    src: pushbuttonStationXb5al73415,
    viewBox: { x: 100, y: 110, width: 1000, height: 1030 },
    displayCells: { width: 1.1, height: 1.55 },
    terminals: [
      terminal(235, 430, left),
      terminal(235, 790, left),
      terminal(1010, 430, right),
      terminal(1010, 790, right),
    ],
    actuator: { x: 470, y: 350, width: 520, height: 690 },
    statusLayers: [
      statusLayer('state', { x: 470, y: 350, width: 520, height: 690 }),
    ],
  },
  ILLUMINATED_PB_XB5AW33B5: {
    kind: 'LIMIT_SWITCH',
    src: illuminatedPushbuttonXb5aw33b5,
    viewBox: { x: 105, y: 95, width: 1050, height: 1035 },
    displayCells: { width: 1.28, height: 1.28 },
    // Contract order is 21, 22, 13, 14, X1, X2. The body is a three-quarter view;
    // anchors remain separate and the deterministic overlay prints each mark.
    terminals: [
      terminal(220, 400, left),
      terminal(220, 790, left),
      terminal(1040, 400, right),
      terminal(1040, 790, right),
      terminal(500, 1030, bottom),
      terminal(760, 1030, bottom),
    ],
    actuator: { x: 545, y: 390, width: 570, height: 570 },
    statusLayers: [
      statusLayer('state', { x: 545, y: 390, width: 570, height: 570 }),
      statusLayer('glow', { x: 545, y: 390, width: 570, height: 570 }),
    ],
  },
  PHASE_MONITOR_RM17TG20: {
    kind: 'CONTACT_2STATE',
    src: phaseMonitorRm17tg20,
    viewBox: { x: 170, y: 35, width: 895, height: 1175 },
    displayCells: { width: 1.02, height: 1.7 },
    // Model contract order: L1 L2 L3, 11 12 14, 21 22 24.
    terminals: [
      terminal(545, 190, top),
      terminal(625, 190, top),
      terminal(705, 190, top),
      terminal(680, 1035, bottom),
      terminal(615, 1035, bottom),
      terminal(745, 1035, bottom),
      terminal(680, 390, right),
      terminal(745, 390, right),
      terminal(615, 390, left),
    ],
    actuator: { x: 500, y: 470, width: 360, height: 430 },
    statusLayers: [
      statusLayer('state', { x: 500, y: 470, width: 360, height: 430 }),
    ],
  },
  AUX_CONTACT_LADN22: {
    kind: 'CONTACT_2STATE',
    src: auxContactLadn22,
    viewBox: { x: 135, y: 115, width: 990, height: 1015 },
    displayCells: { width: 1.48, height: 1.35 },
    // Contract order pairs each top screw with the matching bottom screw:
    // 53/54, 61/62, 71/72, 83/84.
    terminals: [
      terminal(405, 335, top), terminal(405, 905, bottom),
      terminal(565, 335, top), terminal(565, 905, bottom),
      terminal(735, 335, top), terminal(735, 905, bottom),
      terminal(895, 335, top), terminal(895, 905, bottom),
    ],
    actuator: { x: 845, y: 485, width: 125, height: 235 },
    statusLayers: [
      statusLayer('state', { x: 845, y: 485, width: 125, height: 235 }),
    ],
  },
  TIMER_H3CR_A8: {
    kind: 'TIMER',
    src: timerH3crA8,
    viewBox: { x: 80, y: 75, width: 1090, height: 1035 },
    displayCells: { width: 1.2, height: 1.35 },
    // H3CR-A8 pins are socket-side connections. The face render stays faithful
    // while the pin ring is exposed as code-rendered anchors around the body.
    terminals: [
      terminal(300, 240, top), terminal(300, 1010, bottom),
      terminal(465, 240, top), terminal(465, 1010, bottom),
      terminal(790, 240, top), terminal(955, 1010, bottom),
      terminal(955, 240, top), terminal(790, 1010, bottom),
    ],
    actuator: { x: 250, y: 350, width: 560, height: 560 },
    statusLayers: [
      statusLayer('energized', { x: 220, y: 210, width: 170, height: 120 }),
    ],
  },
  FLOAT_SWITCH_9037HG33: {
    kind: 'CONTACT_2STATE',
    src: floatSwitch9037hg33,
    viewBox: { x: 35, y: 300, width: 1180, height: 550 },
    displayCells: { width: 1.85, height: 0.95 },
    terminals: [
      terminal(215, 410, top), terminal(215, 745, bottom),
      terminal(395, 745, bottom), terminal(395, 410, top),
    ],
    actuator: { x: 720, y: 470, width: 480, height: 300 },
    statusLayers: [
      statusLayer('motion', { x: 720, y: 470, width: 480, height: 300 }),
      statusLayer('state', { x: 720, y: 470, width: 480, height: 300 }),
    ],
  },
  PRESSURE_SWITCH_XMLB004: {
    kind: 'CONTACT_2STATE',
    src: pressureSwitchXmlb004,
    viewBox: { x: 210, y: 35, width: 830, height: 1170 },
    displayCells: { width: 1.05, height: 1.7 },
    terminals: [
      terminal(395, 250, top), terminal(395, 1000, bottom),
      terminal(850, 250, top), terminal(850, 1000, bottom),
    ],
    actuator: { x: 465, y: 650, width: 340, height: 390 },
    statusLayers: [
      statusLayer('state', { x: 465, y: 650, width: 340, height: 390 }),
    ],
  },
  THERMOSTAT_NSYCCOTHC: {
    kind: 'CONTACT_2STATE',
    src: thermostatNsyccothc,
    viewBox: { x: 260, y: 75, width: 740, height: 1080 },
    displayCells: { width: 0.95, height: 1.55 },
    terminals: [
      terminal(520, 1010, bottom),
      terminal(735, 1010, bottom),
    ],
    actuator: { x: 480, y: 250, width: 300, height: 300 },
    statusLayers: [
      statusLayer('state', { x: 480, y: 250, width: 300, height: 300 }),
    ],
  },
  TIMER: {
    kind: 'TIMER',
    src: timer,
    viewBox: { x: 314, y: 49, width: 640, height: 1125 },
    displayCells: { width: 0.94, height: 1.82 },
    terminals: [
      terminal(430, 220, top),
      terminal(430, 1010, bottom),
      terminal(565, 220, top),
      terminal(565, 1010, bottom),
      terminal(700, 220, top),
      terminal(830, 1010, bottom),
      terminal(830, 220, top),
      terminal(700, 1010, bottom),
    ],
    actuator: { x: 450, y: 390, width: 350, height: 350 },
    statusLayers: [
      statusLayer('energized', { x: 450, y: 390, width: 350, height: 350 }),
    ],
  },
  OVERLOAD_RELAY: {
    kind: 'OVERLOAD_RELAY',
    src: overload,
    viewBox: { x: 256, y: 99, width: 740, height: 1057 },
    displayCells: { width: 1.46, height: 1.48 },
    terminals: [
      terminal(425, 175, top),
      terminal(400, 920, bottom),
      terminal(620, 175, top),
      terminal(625, 920, bottom),
      terminal(805, 175, top),
      terminal(830, 920, bottom),
      terminal(320, 625, left),
      terminal(320, 735, left),
      terminal(920, 625, right),
      terminal(920, 735, right),
    ],
    actuator: { x: 450, y: 540, width: 360, height: 260 },
    statusLayers: [
      statusLayer('trip', { x: 450, y: 540, width: 360, height: 260 }),
    ],
  },
} as const satisfies Record<string, VirtualAssetDefinition>

export function virtualAssetDefinition(
  spec: PlacedComponent['spec'],
): VirtualAssetDefinition {
  switch (spec.kind) {
    case 'SOURCE':
      if (spec.transformer) return ASSETS.SOURCE_TRANSFORMER_TAPPED
      if (spec.sourceType === 'battery_dc') return ASSETS.SOURCE_BATTERY_24V
      if (spec.sourceType === 'din_psu_24vdc') return ASSETS.SOURCE_DIN_PSU_24V
      if (spec.sourceType === 'control_transformer_24vac') return ASSETS.SOURCE_CONTROL_TRANSFORMER_24VAC
      return ASSETS.SOURCE
    case 'GROUND':
      return ASSETS.GROUND
    case 'LOAD':
      if (spec.threePhase) return ASSETS.LOAD_HEATER_3PH
      if (spec.symbol === 'fan') return ASSETS.LOAD_FAN
      if (spec.symbol === 'resistor') return ASSETS.LOAD_RESISTOR
      if (spec.symbol === 'heater') return ASSETS.LOAD_HEATER
      if (spec.symbol === 'bell') return ASSETS.LOAD_BELL
      if (spec.symbol === 'solenoid_valve') return ASSETS.LOAD_SOLENOID
      return ASSETS.LOAD_LAMP
    case 'SWITCH':
      return ASSETS.SWITCH
    case 'SWITCH_2WAY':
      return ASSETS.SWITCH_2WAY
    case 'SWITCH_CROSS':
      return ASSETS.SWITCH_CROSS
    case 'CONTACT_2STATE':
      return ASSETS.CONTACT_2STATE
    case 'LIMIT_SWITCH':
      return ASSETS.LIMIT_SWITCH
    case 'SENSOR_3WIRE':
      if (spec.technology === 'capacitive') return ASSETS.SENSOR_CAPACITIVE
      if (spec.technology === 'photoelectric') return ASSETS.SENSOR_PHOTOELECTRIC
      return ASSETS.SENSOR_INDUCTIVE
    case 'TERMINAL_BLOCK':
      return ASSETS.TERMINAL_BLOCK
    case 'SELECTOR_3POS':
      return ASSETS.SELECTOR_3POS
    case 'FUSE':
      return ASSETS.FUSE
    case 'ESTOP':
      return ASSETS.ESTOP
    case 'MOTOR':
      return ASSETS.MOTOR
    case 'CAPACITOR':
      return ASSETS.CAPACITOR
    case 'PUSHBUTTON':
      return spec.normallyOpen ? ASSETS.PUSHBUTTON_NO : ASSETS.PUSHBUTTON_NC
    case 'RELAY':
      switch (spec.model) {
        case 'OMRON_MY2_8PIN':
          return ASSETS.RELAY_MY2
        case 'OMRON_MY3_11PIN':
          return ASSETS.RELAY_MY3
        case 'OMRON_MY4_14PIN':
          return ASSETS.RELAY_MY4
        case 'OMRON_G5V2_8PIN':
          return ASSETS.RELAY_G5V2
        default:
          return ASSETS.RELAY
      }
    case 'INDICATOR':
      return ASSETS.INDICATOR
    case 'SOURCE_3PH':
      return ASSETS.SOURCE_3PH
    case 'MOTOR_3PH':
      return ASSETS.MOTOR_3PH
    case 'CONTACTOR':
      return ASSETS.CONTACTOR
    case 'BREAKER_1P':
      return ASSETS.BREAKER_1P
    case 'BREAKER_3P':
      return ASSETS.BREAKER_3P
    case 'TIMER':
      return ASSETS.TIMER
    case 'OVERLOAD_RELAY':
      return ASSETS.OVERLOAD_RELAY
  }
}

/** Model-aware resolver used by the board. A plain spec intentionally resolves
 * to the generic housing for old boards; only a persisted catalog identity may
 * select a branded/product-specific render. */
export function virtualAssetDefinitionForComponent(
  component: PlacedComponent,
): VirtualAssetDefinition {
  if (component.modelId === 'MOTOR_BREAKER_GV2ME14') {
    return ASSETS.MOTOR_BREAKER_GV2ME14
  }
  if (component.modelId === 'DISCONNECTOR_VCF1') {
    return ASSETS.DISCONNECTOR_VCF1
  }
  if (component.modelId === 'SELECTOR_XB5AD21') {
    return ASSETS.SELECTOR_XB5AD21
  }
  if (component.modelId === 'KEY_SELECTOR_XB5AG21') {
    return ASSETS.KEY_SELECTOR_XB5AG21
  }
  if (component.modelId === 'PUSHBUTTON_STATION_XB5AL73415') {
    return ASSETS.PUSHBUTTON_STATION_XB5AL73415
  }
  if (component.modelId === 'ILLUMINATED_PB_XB5AW33B5') {
    return ASSETS.ILLUMINATED_PB_XB5AW33B5
  }
  if (component.modelId === 'PHASE_MONITOR_RM17TG20') {
    return ASSETS.PHASE_MONITOR_RM17TG20
  }
  if (component.modelId === 'AUX_CONTACT_LADN22') {
    return ASSETS.AUX_CONTACT_LADN22
  }
  if (component.modelId === 'TIMER_H3CR_A8') {
    return ASSETS.TIMER_H3CR_A8
  }
  if (component.modelId === 'FLOAT_SWITCH_9037HG33') {
    return ASSETS.FLOAT_SWITCH_9037HG33
  }
  if (component.modelId === 'PRESSURE_SWITCH_XMLB004') {
    return ASSETS.PRESSURE_SWITCH_XMLB004
  }
  if (component.modelId === 'THERMOSTAT_NSYCCOTHC') {
    return ASSETS.THERMOSTAT_NSYCCOTHC
  }
  if (component.modelId === 'TERMINAL_UT25_BU') return ASSETS.TERMINAL_UT25_BU
  if (component.modelId === 'TERMINAL_UT25_PE') return ASSETS.TERMINAL_UT25_PE
  if (component.modelId === 'TERMINAL_UT4_HESI') return ASSETS.TERMINAL_UT4_HESI
  if (component.modelId === 'TERMINAL_UT4_MT') return ASSETS.TERMINAL_UT4_MT
  if (component.modelId === 'TERMINAL_UT25_TWIN') return ASSETS.TERMINAL_UT25_TWIN
  if (component.modelId === 'TERMINAL_UT25_QUATTRO') return ASSETS.TERMINAL_UT25_QUATTRO
  if (component.modelId === 'TERMINAL_UT25_PE_LL') return ASSETS.TERMINAL_UT25_PE_LL
  return virtualAssetDefinition(component.spec)
}

export function virtualAssetFor(spec: PlacedComponent['spec'], modelId?: string): string {
  if (modelId === 'MOTOR_BREAKER_GV2ME14') return ASSETS.MOTOR_BREAKER_GV2ME14.src
  if (modelId === 'DISCONNECTOR_VCF1') return ASSETS.DISCONNECTOR_VCF1.src
  if (modelId === 'SELECTOR_XB5AD21') return ASSETS.SELECTOR_XB5AD21.src
  if (modelId === 'KEY_SELECTOR_XB5AG21') return ASSETS.KEY_SELECTOR_XB5AG21.src
  if (modelId === 'PUSHBUTTON_STATION_XB5AL73415') return ASSETS.PUSHBUTTON_STATION_XB5AL73415.src
  if (modelId === 'ILLUMINATED_PB_XB5AW33B5') return ASSETS.ILLUMINATED_PB_XB5AW33B5.src
  if (modelId === 'PHASE_MONITOR_RM17TG20') return ASSETS.PHASE_MONITOR_RM17TG20.src
  if (modelId === 'AUX_CONTACT_LADN22') return ASSETS.AUX_CONTACT_LADN22.src
  if (modelId === 'TIMER_H3CR_A8') return ASSETS.TIMER_H3CR_A8.src
  if (modelId === 'FLOAT_SWITCH_9037HG33') return ASSETS.FLOAT_SWITCH_9037HG33.src
  if (modelId === 'PRESSURE_SWITCH_XMLB004') return ASSETS.PRESSURE_SWITCH_XMLB004.src
  if (modelId === 'THERMOSTAT_NSYCCOTHC') return ASSETS.THERMOSTAT_NSYCCOTHC.src
  if (modelId === 'TERMINAL_UT25_BU') return ASSETS.TERMINAL_UT25_BU.src
  if (modelId === 'TERMINAL_UT25_PE') return ASSETS.TERMINAL_UT25_PE.src
  if (modelId === 'TERMINAL_UT4_HESI') return ASSETS.TERMINAL_UT4_HESI.src
  if (modelId === 'TERMINAL_UT4_MT') return ASSETS.TERMINAL_UT4_MT.src
  if (modelId === 'TERMINAL_UT25_TWIN') return ASSETS.TERMINAL_UT25_TWIN.src
  if (modelId === 'TERMINAL_UT25_QUATTRO') return ASSETS.TERMINAL_UT25_QUATTRO.src
  if (modelId === 'TERMINAL_UT25_PE_LL') return ASSETS.TERMINAL_UT25_PE_LL.src
  return virtualAssetDefinition(spec).src
}

export function virtualAssetDefinitionForKind(
  kind: ComponentKind,
): VirtualAssetDefinition {
  const spec = {
    SOURCE: { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 },
    GROUND: { kind: 'GROUND' },
    LOAD: { kind: 'LOAD', resistanceOhms: 529, ratedCurrentAmps: 0.5 },
    SWITCH: { kind: 'SWITCH', closed: false },
    SWITCH_2WAY: { kind: 'SWITCH_2WAY', toL2: false },
    SWITCH_CROSS: { kind: 'SWITCH_CROSS', crossed: false },
    CONTACT_2STATE: { kind: 'CONTACT_2STATE', actuated: false },
    LIMIT_SWITCH: { kind: 'LIMIT_SWITCH', actuated: false },
    SENSOR_3WIRE: {
      kind: 'SENSOR_3WIRE',
      technology: 'inductive',
      output: 'PNP',
      normallyOpen: true,
      actuated: false,
      supplyResistanceOhms: 2400,
    },
    TERMINAL_BLOCK: { kind: 'TERMINAL_BLOCK' },
    SELECTOR_3POS: { kind: 'SELECTOR_3POS', pos: 1 },
    FUSE: { kind: 'FUSE', blown: false },
    ESTOP: { kind: 'ESTOP', pressed: false },
    MOTOR: {
      kind: 'MOTOR',
      runResistanceOhms: 100,
      lockedResistanceOhms: 20,
      ratedCurrentAmps: 2,
    },
    CAPACITOR: { kind: 'CAPACITOR' },
    PUSHBUTTON: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true },
    RELAY: { kind: 'RELAY', coilResistanceOhms: 1000, pickupAmps: 0.01 },
    INDICATOR: { kind: 'INDICATOR', resistanceOhms: 1000, ratedCurrentAmps: 0.1 },
    SOURCE_3PH: { kind: 'SOURCE_3PH', vLineToLineVolts: 400, tripAmps: 16 },
    MOTOR_3PH: {
      kind: 'MOTOR_3PH',
      windingResistanceOhms: 20,
      ratedCurrentAmps: 5,
    },
    CONTACTOR: { kind: 'CONTACTOR' },
    BREAKER_1P: { kind: 'BREAKER_1P', on: false },
    BREAKER_3P: { kind: 'BREAKER_3P', on: false },
    TIMER: { kind: 'TIMER', starDurationMs: 1000, transitionDelayMs: 100 },
    OVERLOAD_RELAY: {
      kind: 'OVERLOAD_RELAY',
      ratedCurrentAmps: 5,
      tripMultiplier: 1,
      heatingRate: 0.001,
      coolingRate: 0.001,
      resetThreshold: 0.2,
    },
  } as const
  return virtualAssetDefinition(spec[kind])
}

export const VIRTUAL_ASSET_SOURCE_SIZE = SOURCE_SIZE
