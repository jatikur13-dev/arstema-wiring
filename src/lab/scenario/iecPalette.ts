/**
 * The IEC palette — the professional board's own component list.
 *
 * It is NO LONGER a re-label of the field palette. An engineer picking a part
 * off a schematic looks for a reference designation and a circuit role, not for
 * a photograph: QF for the breaker, KM for the contactor coil, FR for the
 * thermal overload. Grouping follows how a drawing is actually organised —
 * supply, power circuit, control circuit, protection, earth — instead of the
 * shopping categories the field palette uses.
 *
 * What is deliberately SHARED is the `spec`: both palettes place the same
 * component into the same model, so the solver, the wiring rules and every
 * existing test see no difference. Only the face and the vocabulary differ.
 *
 * Designation letters follow common practice (IEC 81346): Q switching and
 * protection, K contactors and relays, M motors, E heating, H signalling,
 * S control devices, F fuses and overload releases, C capacitors, G supply.
 */

import { PALETTE, type PaletteItem } from './topic1a'
import type { WiringModelId } from '../../engine/index'

export type IecPaletteGroup =
  | 'Sumber'
  | 'Proteksi'
  | 'Rangkaian daya'
  | 'Rangkaian kendali'
  | 'Pembumian'

/**
 * Extends rather than replaces PaletteItem: the field palette's `category` is
 * carried along unused so an IEC tile is still a PaletteItem everywhere the
 * page already handles one — arming a tool, opening the info panel, placing.
 */
export interface IecPaletteItem extends PaletteItem {
  /** Reference designation prefix as it appears on a drawing. */
  designation: string
  /** Where this part sits on a schematic. */
  group: IecPaletteGroup
  /** One line in the wording a drawing uses. */
  iecLabel: string
}

/** key -> how the professional board names and files it. */
const IEC_OVERRIDES: Record<
  WiringModelId,
  { designation: string; group: IecPaletteGroup; iecLabel: string }
