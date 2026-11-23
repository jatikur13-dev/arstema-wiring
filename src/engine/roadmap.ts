/**
 * Bounded field map for the Wiring simulator.
 *
 * "Everything in the field" is not a finite technical requirement unless the
 * voltage range, product family and proof state are explicit.  This registry
 * fixes the supported boundary to LV/industrial (<= 1000 VAC / <= 1500 VDC)
 * and gives every family a phase and an honest implementation state.
 */

export const WIRING_ENGINEERING_SCOPE = {
  title: 'LV + industrial wiring',
  maxVac: 1000,
  maxVdc: 1500,
  excluded: [
    'medium/high-voltage protection studies',
    'arc-flash energy calculation',
    'certified machine-safety validation',
    'product selection or conductor sizing approval',
    'live-work instructions',
  ],
} as const

export type WiringRoadmapStatus = 'PLAYABLE_VERIFIED' | 'PLAYABLE_PARTIAL' | 'MODELED_NOT_PLAYABLE' | 'SOURCE_GATED'
export type WiringRoadmapKind = 'COMPONENT' | 'CIRCUIT' | 'FAULT'

export interface WiringRoadmapItem {
  id: string
  label: string
  kind: WiringRoadmapKind
  status: WiringRoadmapStatus
  /** Existing engine kind or example key where one exists. */
  implementationRef?: string
  note?: string
}

export interface WiringRoadmapPhase {
  id: `P${number}`
  label: string
  objective: string
  items: readonly WiringRoadmapItem[]
}

const playable = (id: string, label: string, kind: WiringRoadmapKind, implementationRef: string, note?: string): WiringRoadmapItem => ({
  id, label, kind, status: 'PLAYABLE_VERIFIED', implementationRef, ...(note ? { note } : {}),
})
const partial = (id: string, label: string, kind: WiringRoadmapKind, implementationRef: string, note: string): WiringRoadmapItem => ({
  id, label, kind, status: 'PLAYABLE_PARTIAL', implementationRef, note,
})
const gated = (id: string, label: string, kind: WiringRoadmapKind, note: string): WiringRoadmapItem => ({
  id, label, kind, status: 'SOURCE_GATED', note,
})

