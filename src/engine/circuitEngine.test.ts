import { describe, expect, it } from 'vitest'
import type { Board, ComponentSpec, Terminal } from './types'
import { emptyBoard } from './types'
import { buildNodes } from './topology'
import { solveBoard } from './solve'
import { traceCurrentPath } from './flow'
import { classifyWires } from './wiring'
import { solveCircuit } from './solve'
import { bridgedPairs } from './conduction'
import { circuitReducer, initialCircuitState, type CircuitState } from './engine'

// --- builders ---------------------------------------------------------------

const SOURCE: ComponentSpec = { kind: 'SOURCE', emfVolts: 220, tripAmps: 16 }
const LAMP: ComponentSpec = {
  kind: 'LOAD',
  resistanceOhms: 529, // ~0.42 A at 220 V, comfortably under rating
  ratedCurrentAmps: 0.5,
}
const term = (componentId: string, index: number): Terminal => ({ componentId, index })

function wire(id: string, from: Terminal, to: Terminal) {
  return { id, from, to }
}

/** Topic 1a: L → switch → lamp → N. */
function topic1a(switchClosed: boolean): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: SOURCE },
      SW: { id: 'SW', cell: { x: 2, y: 0 }, spec: { kind: 'SWITCH', closed: switchClosed } },
      L1: { id: 'L1', cell: { x: 4, y: 1 }, spec: LAMP },
    },
    wires: {
      w1: wire('w1', term('S', 0), term('SW', 0)), // L → switch
      w2: wire('w2', term('SW', 1), term('L1', 0)), // switch → lamp
      w3: wire('w3', term('L1', 1), term('S', 1)), // lamp → N
    },
  }
}

/** L tied straight to N with no load in the loop → dead short. */
function directShort(): Board {
  return {
    components: { S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE } },
    wires: { w1: wire('w1', term('S', 0), term('S', 1)) },
  }
}

function run(state: CircuitState, dtMs: number, times: number): CircuitState {
  let next = state
  for (let i = 0; i < times; i += 1) next = circuitReducer(next, { type: 'TICK', dtMs })
  return next
}

// --- topology ---------------------------------------------------------------

describe('topology', () => {
  it('merges wired terminals into one electrical node', () => {
    const nodes = buildNodes(topic1a(true))
    // A closed switch shorts its own two terminals, so L, switch, lamp-in are one.
    expect(nodes.nodeOf.get('S:0')).toBe(nodes.nodeOf.get('SW:0'))
    expect(nodes.nodeOf.get('SW:0')).toBe(nodes.nodeOf.get('SW:1'))
    expect(nodes.nodeOf.get('SW:1')).toBe(nodes.nodeOf.get('L1:0'))
  })

  it('keeps an open switch as two separate nodes', () => {
    const nodes = buildNodes(topic1a(false))
    expect(nodes.nodeOf.get('SW:0')).not.toBe(nodes.nodeOf.get('SW:1'))
  })
})

// --- solver (Ohm's law) -----------------------------------------------------

describe('solveBoard', () => {
  it('computes Ohm current for a closed series loop', () => {
    const solution = solveBoard(topic1a(true))
    expect(solution.energised).toBe(true)
    expect(solution.shorted).toBe(false)
    expect(solution.loadCurrent.L1).toBeCloseTo(220 / 529, 4)
    expect(solution.sourceCurrent).toBeCloseTo(220 / 529, 4)
  })

  it('carries no current when the switch is open', () => {
    const solution = solveBoard(topic1a(false))
    expect(solution.energised).toBe(false)
    expect(solution.loadCurrent.L1 ?? 0).toBeCloseTo(0, 6)
  })

  it('solves parallel loads by superposed conductance', () => {
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: { kind: 'SOURCE', emfVolts: 100, tripAmps: 50 } },
        A: { id: 'A', cell: { x: 1, y: 0 }, spec: { kind: 'LOAD', resistanceOhms: 100, ratedCurrentAmps: 5 } },
        B: { id: 'B', cell: { x: 1, y: 1 }, spec: { kind: 'LOAD', resistanceOhms: 100, ratedCurrentAmps: 5 } },
      },
      wires: {
        a1: wire('a1', term('S', 0), term('A', 0)),
        a2: wire('a2', term('A', 1), term('S', 1)),
        b1: wire('b1', term('S', 0), term('B', 0)),
        b2: wire('b2', term('B', 1), term('S', 1)),
      },
    }
    const solution = solveBoard(board)
    expect(solution.loadCurrent.A).toBeCloseTo(1, 4)
    expect(solution.loadCurrent.B).toBeCloseTo(1, 4)
    expect(solution.sourceCurrent).toBeCloseTo(2, 4) // parallel currents sum
  })

  it('flags a direct L–N short with no load', () => {
    const solution = solveBoard(directShort())
    expect(solution.shorted).toBe(true)
    expect(solution.energised).toBe(true)
  })

  it('reports no source as an inert board', () => {
    const solution = solveBoard(emptyBoard())
    expect(solution.hasSource).toBe(false)
    expect(solution.energised).toBe(false)
  })
})

