/**
 * Circuit Lab component specifications, palette metadata, and introductory copy.
 */

import type {
  BreakerOnePoleSpec,
  BreakerThreePoleSpec,
  CapacitorSpec,
  ComponentKind,
  ComponentSpec,
  ContactorSpec,
  GroundSpec,
  IndicatorSpec,
  LimitSwitchSpec,
  LoadSpec,
  MotorSpec,
  OverloadSpec,
  RelaySpec,
  SourceSpec,
  Sensor3WireSpec,
  SwitchSpec,
  SwitchTwoWaySpec,
  SwitchCrossSpec,
  Contact2StateSpec,
  Selector3PosSpec,
  FuseSpec,
  EstopSpec,
  ThreePhaseMotorSpec,
  ThreePhaseSourceSpec,
  TimerSpec,
  TerminalBlockSpec,
  WiringModelId,
} from '../../engine/index'

export const SOURCE_SPEC: SourceSpec = {
  kind: 'SOURCE',
  emfVolts: 220,
  tripAmps: 16,
}

/** Ideal 24 VDC battery source. Polarity and DC presentation differ from the
 *  single-phase source; the two-terminal ideal-source solve remains identical. */
export const BATTERY_24V_SPEC: SourceSpec = {
  kind: 'SOURCE',
  emfVolts: 24,
  tripAmps: 10,
  sourceType: 'battery_dc',
}

/** Output-side educational models. The simulator intentionally does not claim
 * efficiency, inrush, isolation-test, short-circuit withstand, or product
 * certification; it provides the named nominal secondary/output terminals. */
export const DIN_PSU_24V_SPEC: SourceSpec = {
  kind: 'SOURCE', emfVolts: 24, tripAmps: 1.5, sourceType: 'din_psu_24vdc',
}
export const CONTROL_TRANSFORMER_24VAC_SPEC: SourceSpec = {
  kind: 'SOURCE', emfVolts: 24, tripAmps: 10, sourceType: 'control_transformer_24vac',
}

/** ~90 W at 220 V → ~0.42 A, comfortably under its 0.5 A rating. */
export const LAMP_SPEC: LoadSpec = {
  kind: 'LOAD',
  resistanceOhms: 529,
  ratedCurrentAmps: 0.5,
}

/** Resistor — pure resistive load (~1 A at 220 V). Same behaviour as a lamp; IEC rectangle symbol. */
export const RESISTOR_SPEC: LoadSpec = {
  kind: 'LOAD',
  resistanceOhms: 220,
  ratedCurrentAmps: 5,
  symbol: 'resistor',
}

/** Heating element — resistive load (~1 kW at 220 V -> ~4.6 A). */
export const HEATER_SPEC: LoadSpec = {
  kind: 'LOAD',
  resistanceOhms: 48,
  ratedCurrentAmps: 10,
  symbol: 'heater',
}

/** Bell / buzzer — small resistive load that "sounds" when energised (~0.25 A). */
export const BELL_SPEC: LoadSpec = {
  kind: 'LOAD',
  resistanceOhms: 880,
  ratedCurrentAmps: 0.5,
  symbol: 'bell',
}

/** SMC VXE21 24 VDC energy-saving solenoid valve. Holding resistance is derived
 *  from the published 1.5 W holding power: R = 24² / 1.5 = 384 Ω. The 0.19 A
 *  rating is the published inrush current; hydraulic flow is not simulated. */
export const SOLENOID_VXE21_SPEC: LoadSpec = {
  kind: 'LOAD',
  resistanceOhms: 384,
  ratedCurrentAmps: 0.19,
  symbol: 'solenoid_valve',
}

/** Grounding / earth (PE). 1-terminal reference symbol. Electrically inert in the
 *  current single-source AC-resistive model; true PE bonding awaits the earthing engine. */
export const GROUND_SPEC: GroundSpec = { kind: 'GROUND' }

export const SWITCH_SPEC: SwitchSpec = { kind: 'SWITCH', closed: false }
export const SWITCH_2WAY_SPEC: SwitchTwoWaySpec = { kind: 'SWITCH_2WAY', toL2: false }
export const SWITCH_CROSS_SPEC: SwitchCrossSpec = { kind: 'SWITCH_CROSS', crossed: false }
export const CONTACT_2STATE_SPEC: Contact2StateSpec = { kind: 'CONTACT_2STATE', actuated: false }
export const LIMIT_SWITCH_D4N_SPEC: LimitSwitchSpec = { kind: 'LIMIT_SWITCH', actuated: false }
export const TERMINAL_BLOCK_SPEC: TerminalBlockSpec = { kind: 'TERMINAL_BLOCK' }

const SENSOR_SUPPLY_RESISTANCE_OHMS = 2400
const sensor3Wire = (
  technology: Sensor3WireSpec['technology'],
  output: Sensor3WireSpec['output'],
  normallyOpen: boolean,
): Sensor3WireSpec => ({
  kind: 'SENSOR_3WIRE',
  technology,
  output,
  normallyOpen,
  actuated: false,
  // ~10 mA at 24 V: explicit educational supply draw, not a claimed product maximum.
  supplyResistanceOhms: SENSOR_SUPPLY_RESISTANCE_OHMS,
})

