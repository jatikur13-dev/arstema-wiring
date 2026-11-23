import { describe, expect, it } from 'vitest'
import type { PlacedComponent, RelayModel, RelaySpec } from '../../engine/index'
import { relayDefinition, terminalCountForSpec } from '../../engine/index'
import { virtualAssetDefinition, virtualAssetDefinitionForComponent } from './virtualAssets'

const relay = (model: RelayModel): RelaySpec => ({
  kind: 'RELAY',
  model,
  coilResistanceOhms: 2200,
  pickupAmps: 0.05,
})

describe('model-specific relay assets', () => {
  it.each([
    'OMRON_MY2_8PIN',
    'OMRON_MY3_11PIN',
    'OMRON_MY4_14PIN',
    'OMRON_G5V2_8PIN',
  ] as const)('%s has exactly one distinct physical anchor per manufacturer terminal', (model) => {
    const spec = relay(model)
    const asset = virtualAssetDefinition(spec)
    const points = new Set(asset.terminals.map((terminal) => `${terminal.x},${terminal.y}`))
    expect(asset.terminals).toHaveLength(terminalCountForSpec(spec))
    expect(points.size).toBe(asset.terminals.length)
    expect(relayDefinition(spec).view).toBe('BOTTOM_RELAY')
    expect(asset.src).toMatch(/relay-(my2|my3|my4|g5v2)\.webp/)
  })
})

describe('industrial field-device assets', () => {
  it.each([
    [{ kind: 'SOURCE', emfVolts: 24, tripAmps: 10, sourceType: 'battery_dc' } as const, /battery-24v\.webp/, 2],
    [{ kind: 'SOURCE', emfVolts: 24, tripAmps: 1.5, sourceType: 'din_psu_24vdc' } as const, /din-psu-24v\.webp/, 2],
    [{ kind: 'SOURCE', emfVolts: 24, tripAmps: 10, sourceType: 'control_transformer_24vac' } as const, /control-transformer-24vac\.webp/, 2],
    [{ kind: 'TERMINAL_BLOCK' } as const, /terminal-block\.webp/, 2],
    [{ kind: 'LIMIT_SWITCH', actuated: false } as const, /limit-switch-d4n\.webp/, 4],
    [{ kind: 'SENSOR_3WIRE', technology: 'inductive', output: 'PNP', normallyOpen: true, actuated: false, supplyResistanceOhms: 2400 } as const, /sensor-inductive-e2e\.webp/, 3],
    [{ kind: 'SENSOR_3WIRE', technology: 'capacitive', output: 'PNP', normallyOpen: true, actuated: false, supplyResistanceOhms: 2400 } as const, /sensor-capacitive-e2k\.webp/, 3],
    [{ kind: 'SENSOR_3WIRE', technology: 'photoelectric', output: 'PNP', normallyOpen: true, actuated: false, supplyResistanceOhms: 2400 } as const, /sensor-photoelectric-e3z\.webp/, 3],
    [{ kind: 'LOAD', resistanceOhms: 384, ratedCurrentAmps: 0.19, symbol: 'solenoid_valve' } as const, /solenoid-vxe21\.webp/, 2],
  ])('maps %o to a distinct optional WebP and one anchor per terminal', (spec, expectedFile, terminalCount) => {
    const asset = virtualAssetDefinition(spec)
    const points = new Set(asset.terminals.map((terminal) => `${terminal.x},${terminal.y}`))
    expect(asset.src).toMatch(expectedFile)
    expect(asset.terminals).toHaveLength(terminalCount)
    expect(points.size).toBe(terminalCount)
  })
})

it('gives the motor six winding studs plus a distinct PE frame bond', () => {
  const spec = {
    kind: 'MOTOR_3PH',
    windingResistanceOhms: 23.094,
    ratedCurrentAmps: 10,
  } as const
  const asset = virtualAssetDefinition(spec)
  expect(asset.terminals).toHaveLength(7)
  expect(new Set(asset.terminals.map((terminal) => `${terminal.x},${terminal.y}`)).size).toBe(7)
  expect(terminalCountForSpec(spec)).toBe(7)
})