// --- M1: series / parallel --------------------------------------------------

const MOTOR: ComponentSpec = {
  kind: 'MOTOR',
  runResistanceOhms: 220, // 1.0 A running
  lockedResistanceOhms: 88, // 2.5 A locked-rotor (humming)
  ratedCurrentAmps: 4,
}
const CAP: ComponentSpec = { kind: 'CAPACITOR' }

describe('series and parallel lamps (M1)', () => {
  it('series: same (smaller) current through both lamps → both dimmer', () => {
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
        L1: { id: 'L1', cell: { x: 1, y: 0 }, spec: LAMP },
        L2: { id: 'L2', cell: { x: 2, y: 0 }, spec: LAMP },
      },
      wires: {
        w1: wire('w1', term('S', 0), term('L1', 0)),
        w2: wire('w2', term('L1', 1), term('L2', 0)),
        w3: wire('w3', term('L2', 1), term('S', 1)),
      },
    }
    const solution = solveBoard(board)
    const seriesCurrent = 220 / (529 + 529)
    expect(solution.loadCurrent.L1).toBeCloseTo(seriesCurrent, 4)
    expect(solution.loadCurrent.L2).toBeCloseTo(seriesCurrent, 4)
    // Series current is smaller than one lamp alone (220/529).
    expect(solution.sourceCurrent).toBeLessThan(220 / 529)
  })

  it('parallel: each lamp full current → both bright, source draws the sum', () => {
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
        L1: { id: 'L1', cell: { x: 1, y: 0 }, spec: LAMP },
        L2: { id: 'L2', cell: { x: 1, y: 1 }, spec: LAMP },
      },
      wires: {
        a1: wire('a1', term('S', 0), term('L1', 0)),
        a2: wire('a2', term('L1', 1), term('S', 1)),
        b1: wire('b1', term('S', 0), term('L2', 0)),
        b2: wire('b2', term('L2', 1), term('S', 1)),
      },
    }
    const solution = solveBoard(board)
    expect(solution.loadCurrent.L1).toBeCloseTo(220 / 529, 4)
    expect(solution.loadCurrent.L2).toBeCloseTo(220 / 529, 4)
    expect(solution.sourceCurrent).toBeCloseTo((220 / 529) * 2, 4)
  })
})

// --- M1: motor + capacitor --------------------------------------------------

/** Motor main winding across L–N; aux and any capacitor wired per `wires`. */
function motorBoard(withCapacitor: boolean): Board {
  const components: Board['components'] = {
    S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
    M: { id: 'M', cell: { x: 2, y: 0 }, spec: MOTOR },
  }
  const wires: Board['wires'] = {
    w1: wire('w1', term('S', 0), term('M', 0)), // L → main_a
    w2: wire('w2', term('M', 1), term('S', 1)), // main_b → N
  }
  if (withCapacitor) {
    components.C = { id: 'C', cell: { x: 2, y: 2 }, spec: CAP }
    wires.w3 = wire('w3', term('M', 2), term('C', 0)) // aux → cap
    wires.w4 = wire('w4', term('C', 1), term('M', 0)) // cap → main_a (L side)
  }
  return { components, wires }
}

