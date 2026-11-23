import { describe, expect, it } from 'vitest'
import type { Board } from './types'
import { solveCircuit } from './solve'
import { traceCurrentPath } from './flow'
import { initialCircuitState } from './engine'
import { wirePresentation } from './wirePresentation'
const terminal=(componentId:string,index:number)=>({componentId,index})
function board(volts=230):Board {
  const wire=(id:string,a:string,ai:number,b:string,bi:number)=>({id,from:terminal(a,ai),to:terminal(b,bi)})
  return {components:{
    S:{id:'S',cell:{x:0,y:0},spec:{kind:'SOURCE',emfVolts:volts,tripAmps:16}},
    K:{id:'K',cell:{x:1,y:0},spec:{kind:'CONTACTOR',ratedCoilVolts:230}},
    L:{id:'L',cell:{x:2,y:0},spec:{kind:'LOAD',resistanceOhms:1000,ratedCurrentAmps:10}},
  },wires:Object.fromEntries([wire('a','S',0,'K',0),wire('b','K',1,'S',1),wire('c','S',0,'K',2),wire('d','K',3,'L',0),wire('e','L',1,'S',1)].map(w=>[w.id,w]))}
}
describe('single-source voltage-driven contactor',()=>{
  it('picks up and solves the switched load and conducting trace together',()=>{
    const b=board(),r=solveCircuit(b)
    expect(r.contactorConverged).toBe(true);expect(r.contactorEnergized.K).toBe(true)
    expect(r.coilVoltage.K).toBeCloseTo(230);expect(r.solution.loadCurrent.L).toBeCloseTo(.23)
    expect(traceCurrentPath(b,true,r.relayEnergized,r.contactorEnergized).d.onPath).toBe(true)
  })
  it('uses voltage hysteresis and drops an unpowered coil',()=>{
    expect(solveCircuit(board(150)).contactorEnergized.K).toBe(false)
    expect(solveCircuit(board(150),{},{K:true}).contactorEnergized.K).toBe(true)
    expect(solveCircuit(board(80),{},{K:true}).contactorEnergized.K).toBe(false)
    const b=board();delete b.wires.b
    expect(solveCircuit(b,{},{K:true}).contactorEnergized.K).toBe(false)
    expect(solveCircuit(b).solution.loadCurrent.L??0).toBe(0)
  })
  it('preserves the legacy domain and produces identical explicit DC results',()=>{
    const b=board();expect(solveCircuit(b)).toEqual(solveCircuit({...b,domain:'dc-resistive'}));expect(b.domain).toBeUndefined()
  })
  it('settles a relay feeding the contactor coil within the same solve',()=>{
    const b=board();b.components.R={id:'R',cell:{x:0,y:1},spec:{kind:'RELAY',coilResistanceOhms:2300,pickupAmps:.05}}
    b.wires.a.from=terminal('R',3)
    for(const [id,from,to] of [['r1',terminal('S',0),terminal('R',0)],['r2',terminal('R',1),terminal('S',1)],['r3',terminal('S',0),terminal('R',2)]] as const)b.wires[id]={id,from,to}
    const r=solveCircuit(b);expect(r.relayEnergized.R).toBe(true);expect(r.contactorEnergized.K).toBe(true);expect(r.solution.loadCurrent.L).toBeCloseTo(.23);expect(r.contactorConverged).toBe(true)
  })
  it('distinguishes AC tracing from conventional DC direction without changing the domain',()=>{
    const b=board();const ac=wirePresentation(initialCircuitState(b));expect(ac.a.signal).toBe('ac-trace');expect(ac.a.direction).toBe(0)
    if(b.components.S.spec.kind==='SOURCE')b.components.S.spec.sourceType='battery_dc'
    const dc=wirePresentation(initialCircuitState(b));expect(dc.a.signal).toBe('dc-direction');expect(dc.a.direction).not.toBe(0);expect(dc.d.flowing).toBe(true);expect(b.domain).toBeUndefined()
  })
})
