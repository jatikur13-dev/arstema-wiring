import { describe, expect, it } from 'vitest'
import { JARI_GIZMO, SISI_3D, titikGizmo } from './ViewGizmo'

const panjang = (t: { x: number; y: number }) => Math.hypot(t.x - JARI_GIZMO, t.y - JARI_GIZMO)

describe('gizmo sudut papan 3D', () => {
  it('menawarkan enam sisi papan ditambah isometrik', () => {
    expect(SISI_3D.map(([id]) => id)).toEqual(['front', 'back', 'left', 'right', 'top', 'bottom', 'iso'])
  })

  it('selalu memuat enam ujung sumbu, tiga di antaranya berlabel', () => {
    const titik = titikGizmo({ x: [1, 0, 0], y: [0, -1, 0], z: [0, 0, -1] })
    expect(titik).toHaveLength(6)
    expect(titik.filter((t) => t.huruf).map((t) => t.huruf).sort()).toEqual(['X', 'Y', 'Z'])
  })

  it('menyekala arah layar sehingga sumbu terpanjang selalu sepanjang lengan, sekecil apa pun angkanya', () => {
    const jauh = titikGizmo({ x: [0.0004, 0, 0], y: [0, -0.0002, 0], z: [0, 0, -0.0004] })
    const dekat = titikGizmo({ x: [400, 0, 0], y: [0, -200, 0], z: [0, 0, -400] })
    const terpanjang = (t: ReturnType<typeof titikGizmo>) => Math.max(...t.map(panjang))
    expect(terpanjang(jauh)).toBeCloseTo(terpanjang(dekat), 6)
    // Sumbu yang setengah panjangnya di layar tetap tergambar setengah: itu yang
    // membuat gizmo terbaca sebagai ruang, bukan sebagai bintang datar.
    const sumbuY = jauh.find((t) => t.huruf === 'Y')!
    expect(panjang(sumbuY)).toBeCloseTo(terpanjang(jauh) / 2, 6)
  })

  it('menandai ujung yang menghadap pembaca, dan menggambarnya paling akhir', () => {
    const titik = titikGizmo({ x: [1, 0, -0.5], y: [0, -1, 0], z: [0, 0, -1] })
    expect(titik.find((t) => t.sisi === 'right')?.depan).toBe(true)
    expect(titik.find((t) => t.sisi === 'left')?.depan).toBe(false)
    expect(titik[titik.length - 1]?.depan).toBe(true)
    expect(titik[0].depan).toBe(false)
  })
})