describe('1-phase motor + capacitor (M1)', () => {
  it('without a capacitor: hums (high locked-rotor current), does NOT run or explode', () => {
    const solution = solveBoard(motorBoard(false))
    expect(solution.motorRunning.M).toBe(false)
    expect(solution.motorStatus.M).toBe('HUMMING')
    expect(solution.loadCurrent.M).toBeCloseTo(220 / 88, 3) // 2.5 A locked-rotor
    expect(solution.shorted).toBe(false)
  })

  it('with the capacitor across aux↔main: runs at rated current', () => {
    const solution = solveBoard(motorBoard(true))
    expect(solution.motorRunning.M).toBe(true)
    expect(solution.motorStatus.M).toBe('RUNNING')
    expect(solution.loadCurrent.M).toBeCloseTo(220 / 220, 3) // 1.0 A running
  })

  it('a humming motor draws MORE current than a running one', () => {
    expect(solveBoard(motorBoard(false)).loadCurrent.M).toBeGreaterThan(
      solveBoard(motorBoard(true)).loadCurrent.M,
    )
  })
})

// --- M2: relay control ------------------------------------------------------

const RELAY: ComponentSpec = { kind: 'RELAY', coilResistanceOhms: 2200, pickupAmps: 0.05 }

describe('relay contacts + fixpoint (M2)', () => {
  it('NO closes and NC opens when energized', () => {
    const relay = { id: 'K', cell: { x: 0, y: 0 }, spec: RELAY }
    expect(bridgedPairs(relay, { K: true })).toEqual([[2, 3]])
    expect(bridgedPairs(relay, { K: false })).toEqual([[4, 5]])
  })

  it('the coil energizes the relay only while the button conducts', () => {
    const coilBoard = (pressed: boolean): Board => ({
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
        PB: { id: 'PB', cell: { x: 1, y: 0 }, spec: { kind: 'PUSHBUTTON', pressed, normallyOpen: true } },
        K: { id: 'K', cell: { x: 2, y: 0 }, spec: RELAY },
      },
      wires: {
        w1: wire('w1', term('S', 0), term('PB', 0)),
        w2: wire('w2', term('PB', 1), term('K', 0)),
        w3: wire('w3', term('K', 1), term('S', 1)),
      },
    })
    expect(solveCircuit(coilBoard(false)).relayEnergized.K).toBe(false)
    expect(solveCircuit(coilBoard(true)).relayEnergized.K).toBe(true)
  })

  it('self-holds: a momentary START latches the relay; STOP drops it', () => {
    // L → STOP(NC) → [START(NO) ∥ relay NO] → coil → N
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
        STOP: { id: 'STOP', cell: { x: 1, y: 0 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: false } },
        START: { id: 'START', cell: { x: 2, y: 0 }, spec: { kind: 'PUSHBUTTON', pressed: false, normallyOpen: true } },
        K: { id: 'K', cell: { x: 3, y: 0 }, spec: RELAY },
      },
      wires: {
        w1: wire('w1', term('S', 0), term('STOP', 0)),
        w2: wire('w2', term('STOP', 1), term('START', 0)),
        w3: wire('w3', term('STOP', 1), term('K', 2)), // NO_a from node A
        w4: wire('w4', term('START', 1), term('K', 0)), // START → coil_a
        w5: wire('w5', term('K', 3), term('K', 0)), // NO_b → coil_a (latch)
        w6: wire('w6', term('K', 1), term('S', 1)), // coil_b → N
      },
    }
    let state = initialCircuitState(board)
    expect(state.relayEnergized.K ?? false).toBe(false)

    // Momentary START → relay picks up.
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: true })
    expect(state.relayEnergized.K).toBe(true)
    // Release START → the relay's own NO contact keeps the coil fed: LATCHED.
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: false })
    expect(state.relayEnergized.K).toBe(true)

    // STOP breaks the coil → relay drops and stays off after release.
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'STOP', pressed: true })
    expect(state.relayEnergized.K).toBe(false)
    state = circuitReducer(state, { type: 'PRESS_PUSHBUTTON', id: 'STOP', pressed: false })
    expect(state.relayEnergized.K).toBe(false)
  })
})

// --- undo / redo / replace (M0 UX) ------------------------------------------

