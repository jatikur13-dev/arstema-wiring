/** Primary-source registry used by the Wiring publication gate. */

import type { WiringStandardProfileId } from './standards'

export type WiringEvidenceAuthority = 'INDONESIA_ESDM' | 'IEC' | 'NFPA' | 'NEMA' | 'JISC'

export interface WiringEvidenceRecord {
  id: string
  title: string
  authority: WiringEvidenceAuthority
  profiles: readonly WiringStandardProfileId[]
  url: string
  /** What this source is allowed to support inside the simulator. */
  scope: string
  /** ISO date of the last deliberate registry review, not a claim of certification. */
  reviewedOn: string
}

export const WIRING_EVIDENCE_REGISTRY: readonly WiringEvidenceRecord[] = [
  {
    id: 'PUIL_2020_ESDM',
    title: 'Persyaratan Umum Instalasi Listrik 2020',
    authority: 'INDONESIA_ESDM',
    profiles: ['IEC_PUIL'],
    url: 'https://jdih.esdm.go.id/common/dokumen-external/Permen%20ESDM%20No.%207%20Tahun%202021.pdf',
    scope: 'Konteks instalasi listrik tegangan rendah Indonesia; tidak menggantikan inspeksi atau desain profesional.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'IEC_60617_DB',
    title: 'IEC 60617 — Graphical symbols for diagrams',
    authority: 'IEC',
    profiles: ['IEC_PUIL'],
    url: 'https://webstore.iec.ch/en/publication/2723',
    scope: 'Identitas dan keluarga simbol diagram IEC; implementasi aset tetap harus ditinjau per simbol.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'IEC_60445',
    title: 'IEC 60445 — Identification of equipment terminals and conductors',
    authority: 'IEC',
    profiles: ['IEC_PUIL'],
    url: 'https://webstore.iec.ch/en/publication/66712',
    scope: 'Prinsip identifikasi terminal, conductor termination, dan konduktor.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'IEC_61082_1',
    title: 'IEC 61082-1 — Preparation of documents used in electrotechnology',
    authority: 'IEC',
    profiles: ['IEC_PUIL'],
    url: 'https://webstore.iec.ch/en/publication/4469',
    scope: 'Aturan penyajian dokumen elektroteknik dan keterbacaan diagram.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'IEC_60204_1',
    title: 'IEC 60204-1 — Electrical equipment of machines',
    authority: 'IEC',
    profiles: ['IEC_PUIL'],
    url: 'https://webstore.iec.ch/en/publication/26037',
    scope: 'Konteks peralatan listrik mesin; bukan kalkulasi kepatuhan mesin lengkap.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'IEC_60947_SERIES',
    title: 'IEC 60947 series — Low-voltage switchgear and controlgear',
    authority: 'IEC',
    profiles: ['IEC_PUIL'],
    url: 'https://webstore.iec.ch/en/publication/62425',
    scope: 'Keluarga switchgear/controlgear tegangan rendah; rating produk harus tetap berasal dari datasheet produk.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'IEC_60034_SERIES',
    title: 'IEC 60034 series — Rotating electrical machines',
    authority: 'IEC',
    profiles: ['IEC_PUIL'],
    url: 'https://webstore.iec.ch/en/publication/62415',
    scope: 'Konteks mesin berputar dan nameplate; model simulasi tetap bersifat edukatif.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'NFPA_79_2024',
    title: 'NFPA 79 — Electrical Standard for Industrial Machinery (2024)',
    authority: 'NFPA',
    profiles: ['NEMA_NFPA'],
    url: 'https://link.nfpa.org/all-publications/79/2024',
    scope: 'Batas pack mesin industri Amerika Utara; belum mengaktifkan simbol NEMA secara otomatis.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'NEMA_ESPG',
    title: 'NEMA Electrical Standards & Products Guide',
    authority: 'NEMA',
    profiles: ['NEMA_NFPA'],
    url: 'https://www.nema.org/docs/default-source/blogdocuments/communications/documents/nema-espg.pdf',
    scope: 'Peta keluarga standar NEMA; bukan bukti terminal atau simbol suatu produk tertentu.',
    reviewedOn: '2026-08-27',
  },
  {
    id: 'JISC_STANDARD_REGISTRY',
    title: 'JISC JIS Search',
    authority: 'JISC',
    profiles: ['JIS'],
    url: 'https://www.jisc.go.jp/jis/general/GnrJISSearch.html',
    scope: 'Registri sumber primer untuk discovery JIS; pack tetap SOURCE_GATED sampai dokumen relevan ditetapkan.',
    reviewedOn: '2026-08-27',
  },
] as const

const EVIDENCE_BY_ID = new Map(WIRING_EVIDENCE_REGISTRY.map((record) => [record.id, record]))

export function wiringEvidenceById(id: string): WiringEvidenceRecord | undefined {
  return EVIDENCE_BY_ID.get(id)
}

export function missingWiringEvidence(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter((id) => !EVIDENCE_BY_ID.has(id))
}

export function wiringEvidenceForProfile(profile: WiringStandardProfileId): WiringEvidenceRecord[] {
  return WIRING_EVIDENCE_REGISTRY.filter((record) => record.profiles.includes(profile))
}