it.each([
  ['DISCONNECTOR_VCF1', /disconnector-vcf1\.webp/],
  ['MOTOR_BREAKER_GV2ME14', /motor-breaker-gv2me14\.webp/],
] as const)('uses a dedicated verified three-pole body for %s', (modelId, expectedFile) => {
  const component: PlacedComponent = {
    id: 'Q1',
    cell: { x: 0, y: 0 },
    modelId,
    spec: { kind: 'BREAKER_3P', on: false },
  }
  const asset = virtualAssetDefinitionForComponent(component)
  expect(asset.src).toMatch(expectedFile)
  expect(asset.terminals).toHaveLength(6)
  expect(new Set(asset.terminals.map((item) => `${item.x},${item.y}`)).size).toBe(6)
})

it.each([
  ['KEY_SELECTOR_XB5AG21', { kind: 'SWITCH', closed: false } as const, /key-selector-xb5ag21\.webp/, 2],
  ['ILLUMINATED_PB_XB5AW33B5', { kind: 'LIMIT_SWITCH', actuated: false, lampResistanceOhms: 24 / 0.018 } as const, /illuminated-pushbutton-xb5aw33b5\.webp/, 6],
  ['PHASE_MONITOR_RM17TG20', { kind: 'CONTACT_2STATE', actuated: false } as const, /phase-monitor-rm17tg20\.webp/, 9],
  ['AUX_CONTACT_LADN22', { kind: 'CONTACT_2STATE', actuated: false } as const, /aux-contact-ladn22\.webp/, 8],
  ['TIMER_H3CR_A8', { kind: 'TIMER', model: 'OMRON_H3CR_A8', mode: 'A', starDurationMs: 1000, transitionDelayMs: 0 } as const, /timer-h3cr-a8\.webp/, 8],
  ['FLOAT_SWITCH_9037HG33', { kind: 'CONTACT_2STATE', actuated: false } as const, /float-switch-9037hg33\.webp/, 4],
  ['PRESSURE_SWITCH_XMLB004', { kind: 'CONTACT_2STATE', actuated: false } as const, /pressure-switch-xmlb004\.webp/, 4],
  ['THERMOSTAT_NSYCCOTHC', { kind: 'CONTACT_2STATE', actuated: false } as const, /thermostat-nsyccothc\.webp/, 2],
  ['TERMINAL_UT25_BU', { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_BU' } as const, /terminal-ut25-bu\.webp/, 2],
  ['TERMINAL_UT25_PE', { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_PE' } as const, /terminal-ut25-pe\.webp/, 2],
  ['TERMINAL_UT4_HESI', { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT4_HESI', open: false, fuseBlown: false } as const, /terminal-ut4-hesi\.webp/, 2],
  ['TERMINAL_UT4_MT', { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT4_MT', open: false } as const, /terminal-ut4-mt\.webp/, 2],
  ['TERMINAL_UT25_TWIN', { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_TWIN' } as const, /terminal-ut25-twin\.webp/, 3],
  ['TERMINAL_UT25_QUATTRO', { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_QUATTRO' } as const, /terminal-ut25-quattro\.webp/, 4],
  ['TERMINAL_UT25_PE_LL', { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT25_PE_L_L' } as const, /terminal-ut25-pe-ll\.webp/, 6],
] as const)('uses a dedicated source-referenced body and distinct anchors for %s', (modelId, spec, expectedFile, terminalCount) => {
  const component: PlacedComponent = { id: 'X1', cell: { x: 0, y: 0 }, modelId, spec }
  const asset = virtualAssetDefinitionForComponent(component)
  expect(asset.src).toMatch(expectedFile)
  expect(asset.terminals).toHaveLength(terminalCount)
  expect(new Set(asset.terminals.map((item) => `${item.x},${item.y}`)).size).toBe(terminalCount)
})
