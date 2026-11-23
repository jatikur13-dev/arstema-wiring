import type { PaletteItem } from './topic1a'

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('id-ID')
    .replace(/[^a-z0-9+\-~]+/g, ' ')
    .trim()
}

export function paletteSearchHaystack(item: PaletteItem): string {
  const iec = item as PaletteItem & { designation?: string; iecLabel?: string; group?: string }
  return normalize([
    item.key,
    item.label,
    item.hint,
    item.category,
    item.manufacturer,
    item.model,
    item.simulationScope,
    ...(item.aliases ?? []),
    iec.designation,
    iec.iecLabel,
    iec.group,
  ].filter(Boolean).join(' '))
}

export function matchesPaletteSearch(item: PaletteItem, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = paletteSearchHaystack(item)
  return words.every((word) => haystack.includes(word))
}