describe('undo / redo', () => {
  it('undo removes a placed component; redo restores it', () => {
    let state = initialCircuitState()
    state = circuitReducer(state, { type: 'PLACE_COMPONENT', id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE })
    expect(state.board.components.S).toBeTruthy()
    expect(state.undoStack).toHaveLength(1)

    state = circuitReducer(state, { type: 'UNDO' })
    expect(state.board.components.S).toBeUndefined()
    expect(state.redoStack).toHaveLength(1)

    state = circuitReducer(state, { type: 'REDO' })
    expect(state.board.components.S).toBeTruthy()
  })

  it('undo restores a disconnected wire and a moved component', () => {
    let state = initialCircuitState(topic1a(true))
    state = circuitReducer(state, { type: 'DISCONNECT', id: 'w2' })
    expect(state.board.wires.w2).toBeUndefined()
    state = circuitReducer(state, { type: 'UNDO' })
    expect(state.board.wires.w2).toBeTruthy()

    state = circuitReducer(state, { type: 'MOVE_COMPONENT', id: 'L1', cell: { x: 5, y: 5 } })
    expect(state.board.components.L1.cell).toEqual({ x: 5, y: 5 })
    state = circuitReducer(state, { type: 'UNDO' })
    expect(state.board.components.L1.cell).toEqual({ x: 4, y: 1 })
  })

  it('runtime actions do NOT enter the undo history', () => {
    let state = initialCircuitState(topic1a(true))
    const before = state.undoStack.length
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = circuitReducer(state, { type: 'TICK', dtMs: 20 })
    state = circuitReducer(state, { type: 'SET_RUNNING', running: false })
    state = circuitReducer(state, { type: 'TOGGLE_SWITCH', id: 'SW' })
    expect(state.undoStack.length).toBe(before)
  })
})

describe('REPLACE_COMPONENT', () => {
  it('swaps the occupant for the dragged component in ONE undo step, keeping compatible wires', () => {
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
        L1: { id: 'L1', cell: { x: 2, y: 0 }, spec: LAMP },
        L2: { id: 'L2', cell: { x: 4, y: 0 }, spec: LAMP },
      },
      wires: {
        w1: wire('w1', term('S', 0), term('L1', 0)),
        w2: wire('w2', term('L1', 1), term('S', 1)),
      },
    }
    let state = initialCircuitState(board)
    state = circuitReducer(state, {
      type: 'REPLACE_COMPONENT',
      draggedId: 'L2',
      occupantId: 'L1',
      cell: { x: 2, y: 0 },
    })
    // Occupant gone, dragged took its place.
    expect(state.board.components.L1).toBeUndefined()
    expect(state.board.components.L2.cell).toEqual({ x: 2, y: 0 })
    // Compatible wires (a lamp has terminals 0 and 1) re-pointed to the new lamp.
    expect(state.board.wires.w1.to).toEqual({ componentId: 'L2', index: 0 })
    expect(state.board.wires.w2.from).toEqual({ componentId: 'L2', index: 1 })
    expect(state.undoStack).toHaveLength(1)

    // Undo brings the old component AND its wires back in a single step.
    state = circuitReducer(state, { type: 'UNDO' })
    expect(state.board.components.L1).toBeTruthy()
    expect(state.board.wires.w1.to).toEqual({ componentId: 'L1', index: 0 })
  })
})

// --- flow tracing -----------------------------------------------------------