export const SENSOR_E2E_PNP_NO_SPEC = sensor3Wire('inductive', 'PNP', true)
export const SENSOR_E2E_NPN_NO_SPEC = sensor3Wire('inductive', 'NPN', true)
export const SENSOR_E2E_PNP_NC_SPEC = sensor3Wire('inductive', 'PNP', false)
export const SENSOR_E2E_NPN_NC_SPEC = sensor3Wire('inductive', 'NPN', false)
export const SENSOR_E2K_PNP_NO_SPEC = sensor3Wire('capacitive', 'PNP', true)
export const SENSOR_E3Z_PNP_LIGHT_ON_SPEC = sensor3Wire('photoelectric', 'PNP', true)
export const SENSOR_E3Z_NPN_LIGHT_ON_SPEC = {
  ...sensor3Wire('photoelectric', 'NPN', true), operationMode: 'LIGHT_ON',
} satisfies Sensor3WireSpec
export const SENSOR_E3Z_NPN_DARK_ON_SPEC = {
  ...sensor3Wire('photoelectric', 'NPN', false), operationMode: 'DARK_ON',
} satisfies Sensor3WireSpec
export const SENSOR_E3Z_PNP_DARK_ON_SPEC = {
  ...sensor3Wire('photoelectric', 'PNP', false), operationMode: 'DARK_ON',
} satisfies Sensor3WireSpec
export const SENSOR_E2K_NPN_NO_SPEC = sensor3Wire('capacitive', 'NPN', true)
export const SELECTOR_3POS_SPEC: Selector3PosSpec = { kind: 'SELECTOR_3POS', pos: 1 }
export const FUSE_SPEC: FuseSpec = { kind: 'FUSE', blown: false }
export const ESTOP_SPEC: EstopSpec = { kind: 'ESTOP', pressed: false }

/** 1-phase motor (M1). Running R → 1.0 A at 220 V; locked-rotor R → 2.5 A (high
 *  but below the 4 A rating, so a capacitorless motor HUMS, it does not fault). */
export const MOTOR_SPEC: MotorSpec = {
  kind: 'MOTOR',
  runResistanceOhms: 220,
  lockedResistanceOhms: 88,
  ratedCurrentAmps: 4,
}

export const CAPACITOR_SPEC: CapacitorSpec = { kind: 'CAPACITOR' }

/** Relay coil (M2): 0.1 A at 220 V, above the 0.05 A pickup → energises L–N. */
export const RELAY_SPEC: RelaySpec = {
  kind: 'RELAY',
  coilResistanceOhms: 2200,
  pickupAmps: 0.05,
  model: 'OMRON_MY2_8PIN',
}

/** Model variants share the educational coil parameters, but never share a
 * fabricated terminal map: each uses its manufacturer's own pin designation. */
export const RELAY_MY3_SPEC: RelaySpec = { ...RELAY_SPEC, model: 'OMRON_MY3_11PIN' }
export const RELAY_MY4_SPEC: RelaySpec = { ...RELAY_SPEC, model: 'OMRON_MY4_14PIN' }
export const RELAY_G5V2_SPEC: RelaySpec = { ...RELAY_SPEC, model: 'OMRON_G5V2_8PIN' }

/** Indicator lamp (M2): ~0.05 A, a small pilot light. */
export const INDICATOR_SPEC: IndicatorSpec = {
  kind: 'INDICATOR',
  resistanceOhms: 4400,
  ratedCurrentAmps: 0.2,
}

/** 3-phase source (M3-B1): 400 V line-to-line (V_LN = 230.94 V derived). */
export const SOURCE_3PH_SPEC: ThreePhaseSourceSpec = {
  kind: 'SOURCE_3PH',
  vLineToLineVolts: 400,
  tripAmps: 32,
}

/** Fixed-star teaching motor: a 230/400 V nameplate motor operated in STAR at
 * 400 V line-to-line. The balanced resistive model draws ~10 A line current. */
export const MOTOR_3PH_SPEC: ThreePhaseMotorSpec = {
  kind: 'MOTOR_3PH',
  windingResistanceOhms: 23.094010768,
  ratedCurrentAmps: 10,
  ratedConnection: 'STAR',
  ratedLineVoltageVolts: 400,
  nameplateDeltaVolts: 230,
  nameplateStarVolts: 400,
}

/** Star–delta teaching motor: 400/690 V nameplate, rated DELTA at the 400 V
 * supply. With 57.735 Ω per winding it draws ~12 A in DELTA and ~4 A in STAR. */
export const MOTOR_3PH_STAR_DELTA_SPEC: ThreePhaseMotorSpec = {
  kind: 'MOTOR_3PH',
  windingResistanceOhms: 57.735026919,
  ratedCurrentAmps: 12,
  ratedConnection: 'DELTA',
  ratedLineVoltageVolts: 400,
  nameplateDeltaVolts: 400,
  nameplateStarVolts: 690,
}

/** Contactor (M3-B2): coil A1–A2 picks up from RMS control voltage (educational
 *  thresholds; energization is derived by the solver, never stored on the Board). */
export const CONTACTOR_SPEC: ContactorSpec = {
  kind: 'CONTACTOR',
  coilResistanceOhms: 2300,
  ratedCoilVolts: 230,
  pickupFraction: 0.85,
  dropoutFraction: 0.4,
}

/** Single-pole MCB (M3-B1.5): starts OFF (open), toggled by hand; 10 A nominal. */
export const BREAKER_1P_SPEC: BreakerOnePoleSpec = { kind: 'BREAKER_1P', on: false, ratedAmps: 10 }

/** Three-pole MCB (M3-B1.5): one manual state switches all three poles; 16 A nominal. */
export const BREAKER_3P_SPEC: BreakerThreePoleSpec = { kind: 'BREAKER_3P', on: false, ratedAmps: 16 }
export const DISCONNECTOR_3P_SPEC: BreakerThreePoleSpec = {
  kind: 'BREAKER_3P', on: false, ratedAmps: 32, protectionDisabled: true,
}
export const MOTOR_BREAKER_GV2ME14_SPEC: BreakerThreePoleSpec = {
  kind: 'BREAKER_3P', on: false, ratedAmps: 10, curve: 'C',
}

/** Omron H3DT-G terminal/timing model: STAR 5 s, transfer selector 0.5 s. */
export const TIMER_SPEC: TimerSpec = {
  kind: 'TIMER',
  model: 'OMRON_H3DT_G',
  starDurationMs: 5000,
  transitionDelayMs: 500,
}
export const H3CR_A8_SPEC: TimerSpec = {
  kind: 'TIMER', model: 'OMRON_H3CR_A8', mode: 'A', starDurationMs: 5_000, transitionDelayMs: 0,
}

/** Thermal overload for the fixed-star 10 A examples. Educational, not IEC I²t. */
export const OVERLOAD_SPEC: OverloadSpec = {
  kind: 'OVERLOAD_RELAY',
  ratedCurrentAmps: 10,
  tripMultiplier: 1,
  heatingRate: 0.0001,
  coolingRate: 0.00005,
  resetThreshold: 0.2,
}


