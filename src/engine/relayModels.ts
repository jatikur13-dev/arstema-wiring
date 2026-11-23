/**
 * Manufacturer-backed terminal maps for relay packages used by the simulator.
 *
 * Internal terminal indices remain compact solver identifiers. `pin` is the
 * designation printed by the manufacturer and is what the UI must show.
 * Contact diagrams are interpreted in the normal, coil-de-energized state.
 */

import type { RelayModel, RelaySpec } from './types'

export type RelayTerminalRole = 'A1' | 'A2' | 'COM' | 'NC' | 'NO'

export interface RelayTerminalDefinition {
  index: number
  pin: string
  role: RelayTerminalRole
  pole?: number
}

export interface RelayContactSet {
  pole: number
  common: number
  nc: number
  no: number
}

export interface RelayModelDefinition {
  model: RelayModel
  manufacturer: 'Generic' | 'Omron'
  family: string
  physicalPinCount: number
  contactForm: string
  terminals: readonly RelayTerminalDefinition[]
  contacts: readonly RelayContactSet[]
  /** Compatibility-only packages may expose independent NO/NC pairs. */
  energizedPairs: readonly (readonly [number, number])[]
  deenergizedPairs: readonly (readonly [number, number])[]
  coil: readonly [number, number]
  view: 'TOP_SOCKET' | 'BOTTOM_RELAY'
}

const changeoverPairs = (
  contacts: readonly RelayContactSet[],
  energized: boolean,
): Array<[number, number]> =>
  contacts.map((contact) => [contact.common, energized ? contact.no : contact.nc])

