import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  circuitReducer,
  initialCircuitState,
  type Board,
  type BoardProjection,
  type CircuitState,
} from '../../engine/index'
import { CIRCUIT_EXAMPLES } from '../examples/exampleCatalog'
import { areCircuitBoardPropsEqual, CircuitBoard } from './CircuitBoard'
import {
  CELL,
  expandRect,
  projectionComponentBox,
  terminalPoint,
  virtualTerminalPoint,
  type Rect,
} from './geometry'

function example(key: string) {
  const selected = CIRCUIT_EXAMPLES.find((candidate) => candidate.key === key)
  if (!selected) throw new Error(`Missing circuit example: ${key}`)
  return selected.build()
}

function compactStarContactorBoard(): Board {
  return {
    components: {
      M: {
        id: 'M',
        cell: { x: 1, y: 1 },
        spec: { kind: 'MOTOR_3PH', windingResistanceOhms: 20, ratedCurrentAmps: 12 },
      },
      KMY: { id: 'KMY', cell: { x: 5, y: 1 }, spec: { kind: 'CONTACTOR' } },
    },
    wires: {
      y1: { id: 'y1', from: { componentId: 'M', index: 1 }, to: { componentId: 'KMY', index: 2 } },
      y2: { id: 'y2', from: { componentId: 'M', index: 3 }, to: { componentId: 'KMY', index: 4 } },
      y3: { id: 'y3', from: { componentId: 'M', index: 5 }, to: { componentId: 'KMY', index: 6 } },
      ystar1: { id: 'ystar1', from: { componentId: 'KMY', index: 3 }, to: { componentId: 'KMY', index: 5 } },
      ystar2: { id: 'ystar2', from: { componentId: 'KMY', index: 5 }, to: { componentId: 'KMY', index: 7 } },
    },
  }
}

describe('CircuitBoard projection render gate', () => {
  const props = (active: boolean) =>
    ({ active }) as Parameters<typeof areCircuitBoardPropsEqual>[0]

  it('freezes repeated hidden-projection updates but renders every visibility transition', () => {
    expect(areCircuitBoardPropsEqual(props(false), props(false))).toBe(true)
    expect(areCircuitBoardPropsEqual(props(true), props(false))).toBe(false)
    expect(areCircuitBoardPropsEqual(props(false), props(true))).toBe(false)
    expect(areCircuitBoardPropsEqual(props(true), props(true))).toBe(false)
  })
})

describe('CircuitBoard component move routing', () => {
  it.each(['virtual', 'iec'] as const)(
    'keeps the electrical endpoints and reattaches the cable to moved %s terminals',
    (projection) => {
      const board: Board = {
        components: {
          S: {
            id: 'S',
            cell: { x: 1, y: 1 },
            spec: { kind: 'SOURCE', emfVolts: 24, tripAmps: 10 },
          },
          H: {
            id: 'H',
            cell: { x: 5, y: 1 },
            spec: { kind: 'LOAD', resistanceOhms: 24, ratedCurrentAmps: 1 },
          },
        },
        wires: {
          w1: {
            id: 'w1',
            from: { componentId: 'S', index: 0 },
            to: { componentId: 'H', index: 0 },
          },
        },
      }
      const initial = initialCircuitState(board)
      const beforePath = attribute(wireTag(renderBoard(initial, projection), 'w1'), 'd') as string
      const moved = circuitReducer(initial, {
        type: 'MOVE_COMPONENT',
        id: 'H',
        cell: { x: 7, y: 3 },
        projection,
      })
      const afterTag = wireTag(renderBoard(moved, projection), 'w1')
      const afterPath = attribute(afterTag, 'd') as string
      const vertices = routeVertices(afterPath)
      const movedLoad = moved.board.components.H
      const expectedEnd = projection === 'virtual'
        ? virtualTerminalPoint(movedLoad, 0)
        : terminalPoint(movedLoad, 0)

      expect(afterPath).not.toBe(beforePath)
      expect(attribute(afterTag, 'data-from-terminal')).toBe('S:0')
      expect(attribute(afterTag, 'data-to-terminal')).toBe('H:0')
      expect(vertices[vertices.length - 1]).toEqual(expectedEnd)
    },
  )
})