/** Line-mounted overload matched to the 12 A DELTA nameplate current. */
export const OVERLOAD_STAR_DELTA_SPEC: OverloadSpec = {
  ...OVERLOAD_SPEC,
  ratedCurrentAmps: 12,
}

/** Palette filter categories (M3-UX1). UI metadata only — no electrical meaning. */
export type PaletteCategory =
  | 'Sumber'
  | 'Proteksi'
  | 'Kontrol'
  | 'Sensor'
  | 'Koneksi'
  | 'Switching'
  | 'Beban'
  | 'Indikator'
  | 'Pembumian'

/** The category chips, in display order. "Semua" (all) is prepended by the UI. */
export const PALETTE_CATEGORIES: PaletteCategory[] = [
  'Sumber',
  'Proteksi',
  'Kontrol',
  'Sensor',
  'Koneksi',
  'Switching',
  'Beban',
  'Indikator',
  'Pembumian',
]

export interface PaletteItem {
  /** Unique key (a kind, or a variant like PUSHBUTTON_NC). */
  key: WiringModelId
  kind: ComponentKind
  label: string
  hint: string
  /** Catalog identity is separate from the generic teaching label. */
  manufacturer?: string
  model?: string
  aliases?: readonly string[]
  /** Exact boundary of what the local solver represents. */
  simulationScope?: string
  datasheetUrl?: string
  /** Filter category (UI metadata only). */
  category: PaletteCategory
  /** Short symbol shown on the compact tile (UI metadata only). */
  icon: string
  /** The spec placed when this item is used. */
  spec: ComponentSpec
}

