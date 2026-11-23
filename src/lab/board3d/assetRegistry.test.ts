import { expect, it } from 'vitest'
import { PALETTE } from '../scenario/topic1a'
import { componentAsset, componentAssetId, componentAssets } from './assetRegistry'
it('resolves every palette identity to its existing model, image and terminal contract',()=>{
  for(const p of PALETTE){const c={id:'instance',modelId:p.key,cell:{x:0,y:0},spec:p.spec},asset=componentAsset(c)
    expect(asset,p.key).toBeDefined();expect(componentAssetId(c)).toBe(p.key)
    expect(asset!.path).toMatch(/\.glb$/);expect(asset!.visual).toMatch(/\.webp$/);expect(asset!.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(asset!.anchors.length,p.key).toBeGreaterThan(0)
  }
  expect(new Set(Object.values(componentAssets).map(a=>a.path)).size).toBe(61)
})
it('resolves a legacy component without rewriting its identity',()=>{
  const c={id:'KM1',cell:{x:0,y:0},spec:{kind:'CONTACTOR' as const}}
  expect(componentAsset(c)?.path).toBe('contactor.glb');expect(c).not.toHaveProperty('modelId')
})
