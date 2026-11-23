import { describe,it,expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { assemblyStages, boardExploded, componentStage, normalizeBoard3DView, panelPlacement } from '../../engine/board3d'
import { circuitReducer,initialCircuitState } from '../../engine/engine'
import { createCircuitProject, parseCircuitProject, canonicalCircuitProjectJson } from '../../engine/project'
import type { Board } from '../../engine/types'
import { MOTOR_SPEC,RELAY_SPEC,PALETTE } from '../scenario/topic1a'
import { buildGlobalTek } from '../examples/globalTek'
import { measuredReadout,operatingVisuals,terminalLabels,terminalPoint } from './presentation'
import index from './assetIndex.json'

export function demoBoard():Board {
  const board:Board={components:{
    S:{id:'S',modelId:'SOURCE',cell:{x:0,y:0},spec:{kind:'SOURCE',emfVolts:220,tripAmps:100}},
    SW:{id:'SW',modelId:'SWITCH',cell:{x:2,y:0},spec:{kind:'SWITCH',closed:false}},
    L:{id:'L',modelId:'LOAD',cell:{x:4,y:0},spec:{kind:'LOAD',resistanceOhms:500,ratedCurrentAmps:5}},
    M:{id:'M',modelId:'MOTOR',cell:{x:4,y:2},spec:{...MOTOR_SPEC}},
    C:{id:'C',modelId:'CAPACITOR',cell:{x:2,y:2},spec:{kind:'CAPACITOR'}},
    K:{id:'K',modelId:'RELAY',cell:{x:0,y:2},spec:{...RELAY_SPEC}},
  },wires:{}}
  const edges:[string,number,string,number][]=[['S',0,'SW',0],['SW',1,'L',0],['L',1,'S',1],['SW',1,'M',0],['M',1,'S',1],['M',2,'C',0],['C',1,'M',0],['SW',1,'K',0],['K',1,'S',1]]
  edges.forEach(([a,ai,b,bi],i)=>board.wires[`w${i}`]={id:`w${i}`,from:{componentId:a,index:ai},to:{componentId:b,index:bi}})
  return board
}
describe('3D panel: one electrical graph, layered presentation only',()=>{
  it('clamps independent 0/3/5 layers and respects per-component override',()=>{
    const board=demoBoard(),v=normalizeBoard3DView({level:4,overrides:{K:1}})
    expect(componentStage(board.components.SW,v)).toBe(3)
    expect(componentStage(board.components.M,v)).toBe(4)
    expect(componentStage(board.components.K,v)).toBe(1)
    expect(assemblyStages({...board.components.S,spec:{kind:'GROUND'}})).toEqual([])
    expect(boardExploded(board,v)).toBe(true)
    expect(boardExploded(board,normalizeBoard3DView({}))).toBe(false)
  })
  it('sanitizes damaged state and degenerate camera without losing valid preferences',()=>{
    const v=normalizeBoard3DView({level:NaN,overrides:{M:999,K:-3},camera:{position:[0,0,0],target:[0,0,0],up:[0,1,0]},conceptual:true})
    expect(v.level).toBe(0);expect(v.overrides).toEqual({M:20,K:0});expect(v.camera).toBeUndefined();expect(v.conceptual).toBe(true)
  })
  it('moves panel only, supports undo/redo and preserves electrical solutions',()=>{
    const start=initialCircuitState(demoBoard()),p={x:30,y:30,rotation:90}
    const moved=circuitReducer(start,{type:'MOVE_COMPONENT_3D',id:'SW',placement:p})
    expect(moved.board.components.SW.cell).toEqual(start.board.components.SW.cell)
    expect(panelPlacement(moved.board.components.SW)).toEqual(p)
    expect(moved.board.wires).toEqual(start.board.wires)
    expect(moved.solution).toEqual(start.solution)
    const undo=circuitReducer(moved,{type:'UNDO'});expect(undo.board.components.SW.panel3d).toBeUndefined()
    expect(circuitReducer(undo,{type:'REDO'}).board.components.SW.panel3d).toEqual(p)
    expect(circuitReducer(start,{type:'MOVE_COMPONENT_3D',id:'SW',placement:{x:0,y:0,rotation:0}})).toBe(start)
  })
  it('seeds a legacy panel once; later Visual moves do not move the 3D placement',()=>{
    const start=initialCircuitState(demoBoard()),seed=circuitReducer(start,{type:'INITIALIZE_PANEL_3D'})
    const old=panelPlacement(seed.board.components.SW,seed.board.view?.three)
    expect(seed.board.components).toBe(start.board.components)
    const project=createCircuitProject(start.board)
    expect(canonicalCircuitProjectJson({...project,board:seed.board})).toBe(canonicalCircuitProjectJson(project))
    const move=circuitReducer(seed,{type:'MOVE_COMPONENT',id:'SW',cell:{x:15,y:15},projection:'virtual'})
    expect(panelPlacement(move.board.components.SW,move.board.view?.three)).toEqual(old)
    expect(seed.solution).toBe(start.solution);expect(circuitReducer(seed,{type:'INITIALIZE_PANEL_3D'})).toBe(seed)
  })
  it('restores project camera, layer selection and independent placement',()=>{
    const board=demoBoard();board.components.SW.panel3d={x:30,y:0,rotation:90}
    board.view={zoom:1,projection:'iec',cameras:{},active3d:true,three:normalizeBoard3DView({level:4,selected:'K',overrides:{K:2},camera:{position:[10,20,-30],target:[0,0,0],up:[0,-1,0]}})}
    const p=parseCircuitProject(JSON.parse(JSON.stringify(createCircuitProject(board))))
    expect(p?.board.view).toEqual(board.view);expect(p?.board.components.SW.panel3d).toEqual(board.components.SW.panel3d)
    expect(parseCircuitProject(createCircuitProject(demoBoard()))?.board.view).toBeUndefined()
  })
  it('drives lamp, motor, relay and contact topology from real switch and wire changes',()=>{
    let s=initialCircuitState(demoBoard());expect(operatingVisuals(s).L.active).toBe(false)
    s=circuitReducer(s,{type:'TOGGLE_SWITCH',id:'SW'});let v=operatingVisuals(s)
    expect(v.L.active).toBe(true);expect(v.M.rotor).toBe(true);expect(v.K.active).toBe(true)
    const onContacts=v.K.contacts
    s=circuitReducer(s,{type:'DISCONNECT',id:'w0'});v=operatingVisuals(s)
    expect(v.L.active).toBe(false);expect(v.M.rotor).toBe(false);expect(v.K.active).toBe(false);expect(v.K.contacts).not.toEqual(onContacts)
  })
  it('covers every palette identity and Global-Tek terminal contract with finite anchors',()=>{
    for(const p of PALETTE){expect(index).toHaveProperty(p.key);const c={id:p.key,modelId:p.key,cell:{x:0,y:0},spec:p.spec};terminalLabels(c).forEach((_,i)=>expect(terminalPoint(i,terminalLabels(c).length).every(Number.isFinite)).toBe(true))}
    const b=buildGlobalTek('corrected');expect(Object.keys(operatingVisuals(initialCircuitState(b)))).toHaveLength(Object.keys(b.components).length)
    expect(Object.keys(index)).toHaveLength(68)
    const source=JSON.parse(readFileSync('content-packs/source/wiring-models-3d/sources.json','utf8'));expect(source.published).toBe(false);expect(source.files).toHaveLength(61)
  })
})

describe('proyeksi kamera 3D tersimpan bersama sudutnya', () => {
  const kamera = { position: [1, 2, 3] as [number, number, number], target: [0, 0, 0] as [number, number, number], up: [0, 1, 0] as [number, number, number] }

  it('mengingat pilihan ortografis pembaca', () => {
    expect(normalizeBoard3DView({ camera: { ...kamera, projection: 'orthographic' } }).camera?.projection).toBe('orthographic')
  })

  it('mengabaikan nilai proyeksi yang tidak dikenal, tanpa membuang sudut kameranya', () => {
    const v = normalizeBoard3DView({ camera: { ...kamera, projection: 'bohong' } })
    expect(v.camera?.projection).toBeUndefined()
    expect(v.camera?.position).toEqual([1, 2, 3])
  })
  it('membaca arus beban dari solve, dan diam saat tidak ada yang mengalir', () => {
    const board = demoBoard()
    const open = initialCircuitState(board)
    // Sakelar terbuka: beban tidak dialiri, jadi pembacaannya KOSONG — bukan "0.00 A".
    expect(measuredReadout(open, board.components.L)).toBe('')
    expect(operatingVisuals(open).L.measured).toBe('')

    const closed = circuitReducer(open, { type: 'TOGGLE_SWITCH', id: 'SW' })
    // Dihitung tangan: 220 V / 500 Ω = 0,44 A tepat.
    expect(closed.solution.loadCurrent.L).toBeCloseTo(0.44, 10)
    expect(measuredReadout(closed, board.components.L)).toBe('0.44 A')
    expect(operatingVisuals(closed).L.measured).toBe('0.44 A')
    // Koil relai adalah cabang resistif, jadi solve memang mengukurnya:
    // 220 V / 2200 Ω (RELAY_SPEC.coilResistanceOhms) = 0,1 A tepat.
    expect(measuredReadout(closed, board.components.K)).toBe('0.10 A')
  })
})