export const PALETTE: PaletteItem[] = [
  { key: 'SOURCE', kind: 'SOURCE', category: 'Sumber', icon: '1~', label: 'Sumber 1-fasa', hint: 'Dua terminal: L (bertegangan) dan N (netral).', spec: SOURCE_SPEC },
  { key: 'BATTERY_24V', kind: 'SOURCE', category: 'Sumber', icon: '24V', label: 'Baterai 24 VDC', aliases: ['Battery 24 VDC'], hint: 'Sumber DC ideal dua terminal: + dan −. Polaritas harus dipertahankan.', spec: BATTERY_24V_SPEC },
  { key: 'SWITCH', kind: 'SWITCH', category: 'Switching', icon: 'SW', label: 'Sakelar', aliases: ['Saklar'], hint: 'Memutus atau menyambung satu jalur.', spec: SWITCH_SPEC },
  { key: 'SWITCH_2WAY', kind: 'SWITCH_2WAY', category: 'Switching', icon: 'S⇄', label: 'Sakelar tukar', aliases: ['Saklar tukar'], hint: 'Sakelar tukar (SPDT): satu common (COM) dan dua jalur (L1/L2). Dua unit mengendalikan satu lampu dari dua titik.', spec: SWITCH_2WAY_SPEC },
  { key: 'SWITCH_CROSS', kind: 'SWITCH_CROSS', category: 'Switching', icon: 'S✕', label: 'Sakelar silang', aliases: ['Saklar silang'], hint: 'Sakelar silang (intermediate): 4 terminal, ditempatkan di antara dua sakelar tukar untuk kontrol dari 3+ titik.', spec: SWITCH_CROSS_SPEC },
  { key: 'SELECTOR_3POS', kind: 'SELECTOR_3POS', category: 'Kontrol', icon: 'MOA', label: 'Selektor 3 posisi', hint: 'Selektor MANUAL-OFF-AUTO: COM ke kiri / OFF / kanan. Posisi tengah memutus.', spec: SELECTOR_3POS_SPEC },
  { key: 'CONTACT_2STATE', kind: 'CONTACT_2STATE', category: 'Kontrol', icon: 'CT', label: 'Sakelar proses (COM–NC–NO)', aliases: ['Saklar proses'], hint: 'Kontak generik COM/NC/NO. Normal: COM-NC; aktif: COM-NO. Mewakili limit/float/pressure/flow/thermostat pada wiring — nama proses ditempatkan di paket/example, bukan tile.', spec: CONTACT_2STATE_SPEC },
  { key: 'LIMIT_SWITCH_D4N', kind: 'LIMIT_SWITCH', category: 'Sensor', icon: 'LS', label: 'Sakelar batas (limit switch) D4N — 1NC/1NO', aliases: ['Limit switch D4N'], hint: 'Slow-action: normal 11–12 (NC), tertekan 33–34 (NO). Hanya NC memiliki mekanisme direct opening pada produk rujukan; simulator bukan validasi fungsi keselamatan.', spec: LIMIT_SWITCH_D4N_SPEC },
  { key: 'SENSOR_E2E_PNP_NO', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'P+', label: 'Sensor induktif E2E — PNP NO', hint: 'DC 3-wire: pin 1 cokelat +V, pin 3 biru 0 V, pin 4 hitam OUT. Saat mendeteksi logam, output PNP menyuplai +V.', spec: SENSOR_E2E_PNP_NO_SPEC },
  { key: 'SENSOR_E2E_NPN_NO', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'N−', label: 'Sensor induktif E2E — NPN NO', hint: 'DC 3-wire: pin 1 cokelat +V, pin 3 biru 0 V, pin 4 hitam OUT. Saat mendeteksi logam, output NPN menarik OUT ke 0 V.', spec: SENSOR_E2E_NPN_NO_SPEC },
  { key: 'SENSOR_E2E_PNP_NC', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'P̅', label: 'Sensor induktif E2E — PNP NC', hint: 'Pin 1/3/4 mengikuti konvensi E2E. Output PNP menghantar saat target tidak terdeteksi dan membuka saat terdeteksi.', spec: SENSOR_E2E_PNP_NC_SPEC },
  { key: 'SENSOR_E2E_NPN_NC', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'N̅', label: 'Sensor induktif E2E — NPN NC', hint: 'Pin 1/3/4 mengikuti konvensi E2E. Output NPN menghantar saat target tidak terdeteksi dan membuka saat terdeteksi.', spec: SENSOR_E2E_NPN_NC_SPEC },
  { key: 'SENSOR_E2K_PNP_NO', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'CP', label: 'Sensor kapasitif E2K — PNP NO', hint: 'Mendeteksi target kapasitif. Pin 1 cokelat +V, pin 3 biru 0 V, pin 4 hitam OUT; output PNP.', spec: SENSOR_E2K_PNP_NO_SPEC },
  { key: 'SENSOR_E3Z_PNP_LIGHT_ON', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'PH', label: 'Sensor fotoelektrik E3Z — PNP Light-ON', aliases: ['Photoelectric E3Z'], hint: 'Pin 1 cokelat +V, pin 3 biru 0 V, pin 4 hitam OUT. Klik mensimulasikan target/cahaya terdeteksi; ini bukan model optik jarak nyata.', spec: SENSOR_E3Z_PNP_LIGHT_ON_SPEC },
  { key: 'TERMINAL_BLOCK', kind: 'TERMINAL_BLOCK', category: 'Koneksi', icon: 'X1', label: 'Terminal blok tembus', aliases: ['Feed-through terminal block'], hint: 'Satu posisi, dua titik sambung, satu potensial: kedua klem tersambung melalui current bar internal.', spec: TERMINAL_BLOCK_SPEC },
  { key: 'ESTOP', kind: 'ESTOP', category: 'Kontrol', icon: 'ES', label: 'Tombol henti darurat (E-stop)', aliases: ['Emergency stop'], hint: 'NC maintained: normal tertutup; ditekan mengunci terbuka sampai di-reset (klik lagi).', spec: ESTOP_SPEC },
  { key: 'FUSE', kind: 'FUSE', category: 'Proteksi', icon: 'FU', label: 'Sekring (fuse)', hint: 'Dua terminal: NORMAL menghantarkan, PUTUS membuka. Tanpa model I2t.', spec: FUSE_SPEC },
  { key: 'BREAKER_1P', kind: 'BREAKER_1P', category: 'Proteksi', icon: 'QF', label: 'MCB 1-fasa', hint: 'Memutus satu penghantar fase. Model trip termal bersifat edukasional, bukan kurva IEC atau alat pemilihan proteksi.', spec: BREAKER_1P_SPEC },
  { key: 'LOAD', kind: 'LOAD', category: 'Beban', icon: '⊗', label: 'Lampu', hint: 'Beban: menyala bila dialiri arus yang cukup.', spec: LAMP_SPEC },
  { key: 'LOAD_RESISTOR', kind: 'LOAD', category: 'Beban', icon: '▭', label: 'Resistor', hint: 'Beban resistif murni; membatasi arus & membuang daya sebagai panas.', spec: RESISTOR_SPEC },
  { key: 'LOAD_HEATER', kind: 'LOAD', category: 'Beban', icon: '♨', label: 'Elemen pemanas', hint: 'Beban resistif; energi listrik menjadi panas saat dialiri arus.', spec: HEATER_SPEC },
  { key: 'LOAD_BELL', kind: 'LOAD', category: 'Beban', icon: '🔔', label: 'Bel / Buzzer', hint: 'Beban; berbunyi saat dialiri arus (mis. rangkaian bel pintu).', spec: BELL_SPEC },
  { key: 'SOLENOID_VXE21', kind: 'LOAD', category: 'Beban', icon: 'YV', label: 'Katup solenoid VXE21 — 24 VDC', aliases: ['Solenoid valve VXE21'], hint: 'Coil terminal 1–2, 24 VDC. Model memakai holding 1,5 W (384 Ω); animasi menunjukkan coil energised, bukan aliran fluida.', spec: SOLENOID_VXE21_SPEC },
  { key: 'GROUND', kind: 'GROUND', category: 'Pembumian', icon: '⏚', label: 'Pembumian (PE)', hint: 'Titik pembumian / earth (PE). Simbol wiring standar; belum menghantar pada model listrik saat ini.', spec: GROUND_SPEC },
  { key: 'MOTOR', kind: 'MOTOR', category: 'Beban', icon: 'M', label: 'Motor 1-fasa (model PSC)', hint: 'Model PSC edukasional: belitan bantu memerlukan kapasitor. Motor shaded-pole/split-phase lain dapat memakai metode start berbeda.', spec: MOTOR_SPEC },
  { key: 'CAPACITOR', kind: 'CAPACITOR', category: 'Beban', icon: '⊣⊢', label: 'Kapasitor', hint: 'Memberi beda fasa agar motor punya torsi awal.', spec: CAPACITOR_SPEC },
  { key: 'PUSHBUTTON_NO', kind: 'PUSHBUTTON', category: 'Kontrol', icon: 'NO', label: 'Tombol START (NO)', hint: 'Tekan-tahan untuk menyambung (momentary).', spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true } },
  { key: 'PUSHBUTTON_NC', kind: 'PUSHBUTTON', category: 'Kontrol', icon: 'NC', label: 'Tombol STOP (NC)', hint: 'Tekan-tahan untuk memutus (momentary).', spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: false } },
  { key: 'RELAY', kind: 'RELAY', category: 'Kontrol', icon: 'K2', label: 'Relai MY2 — 8 pin', aliases: ['Relay MY2'], hint: 'Omron MY2: DPDT / 2 changeover. Pin fisik: 1, 4, 5, 8, 9, 12, 13, 14; tampilan terminal relay dari bawah.', spec: RELAY_SPEC },
  { key: 'RELAY_MY3', kind: 'RELAY', category: 'Kontrol', icon: 'K3', label: 'Relai MY3 — 11 pin', aliases: ['Relay MY3'], hint: 'Omron MY3: 3PDT / 3 changeover, terminal 1–11; tampilan terminal relay dari bawah.', spec: RELAY_MY3_SPEC },
  { key: 'RELAY_MY4', kind: 'RELAY', category: 'Kontrol', icon: 'K4', label: 'Relai MY4 — 14 pin', aliases: ['Relay MY4'], hint: 'Omron MY4: 4PDT / 4 changeover, terminal 1–14; tampilan terminal relay dari bawah.', spec: RELAY_MY4_SPEC },
  { key: 'RELAY_G5V2', kind: 'RELAY', category: 'Kontrol', icon: 'K8', label: 'Relai G5V-2 — 8 pin PCB', aliases: ['Relay G5V-2'], hint: 'Omron G5V-2: delapan kaki fisik dengan designation 1, 4, 6, 8, 9, 11, 13, 16. Angka 16 adalah nomor pin, bukan jumlah kaki. Tampilan bawah.', spec: RELAY_G5V2_SPEC },
  { key: 'INDICATOR', kind: 'INDICATOR', category: 'Indikator', icon: '◉', label: 'Lampu indikator', hint: 'Nyala bila dialiri arus.', spec: INDICATOR_SPEC },
  { key: 'SOURCE_3PH', kind: 'SOURCE_3PH', category: 'Sumber', icon: '3~', label: 'Sumber 3-fasa', hint: 'Empat terminal: R, S, T, dan N.', spec: SOURCE_3PH_SPEC },
  { key: 'BREAKER_3P', kind: 'BREAKER_3P', category: 'Proteksi', icon: 'QF3', label: 'MCB 3-fasa', hint: 'Memutus R, S, dan T dengan satu handle. Model trip termal bersifat edukasional, bukan kurva IEC atau studi koordinasi.', spec: BREAKER_3P_SPEC },
  { key: 'MOTOR_3PH', kind: 'MOTOR_3PH', category: 'Beban', icon: 'M3', label: 'Motor 3-fasa', hint: 'Enam ujung belitan U1/U2, V1/V2, W1/W2 plus PE rangka. Sambungan wajib mengikuti nameplate; U2/V2/W2 bukan identitas fasa.', spec: MOTOR_3PH_SPEC },
  { key: 'CONTACTOR', kind: 'CONTACTOR', category: 'Kontrol', icon: 'KM', label: 'Kontaktor', hint: 'Kumparan A1/A2 mengendalikan tiga kontak utama serta auxiliary NO/NC.', spec: CONTACTOR_SPEC },
  { key: 'TIMER', kind: 'TIMER', category: 'Kontrol', icon: 'KT', label: 'Timer bintang–segitiga H3DT-G', aliases: ['Timer star–delta H3DT-G', 'star delta'], hint: 'Omron H3DT-G: A1/A2; STAR 15-16-18; DELTA 25-26-28. STAR 1–120 s, transfer 0,05/0,1/0,25/0,5 s.', spec: TIMER_SPEC },
  { key: 'OVERLOAD_RELAY', kind: 'OVERLOAD_RELAY', category: 'Proteksi', icon: 'OL', label: 'Relai beban lebih', aliases: ['Relay beban-lebih', 'overload relay'], hint: 'Menyensor arus; akumulasi termal memicu trip yang membuka 95–96 (memutus kontrol). Model termal edukasional, bukan kurva IEC.', spec: OVERLOAD_SPEC },
  { key: 'DIN_PSU_HDR3024', kind: 'SOURCE', category: 'Sumber', icon: 'PS', label: 'Catu daya DIN 24 VDC', hint: 'MEAN WELL HDR-30-24. Simulator menyediakan terminal keluaran +V/−V 24 VDC; efisiensi, inrush, proteksi internal, dan sisi PLN tidak dimodelkan.', manufacturer: 'MEAN WELL', model: 'HDR-30-24', aliases: ['SMPS', 'PSU', 'power supply DIN'], simulationScope: 'Sumber keluaran ideal 24 VDC dengan batas arus edukasional 1,5 A.', datasheetUrl: 'https://www.meanwell.com/webapp/product/search.aspx?prod=HDR-30', spec: DIN_PSU_24V_SPEC },
  { key: 'CONTROL_TRANSFORMER_ABL6TS25B', kind: 'SOURCE', category: 'Sumber', icon: 'TR', label: 'Transformator kontrol 24 VAC', hint: 'Schneider ABL6TS25B 250 VA. Simulator memakai sisi sekunder 24 VAC sebagai sumber ideal; rasio, tap primer 230/400 V, rugi, inrush, dan uji isolasi tidak dihitung.', manufacturer: 'Schneider Electric', model: 'ABL6TS25B', aliases: ['control transformer', 'trafo kontrol'], simulationScope: 'Sekunder ideal 24 VAC; terminal primer hanya didokumentasikan, tidak diselesaikan sebagai transformator berkopel.', datasheetUrl: 'https://www.se.com/ww/en/product/ABL6TS25B/', spec: CONTROL_TRANSFORMER_24VAC_SPEC },
  { key: 'DISCONNECTOR_VCF1', kind: 'BREAKER_3P', category: 'Switching', icon: 'QS', label: 'Sakelar pemisah 3 kutub', hint: 'Schneider VCF1, tiga kutub terhubung mekanis. ON/OFF memutus seluruh fasa; tidak memiliki fungsi trip arus pada simulator karena disconnector bukan MCB.', manufacturer: 'Schneider Electric', model: 'VCF1', aliases: ['switch-disconnector', 'isolator', 'main switch', 'disconnect switch'], simulationScope: 'Tiga kontak utama ganged; tanpa pelepas arus lebih.', datasheetUrl: 'https://www.se.com/ww/en/product/VCF1/', spec: DISCONNECTOR_3P_SPEC },
  { key: 'MOTOR_BREAKER_GV2ME14', kind: 'BREAKER_3P', category: 'Proteksi', icon: 'GV2', label: 'Pemutus motor (MPCB) 6–10 A', hint: 'Schneider GV2ME14. Tiga kutub common-trip; rating simulasi disetel 10 A. Model termal/seketika bersifat edukasional, bukan kurva produk atau studi koordinasi.', manufacturer: 'Schneider Electric', model: 'GV2ME14', aliases: ['MPCB', 'manual motor starter', 'motor protection circuit breaker'], simulationScope: 'Kontak 3P, arus tiap kutub, trip termal/seketika kualitatif, dan latch/reset.', datasheetUrl: 'https://www.se.com/ww/en/product/GV2ME14/', spec: MOTOR_BREAKER_GV2ME14_SPEC },
  { key: 'PHASE_MONITOR_RM17TG20', kind: 'CONTACT_2STATE', category: 'Proteksi', icon: 'PM', label: 'Relai pemantau fasa', hint: 'Schneider RM17TG20: input L1/L2/L3 dan dua output changeover 11-12-14 / 21-22-24. Simulator menurunkan keadaan sehat/fault dari kontinuitas dan urutan L1/L2/L3; output tidak dapat dipaksa manual.', manufacturer: 'Schneider Electric', model: 'RM17TG20', aliases: ['phase monitor', 'phase failure relay', 'phase sequence relay'], simulationScope: 'Deteksi ideal fasa hilang/tertukar pada topologi; dua output CO bergerak bersama. Ambang tegangan analog, imbalance, dan waktu respons produk tidak dihitung.', datasheetUrl: 'https://www.se.com/ww/en/product/RM17TG20/', spec: { kind: 'CONTACT_2STATE', actuated: false } },
  { key: 'AUX_CONTACT_LADN22', kind: 'CONTACT_2STATE', category: 'Kontrol', icon: 'AX', label: 'Blok kontak bantu 2NO+2NC', hint: 'Schneider LADN22: NO 53-54/83-84 dan NC 61-62/71-72. Keempat pole tersedia pada satu komponen dan berpindah bersama saat state mekanis diubah.', manufacturer: 'Schneider Electric', model: 'LADN22', aliases: ['auxiliary contact block', 'aux block', 'kontak bantu'], simulationScope: 'Empat pole lengkap 2NO+2NC dengan keadaan mekanis manual; link otomatis ke kontaktor belum diklaim.', datasheetUrl: 'https://www.se.com/ww/en/product/LADN22/', spec: { kind: 'CONTACT_2STATE', actuated: false } },
  { key: 'TIMER_H3CR_A8', kind: 'TIMER', category: 'Kontrol', icon: 'KT8', label: 'Timer multifungsi 8 pin', hint: 'Omron H3CR-A8 varian 24–48 VAC / 12–48 VDC: catu pin 2–7; DPDT 1(COM)-4(NC)-3(NO) dan 8(COM)-5(NC)-6(NO). Mode A/B/B2/E/J menggerakkan kedua changeover bersama.', manufacturer: 'OMRON', model: 'H3CR-A8', aliases: ['multifunction timer', 'time relay', 'timer octal', 'ON delay', 'flicker'], simulationScope: 'Mode A, B, B2, E, J deterministik; power-start dan dua SPDT. Rentang analog, toleransi, dan kurva umur kontak produk tidak disimulasikan.', datasheetUrl: 'https://www.ia.omron.com/products/family/193/', spec: H3CR_A8_SPEC },
  { key: 'SELECTOR_XB5AD21', kind: 'SWITCH', category: 'Kontrol', icon: 'S2', label: 'Selektor 2 posisi', hint: 'Schneider XB5AD21 maintained. Klik mengganti posisi kontak 13-14; satu kontak NO dimodelkan.', manufacturer: 'Schneider Electric', model: 'XB5AD21', aliases: ['selector switch', 'selector 2 position', 'maintained selector'], simulationScope: 'Satu kontak maintained NO 13-14.', datasheetUrl: 'https://www.se.com/ww/en/product/XB5AD21/', spec: { kind: 'SWITCH', closed: false } },
  { key: 'KEY_SELECTOR_XB5AG21', kind: 'SWITCH', category: 'Kontrol', icon: 'KEY', label: 'Selektor kunci 2 posisi', hint: 'Schneider XB5AG21 maintained dengan kunci. Simulator memodelkan kontak NO 13-14; pelepasan/penahanan kunci mekanis tidak dinilai.', manufacturer: 'Schneider Electric', model: 'XB5AG21', aliases: ['key selector', 'key switch', 'saklar kunci'], simulationScope: 'Satu kontak maintained NO 13-14.', datasheetUrl: 'https://www.se.com/ww/en/product/XB5AG21/', spec: { kind: 'SWITCH', closed: false } },
  { key: 'PUSHBUTTON_STATION_XB5AL73415', kind: 'LIMIT_SWITCH', category: 'Kontrol', icon: 'SS', label: 'Stasiun tombol START/STOP', hint: 'Schneider XB5AL73415: STOP NC 21-22 dan START NO 13-14 adalah dua operator spring-return yang independen. Tekan-tahan salah satu kepala hanya mengubah contact block miliknya.', manufacturer: 'Schneider Electric', model: 'XB5AL73415', aliases: ['pushbutton station', 'start stop station', 'double pushbutton'], simulationScope: 'START NO 13-14 dan STOP NC 21-22 dapat ditekan independen dan momentary pada Virtual maupun IEC.', datasheetUrl: 'https://www.se.com/ww/en/product/XB5AL73415/', spec: { kind: 'LIMIT_SWITCH', actuated: false, startPressed: false, stopPressed: false } },
  { key: 'ILLUMINATED_PB_XB5AW33B5', kind: 'LIMIT_SWITCH', category: 'Kontrol', icon: 'PB+', label: 'Tombol tekan berlampu 24 V', hint: 'Schneider XB5AW33B5, spring-return 1NO+1NC dengan LED integral 24 V AC/DC. Kontak 21-22/13-14 dan terminal lampu X1-X2 tersedia terpisah.', manufacturer: 'Schneider Electric', model: 'XB5AW33B5', aliases: ['illuminated pushbutton', 'lamp pushbutton'], simulationScope: 'Kontak 21-22 NC dan 13-14 NO bergerak bersama; LED X1-X2 menjadi beban eksplisit 18 mA nominal pada 24 V.', datasheetUrl: 'https://www.se.com/ww/en/product/XB5AW33B5/', spec: { kind: 'LIMIT_SWITCH', actuated: false, lampResistanceOhms: 24 / 0.018 } },
  { key: 'FLOAT_SWITCH_9037HG33', kind: 'CONTACT_2STATE', category: 'Sensor', icon: 'FL', label: 'Sakelar pelampung (float switch)', hint: 'Schneider 9037HG33RZ20: dua pole NO DPST dengan empat terminal. Datasheet menyatakan kedua kontak membuka saat level cairan naik. Klik mengubah kondisi level; orientasi pemasangan dan mekanika pelampung tidak dihitung.', manufacturer: 'Schneider Electric', model: '9037HG33RZ20', aliases: ['level switch', 'pelampung'], simulationScope: 'Dua pole DPST bergerak bersama; state level tinggi membuka kedua pole.', datasheetUrl: 'https://www.se.com/us/en/product/9037HG33RZ20/', spec: { kind: 'CONTACT_2STATE', actuated: false } },
  { key: 'PRESSURE_SWITCH_XMLB004', kind: 'CONTACT_2STATE', category: 'Sensor', icon: 'PSW', label: 'Sakelar tekanan (pressure switch)', hint: 'Schneider XMLB004A2S11: kontak snap-action 13-14 NO dan 11-12 NC. Klik mensimulasikan ambang tekanan tercapai; nilai tekanan, hysteresis, media, dan batas proses tidak dihitung.', manufacturer: 'Schneider Electric', model: 'XMLB004A2S11', aliases: ['pressostat', 'saklar tekanan'], simulationScope: 'Pasangan NO 13-14 dan NC 11-12 berpindah secara mekanis.', datasheetUrl: 'https://www.se.com/ww/en/product/XMLB004A2S11/', spec: { kind: 'CONTACT_2STATE', actuated: false } },
  { key: 'THERMOSTAT_NSYCCOTHC', kind: 'CONTACT_2STATE', category: 'Sensor', icon: 'TH', label: 'Termostat panel NC', hint: 'Schneider NSYCCOTHC: satu kontak NC terminal 1-2 yang membuka saat temperatur naik melewati setpoint. Klik mengubah kondisi temperatur; dinamika termal kabinet tidak dihitung.', manufacturer: 'Schneider Electric', model: 'NSYCCOTHC', aliases: ['cabinet thermostat', 'thermostat NC'], simulationScope: 'Kontak NC 1-2 membuka pada state temperatur tinggi.', datasheetUrl: 'https://www.se.com/ww/en/product/NSYCCOTHC/', spec: { kind: 'CONTACT_2STATE', actuated: false } },
  { key: 'SENSOR_E3Z_D61_NPN_LIGHT', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'N☀', label: 'Sensor fotoelektrik NPN Light-ON', hint: 'Omron E3Z-D61, DC 3-wire NPN. Target/cahaya terdeteksi membuat OUT pin 4 sink ke 0 V pada Light-ON.', manufacturer: 'OMRON', model: 'E3Z-D61', aliases: ['photoelectric', 'photoeye', 'Light-ON'], simulationScope: 'Supply pin 1/3 dan open-collector ideal pin 4; optik/jarak tidak dihitung.', datasheetUrl: 'https://www.ia.omron.com/products/family/465/', spec: SENSOR_E3Z_NPN_LIGHT_ON_SPEC },
  { key: 'SENSOR_E3Z_D61_NPN_DARK', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'N◐', label: 'Sensor fotoelektrik NPN Dark-ON', hint: 'Omron E3Z-D61, mode Dark-ON. OUT sink aktif ketika target/cahaya tidak terdeteksi.', manufacturer: 'OMRON', model: 'E3Z-D61', aliases: ['photoelectric', 'photoeye', 'Dark-ON'], simulationScope: 'Supply pin 1/3 dan open-collector ideal pin 4; optik/jarak tidak dihitung.', datasheetUrl: 'https://www.ia.omron.com/products/family/465/', spec: SENSOR_E3Z_NPN_DARK_ON_SPEC },
  { key: 'SENSOR_E3Z_D81_PNP_DARK', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'P◐', label: 'Sensor fotoelektrik PNP Dark-ON', hint: 'Omron E3Z-D81, mode Dark-ON. OUT pin 4 source +V ketika target/cahaya tidak terdeteksi.', manufacturer: 'OMRON', model: 'E3Z-D81', aliases: ['photoelectric', 'photoeye PNP', 'Dark-ON'], simulationScope: 'Supply pin 1/3 dan open-collector ideal pin 4; optik/jarak tidak dihitung.', datasheetUrl: 'https://www.ia.omron.com/products/family/465/', spec: SENSOR_E3Z_PNP_DARK_ON_SPEC },
  { key: 'SENSOR_E2K_X4ME1', kind: 'SENSOR_3WIRE', category: 'Sensor', icon: 'CN', label: 'Sensor kapasitif NPN NO', hint: 'Omron E2K-X4ME1 DC 3-wire NPN NO. Saat target terdeteksi, pin 4 sink ke pin 3/0 V.', manufacturer: 'OMRON', model: 'E2K-X4ME1', aliases: ['capacitive sensor', 'capacitive proximity', 'NPN NO'], simulationScope: 'Supply dan open-collector ideal; jarak/material/dielectric tidak dihitung.', datasheetUrl: 'https://www.ia.omron.com/products/family/473/', spec: SENSOR_E2K_NPN_NO_SPEC },
  { key: 'TERMINAL_UT25_BU', kind: 'TERMINAL_BLOCK', category: 'Koneksi', icon: 'N', label: 'Terminal blok netral', hint: 'Phoenix Contact UT 2,5 BU: dua clamp pada satu potensial. Warna biru adalah identifikasi fungsi; tidak otomatis membuat net menjadi neutral. A/B pada papan adalah alias simulator karena marker proyek dipasang pengguna.', manufacturer: 'Phoenix Contact', model: 'UT 2,5 BU', aliases: ['blue terminal', 'neutral terminal'], simulationScope: 'Kontinuitas dua titik satu potensial.', datasheetUrl: 'https://www.phoenixcontact.com/en-us/products/feed-through-terminal-block-ut-25-3044076', spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_BU' } },
  { key: 'TERMINAL_UT25_PE', kind: 'TERMINAL_BLOCK', category: 'Pembumian', icon: 'PE', label: 'Terminal blok PE', hint: 'Phoenix Contact UT 2,5-PE. Dua clamp disatukan; hubungan ke DIN rail/earth hanya dinyatakan sebagai PE dan tidak menjalankan model fault-to-earth.', manufacturer: 'Phoenix Contact', model: 'UT 2,5-PE', aliases: ['protective earth terminal', 'ground terminal'], simulationScope: 'Kontinuitas dua clamp; impedansi PE, fault loop, dan trip proteksi tidak dihitung.', datasheetUrl: 'https://www.phoenixcontact.com/en-us/products/ground-terminal-block-ut-25-pe-3044092', spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_PE' } },
  { key: 'TERMINAL_UT4_HESI', kind: 'TERMINAL_BLOCK', category: 'Proteksi', icon: 'XF', label: 'Terminal blok bersekring', hint: 'Phoenix Contact UT 4-HESI (5×20). Klik membuka/menutup carrier; fuseBlown tetap state terpisah pada model.', manufacturer: 'Phoenix Contact', model: 'UT 4-HESI (5x20)', aliases: ['fused terminal block', 'fuse terminal', 'fused disconnect'], simulationScope: 'Kontinuitas dua titik, carrier open, dan fuse blown.', datasheetUrl: 'https://www.phoenixcontact.com/de-de/produkte/sicherungsklemme-ut-4-hesi-5x20-3046032', spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT4_HESI', open: false, fuseBlown: false } },
  { key: 'TERMINAL_UT4_MT', kind: 'TERMINAL_BLOCK', category: 'Koneksi', icon: 'XD', label: 'Terminal pemisah pisau', hint: 'Phoenix Contact UT 4-MT. Klik mengubah knife disconnect OPEN/CLOSED; tidak ada pelepas proteksi tersembunyi.', manufacturer: 'Phoenix Contact', model: 'UT 4-MT', aliases: ['knife disconnect terminal', 'test disconnect terminal', 'knife terminal'], simulationScope: 'Kontinuitas dua titik dengan disconnect manual.', datasheetUrl: 'https://www.phoenixcontact.com/en-us/products/disconnect-terminal-block-ut-4-mt-3046139', spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT4_MT', open: false } },
  { key: 'TERMINAL_UT25_TWIN', kind: 'TERMINAL_BLOCK', category: 'Koneksi', icon: 'X3', label: 'Terminal tiga sambungan', hint: 'Phoenix Contact UT 2,5-TWIN: tiga clamp pada satu current bar dan satu potensial.', manufacturer: 'Phoenix Contact', model: 'UT 2,5-TWIN', aliases: ['twin terminal', '3 connection terminal'], simulationScope: 'Ketiga terminal berada pada satu electrical net.', datasheetUrl: 'https://www.phoenixcontact.com/en-us/products/multi-conductor-terminal-block-ut-25-twin-3044513', spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_TWIN' } },
  { key: 'TERMINAL_UT25_QUATTRO', kind: 'TERMINAL_BLOCK', category: 'Koneksi', icon: 'X4', label: 'Terminal empat sambungan', hint: 'Phoenix Contact UT 2,5-QUATTRO: empat clamp pada satu current bar dan satu potensial.', manufacturer: 'Phoenix Contact', model: 'UT 2,5-QUATTRO', aliases: ['quattro terminal', '4 connection terminal'], simulationScope: 'Keempat terminal berada pada satu electrical net.', datasheetUrl: 'https://www.phoenixcontact.com/en-us/products/multi-conductor-terminal-block-ut-25-quattro-3044542', spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_QUATTRO' } },
  { key: 'TERMINAL_UT25_PE_LL', kind: 'TERMINAL_BLOCK', category: 'Koneksi', icon: 'X6', label: 'Terminal bertingkat PE/L/L', hint: 'Phoenix Contact UT 2,5-PE/L/L: enam clamp pada tiga level/potensial terpisah. Simulator menyatukan hanya pasangan pada level yang sama; PE tidak disatukan dengan kedua level L.', manufacturer: 'Phoenix Contact', model: 'UT 2,5-PE/L/L', aliases: ['multilevel terminal', 'three potential terminal'], simulationScope: 'Tiga pasangan net terisolasi: PE, L, L.', datasheetUrl: 'https://www.phoenixcontact.com/en-us/products/ground-terminal-block-ut-25-pell-3214301', spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_PE_L_L' } },
]

/** id-prefix per kind, so placed ids read as S1, SW1, K1 (relay), PB1… */
export const ID_PREFIX: Record<ComponentKind, string> = {
  SOURCE: 'S',
  SWITCH: 'SW',
  SWITCH_2WAY: 'S2',
  SWITCH_CROSS: 'SX',
  CONTACT_2STATE: 'CT',
  LIMIT_SWITCH: 'LS',
  SENSOR_3WIRE: 'B',
  TERMINAL_BLOCK: 'X',
  SELECTOR_3POS: 'SEL',
  FUSE: 'FU',
  ESTOP: 'ES',
  LOAD: 'L',
  MOTOR: 'M',
  CAPACITOR: 'C',
  PUSHBUTTON: 'PB',
  SOURCE_3PH: 'Q',
  MOTOR_3PH: 'M3',
  CONTACTOR: 'KM',
  RELAY: 'K',
  INDICATOR: 'IND',
  BREAKER_1P: 'QF',
  BREAKER_3P: 'QF3',
  TIMER: 'KT',
  OVERLOAD_RELAY: 'OL',
  GROUND: 'PE',
}

export const TOPIC_1A_COPY = {
  eyebrow: 'M0 · Mesin Inti',
  title: 'Papan Simulasi — Topik 1a',
  intro:
    'Susun rangkaian sederhana, jalankan, dan amati arus mengalir. Sambungkan L → saklar → lampu → N, lalu tutup saklar: lampu menyala. Sambungkan L langsung ke N tanpa beban: terjadi hubung singkat.',
  goalLabel: 'Yang dibuktikan di sini',
  goal: 'Lampu hanya menyala bila tersambung benar; L–N langsung tanpa beban meledak — dan panel menjelaskan mengapa.',
} as const
