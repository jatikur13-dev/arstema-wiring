import index from './assetIndex.json'
import type { PlacedComponent } from '../../engine/types'
import { virtualAssetFor } from '../board/virtualAssets'
export interface ComponentAsset { path: string; label: string; visual: string; preview: string; sha256: string; source: string; terminals: string[]; anchors: { index: number; designation: string; node: string | null; verified: boolean }[] }
export const componentAssets: Record<string, ComponentAsset> = index
export function componentAssetId(c: PlacedComponent): string | undefined {
  if (c.modelId && componentAssets[c.modelId]) return c.modelId
  const visual = virtualAssetFor(c.spec, c.modelId)
  return Object.keys(componentAssets).find(id => componentAssets[id].visual === visual)
}
export function componentAsset(c: PlacedComponent): ComponentAsset | undefined {
  const id = componentAssetId(c); return id ? componentAssets[id] : undefined
}