export const WIRING_ROADMAP: readonly WiringRoadmapPhase[] = [
  {
    id: 'P0',
    label: 'Fondasi semantic CAD',
    objective: 'Satu netlist, dua proyeksi, terminal contract, routing ortogonal, save/reload, dan review hash.',
    items: [
      playable('netlist-single-source', 'Canonical electrical netlist', 'COMPONENT', 'Board'),
      playable('projection-virtual', 'Papan Virtual', 'COMPONENT', 'virtual'),
      playable('projection-iec', 'Diagram IEC 60617', 'COMPONENT', 'iec'),
      playable('semantic-net-role', 'Semantic net roles', 'COMPONENT', 'analyzeSemanticNets'),
      playable('project-offline', 'Proyek offline + autosave', 'COMPONENT', 'CircuitProject'),
      playable('review-sha256', 'Review package SHA-256', 'COMPONENT', 'computeCircuitProjectHash'),
    ],
  },
  {
    id: 'P1',
    label: 'Sumber, beban, dan instalasi dasar',
    objective: 'Rangkaian AC/DC dasar, switching penerangan, PE, dan beban resistif.',
    items: [
      playable('source-ac-1ph', 'Sumber AC 1 fasa', 'COMPONENT', 'SOURCE'),
      playable('source-ac-3ph', 'Sumber AC 3 fasa + N', 'COMPONENT', 'SOURCE_3PH'),
      playable('source-dc-battery', 'Battery DC', 'COMPONENT', 'SOURCE:battery_dc'),
      playable('protective-earth', 'Protective earth / PE', 'COMPONENT', 'GROUND'),
      playable('load-lamp', 'Lampu', 'COMPONENT', 'LOAD:lamp'),
      playable('load-resistor', 'Resistor', 'COMPONENT', 'LOAD:resistor'),
      playable('load-heater', 'Heater resistif', 'COMPONENT', 'LOAD:heater'),
      playable('switch-spst', 'Switch SPST', 'COMPONENT', 'SWITCH'),
      playable('switch-two-way', 'Switch two-way / SPDT', 'COMPONENT', 'SWITCH_2WAY'),
      playable('switch-cross', 'Intermediate/cross switch', 'COMPONENT', 'SWITCH_CROSS'),
      playable('circuit-series', 'Beban seri', 'CIRCUIT', 'seri'),
      playable('circuit-parallel', 'Beban paralel', 'CIRCUIT', 'paralel'),
      gated('rcd-basic', 'RCD/RCCB basic residual-current topology', 'COMPONENT', 'Membutuhkan model differential current dan evidence terminal/symbol.'),
      gated('rcbo-basic', 'RCBO', 'COMPONENT', 'Membutuhkan kombinasi overcurrent + residual-current yang tidak boleh dipalsukan sebagai MCB.'),
    ],
  },
  {
    id: 'P2',
    label: 'Proteksi dan distribusi LV',
    objective: 'Isolation, overcurrent, overload, terminal distribution, serta fault yang terlabel edukatif.',
    items: [
      playable('fuse', 'Fuse', 'COMPONENT', 'FUSE'),
      partial('mcb-1p', 'MCB 1P', 'COMPONENT', 'BREAKER_1P', 'Kurva trip adalah model edukatif, bukan kurva produk IEC.'),
      partial('mcb-3p', 'MCB 3P', 'COMPONENT', 'BREAKER_3P', 'Kurva trip adalah model edukatif, bukan koordinasi proteksi.'),
      partial('motor-breaker', 'Manual motor starter / motor breaker', 'COMPONENT', 'BREAKER_3P', 'Geometri/rating product preset tersedia; model magnetik/thermal masih disederhanakan.'),
      playable('overload-relay', 'Thermal overload relay', 'COMPONENT', 'OVERLOAD_RELAY'),
      playable('terminal-feedthrough', 'Feed-through terminal block', 'COMPONENT', 'TERMINAL_BLOCK'),
      partial('terminal-disconnect', 'Disconnect/fuse terminal block', 'COMPONENT', 'TERMINAL_BLOCK', 'Kontinuitas/sekering playable; aksesori bridge/marker belum dimodelkan.'),
      partial('terminal-pe', 'PE terminal block', 'COMPONENT', 'TERMINAL_BLOCK', 'Bonding playable; rail impedance tidak dihitung.'),
      gated('mccb', 'MCCB adjustable trip', 'COMPONENT', 'Memerlukan trip-unit model, terminal pack, dan evidence produk.'),
      gated('spd', 'Surge protective device', 'COMPONENT', 'Tidak boleh dibuat sebagai switch; memerlukan transient model khusus.'),
      gated('busbar', 'Busbar / distribution block', 'COMPONENT', 'Memerlukan multi-terminal common-net component dan rating boundary.'),
      gated('ats-amf', 'ATS / AMF power transfer', 'CIRCUIT', 'Memerlukan two-source interlock, transfer sequence, dan failure modes.'),
      gated('earth-fault', 'Earth fault', 'FAULT', 'Memerlukan source earthing context; PE tidak boleh dipakai sebagai generic return.'),
    ],
  },
  {
    id: 'P3',
    label: 'Kontrol relay dan sensor',
    objective: '24 VDC/24 VAC control, contacts, timing, sensors, permissive, dan field terminal numbering.',
    items: [
      playable('pushbutton-no-nc', 'Pushbutton NO/NC', 'COMPONENT', 'PUSHBUTTON'),
      playable('estop-maintained', 'E-stop maintained NC', 'COMPONENT', 'ESTOP', 'Simulasi kontak saja; bukan safety validation.'),
      playable('selector-3pos', 'Selector 3 posisi', 'COMPONENT', 'SELECTOR_3POS'),
      playable('relay-my2-my3-my4', 'Relay MY2/MY3/MY4 terminal asli', 'COMPONENT', 'RELAY'),
      playable('timer-h3dt-g', 'Star-delta timer H3DT-G', 'COMPONENT', 'TIMER:OMRON_H3DT_G'),
      playable('timer-h3cr-a8', 'Multifunction timer H3CR-A8', 'COMPONENT', 'TIMER:OMRON_H3CR_A8'),
      playable('limit-switch', 'Limit switch 1NC/1NO', 'COMPONENT', 'LIMIT_SWITCH'),
      playable('sensor-pnp-npn', '3-wire sensor PNP/NPN', 'COMPONENT', 'SENSOR_3WIRE'),
      playable('process-contact', 'Float/pressure/flow/thermostat contact', 'COMPONENT', 'CONTACT_2STATE'),
      playable('self-hold', 'Self-holding / seal-in', 'CIRCUIT', 'self-holding'),
      playable('pnp-relay', 'PNP sensor to relay', 'CIRCUIT', 'psu-pnp-relay'),
      playable('npn-relay', 'NPN sensor to relay', 'CIRCUIT', 'psu-npn-relay'),
      gated('analog-sensor-420ma', '4–20 mA transmitter loop', 'CIRCUIT', 'Memerlukan analog current-loop solver dan input impedance.'),
      gated('intrinsic-safety', 'Intrinsic safety barrier', 'CIRCUIT', 'Di luar pack saat ini; memerlukan product/zone-specific evidence.'),
    ],
  },
  {
    id: 'P4',
    label: 'Motor dan starter',
    objective: 'Single/three-phase motor connections, starters, interlock, protection, dan transition sequencing.',
    items: [
      partial('motor-psc', 'Motor PSC 1 fasa', 'COMPONENT', 'MOTOR', 'Starting/running ditentukan model topologi edukatif, bukan electromagnetic transient.'),
      partial('motor-3ph-sixlead', 'Motor 3 fasa 6 lead + PE', 'COMPONENT', 'MOTOR_3PH', 'Balanced resistive winding model.'),
      playable('contactor-3p-aux', 'Contactor 3P + aux NO/NC', 'COMPONENT', 'CONTACTOR'),
      playable('dol-full', 'DOL START–STOP + self-hold + overload', 'CIRCUIT', 'dol-full'),
      playable('forward-reverse', 'Forward/reverse electrical + mechanical interlock', 'CIRCUIT', 'forward-reverse-interlock'),
      playable('star-delta-manual', 'Star–delta manual', 'CIRCUIT', 'star-delta-manual'),
      playable('star-delta-auto', 'Star–delta timer', 'CIRCUIT', 'star-delta-auto'),
      gated('autotransformer-starter', 'Autotransformer starter', 'CIRCUIT', 'Memerlukan transformer taps dan transition rules.'),
      gated('part-winding-starter', 'Part-winding starter', 'CIRCUIT', 'Memerlukan motor winding contract khusus.'),
      gated('dahlander', 'Dahlander two-speed motor', 'CIRCUIT', 'Memerlukan 6/9/12 terminal motor variants dan verified connection tables.'),
      gated('wound-rotor', 'Wound-rotor resistance starter', 'CIRCUIT', 'Memerlukan rotor branch model dan staged resistance.'),
      gated('motor-brake', 'Electromagnetic motor brake', 'COMPONENT', 'Memerlukan coil + mechanical state/failure semantics.'),
    ],
  },
  {
    id: 'P5',
    label: 'Drives, power conversion, dan measurement',
    objective: 'VFD/soft starter/rectifier/measurement sebagai device-aware subsystem, bukan decorative box.',
    items: [
      gated('soft-starter', 'Soft starter', 'COMPONENT', 'Memerlukan input/bypass/output state machine dan ramp semantics.'),
      gated('vfd', 'Variable frequency drive', 'COMPONENT', 'Memerlukan DC-link/control terminals, frequency state, and drive faults.'),
      gated('servo-drive', 'Servo drive', 'COMPONENT', 'Di luar solver motor saat ini.'),
      gated('ct', 'Current transformer', 'COMPONENT', 'Open-secondary hazard dan ratio measurement wajib dimodelkan.'),
      gated('vt', 'Voltage transformer', 'COMPONENT', 'Memerlukan ratio/isolation semantics.'),
      gated('multimeter', 'Voltmeter/ammeter/multimeter', 'COMPONENT', 'Memerlukan measurement probe model tanpa mengubah netlist sembarang.'),
      gated('energy-meter', 'kWh / multifunction meter', 'COMPONENT', 'Memerlukan terminal pack 1P/3P dan CT/direct variants.'),
      gated('phase-monitor', 'Phase sequence/failure relay', 'COMPONENT', 'Saat ini hanya output contact demo; sensing algorithm belum ada.'),
      gated('capacitor-bank', 'Power-factor capacitor bank', 'CIRCUIT', 'Memerlukan reactive phasor model, inrush, discharge, dan contactor class.'),
    ],
  },
  {
    id: 'P6',
    label: 'PLC dan functional safety',
    objective: 'I/O, control logic, safety channels, diagnostics, dan reset semantics yang tidak mengklaim certification.',
    items: [
      gated('plc-di-do', 'PLC digital input/output', 'COMPONENT', 'Memerlukan scan-cycle model dan isolated terminal packs.'),
      gated('plc-ai-ao', 'PLC analog input/output', 'COMPONENT', 'Memerlukan analog solver and scaling.'),
      gated('safety-relay', 'Safety relay dual channel', 'COMPONENT', 'Memerlukan discrepancy, monitored reset, EDM, dan failure injection.'),
      gated('dual-channel-estop', 'Dual-channel E-stop circuit', 'CIRCUIT', 'Tidak boleh dipublikasikan tanpa safety architecture review.'),
      gated('guard-interlock', 'Guard switch + safety relay', 'CIRCUIT', 'Memerlukan direct-opening/diagnostic coverage.'),
      gated('two-hand-control', 'Two-hand control', 'CIRCUIT', 'Memerlukan simultaneity/anti-tie-down timing.'),
      gated('safety-contactor-feedback', 'Contactor EDM feedback', 'CIRCUIT', 'Memerlukan welded-contact fault state.'),
    ],
  },
  {
    id: 'P7',
    label: 'DC, backup, PV, dan specialty packs',
    objective: 'Pisahkan DC/PV/backup dari AC industrial serta tandai specialty engineering packs secara eksplisit.',
    items: [
      playable('din-psu-24vdc', 'DIN PSU 24 VDC', 'COMPONENT', 'SOURCE:din_psu_24vdc'),
      playable('control-transformer-24vac', 'Control transformer 24 VAC', 'COMPONENT', 'SOURCE:control_transformer_24vac'),
      gated('rectifier', 'Bridge rectifier', 'COMPONENT', 'Memerlukan diode/nonlinear solver.'),
      gated('ups', 'UPS static bypass', 'COMPONENT', 'Memerlukan source transfer and battery state.'),
      gated('dc-breaker', 'DC-rated breaker', 'COMPONENT', 'Tidak boleh memakai MCB AC tanpa DC product contract.'),
      gated('dc-contactor', 'DC contactor', 'COMPONENT', 'Memerlukan coil/arc/application-specific contract.'),
      gated('pv-module-string', 'PV module/string', 'COMPONENT', 'Memerlukan irradiance/I-V model.'),
      gated('pv-combiner', 'PV combiner box', 'CIRCUIT', 'Memerlukan string fuse/SPD/DC isolator pack.'),
      gated('solar-charge-controller', 'Solar charge controller', 'COMPONENT', 'Memerlukan battery/PV control model.'),
      gated('inverter-grid', 'Grid-connected inverter', 'COMPONENT', 'Memerlukan anti-islanding and grid-code boundary.'),
      gated('hazardous-area', 'Hazardous-area wiring pack', 'CIRCUIT', 'Specialty pack; source and product-zone gating required.'),
      gated('marine-rail', 'Marine/rail wiring pack', 'CIRCUIT', 'Specialty pack; distinct standards and components.'),
    ],
  },
] as const

export function wiringRoadmapSummary(): Record<WiringRoadmapStatus, number> {
  const summary: Record<WiringRoadmapStatus, number> = {
    PLAYABLE_VERIFIED: 0,
    PLAYABLE_PARTIAL: 0,
    MODELED_NOT_PLAYABLE: 0,
    SOURCE_GATED: 0,
  }
  for (const phase of WIRING_ROADMAP) for (const item of phase.items) summary[item.status] += 1
  return summary
}

export function duplicateWiringRoadmapIds(): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const phase of WIRING_ROADMAP) {
    for (const item of phase.items) {
      if (seen.has(item.id)) duplicates.add(item.id)
      seen.add(item.id)
    }
  }
  return [...duplicates].sort()
}