function renderBoard(state: CircuitState, projection: BoardProjection): string {
  const noop = () => undefined
  return renderToStaticMarkup(
    <CircuitBoard
      state={state}
      projection={projection}
      prefersReducedMotion
      placingSpec={null}
      pendingTerminal={null}
      eraseMode={false}
      onPlaceCell={noop}
      onTerminalClick={noop}
      onTapWire={noop}
      onToggleSwitch={noop}
      onPressButton={noop}
      onDeleteComponent={noop}
      onDeleteWire={noop}
      onMoveComponent={noop}
      onReplaceRequest={noop}
      onCancelWiring={noop}
    />,
  )
}

function wireTag(markup: string, wireId: string): string {
  const match = markup.match(
    new RegExp(`<path[^>]*data-wire-id="${wireId}"[^>]*>`),
  )
  if (!match) throw new Error(`Wire ${wireId} was not rendered`)
  return match[0]
}

function attribute(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
}

function routeVertices(path: string): Array<{ x: number; y: number }> {
  return [...path.matchAll(/[ML] (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map(
    (match) => ({ x: Number(match[1]), y: Number(match[2]) }),
  )
}

function pointInside(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.minX &&
    point.x <= rect.maxX &&
    point.y >= rect.minY &&
    point.y <= rect.maxY
  )
}

describe('CircuitBoard semantic STAR routing', () => {
  it.each(['virtual', 'iec'] as const)(
    'renders the floating STAR as a compact trunk and branch on %s',
    (projection) => {
      const board = example('breaker-3f-motor')
      const state = initialCircuitState(board)
      const markup = renderBoard(state, projection)
      const star1 = wireTag(markup, 'star1')
      const star2 = wireTag(markup, 'star2')
      const path1 = attribute(star1, 'd') as string
      const path2 = attribute(star2, 'd') as string
      const starNet = attribute(star1, 'data-net')

      expect(starNet).toBeDefined()
      expect(attribute(star2, 'data-net')).toBe(starNet)
      expect(path1).not.toContain(' A ')
      expect(path2).not.toContain(' A ')
      expect(markup.match(/class="as-lab-board__junction"/g)?.length ?? 0).toBeGreaterThanOrEqual(1)

      const motor = board.components.M3
      const readableLocalArea = expandRect(projectionComponentBox(motor, projection), CELL)
      const vertices = [...routeVertices(path1), ...routeVertices(path2)]
      expect(vertices.length).toBeGreaterThanOrEqual(4)
      expect(vertices.every((point) => pointInside(point, readableLocalArea))).toBe(true)
    },
  )

  it('keeps one physical net number across projections while allowing different geometry', () => {
    const state = initialCircuitState(example('breaker-3f-motor'))
    const virtualTag = wireTag(renderBoard(state, 'virtual'), 'star1')
    const iecTag = wireTag(renderBoard(state, 'iec'), 'star1')

    expect(attribute(virtualTag, 'data-net')).toBe(attribute(iecTag, 'data-net'))
    expect(attribute(virtualTag, 'd')).not.toBe(attribute(iecTag, 'd'))
  })

  it('does not re-route the STAR contactor trunk when its runtime state changes', () => {
    const open = initialCircuitState(compactStarContactorBoard())
    const closed: CircuitState = {
      ...open,
      contactorEnergized: { ...open.contactorEnergized, KMY: true },
    }
    for (const projection of ['virtual', 'iec'] as const) {
      const openMarkup = renderBoard(open, projection)
      const closedMarkup = renderBoard(closed, projection)
      for (const wireId of ['ystar1', 'ystar2']) {
        expect(attribute(wireTag(openMarkup, wireId), 'd')).toBe(
          attribute(wireTag(closedMarkup, wireId), 'd'),
        )
      }
    }
  })
})

describe('CircuitBoard model-specific relay rendering', () => {
  const relayState = (model: 'OMRON_MY4_14PIN' | 'OMRON_G5V2_8PIN') =>
    initialCircuitState({
      components: {
        K1: {
          id: 'K1',
          cell: { x: 3, y: 2 },
          spec: { kind: 'RELAY', model, coilResistanceOhms: 2200, pickupAmps: 0.05 },
        },
      },
      wires: {},
    })

  it('renders all four MY4 changeover poles without collapsing its 14 terminals', () => {
    const virtual = renderBoard(relayState('OMRON_MY4_14PIN'), 'virtual')
    const iec = renderBoard(relayState('OMRON_MY4_14PIN'), 'iec')
    expect(virtual.match(/data-terminal-index="\d+"/g)).toHaveLength(14)
    expect(iec.match(/data-relay-pole="\d+"/g)).toHaveLength(4)
    expect(iec).toContain('data-terminal-key="K1:13"')
    expect(iec).toContain('MY4')
  })

  it('shows G5V-2 manufacturer pin 16 while keeping only eight physical anchors', () => {
    const virtual = renderBoard(relayState('OMRON_G5V2_8PIN'), 'virtual')
    expect(virtual.match(/data-terminal-index="\d+"/g)).toHaveLength(8)
    expect(virtual).toContain('pin 16')
    expect(virtual).toContain('data-terminal-key="K1:7"')
    expect(virtual).not.toContain('data-terminal-key="K1:8"')
  })
})

describe('CircuitBoard breaker and timer state rendering', () => {
  const board = (breakerOn: boolean): Board => ({
    components: {
      QF: {
        id: 'QF',
        cell: { x: 2, y: 2 },
        spec: { kind: 'BREAKER_1P', on: breakerOn, ratedAmps: 10 },
      },
      KT: {
        id: 'KT',
        cell: { x: 5, y: 2 },
        spec: { kind: 'TIMER', model: 'OMRON_H3DT_G', starDurationMs: 65_500, transitionDelayMs: 500 },
      },
    },
    wires: {},
  })

  it('exposes a distinct movable Virtual MCB handle state for ON and OFF', () => {
    const off = renderBoard(initialCircuitState(board(false)), 'virtual')
    const on = renderBoard(initialCircuitState(board(true)), 'virtual')
    expect(off).toContain('class="as-lab-board__virtual-breaker-mechanism" data-breaker-position="off"')
    expect(on).toContain('class="as-lab-board__virtual-breaker-mechanism" data-breaker-position="on"')
  })

  it('draws exactly one IEC moving contact per MCB pole with no retained state line', () => {
    const open = renderBoard(initialCircuitState(board(false)), 'iec')
    const closed = renderBoard(initialCircuitState(board(true)), 'iec')
    expect(open.match(/data-iec-breaker-contact="QF:1"/g)).toHaveLength(1)
    expect(closed.match(/data-iec-breaker-contact="QF:1"/g)).toHaveLength(1)
    expect(open).toContain('data-contact-state="open"')
    expect(closed).toContain('data-contact-state="closed"')
  })

  it('prints the configured timer number on both projections', () => {
    const state = initialCircuitState(board(false))
    const virtual = renderBoard(state, 'virtual')
    const iec = renderBoard(state, 'iec')
    expect(virtual).toContain('data-timer-setting="01:05.5"')
    expect(virtual).toContain('STAR 01:05.5, jeda 0.5 s')
    expect(iec).toContain('data-timer-setting="01:05.5"')
    expect(iec).toContain('01:05.5')
  })

  it('draws the H3DT-G STAR and DELTA changeovers independently', () => {
    const base = initialCircuitState(board(false))
    const star = renderBoard({
      ...base,
      timerRuntime: { KT: { running: true, elapsedMs: 0 } },
    }, 'iec')
    const delta = renderBoard({
      ...base,
      timerRuntime: { KT: { running: true, elapsedMs: 66_000 } },
    }, 'iec')
    expect(star).toMatch(/data-timer-contact="star" data-selected-throw="no"/)
    expect(star).toMatch(/data-timer-contact="delta" data-selected-throw="nc"/)
    expect(delta).toMatch(/data-timer-contact="star" data-selected-throw="nc"/)
    expect(delta).toMatch(/data-timer-contact="delta" data-selected-throw="no"/)
  })

  it('renders a physical MECH link separately from conductors', () => {
    const mechanicalBoard: Board = {
      components: {
        KMY: { id: 'KMY', cell: { x: 2, y: 2 }, spec: { kind: 'CONTACTOR' } },
        KMD: { id: 'KMD', cell: { x: 6, y: 2 }, spec: { kind: 'CONTACTOR' } },
      },
      wires: {},
      mechanicalInterlocks: [{ contactorA: 'KMY', contactorB: 'KMD' }],
    }
    const markup = renderBoard(initialCircuitState(mechanicalBoard), 'iec')
    expect(markup).toContain('data-layer="mechanical-interlocks"')
    expect(markup).toContain('class="as-lab-board__mechanical-interlock"')
    expect(markup).toContain('MECH')
  })
})

describe('CircuitBoard disconnect terminal rendering', () => {
  const state = initialCircuitState({
    components: {
      X1: {
        id: 'X1',
        cell: { x: 2, y: 2 },
        spec: { kind: 'TERMINAL_BLOCK', model: 'PHOENIX_UT4_MT', open: false },
      },
    },
    wires: {},
  })

  it.each(['virtual', 'iec'] as const)('keeps the UT 4-MT disconnect operable on %s', (projection) => {
    const markup = renderBoard(state, projection)
    expect(markup).toContain('role="button"')
    if (projection === 'iec') {
      expect(markup).toContain('aria-label="X-MT tertutup. Klik untuk mengubah."')
    }
  })
})

describe('CircuitBoard Phoenix terminal topology', () => {
  it.each([
    ['TERMINAL_UT25_BU', 'PHOENIX_UT25_BU', 2, 'feed-through'],
    ['TERMINAL_UT25_PE', 'PHOENIX_UT25_PE', 2, 'protective-earth'],
    ['TERMINAL_UT4_HESI', 'PHOENIX_UT4_HESI', 2, 'fuse-disconnect'],
    ['TERMINAL_UT4_MT', 'PHOENIX_UT4_MT', 2, 'knife-disconnect'],
    ['TERMINAL_UT25_TWIN', 'PHOENIX_UT25_TWIN', 3, 'common-potential'],
    ['TERMINAL_UT25_QUATTRO', 'PHOENIX_UT25_QUATTRO', 4, 'common-potential'],
    ['TERMINAL_UT25_PE_LL', 'PHOENIX_UT25_PE_L_L', 6, 'three-level'],
  ] as const)(
    'keeps %s Virtual anchors and IEC topology synchronized',
    (modelId, model, count, symbol) => {
      const state = initialCircuitState({
        components: {
          X1: {
            id: 'X1',
            cell: { x: 3, y: 2 },
            modelId,
            spec: {
              kind: 'TERMINAL_BLOCK',
              model,
              ...(model === 'PHOENIX_UT4_HESI' ? { open: false, fuseBlown: false } : {}),
              ...(model === 'PHOENIX_UT4_MT' ? { open: false } : {}),
            },
          },
        },
        wires: {},
      })
      const virtual = renderBoard(state, 'virtual')
      const iec = renderBoard(state, 'iec')
      expect(virtual.match(/data-terminal-index="\d+"/g)).toHaveLength(count)
      expect(iec).toContain(`data-terminal-symbol="${symbol}"`)
      expect(iec.match(/data-terminal-key="X1:\d+"/g)).toHaveLength(count)
    },
  )
})

describe('CircuitBoard H3CR-A8 product rendering', () => {
  const base = initialCircuitState({
    components: {
      KT8: {
        id: 'KT8',
        cell: { x: 3, y: 2 },
        spec: { kind: 'TIMER', model: 'OMRON_H3CR_A8', mode: 'A', starDurationMs: 5_000, transitionDelayMs: 0 },
      },
    },
    wires: {},
  })

  it('prints the physical 8-pin socket designations instead of star/delta numbers', () => {
    const markup = renderBoard(base, 'iec')
    for (const pin of ['2', '7', '1', '4', '8', '6', '3', '5']) {
      expect(markup).toContain(`data-terminal-designation="${pin}"`)
    }
    expect(markup).toContain('H3CR-A8 pin 2: catu timer')
    expect(markup).not.toContain('common kontak STAR 15')
  })

  it('animates both IEC changeovers together when mode A reaches its setting', () => {
    const before = renderBoard({ ...base, timerRuntime: { KT8: { running: true, elapsedMs: 4_999 } } }, 'iec')
    const after = renderBoard({ ...base, timerRuntime: { KT8: { running: true, elapsedMs: 5_000 } } }, 'iec')
    expect(before).toMatch(/data-timer-contact="contact-1" data-selected-throw="nc"/)
    expect(before).toMatch(/data-timer-contact="contact-2" data-selected-throw="nc"/)
    expect(after).toMatch(/data-timer-contact="contact-1" data-selected-throw="no"/)
    expect(after).toMatch(/data-timer-contact="contact-2" data-selected-throw="no"/)
    expect(after).toContain('data-timer-phase="OUTPUT_ON"')
  })
})


describe('IEC contacts follow the same topology on new and example boards', () => {
  it.each([
    ['AUX_CONTACT_LADN22', ['0-1','2-3','4-5','6-7'], ['open','closed','closed','open']],
    ['FLOAT_SWITCH_9037HG33', ['0-1','2-3'], ['closed','closed']],
    ['PRESSURE_SWITCH_XMLB004', ['0-1','2-3'], ['open','closed']],
    ['THERMOSTAT_NSYCCOTHC', ['0-1'], ['closed']],
  ] as const)('draws every independent contact of %s and reverses on actuation', (modelId, contacts, resting) => {
    const make = (actuated: boolean) => initialCircuitState({components:{Q:{id:'Q',modelId,cell:{x:0,y:0},spec:{kind:'CONTACT_2STATE',actuated}}},wires:{}})
    const before=renderBoard(make(false),'iec'), after=renderBoard(make(true),'iec')
    contacts.forEach((name,i) => {
      expect(before).toContain(`data-iec-contact="${name}" data-contact-state="${resting[i]}"`)
      expect(after).toContain(`data-iec-contact="${name}" data-contact-state="${resting[i]==='closed'?'open':'closed'}"`)
    })
    expect(before).not.toContain('data-iec-changeover')
  })

  it('draws an emergency-stop NC contact opening when latched', () => {
    const make=(pressed:boolean)=>initialCircuitState({components:{S:{id:'S',cell:{x:0,y:0},spec:{kind:'ESTOP',pressed}}},wires:{}})
    expect(renderBoard(make(false),'iec')).toContain('data-iec-contact="emergency-stop-nc" data-contact-state="closed"')
    expect(renderBoard(make(true),'iec')).toContain('data-iec-contact="emergency-stop-nc" data-contact-state="open"')
  })

  it('shows opposite NO/NC states for contactor auxiliary contacts', () => {
    const base=initialCircuitState({components:{K:{id:'K',cell:{x:0,y:0},spec:{kind:'CONTACTOR'}}},wires:{}})
    const off=renderBoard(base,'iec'), on=renderBoard({...base,contactorEnergized:{K:true}},'iec')
    expect(off).toContain('data-iec-contact="aux-no" data-contact-state="open"')
    expect(off).toContain('data-iec-contact="aux-nc" data-contact-state="closed"')
    expect(on).toContain('data-iec-contact="aux-no" data-contact-state="closed"')
    expect(on).toContain('data-iec-contact="aux-nc" data-contact-state="open"')
  })
})
