import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PALETTE } from '../scenario/topic1a'
import { terminalCountForComponent } from '../../engine/index'
import { virtualAssetDefinitionForComponent } from './virtualAssets'

const root = resolve('assets/blender/wiring-catalog-v1')
const inventory = JSON.parse(readFileSync(resolve(root,'inventory.json'),'utf8'))

describe('local Blender wiring catalog inventory', () => {
  it('covers every palette identity with the actual runtime terminal contract', () => {
    for (const item of PALETTE) {
      const component = { id: item.key, modelId: item.key, cell:{ x:0,y:0 }, spec:item.spec }
      const source = virtualAssetDefinitionForComponent(component)
      const group = inventory.items.find((g:any)=>g.sourceAsset===source.src)
      expect(group, item.key).toBeDefined()
      expect(group.models.some((m:any)=>m.id===item.key)).toBe(true)
      expect(group.terminals.length).toBe(terminalCountForComponent(component))
    }
    expect(inventory.paletteCount).toBe(PALETTE.length)
  })

  it('uses existing Blender sources only with matching terminal counts', () => {
    for (const item of inventory.items.filter((g:any)=>g.reuse)) {
      expect(item.reuse.terminals.length).toBe(item.terminals.length)
      for (const file of Object.values(item.reuse.files) as string[])
        expect(existsSync(resolve(root,'..',item.reuse.directory,file)), file).toBe(true)
    }
    expect(inventory.items.filter((g:any)=>g.reuse)).toHaveLength(9)
  })

  it('does not merge distinct logic variants when sharing a visual body', () => {
    const group=inventory.items.find((g:any)=>g.id==='sensor-inductive-e2e')
    expect(group.models.map((m:any)=>m.id)).toEqual(expect.arrayContaining([
      'SENSOR_E2E_PNP_NO','SENSOR_E2E_NPN_NO','SENSOR_E2E_PNP_NC','SENSOR_E2E_NPN_NC',
    ]))
    expect(inventory.items.some((g:any)=>g.id==='globaltek-transformer-tapped')).toBe(true)
    expect(inventory.items.some((g:any)=>g.id==='globaltek-heater-3ph')).toBe(true)
  })
})