describe('traceCurrentPath', () => {
  it('marks the loop wires as carrying current when energised', () => {
    const trace = traceCurrentPath(topic1a(true), true)
    expect(trace.w1.onPath).toBe(true)
    expect(trace.w2.onPath).toBe(true)
    expect(trace.w3.onPath).toBe(true)
    // w1 is stored S.L → SW, which is the direction current flows.
    expect(trace.w1.direction).toBe(1)
  })

  it('reports no flow when the circuit is not energised', () => {
    const trace = traceCurrentPath(topic1a(false), false)
    expect(trace.w1.onPath).toBe(false)
    expect(trace.w1.direction).toBe(0)
  })

  it('lights EVERY loop wire on parallel branches, not just a spanning tree', () => {
    // Two lamps straight across L–N. The two neutral returns (a2, b2) are a
    // parallel pair: a plain reachability walk would tree-cover one and leave the
    // other dark. Both must carry current.
    const parallel: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 1 }, spec: SOURCE },
        L1: { id: 'L1', cell: { x: 3, y: 0 }, spec: LAMP },
        L2: { id: 'L2', cell: { x: 3, y: 2 }, spec: LAMP },
      },
      wires: {
        a1: wire('a1', term('S', 0), term('L1', 0)),
        a2: wire('a2', term('L1', 1), term('S', 1)),
        b1: wire('b1', term('S', 0), term('L2', 0)),
        b2: wire('b2', term('L2', 1), term('S', 1)),
      },
    }
    const trace = traceCurrentPath(parallel, true)
    expect(trace.a1.onPath).toBe(true)
    expect(trace.a2.onPath).toBe(true)
    expect(trace.b1.onPath).toBe(true)
    expect(trace.b2.onPath).toBe(true) // the branch a spanning tree used to drop
  })

  it('lights a wire that taps an existing node (a branch), but not a dead stub', () => {
    // topic1a plus a SECOND lamp tapped onto the live node (branch b1→b2 back to
    // N) and a spare wire stub to a dangling terminal that carries nothing.
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 1 }, spec: SOURCE },
        SW: { id: 'SW', cell: { x: 2, y: 1 }, spec: { kind: 'SWITCH', closed: true } },
        L1: { id: 'L1', cell: { x: 4, y: 1 }, spec: LAMP },
        L2: { id: 'L2', cell: { x: 4, y: 3 }, spec: LAMP },
        L3: { id: 'L3', cell: { x: 6, y: 3 }, spec: LAMP }, // dead-ended
      },
      wires: {
        w1: wire('w1', term('S', 0), term('SW', 0)),
        w2: wire('w2', term('SW', 1), term('L1', 0)),
        w3: wire('w3', term('L1', 1), term('S', 1)),
        // Tap: branch off the L node (SW.out) to a second lamp and back to N.
        b1: wire('b1', term('SW', 1), term('L2', 0)),
        b2: wire('b2', term('L2', 1), term('S', 1)),
        // Stub: L node to a lamp whose other terminal goes nowhere → no loop.
        s1: wire('s1', term('SW', 1), term('L3', 0)),
      },
    }
    const trace = traceCurrentPath(board, true)
    expect(trace.b1.onPath).toBe(true)
    expect(trace.b2.onPath).toBe(true)
    expect(trace.s1.onPath).toBe(false) // dead stub carries no current
  })
})

// --- wire colour by node potential (SNI, solver-driven) ---------------------

describe('classifyWires', () => {
  it('colours by the source L/N nodes, not by which terminal was touched', () => {
    const closed = classifyWires(topic1a(true))
    // Switch closed: the whole pre-load side is the L node.
    expect(closed.w1).toBe('LIVE')
    expect(closed.w2).toBe('LIVE')
    expect(closed.w3).toBe('NEUTRAL')
  })

  it('re-colours when the topology changes (switch opened)', () => {
    const open = classifyWires(topic1a(false))
    expect(open.w1).toBe('LIVE') // still tied to L
    expect(open.w2).toBe('AMBIGUOUS') // now stranded past the open switch
    expect(open.w3).toBe('NEUTRAL')
  })

  it('stops the flood at a load: the two sides of a lamp are opposite classes', () => {
    // L → lamp → N, no switch. The flood cannot cross the lamp, so the wire into
    // it is LIVE and the wire out of it is NEUTRAL — the load splits the sides.
    const board: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
        L1: { id: 'L1', cell: { x: 2, y: 0 }, spec: LAMP },
      },
      wires: {
        wa: wire('wa', term('S', 0), term('L1', 0)), // L → lamp
        wb: wire('wb', term('L1', 1), term('S', 1)), // lamp → N
      },
    }
    const cls = classifyWires(board)
    expect(cls.wa).toBe('LIVE')
    expect(cls.wb).toBe('NEUTRAL')
  })

  it('marks every wire ambiguous when there is no source', () => {
    const board: Board = {
      components: { A: { id: 'A', cell: { x: 0, y: 0 }, spec: LAMP } },
      wires: { w: wire('w', term('A', 0), term('A', 1)) },
    }
    expect(classifyWires(board).w).toBe('AMBIGUOUS')
  })
})

// --- engine reduce + tick ---------------------------------------------------

