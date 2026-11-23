import { describe, expect, it } from 'vitest'
import {
  circuitReducer,
  initialCircuitState,
  solveCircuit,
  terminalCountForComponent,
} from '../../engine/index'
import { CIRCUIT_EXAMPLES } from './exampleCatalog'
import { INDUSTRIAL_CIRCUIT_EXAMPLES } from './industrialBoards'

describe('industrial worked examples', () => {
  it('ships thirteen verified examples and every wire stays inside its terminal contract', () => {
    const publicExamples = CIRCUIT_EXAMPLES.filter((item) => item.key in INDUSTRIAL_CIRCUIT_EXAMPLES)
    expect(publicExamples).toHaveLength(13)
    expect(publicExamples.every((item) => item.verified)).toBe(true)
    for (const [key, build] of Object.entries(INDUSTRIAL_CIRCUIT_EXAMPLES)) {
      const board = build()
      for (const wire of Object.values(board.wires)) {
        for (const terminal of [wire.from, wire.to]) {
          const component = board.components[terminal.componentId]
          expect(component, `${key}/${wire.id}`).toBeDefined()
          expect(terminal.index, `${key}/${wire.id}`).toBeLessThan(terminalCountForComponent(component))
        }
      }
    }
  })

  it.each(['psu-pnp-relay', 'psu-npn-relay'] as const)('%s actuates a relay only after target detection', (key) => {
    const board = INDUSTRIAL_CIRCUIT_EXAMPLES[key]()
    expect(solveCircuit(board).relayEnergized.K1).toBe(false)
    board.components.B1 = { ...board.components.B1, spec: { ...board.components.B1.spec, actuated: true } as never }
    const active = solveCircuit(board)
    expect(active.relayEnergized.K1).toBe(true)
    expect(active.solution.loadCurrent.H1).toBeGreaterThan(0)
  })

  it('START latches and STOP drops the 24 V control relay', () => {
    let state = initialCircuitState(INDUSTRIAL_CIRCUIT_EXAMPLES['trafo-start-stop-relay']())
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: true })
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: false })
    expect(state.relayEnergized.K1).toBe(true)
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'STOP', pressed: true })
    expect(state.relayEnergized.K1).toBe(false)
  })

  it('complete motor feeder resolves through QS, motor breaker, KM and overload', () => {
    const result = solveCircuit(INDUSTRIAL_CIRCUIT_EXAMPLES['motor-feeder-lengkap']())
    expect(result.solution.shorted).toBe(false)
    expect(result.contactorEnergized.KM).toBe(true)
    expect(result.threePhase?.lineCurrent.R).toBeGreaterThan(0)
  })

  it('RM17TG20 shows healthy only with matching L1/L2/L3 and drops to fault on phase loss', () => {
    const healthy = INDUSTRIAL_CIRCUIT_EXAMPLES['phase-monitor-dropout']()
    const healthySolve = solveCircuit(healthy)
    expect(healthySolve.solution.loadCurrent.H_OK).toBeGreaterThan(0)
    expect(healthySolve.solution.loadCurrent.H_FAULT ?? 0).toBe(0)

    const missing = INDUSTRIAL_CIRCUIT_EXAMPLES['phase-monitor-dropout']()
    delete missing.wires.senseL3
    const faultSolve = solveCircuit(missing)
    expect(faultSolve.solution.loadCurrent.H_OK ?? 0).toBe(0)
    expect(faultSolve.solution.loadCurrent.H_FAULT).toBeGreaterThan(0)
  })

  it('the product START/STOP station latches and releases the MY2 relay', () => {
    let state = initialCircuitState(INDUSTRIAL_CIRCUIT_EXAMPLES['product-start-stop-selfhold']())
    expect(state.relayEnergized.K1).toBe(false)
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'START', pressed: true,
    })
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'START', pressed: false,
    })
    expect(state.relayEnergized.K1).toBe(true)
    expect(state.solution.loadCurrent.RUN).toBeGreaterThan(0)
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'STOP', pressed: true,
    })
    expect(state.relayEnergized.K1).toBe(false)
  })

  it('the illuminated pushbutton drives its X1-X2 LED and solenoid only while held', () => {
    let state = initialCircuitState(INDUSTRIAL_CIRCUIT_EXAMPLES['illuminated-pb-solenoid']())
    expect(state.solution.loadCurrent.S1 ?? 0).toBe(0)
    expect(state.solution.loadCurrent.Y1 ?? 0).toBe(0)
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'ACTUATOR', pressed: true,
    })
    expect(state.solution.loadCurrent.S1).toBeCloseTo(0.018, 8)
    expect(state.solution.loadCurrent.Y1).toBeGreaterThan(0)
    state = circuitReducer(state, {
      type: 'PRESS_PRODUCT_CONTROL', id: 'S1', control: 'ACTUATOR', pressed: false,
    })
    expect(state.solution.loadCurrent.S1 ?? 0).toBe(0)
    expect(state.solution.loadCurrent.Y1 ?? 0).toBe(0)
  })

  it('D4N 33-34 closes on actuation and drives the position relay', () => {
    let state = initialCircuitState(INDUSTRIAL_CIRCUIT_EXAMPLES['limit-switch-position-relay']())
    expect(state.relayEnergized.K1).toBe(false)
    state = circuitReducer(state, { type: 'TOGGLE_SWITCH', id: 'B1' })
    expect(state.relayEnergized.K1).toBe(true)
    expect(state.solution.loadCurrent.H1).toBeGreaterThan(0)
  })

  it('H3CR examples change their real output contact with elapsed time', () => {
    let delay = initialCircuitState(INDUSTRIAL_CIRCUIT_EXAMPLES['h3cr-on-delay']())
    delay = circuitReducer(delay, { type: 'SET_RUNNING', running: true })
    delay = circuitReducer(delay, { type: 'TICK', dtMs: 20 })
    delay = circuitReducer(delay, { type: 'TICK', dtMs: 3_000 })
    expect(delay.solution.loadCurrent.H1).toBeGreaterThan(0)

    let flicker = initialCircuitState(INDUSTRIAL_CIRCUIT_EXAMPLES['h3cr-flicker']())
    flicker = circuitReducer(flicker, { type: 'SET_RUNNING', running: true })
    flicker = circuitReducer(flicker, { type: 'TICK', dtMs: 20 })
    const first = flicker.solution.loadCurrent.H1 ?? 0
    flicker = circuitReducer(flicker, { type: 'TICK', dtMs: 1_000 })
    expect(first).toBe(0)
    expect(flicker.solution.loadCurrent.H1).toBeGreaterThan(0)
  })

  it('MAN/OFF/AUTO and thermostat examples open and close the intended path', () => {
    const pump = INDUSTRIAL_CIRCUIT_EXAMPLES['moa-pump-float']()
    expect(solveCircuit(pump).relayEnergized.K1).toBe(false)
    pump.components.SEL = { ...pump.components.SEL, spec: { kind: 'SELECTOR_3POS', pos: 0 } }
    expect(solveCircuit(pump).relayEnergized.K1).toBe(true)

    const heater = INDUSTRIAL_CIRCUIT_EXAMPLES['heater-thermostat']()
    expect(solveCircuit(heater).solution.loadCurrent.EH).toBeGreaterThan(0)
    heater.components.TH = { ...heater.components.TH, spec: { kind: 'CONTACT_2STATE', actuated: true } }
    expect(solveCircuit(heater).solution.loadCurrent.EH ?? 0).toBe(0)
  })
})