> = {
  SOURCE: { designation: 'G', group: 'Sumber', iecLabel: 'Suplai 1~ L/N' },
  BATTERY_24V: { designation: 'GB', group: 'Sumber', iecLabel: 'Baterai 24 VDC (+/−)' },
  SOURCE_3PH: { designation: 'G', group: 'Sumber', iecLabel: 'Suplai 3~ L1/L2/L3' },
  GROUND: { designation: 'PE', group: 'Pembumian', iecLabel: 'Penghantar proteksi PE' },

  FUSE: { designation: 'F', group: 'Proteksi', iecLabel: 'Pengaman lebur' },
  BREAKER_1P: { designation: 'QF', group: 'Proteksi', iecLabel: 'Pemutus daya 1 kutub' },
  BREAKER_3P: { designation: 'QF', group: 'Proteksi', iecLabel: 'Pemutus daya 3 kutub' },
  OVERLOAD_RELAY: { designation: 'FR', group: 'Proteksi', iecLabel: 'Relai beban lebih termal' },

  MOTOR: { designation: 'M', group: 'Rangkaian daya', iecLabel: 'Motor 1~' },
  MOTOR_3PH: { designation: 'M', group: 'Rangkaian daya', iecLabel: 'Motor 3~' },
  LOAD_HEATER: { designation: 'E', group: 'Rangkaian daya', iecLabel: 'Elemen pemanas' },
  LOAD_RESISTOR: { designation: 'R', group: 'Rangkaian daya', iecLabel: 'Resistor' },
  CAPACITOR: { designation: 'C', group: 'Rangkaian daya', iecLabel: 'Kapasitor' },
  LOAD: { designation: 'EL', group: 'Rangkaian daya', iecLabel: 'Lampu penerangan' },
  SOLENOID_VXE21: { designation: 'YV', group: 'Rangkaian daya', iecLabel: 'Koil katup solenoid 24 VDC' },

  CONTACTOR: { designation: 'KM', group: 'Rangkaian kendali', iecLabel: 'Kontaktor — koil A1/A2' },
  RELAY: { designation: 'KA', group: 'Rangkaian kendali', iecLabel: 'Relai MY2 — 2 changeover' },
  RELAY_MY3: { designation: 'KA', group: 'Rangkaian kendali', iecLabel: 'Relai MY3 — 3 changeover' },
  RELAY_MY4: { designation: 'KA', group: 'Rangkaian kendali', iecLabel: 'Relai MY4 — 4 changeover' },
  RELAY_G5V2: { designation: 'KA', group: 'Rangkaian kendali', iecLabel: 'Relai PCB G5V-2 — 2 changeover' },
  TIMER: { designation: 'KT', group: 'Rangkaian kendali', iecLabel: 'Relai waktu' },
  PUSHBUTTON_NO: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Tombol tekan NO' },
  PUSHBUTTON_NC: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Tombol tekan NC' },
  ESTOP: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Penghenti darurat NC' },
  SELECTOR_3POS: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Sakelar pilih 3 posisi' },
  CONTACT_2STATE: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Kontak proses COM/NC/NO' },
  LIMIT_SWITCH_D4N: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sakelar batas 1NC/1NO — 11/12, 33/34' },
  SENSOR_E2E_PNP_NO: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor induktif PNP NO — pin 1/3/4' },
  SENSOR_E2E_NPN_NO: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor induktif NPN NO — pin 1/3/4' },
  SENSOR_E2E_PNP_NC: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor induktif PNP NC — pin 1/3/4' },
  SENSOR_E2E_NPN_NC: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor induktif NPN NC — pin 1/3/4' },
  SENSOR_E2K_PNP_NO: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor kapasitif PNP NO — pin 1/3/4' },
  SENSOR_E3Z_PNP_LIGHT_ON: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor fotoelektrik PNP Light-ON — pin 1/3/4' },
  TERMINAL_BLOCK: { designation: 'X', group: 'Rangkaian kendali', iecLabel: 'Terminal blok tembus' },
  SWITCH: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Sakelar 1 kutub' },
  SWITCH_2WAY: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Sakelar tukar SPDT' },
  SWITCH_CROSS: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Sakelar silang' },
  INDICATOR: { designation: 'H', group: 'Rangkaian kendali', iecLabel: 'Lampu tanda' },
  LOAD_BELL: { designation: 'HA', group: 'Rangkaian kendali', iecLabel: 'Pemberi isyarat bunyi' },

  DIN_PSU_HDR3024: { designation: 'G', group: 'Sumber', iecLabel: 'Catu daya 24 VDC' },
  CONTROL_TRANSFORMER_ABL6TS25B: { designation: 'T', group: 'Sumber', iecLabel: 'Transformator kontrol 24 VAC' },
  DISCONNECTOR_VCF1: { designation: 'QS', group: 'Rangkaian daya', iecLabel: 'Sakelar pemisah 3 kutub' },
  MOTOR_BREAKER_GV2ME14: { designation: 'QF', group: 'Proteksi', iecLabel: 'Pemutus motor (MPCB) 6–10 A' },
  PHASE_MONITOR_RM17TG20: { designation: 'K', group: 'Proteksi', iecLabel: 'Relai pemantau fasa — kontak CO' },
  AUX_CONTACT_LADN22: { designation: 'KM', group: 'Rangkaian kendali', iecLabel: 'Blok kontak bantu 2NO+2NC' },
  TIMER_H3CR_A8: { designation: 'KT', group: 'Rangkaian kendali', iecLabel: 'Relai waktu multifungsi 8 pin' },
  SELECTOR_XB5AD21: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Selektor tetap 2 posisi' },
  KEY_SELECTOR_XB5AG21: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Selektor kunci tetap' },
  PUSHBUTTON_STATION_XB5AL73415: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Stasiun tombol START/STOP' },
  ILLUMINATED_PB_XB5AW33B5: { designation: 'S', group: 'Rangkaian kendali', iecLabel: 'Tombol tekan berlampu 24 V' },
  FLOAT_SWITCH_9037HG33: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sakelar pelampung / kontak level' },
  PRESSURE_SWITCH_XMLB004: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sakelar tekanan 1CO' },
  THERMOSTAT_NSYCCOTHC: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Termostat kabinet NC' },
  SENSOR_E3Z_D61_NPN_LIGHT: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor fotoelektrik NPN Light-ON' },
  SENSOR_E3Z_D61_NPN_DARK: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor fotoelektrik NPN Dark-ON' },
  SENSOR_E3Z_D81_PNP_DARK: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor fotoelektrik PNP Dark-ON' },
  SENSOR_E2K_X4ME1: { designation: 'B', group: 'Rangkaian kendali', iecLabel: 'Sensor kapasitif NPN NO' },
  TERMINAL_UT25_BU: { designation: 'X', group: 'Rangkaian kendali', iecLabel: 'Terminal N — 2 koneksi' },
  TERMINAL_UT25_PE: { designation: 'XPE', group: 'Pembumian', iecLabel: 'Terminal PE — 2 koneksi' },
  TERMINAL_UT4_HESI: { designation: 'XF', group: 'Proteksi', iecLabel: 'Terminal sekring 5×20' },
  TERMINAL_UT4_MT: { designation: 'X', group: 'Rangkaian kendali', iecLabel: 'Terminal pemisah pisau' },
  TERMINAL_UT25_TWIN: { designation: 'X', group: 'Rangkaian kendali', iecLabel: 'Terminal satu net — 3 koneksi' },
  TERMINAL_UT25_QUATTRO: { designation: 'X', group: 'Rangkaian kendali', iecLabel: 'Terminal satu net — 4 koneksi' },
  TERMINAL_UT25_PE_LL: { designation: 'X', group: 'Rangkaian kendali', iecLabel: 'Terminal bertingkat PE/L/L' },
}

/** Drawing order: supply first, then protection, power, control, earth. */
export const IEC_PALETTE_GROUPS: readonly IecPaletteGroup[] = [
  'Sumber',
  'Proteksi',
  'Rangkaian daya',
  'Rangkaian kendali',
  'Pembumian',
]

/**
 * The professional list, derived from the shared specs.
 *
 * A key with no override is a wiring mistake rather than a styling gap, so it
 * is dropped loudly in development instead of silently appearing under a
 * category an engineer would not look in.
 */
export const IEC_PALETTE: readonly IecPaletteItem[] = PALETTE.flatMap((item) => {
  const override = IEC_OVERRIDES[item.key]
  if (!override) {
    if (import.meta.env.DEV) {
      throw new Error(`IEC palette has no entry for "${item.key}".`)
    }
    return []
  }
  return [{ ...item, ...override }]
})