describe('circuit engine', () => {
  it('places components and connects wires onto the board', () => {
    let state = initialCircuitState()
    state = circuitReducer(state, {
      type: 'PLACE_COMPONENT',
      id: 'S',
      cell: { x: 0, y: 0 },
      spec: SOURCE,
    })
    state = circuitReducer(state, {
      type: 'PLACE_COMPONENT',
      id: 'L1',
      cell: { x: 2, y: 0 },
      spec: LAMP,
    })
    state = circuitReducer(state, {
      type: 'CONNECT',
      id: 'w1',
      from: term('S', 0),
      to: term('L1', 0),
    })
    expect(Object.keys(state.board.components)).toEqual(['S', 'L1'])
    expect(Object.keys(state.board.wires)).toEqual(['w1'])
  })

  it('removing a component also drops every wire attached to it', () => {
    let state = initialCircuitState(topic1a(true))
    expect(Object.keys(state.board.wires).sort()).toEqual(['w1', 'w2', 'w3'])
    // Remove the switch → w1 (S→SW) and w2 (SW→L1) must go; w3 (L1→N) stays.
    state = circuitReducer(state, { type: 'REMOVE_COMPONENT', id: 'SW' })
    expect(Object.keys(state.board.components).sort()).toEqual(['L1', 'S'])
    expect(Object.keys(state.board.wires)).toEqual(['w3'])
  })

  it('moving a component keeps the topology and the solution intact', () => {
    const before = initialCircuitState(topic1a(true))
    const beforeCurrent = solveBoard(before.board).sourceCurrent
    const state = circuitReducer(before, {
      type: 'MOVE_COMPONENT',
      id: 'L1',
      cell: { x: 5, y: 3 },
    })
    // Position changed…
    expect(state.board.components.L1.cell).toEqual({ x: 5, y: 3 })
    // …but the wires and the electrical result did not.
    expect(Object.keys(state.board.wires).sort()).toEqual(['w1', 'w2', 'w3'])
    expect(solveBoard(state.board).sourceCurrent).toBeCloseTo(beforeCurrent, 6)
  })

  it('disconnecting one wire leaves the other components and wires intact', () => {
    let state = initialCircuitState(topic1a(true))
    state = circuitReducer(state, { type: 'DISCONNECT', id: 'w2' })
    expect(Object.keys(state.board.components).sort()).toEqual(['L1', 'S', 'SW'])
    expect(Object.keys(state.board.wires).sort()).toEqual(['w1', 'w3'])
    // The loop is broken, so nothing conducts.
    expect(solveBoard(state.board).energised).toBe(false)
  })

  it('lights the lamp (ramped current rises) when the switch is closed and running', () => {
    let state = initialCircuitState(topic1a(true))
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    expect(state.status).toBe('RUNNING')
    state = run(state, 32, 8)
    expect(state.status).toBe('RUNNING') // under rating → no trip
    expect(state.display.loadCurrent.L1).toBeGreaterThan(0.3)
  })

  it('darkens the lamp when the switch is toggled off mid-run', () => {
    let state = initialCircuitState(topic1a(true))
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = run(state, 32, 8)
    expect(state.display.loadCurrent.L1).toBeGreaterThan(0.3)
    state = circuitReducer(state, { type: 'TOGGLE_SWITCH', id: 'SW' })
    expect(state.status).toBe('RUNNING') // a toggle does not stop the run
    state = run(state, 32, 12)
    expect(state.display.loadCurrent.L1).toBeCloseTo(0, 2)
  })

  it('shows the current climb, THEN trips on a dead short', () => {
    let state = initialCircuitState(directShort())
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })

    // First tick: current is rising but has NOT yet crossed the trip point.
    state = circuitReducer(state, { type: 'TICK', dtMs: 16 })
    expect(state.status).toBe('RUNNING')
    expect(state.display.sourceCurrent).toBeGreaterThan(0)
    expect(state.display.sourceCurrent).toBeLessThan(16)

    // A few ticks later it crosses 16 A and the source protection trips.
    state = run(state, 16, 4)
    expect(state.status).toBe('FAULTED')
    expect(state.fault?.code).toBe('SHORT_CIRCUIT_NO_LOAD')
    expect(state.fault?.measured.currentAmps).toBeGreaterThanOrEqual(16)
    expect(state.fault?.measured.limitAmps).toBe(16)
  })

  it('freezes when paused and clears on reset', () => {
    let state = initialCircuitState(topic1a(true))
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = run(state, 32, 4)
    const runningReading = state.display.loadCurrent.L1
    state = circuitReducer(state, { type: 'SET_RUNNING', running: false })
    expect(state.status).toBe('PAUSED')
    const frozen = run(state, 32, 4) // ticks are ignored while paused
    expect(frozen.display.loadCurrent.L1).toBe(runningReading)

    const reset = circuitReducer(frozen, { type: 'RESET' })
    expect(reset.status).toBe('IDLE')
    expect(reset.display.loadCurrent.L1).toBe(0)
    expect(reset.timeMs).toBe(0)
  })

  it('does not run a faulted circuit until reset', () => {
    let state = initialCircuitState(directShort())
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    state = run(state, 16, 6)
    expect(state.status).toBe('FAULTED')
    // SET_RUNNING is refused while faulted.
    state = circuitReducer(state, { type: 'SET_RUNNING', running: true })
    expect(state.status).toBe('FAULTED')
    state = circuitReducer(state, { type: 'RESET' })
    expect(state.status).toBe('IDLE')
    expect(state.fault).toBeNull()
  })
})