const DEFINITIONS: Record<RelayModel, RelayModelDefinition> = {
  LEGACY_1NO_1NC: {
    model: 'LEGACY_1NO_1NC',
    manufacturer: 'Generic',
    family: 'Legacy 1NO + 1NC terpisah',
    physicalPinCount: 6,
    contactForm: '1NO + 1NC (bukan changeover)',
    terminals: [
      { index: 0, pin: 'A1', role: 'A1' },
      { index: 1, pin: 'A2', role: 'A2' },
      { index: 2, pin: '13', role: 'NO', pole: 1 },
      { index: 3, pin: '14', role: 'NO', pole: 1 },
      { index: 4, pin: '21', role: 'NC', pole: 2 },
      { index: 5, pin: '22', role: 'NC', pole: 2 },
    ],
    contacts: [],
    energizedPairs: [[2, 3]],
    deenergizedPairs: [[4, 5]],
    coil: [0, 1],
    view: 'TOP_SOCKET',
  },
  OMRON_MY2_8PIN: {
    model: 'OMRON_MY2_8PIN',
    manufacturer: 'Omron',
    family: 'MY2',
    physicalPinCount: 8,
    contactForm: 'DPDT / 2 Form C',
    // Manufacturer pin numbers: 1,4,5,8,9,12,13,14. Indices 2-3 and
    // 4-5 intentionally retain the old examples' first NO and NC pair shape.
    terminals: [
      { index: 0, pin: '13', role: 'A1' },
      { index: 1, pin: '14', role: 'A2' },
      { index: 2, pin: '9', role: 'COM', pole: 1 },
      { index: 3, pin: '5', role: 'NO', pole: 1 },
      { index: 4, pin: '12', role: 'COM', pole: 2 },
      { index: 5, pin: '4', role: 'NC', pole: 2 },
      { index: 6, pin: '1', role: 'NC', pole: 1 },
      { index: 7, pin: '8', role: 'NO', pole: 2 },
    ],
    contacts: [
      { pole: 1, common: 2, nc: 6, no: 3 },
      { pole: 2, common: 4, nc: 5, no: 7 },
    ],
    energizedPairs: [],
    deenergizedPairs: [],
    coil: [0, 1],
    view: 'BOTTOM_RELAY',
  },
  OMRON_MY3_11PIN: {
    model: 'OMRON_MY3_11PIN',
    manufacturer: 'Omron',
    family: 'MY3',
    physicalPinCount: 11,
    contactForm: '3PDT / 3 Form C',
    terminals: [
      { index: 0, pin: '10', role: 'A1' },
      { index: 1, pin: '11', role: 'A2' },
      { index: 2, pin: '7', role: 'COM', pole: 1 },
      { index: 3, pin: '4', role: 'NO', pole: 1 },
      { index: 4, pin: '1', role: 'NC', pole: 1 },
      { index: 5, pin: '8', role: 'COM', pole: 2 },
      { index: 6, pin: '5', role: 'NO', pole: 2 },
      { index: 7, pin: '2', role: 'NC', pole: 2 },
      { index: 8, pin: '9', role: 'COM', pole: 3 },
      { index: 9, pin: '6', role: 'NO', pole: 3 },
      { index: 10, pin: '3', role: 'NC', pole: 3 },
    ],
    contacts: [
      { pole: 1, common: 2, nc: 4, no: 3 },
      { pole: 2, common: 5, nc: 7, no: 6 },
      { pole: 3, common: 8, nc: 10, no: 9 },
    ],
    energizedPairs: [],
    deenergizedPairs: [],
    coil: [0, 1],
    view: 'BOTTOM_RELAY',
  },
  OMRON_MY4_14PIN: {
    model: 'OMRON_MY4_14PIN',
    manufacturer: 'Omron',
    family: 'MY4',
    physicalPinCount: 14,
    contactForm: '4PDT / 4 Form C',
    terminals: [
      { index: 0, pin: '13', role: 'A1' },
      { index: 1, pin: '14', role: 'A2' },
      { index: 2, pin: '9', role: 'COM', pole: 1 },
      { index: 3, pin: '5', role: 'NO', pole: 1 },
      { index: 4, pin: '1', role: 'NC', pole: 1 },
      { index: 5, pin: '10', role: 'COM', pole: 2 },
      { index: 6, pin: '6', role: 'NO', pole: 2 },
      { index: 7, pin: '2', role: 'NC', pole: 2 },
      { index: 8, pin: '11', role: 'COM', pole: 3 },
      { index: 9, pin: '7', role: 'NO', pole: 3 },
      { index: 10, pin: '3', role: 'NC', pole: 3 },
      { index: 11, pin: '12', role: 'COM', pole: 4 },
      { index: 12, pin: '8', role: 'NO', pole: 4 },
      { index: 13, pin: '4', role: 'NC', pole: 4 },
    ],
    contacts: [
      { pole: 1, common: 2, nc: 4, no: 3 },
      { pole: 2, common: 5, nc: 7, no: 6 },
      { pole: 3, common: 8, nc: 10, no: 9 },
      { pole: 4, common: 11, nc: 13, no: 12 },
    ],
    energizedPairs: [],
    deenergizedPairs: [],
    coil: [0, 1],
    view: 'BOTTOM_RELAY',
  },
  OMRON_G5V2_8PIN: {
    model: 'OMRON_G5V2_8PIN',
    manufacturer: 'Omron',
    family: 'G5V-2',
    physicalPinCount: 8,
    contactForm: 'DPDT / 2 Form C',
    // Eight physical pins; 16 is a manufacturer pin DESIGNATION, not a claim
    // that this package has sixteen leads.
    terminals: [
      { index: 0, pin: '1', role: 'A1' },
      { index: 1, pin: '16', role: 'A2' },
      { index: 2, pin: '4', role: 'COM', pole: 1 },
      { index: 3, pin: '8', role: 'NO', pole: 1 },
      { index: 4, pin: '6', role: 'NC', pole: 1 },
      { index: 5, pin: '13', role: 'COM', pole: 2 },
      { index: 6, pin: '9', role: 'NO', pole: 2 },
      { index: 7, pin: '11', role: 'NC', pole: 2 },
    ],
    contacts: [
      { pole: 1, common: 2, nc: 4, no: 3 },
      { pole: 2, common: 5, nc: 7, no: 6 },
    ],
    energizedPairs: [],
    deenergizedPairs: [],
    coil: [0, 1],
    view: 'BOTTOM_RELAY',
  },
}

export function relayModel(spec: RelaySpec): RelayModel {
  return spec.model ?? 'LEGACY_1NO_1NC'
}

export function relayDefinition(spec: RelaySpec): RelayModelDefinition {
  return DEFINITIONS[relayModel(spec)]
}

export function relayConductingPairs(
  spec: RelaySpec,
  energized: boolean,
): Array<[number, number]> {
  const definition = relayDefinition(spec)
  if (definition.contacts.length > 0) {
    return changeoverPairs(definition.contacts, energized)
  }
  const pairs = energized ? definition.energizedPairs : definition.deenergizedPairs
  return pairs.map(([a, b]) => [a, b])
}

export const RELAY_MODEL_DEFINITIONS = DEFINITIONS
