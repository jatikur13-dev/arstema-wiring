import { describe, expect, it } from 'vitest'
import { PALETTE } from './topic1a'
import { matchesPaletteSearch } from './paletteSearch'

const found = (query: string) => PALETTE.filter((item) => matchesPaletteSearch(item, query)).map((item) => item.key)

describe('Wiring palette search', () => {
  it('finds generic names, exact models, manufacturers and common aliases', () => {
    expect(found('power supply')).toContain('DIN_PSU_HDR3024')
    expect(found('GV2ME14')).toEqual(['MOTOR_BREAKER_GV2ME14'])
    expect(found('phoenix quattro')).toEqual(['TERMINAL_UT25_QUATTRO'])
    expect(found('MPCB')).toContain('MOTOR_BREAKER_GV2ME14')
  })

  it('combines words and ignores case/diacritics without returning unrelated items', () => {
    expect(found('omron dark on')).toEqual(expect.arrayContaining([
      'SENSOR_E3Z_D61_NPN_DARK',
      'SENSOR_E3Z_D81_PNP_DARK',
    ]))
    expect(found('tidak-ada-komponen')).toEqual([])
  })
})