/** Two lamps in parallel where L2 reaches the circuit ONLY through mid-span taps
 *  onto L1's live and neutral rails. Each tap wire's `tap` is a render-only hint;
 *  electrically it is still from↔to (its `to` is a terminal of the tapped rail —
 *  the same node), so the solver needs no special case. */
function parallelTappedBoard(): Board {
  return {
    components: {
      S: { id: 'S', cell: { x: 0, y: 1 }, spec: SOURCE },
      L1: { id: 'L1', cell: { x: 3, y: 0 }, spec: LAMP },
      L2: { id: 'L2', cell: { x: 3, y: 2 }, spec: LAMP },
    },
    wires: {
      a1: wire('a1', term('S', 0), term('L1', 0)), // live rail
      a2: wire('a2', term('L1', 1), term('S', 1)), // neutral rail
      t1: { ...wire('t1', term('L2', 0), term('S', 0)), tap: { wireId: 'a1', near: { x: 120, y: 40 } } },
      t2: { ...wire('t2', term('L2', 1), term('S', 1)), tap: { wireId: 'a2', near: { x: 120, y: 120 } } },
    },
  }
}

describe('mid-span wire tap (M0 bug fix) — model / union', () => {
  it('a load joined ONLY by taps is energised: the tap unions its node', () => {
    const solution = solveBoard(parallelTappedBoard())
    expect(solution.energised).toBe(true)
    // Both lamps draw full current — L2 is in the circuit purely through its taps.
    expect(solution.loadCurrent.L1).toBeCloseTo(220 / 529, 4)
    expect(solution.loadCurrent.L2).toBeCloseTo(220 / 529, 4)
  })

  it('buildNodes ignores `tap` — the union comes from from/to (same node as the rail)', () => {
    const nodes = buildNodes(parallelTappedBoard())
    expect(nodes.nodeOf.get('L2:0')).toBe(nodes.nodeOf.get('S:0')) // live node
    expect(nodes.nodeOf.get('L2:1')).toBe(nodes.nodeOf.get('S:1')) // neutral node
  })

  it('CONNECT carrying a tap is ONE undoable step; UNDO/REDO restore it whole', () => {
    const seed: Board = {
      components: {
        S: { id: 'S', cell: { x: 0, y: 0 }, spec: SOURCE },
        L1: { id: 'L1', cell: { x: 3, y: 0 }, spec: LAMP },
      },
      wires: { a1: wire('a1', term('S', 0), term('L1', 0)) },
    }
    let state = initialCircuitState(seed)
    expect(Object.keys(state.board.wires)).toHaveLength(1)

    const tap = { wireId: 'a1', near: { x: 11, y: 22 } }
    state = circuitReducer(state, {
      type: 'CONNECT',
      id: 'w2',
      from: term('L1', 1),
      to: term('S', 1),
      tap,
    })
    expect(state.board.wires.w2.tap).toEqual(tap)
    expect(Object.keys(state.board.wires)).toHaveLength(2)

    const undone = circuitReducer(state, { type: 'UNDO' })
    expect(undone.board.wires.w2).toBeUndefined() // one step removed the whole tap
    expect(Object.keys(undone.board.wires)).toHaveLength(1)

    const redone = circuitReducer(undone, { type: 'REDO' })
    expect(redone.board.wires.w2?.tap).toEqual(tap) // and one step restores it
  })

  it('an ordinary terminal→terminal CONNECT stores no tap (unchanged)', () => {
    let state = initialCircuitState()
    state = circuitReducer(state, { type: 'CONNECT', id: 'w1', from: term('S', 0), to: term('S', 1) })
    expect(state.board.wires.w1.tap).toBeUndefined()
  })
})


