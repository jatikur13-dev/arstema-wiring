import type { Board3DAxes, Board3DProjection } from './BoardScene'

/**
 * Gizmo sumbu — penunjuk arah di pojok kanvas 3D, seperti di viewport Blender.
 *
 * Isinya tiga sumbu papan: X (kiri–kanan), Y (bawah–atas), Z (belakang–depan).
 * Enam bola kecil di ujungnya ikut berputar mengikuti kamera, jadi pembaca
 * selalu tahu sedang melihat papan dari mana. Setiap bola bisa ditekan untuk
 * melompat ke sisi itu; yang menghadap pembaca digambar penuh, yang membelakangi
 * digambar berongga — sama seperti gizmo yang sudah dikenal orang.
 *
 * Murni penunjuk arah: tidak menyentuh rangkaian, model, atau simulasi.
 */

/** Sisi papan, dipakai bersama oleh gizmo dan daftar "Sudut" di bilah alat. */
export const SISI_3D = [
  ['front', 'Depan'],
  ['back', 'Belakang'],
  ['left', 'Kiri'],
  ['right', 'Kanan'],
  ['top', 'Atas'],
  ['bottom', 'Bawah'],
  ['iso', 'Isometrik'],
] as const

const TITIK: { sisi: string; huruf: string; sumbu: keyof Board3DAxes; tanda: 1 | -1 }[] = [
  { sisi: 'right', huruf: 'X', sumbu: 'x', tanda: 1 },
  { sisi: 'left', huruf: '', sumbu: 'x', tanda: -1 },
  { sisi: 'top', huruf: 'Y', sumbu: 'y', tanda: 1 },
  { sisi: 'bottom', huruf: '', sumbu: 'y', tanda: -1 },
  { sisi: 'front', huruf: 'Z', sumbu: 'z', tanda: 1 },
  { sisi: 'back', huruf: '', sumbu: 'z', tanda: -1 },
]

const NAMA: Record<string, string> = Object.fromEntries(SISI_3D.map(([id, label]) => [id, label]))

/** Sudut pandang cadangan sebelum kamera mengabarkan orientasinya. */
export const SUMBU_AWAL: Board3DAxes = { x: [0.8, 0.4, 0], y: [0, -1, 0], z: [-0.8, 0.4, 0] }

export const JARI_GIZMO = 26
const PANJANG_LENGAN = 17

export interface TitikGizmo { sisi: string; huruf: string; x: number; y: number; depan: boolean }

/**
 * Menaruh keenam ujung sumbu pada bidang gizmo.
 *
 * Arah dari kamera datang dalam satuan layar yang bisa sangat kecil (papan
 * besar, kamera jauh), jadi ketiganya dibagi dengan yang terpanjang: gizmo
 * selalu sebesar ini, sementara perbandingan panjang antar sumbu — yang
 * membuatnya terbaca sebagai ruang — tetap utuh. Yang menghadap pembaca
 * (`depan`) digambar terakhir supaya menimpa yang membelakangi.
 */
export function titikGizmo(a: Board3DAxes): TitikGizmo[] {
  const panjang = Math.max(Math.hypot(a.x[0], a.x[1]), Math.hypot(a.y[0], a.y[1]), Math.hypot(a.z[0], a.z[1])) || 1
  return TITIK.map((t) => {
    const [dx, dy, dz] = a[t.sumbu]
    return {
      sisi: t.sisi,
      huruf: t.huruf,
      x: JARI_GIZMO + (dx / panjang) * t.tanda * PANJANG_LENGAN,
      y: JARI_GIZMO + (dy / panjang) * t.tanda * PANJANG_LENGAN,
      depan: dz * t.tanda <= 0,
    }
  }).sort((p, q) => Number(p.depan) - Number(q.depan))
}

export function ViewGizmo({ axes, onPick, proyeksi }: { axes: Board3DAxes | null; onPick(sisi: string): void; proyeksi: Board3DProjection }) {
  const titik = titikGizmo(axes ?? SUMBU_AWAL)
  const R = JARI_GIZMO

  return (
    <div className="board3d-gizmo" data-proyeksi={proyeksi}>
      <svg viewBox={`0 0 ${R * 2} ${R * 2}`} role="group" aria-label="Arah pandang papan">
        {titik.filter((t) => t.huruf).map((t) => (
          <line className="board3d-gizmo__lengan" key={`l${t.sisi}`} x1={R} y1={R} x2={t.x} y2={t.y} />
        ))}
        {titik.map((t) => (
          <g className="board3d-gizmo__titik" data-depan={t.depan ? '' : undefined} key={t.sisi}>
            <circle className="board3d-gizmo__bola" cx={t.x} cy={t.y} r={t.huruf ? 5.6 : 4} />
            {t.huruf ? <text x={t.x} y={t.y + 2.4}>{t.huruf}</text> : null}
            <title>{NAMA[t.sisi]}</title>
            <circle
              className="board3d-gizmo__sasaran"
              cx={t.x}
              cy={t.y}
              onClick={() => onPick(t.sisi)}
              r={8}
            />
          </g>
        ))}
      </svg>
      <button className="board3d-gizmo__iso" onClick={() => onPick('iso')} title="Pandangan isometrik (tombol 0)" type="button">
        ISO
      </button>
    </div>
  )
}
