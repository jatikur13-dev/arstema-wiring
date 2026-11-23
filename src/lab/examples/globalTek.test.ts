import { describe, it, expect } from 'vitest'
import { buildGlobalTek } from './globalTek'
import { circuitReducer, initialCircuitState, buildNodes, terminalKey, terminalCountForComponent, solveCircuit, sub, magnitude } from '../../engine/index'
import { circuitRunRequirements } from '../../engine/runRequirements'
import { createCircuitProject, parseCircuitProject, canonicalCircuitProjectJson } from '../../engine/project'
import { iecLayoutFor, virtualTerminalPoint, collidingComponentPairs } from '../board/geometry'
import { virtualAssetDefinition } from '../board/virtualAssets'

function configured() {
  let state = initialCircuitState(buildGlobalTek('corrected'))
  for (const id of ['SJ1', 'SJ2']) {
    state = circuitReducer(state, { type: 'SET_TIMER_MODE', id, mode: 'A' })
    state = circuitReducer(state, { type: 'SET_TIMER_TIMING', id, starDurationMs: 3000, transitionDelayMs: 0 })
  }
  return state
}
function on() { return circuitReducer(configured(), { type: 'TOGGLE_SWITCH', id: 'POWER' }) }

describe('Global-Tek reconstruction', () => {
  it('records every endpoint and source page; retains the two source interpretations', () => {
    for (const v of ['document', 'corrected'] as const) {
      const board = buildGlobalTek(v)
      for (const wire of Object.values(board.wires)) {
        expect(wire.source?.pages.length).toBeGreaterThan(0)
        for (const pin of [wire.from, wire.to]) expect(pin.index).toBeLessThan(terminalCountForComponent(board.components[pin.componentId]))
      }
      expect(Object.values(board.components).filter((c) => c.spec.kind === 'LOAD' && c.spec.threePhase)).toHaveLength(5)
      const aux = board.components['AUX-41-43'].spec
      expect(aux.kind === 'CONTACT_2STATE' && aux.drivenBy?.id).toBe(v === 'corrected' ? '4KM' : '3KM')
    }
  })
  it('blocks source conflict and requires explicit mode AND timing; retains these through JSON reload', () => {
    const raw = initialCircuitState(buildGlobalTek('document'))
    expect(circuitReducer(raw, { type: 'SET_RUNNING', running: true }).status).not.toBe('RUNNING')
    const s = configured()
    expect(circuitRunRequirements(s.board)).toEqual([])
    expect(parseCircuitProject(JSON.stringify(createCircuitProject(s.board)))?.board).toEqual(s.board)
  })
  it('supplies 110 and 220 V from the connected primary and drops both when POWER opens', () => {
    const s = on()
    const nodes = buildNodes(s.board, s.relayEnergized, s.contactorEnergized)
    const voltage = (a: number, b: number) => magnitude(sub(s.threePhase!.nodeVoltage[nodes.nodeOf.get(terminalKey({componentId:'TR',index:a}))!]!.phasor,
      s.threePhase!.nodeVoltage[nodes.nodeOf.get(terminalKey({componentId:'TR',index:b}))!]!.phasor))
    expect(s.contactorConverged).toBe(true)
    expect(voltage(3, 2)).toBeCloseTo(110, 3)
    expect(voltage(4, 2)).toBeCloseTo(220, 3)
    const off = circuitReducer(s, {type:'TOGGLE_SWITCH',id:'POWER'})
    expect(off.solution.loadCurrent.SV1 ?? 0).toBeCloseTo(0, 8)
    expect(Object.values(off.contactorEnergized).some(Boolean)).toBe(false)
  })
  it('reflects both secondary loads to the primary without bonding secondary zero to PE/N', () => {
    const b=buildGlobalTek('corrected')
    expect(collidingComponentPairs(b,'iec')).toEqual([])
    expect(collidingComponentPairs(b,'virtual')).toEqual([])
    const keep=new Set(['SUPPLY','TR','POWER-LAMP','FAN1'])
    b.components=Object.fromEntries(Object.entries(b.components).filter(([id])=>keep.has(id)))
    b.wires={}
    const join=(id:string,a:string,ai:number,c:string,ci:number)=>{b.wires[id]={id,from:{componentId:a,index:ai},to:{componentId:c,index:ci}}}
    join('P1','SUPPLY',0,'TR',0);join('P2','SUPPLY',1,'TR',1)
    join('L1','TR',3,'POWER-LAMP',0);join('L2','TR',4,'FAN1',0)
    join('Z1','TR',2,'POWER-LAMP',1);join('Z2','TR',2,'FAN1',1)
    const solved=solveCircuit(b).threePhase!
    // 110²/9680 + 220²/2420 = 21.25 W, transformer ideal and lossless.
    expect(solved.lineCurrent.R).toBeCloseTo(21.25/415,7)
    expect(solved.lineCurrent.S).toBeCloseTo(21.25/415,7)
    expect(solved.lineCurrent.T).toBe(0)
    const nodes=buildNodes(b)
    expect(nodes.nodeOf.get('TR:2')).not.toBe(nodes.nodeOf.get('SUPPLY:3'))
    expect(nodes.nodeOf.get('TR:2')).not.toBe(nodes.nodeOf.get('TR:1'))
  })
  it('runs conveyor then wash through START and stops on opening the door', () => {
    let s = on()
    s = circuitReducer(s, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: true })
    expect(s.relayEnergized.J2).toBe(true)
    expect(s.contactorEnergized['5KM']).toBe(true)
    expect(s.contactorEnergized['4KM']).toBe(true)
    s = circuitReducer(s, { type: 'PRESS_PUSHBUTTON', id: 'START', pressed: false })
    expect(s.relayEnergized.J2).toBe(true)
    s = circuitReducer(s, { type: 'TOGGLE_SWITCH', id: 'DOOR' })
    expect(s.relayEnergized.J2).toBe(false)
    expect(s.contactorEnergized['4KM']).toBe(false)
    expect(s.contactorEnergized['5KM']).toBe(false)
    s = circuitReducer(s, { type: 'TOGGLE_SWITCH', id: 'DOOR' })
    expect(s.contactorEnergized['5KM']).toBe(false)
  })
  it('wire deletion changes the result instead of replaying an animation', () => {
    const s = on()
    const b = structuredClone(s.board)
    for (const wire of Object.values(b.wires)) if (wire.to.componentId === 'TR' && wire.to.index === 0) delete b.wires[wire.id]
    const solved = solveCircuit(b)
    expect(solved.solution.loadCurrent.SV1 ?? 0).toBeCloseTo(0, 8)
  })
  it('preserves the page-15 net-9 junction without an invented holding contact', () => {
    const b=buildGlobalTek('document')
    expect(b.components['J1-HOLD']).toBeUndefined()
    const endpoints=Object.values(b.wires).filter(w=>w.source?.number==='9').flatMap(w=>[w.from,w.to]).map(terminalKey)
    for(const pin of ['LEVEL-LOW:1','LEVEL-HIGH:0','J5:0','SJ1:0']) expect(endpoints).toContain(pin)
    expect(b.wires['GT-ALIAS-205-207']).toBeUndefined()
    expect(buildGlobalTek('corrected').wires['GT-ALIAS-205-207'].source?.note).toBeTruthy()
  })
  it('projects all pins distinctly in both views with matching virtual asset contracts', () => {
    const b=buildGlobalTek('corrected')
    for(const c of Object.values(b.components)) {
      const n=terminalCountForComponent(c)
      expect(iecLayoutFor(c).terminals.length, c.id).toBe(n)
      expect(virtualAssetDefinition(c.spec).terminals.length,c.id).toBe(n)
      const points=Array.from({length:n},(_,i)=>virtualTerminalPoint(c,i)).map(p=>`${p.x},${p.y}`)
      expect(new Set(points).size,c.id).toBe(n)
    }
  })
  it('persists edited wiring and independent camera positions with timer configuration', () => {
    const b=configured().board
    delete b.wires['GT-1']
    b.view={zoom:.8,projection:'virtual',cameras:{virtual:{x:123,y:456,insets:{left:1,top:2,right:3,bottom:4}},iec:{x:3,y:5,insets:{left:0,top:0,right:0,bottom:0}}}}
    expect(parseCircuitProject(JSON.stringify(createCircuitProject(b)))?.board).toEqual(b)
  })
  it('camera-only updates do not change the engineering review hash payload', () => {
    const p=createCircuitProject(configured().board)
    const before=canonicalCircuitProjectJson(p)
    p.board.view={zoom:.5,projection:'virtual',sourceOpen:false,cameras:{}}
    expect(canonicalCircuitProjectJson(p)).toBe(before)
  })
  it('rejects malformed optional source/view data instead of crashing on reopen', () => {
    const p=createCircuitProject(configured().board)
    expect(parseCircuitProject({...p,board:{...p.board,reference:{title:'broken'}}})).toBeNull()
    expect(parseCircuitProject({...p,board:{...p.board,view:{zoom:1,projection:'iec',cameras:{iec:{x:0,y:0,insets:null}}}}})).toBeNull()
  })
  it('STOP and conveyor jam release self hold', () => {
    for(const stop of ['STOP','KN']) {
      let s=circuitReducer(on(),{type:'PRESS_PUSHBUTTON',id:'START',pressed:true})
      s=circuitReducer(s,{type:'PRESS_PUSHBUTTON',id:'START',pressed:false})
      s=circuitReducer(s,stop==='STOP'?{type:'PRESS_PUSHBUTTON',id:stop,pressed:true}:{type:'TOGGLE_SWITCH',id:stop})
      expect(s.relayEnergized.J2).toBe(false)
      expect(s.contactorEnergized['4KM']).toBe(false)
      expect(s.contactorEnergized['5KM']).toBe(false)
    }
  })
  it('heater power, thermostat priority and over-temperature follow the actual contacts', () => {
    let s=on()
    for(const id of ['1K','2K','3K']) s=circuitReducer(s,{type:'TOGGLE_SWITCH',id})
    for(const id of ['BOOSTER-A','BOOSTER-B','BOOSTER-C','BOOSTER-D']) {
      const watts=[0,1,2].reduce((sum,i)=>sum+magnitude(s.threePhase!.branchVoltage[`${id}#${i}`])*magnitude(s.threePhase!.branchCurrentPhasor[`${id}#${i}`]),0)
      expect(watts).toBeCloseTo(9000,0)
      expect(s.solution.loadCurrent[id]).toBeGreaterThan(0)
    }
    expect(s.solution.loadCurrent['WASH-HEATER']??0).toBe(0)
    // High-level contact opens fill circuit; rinse thermostat opens booster, allowing tank heat.
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'LEVEL-HIGH'})
    expect(s.solution.loadCurrent.SV1??0).toBeCloseTo(0,8)
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'1TAS'})
    expect(s.contactorEnergized['1KM']).toBe(false)
    expect(s.contactorEnergized['3KM']).toBe(true)
    expect(s.solution.loadCurrent['WASH-HEATER']).toBeGreaterThan(0)
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'3TAS'})
    expect(s.contactorEnergized['3KM']).toBe(false)
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'1TAS'})
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'2TAS'})
    expect(s.contactorEnergized['1KM']).toBe(false)
    expect(s.contactorEnergized['2KM']).toBe(false)
  })
  it('edited 4KM auxiliary contact changes rinse result, and cannot be clicked independently', () => {
    let s=circuitReducer(on(),{type:'TOGGLE_SWITCH',id:'LEVEL-HIGH'})
    s=circuitReducer(s,{type:'PRESS_PUSHBUTTON',id:'START',pressed:true})
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'X2'})
    expect(s.relayEnergized.J4).toBe(true)
    expect(s.solution.loadCurrent.SV2).toBeGreaterThan(0)
    expect(circuitReducer(s,{type:'TOGGLE_SWITCH',id:'AUX-41-43'})).toBe(s)
    const b=structuredClone(s.board)
    let changed=0
    for(const wire of Object.values(b.wires)) for(const pin of [wire.from,wire.to]) {
      if(pin.componentId==='AUX-41-43'&&pin.index===2) {pin.index=1;changed++} // physically change NO to NC
    }
    expect(changed).toBeGreaterThan(0)
    const solved=solveCircuit(b,s.relayEnergized,s.contactorEnergized)
    expect(solved.relayEnergized.J4).toBe(false)
    expect(solved.solution.loadCurrent.SV2??0).toBeCloseTo(0,8)
  })
  it('each overload independently opens its own contactor coil return', () => {
    for(const id of ['FR1','FR2']) {
      let s=circuitReducer(on(),{type:'PRESS_PUSHBUTTON',id:'START',pressed:true})
      s=circuitReducer(s,{type:'SET_RUNNING',running:true})
      s={...s,overloadRuntime:{...s.overloadRuntime,[id]:{thermalLevel:1,tripped:true}}}
      s=circuitReducer(s,{type:'TICK',dtMs:10})
      expect(s.contactorEnergized[id==='FR1'?'5KM':'4KM']).toBe(false)
      if(id==='FR1') expect(s.contactorEnergized['4KM']).toBe(false)
      else expect(s.contactorEnergized['5KM']).toBe(true)
    }
  })
  it('configured timers switch their wired NC contacts at the requested time and reset with power', () => {
    let s=circuitReducer(on(),{type:'PRESS_PUSHBUTTON',id:'START',pressed:true})
    s=circuitReducer(s,{type:'SET_RUNNING',running:true})
    s=circuitReducer(s,{type:'TICK',dtMs:2999})
    expect(s.contactorEnergized['5KM']).toBe(true)
    s=circuitReducer(s,{type:'TICK',dtMs:1})
    expect(s.timerRuntime.SJ2.elapsedMs).toBe(3000)
    expect(s.contactorEnergized['5KM']).toBe(false)
    expect(s.solution.loadCurrent.SV1??0).toBeCloseTo(0,8)
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'POWER'})
    s=circuitReducer(s,{type:'TICK',dtMs:1})
    expect(s.timerRuntime.SJ1.running).toBe(false)
    expect(s.timerRuntime.SJ2.elapsedMs).toBe(0)
  })
})
