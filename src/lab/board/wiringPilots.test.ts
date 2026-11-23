import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const root='assets/blender/wiring-pilots-v2/'
const manifest=JSON.parse(readFileSync(root+'manifest.json','utf8'))
function glb(id: string) { const bytes=readFileSync(root+id+'.glb'); expect(bytes.readUInt32LE(0)).toBe(0x46546c67); return JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString()) }
describe('approved pilot artifacts',()=>{
  it('keeps exactly two local reconstructions, never claims manufacturer CAD or mass approval',()=>{
    expect(manifest.models.map((m: {id:string})=>m.id)).toEqual(['xb5ad21-pilot','my2-pyf08ae-pilot'])
    expect(manifest.pilotApproved).toBe(true);expect(manifest.massRenderApproved).toBe(false)
    for(const m of manifest.models){expect(m.manufacturerCad).toBe(false);expect(m.anatomy).toBe('CONCEPTUAL_SEPARATE')}
  })
  it('exports named parts, explosion offsets and all terminal anchors into actual GLBs',()=>{
    for(const m of manifest.models){const doc=glb(m.id);for(const p of m.parts){const node=doc.nodes.find((n:{name:string})=>n.name===p.id);expect(node).toBeDefined();expect(node.extras.explodeOffsetMm).toEqual(p.offsetMm);expect(node.extras.explodeOffsetGltfMm).toEqual(p.offsetGltfMm);expect(p.offsetGltfMm).toEqual([p.offsetMm[0],p.offsetMm[2],p.offsetMm[1] === 0 ? 0 : -p.offsetMm[1]]);expect(node.extras.conceptual).toBe(p.conceptual)}
      for(const t of m.terminals){const node=doc.nodes.find((n:{name:string})=>n.name===t.node);expect(node?.extras.terminalId).toBe(t.id);expect(t.coordinateEvidence).toContain('not manufacturer CAD')}
      expect(doc.images??[]).toEqual([])
    }
  })
  it('keeps MY2 and socket top-view pin identity distinct from old circuit parameters',()=>{
    const m=manifest.models[1];expect(m.terminals.map((t:{id:string})=>t.id)).toEqual(['4','1','8','5','12','9','14','13'])
    expect(m.terminals.filter((t:{role:string})=>t.role==='COIL').map((t:{id:string})=>t.id)).toEqual(['14','13'])
    expect(m.dimensionEnvelopeMm).toMatchObject({socketWidth:23,socketLength:72,socketHeight:31,relayWidth:21.5,relayDepth:28,relayBodyHeight:36,bladeProjection:6.4})
    expect(manifest.models[0].terminals.map((t:{physicalMark:string})=>t.physicalMark)).toEqual(['3 (photo); 13 (table)','4 (photo); 14 (table)'])
  })
})
