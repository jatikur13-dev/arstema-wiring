/**
 * The worked examples a learner can open on the lab board.
 *
 * The boards themselves live in `circuitBoards.ts` and are proven by the suites
 * beside them — structure, a finite solve, and for the motor circuits the real
 * electrical properties: the star point unites U2/V2/W2, delta gives line ≈ √3
 * × winding, and the star–delta interlock never lets both mode contactors close
 * together at any tick of the changeover.
 *
 * This file adds only what a learner needs to CHOOSE one: a title, one line on
 * what it shows, and what to do once it is on the board. No board is invented
 * here and none is altered.
 *
 * `verified` means precisely this: a test references the example BY KEY and
 * asserts something about how it behaves — not merely that it solves. Every
 * example passes the structural sweep, so that sweep alone earns nothing here.
 * The flag is honest labelling, not decoration: an unverified example is a
 * diagram that solves, and a learner deserves to know the difference.
 */

import type { Board } from '../../engine/index'
import { CIRCUIT_TEST_FIXTURES, type CircuitTestFixtureKey } from './circuitBoards'
import { INDUSTRIAL_CIRCUIT_EXAMPLES, type IndustrialCircuitExampleKey } from './industrialBoards'
import { withDefaultGridSpacing } from './defaultLayout'
import { buildGlobalTek, type GlobalTekKey } from './globalTek'

export type ExampleGroup = 'Dasar' | 'Kontrol motor' | 'Proteksi' | 'Kontrol industri'

export interface CircuitExample {
  key: CircuitTestFixtureKey | IndustrialCircuitExampleKey | GlobalTekKey
  title: string
  summary: string
  /** What to press or toggle once it is loaded. */
  tryIt: string
  group: ExampleGroup
  /** True when a test asserts how it BEHAVES, not just that it solves. */
  verified: boolean
  /** Primary technical references used to lock topology/terminal behaviour. */
  references?: readonly {
    label: string
    url: string
  }[]
  build: () => Board
}

const META: Record<
  CircuitTestFixtureKey,
  Omit<CircuitExample, 'key' | 'build'>
> = {
  seri: {
    title: 'Dua lampu seri',
    summary: 'Arus yang sama melewati kedua lampu; tegangan terbagi sehingga keduanya lebih redup.',
    tryIt: 'Jalankan dan bandingkan terangnya dengan contoh paralel.',
    group: 'Dasar',
    verified: true,
  },
  paralel: {
    title: 'Dua lampu paralel',
    summary: 'Kedua lampu menerima tegangan penuh; arus sumber terbagi ke dua cabang.',
    tryIt: 'Jalankan dan bandingkan terangnya dengan contoh seri.',
    group: 'Dasar',
    verified: true,
  },
  'breaker-1p': {
    title: 'MCB satu fasa',
    summary: 'MCB sebagai pemutus di sisi masuk sebelum beban.',
    tryIt: 'Klik MCB untuk menutup kutubnya, lalu jalankan.',
    group: 'Proteksi',
    verified: true,
  },
  'motor-tanpa-kapasitor': {
    title: 'Motor PSC tanpa kapasitor',
    summary: 'Model motor PSC dengan kapasitor dilepas: belitan bantu tidak membentuk beda fasa sehingga rotor tidak mulai.',
    tryIt: 'Jalankan dan perhatikan motor berdengung tetapi tidak berputar.',
    group: 'Kontrol motor',
    verified: true,
  },
  'motor-kapasitor': {
    title: 'Motor PSC dengan kapasitor',
    summary: 'Pada model PSC, kapasitor belitan bantu memberi beda fasa dan torsi awal. Ini bukan aturan universal semua motor 1-fasa.',
    tryIt: 'Jalankan; motor berputar. Bandingkan dengan contoh tanpa kapasitor.',
    group: 'Kontrol motor',
    verified: true,
  },
  'relay-dasar': {
    title: 'Relai dasar',
    summary: 'Koil relai menarik kontak bantu yang menyalakan lampu tanda.',
    tryIt: 'Tekan dan tahan START; relai menarik dan lampu menyala.',
    group: 'Dasar',
    verified: true,
  },
  'self-holding': {
    title: 'Self-holding (mengunci sendiri)',
    summary: 'Kontak bantu NO paralel dengan START menahan koil setelah tombol dilepas.',
    tryIt: 'Tekan START lalu lepas — koil tetap aktif. Tekan STOP untuk melepas.',
    group: 'Dasar',
    verified: true,
  },
  'relay-selfhold-breaker': {
    title: 'Self-holding dengan MCB',
    summary: 'Rangkaian pengunci yang disuplai lewat MCB pada jalur kendali.',
    tryIt: 'Tutup MCB dulu, baru START. Buka MCB dan lihat kuncian terlepas.',
    group: 'Proteksi',
    verified: true,
  },
  'motor-3f-langsung': {
    title: 'Motor 3~ langsung ke sumber',
    summary: 'Contoh topologi fixed-STAR 230/400 V: U2/V2/W2 disatukan lokal, PE ke rangka, tanpa perangkat starter/proteksi.',
    tryIt: 'Jalankan dan amati arus tiap fasa pada panel status.',
    group: 'Kontrol motor',
    verified: true,
  },
  'breaker-3f-motor': {
    title: 'MCB 3 kutub ke motor',
    summary: 'MCB memutus tiga fasa dan motor fixed-STAR memiliki PE. Ini demonstrasi pemutus, bukan starter motor lengkap dengan overload.',
    tryIt: 'Tutup MCB tiga kutub lalu jalankan.',
    group: 'Proteksi',
    verified: true,
  },
  'dol-power': {
    title: 'DOL — jalur daya saja',
    summary: 'Jalur daya DOL: MCB → kontaktor → overload → motor fixed-STAR, lengkap PE; rangkaian kendali belum dipasang.',
    tryIt: 'Lihat bahwa motor tidak jalan sampai koil kontaktor mendapat perintah.',
    group: 'Kontrol motor',
    verified: true,
  },
  'dol-driven': {
    title: 'DOL — kontaktor diberi perintah',
    summary: 'Contoh kendali dua-kawat: koil disuplai langsung melalui 95–96 overload. Saat suplai kembali motor dapat start ulang, sehingga bukan kendali START–STOP.',
    tryIt: 'Jalankan dan amati kontak utama menutup mengikuti koil.',
    group: 'Kontrol motor',
    verified: true,
  },
  'dol-full': {
    title: 'DOL lengkap dengan START–STOP',
    summary:
      'Direct-on-line utuh: MCB, kontaktor, overload seri, STOP NC, START NO, dan self-hold.',
    tryIt: 'Tutup kedua MCB, tekan START lalu lepas untuk menguji self-hold; tekan STOP untuk melepas kontaktor.',
    group: 'Kontrol motor',
    verified: true,
  },
  'interlock-2km': {
    title: 'Interlock dua kontaktor',
    summary:
      'Dua kontaktor memiliki interlock listrik silang dan interlock mekanis; perintah bersamaan dari kondisi mati ditolak aman.',
    tryIt: 'Aktifkan satu kontaktor, lalu coba aktifkan yang lain — akan tertahan.',
    group: 'Kontrol motor',
    verified: true,
  },
  'star-delta-manual': {
    title: 'Star–delta manual',
    summary:
      'Motor 400/690 V berpindah STAR ke DELTA clockwise yang direkomendasikan, dengan overload, PE, interlock listrik, dan interlock mekanis.',
    tryIt: 'START utama, lalu START bintang; hentikan bintang sebelum masuk segitiga.',
    group: 'Kontrol motor',
    verified: true,
  },
  'star-delta-auto': {
    title: 'Star–delta otomatis (timer)',
    summary:
      'H3DT-G memerintah STAR 15–18 lalu DELTA 25–28; motor 400/690 V memakai overload, PE, serta interlock listrik dan mekanis.',
    tryIt: 'Tutup kedua MCB, tekan START, lalu jalankan dan amati perpindahannya.',
    group: 'Kontrol motor',
    verified: true,
  },
  'mcb-overload-trip': {
    title: 'MCB trip karena beban lebih',
    summary:
      'Model edukasional orde-pertama memperagakan trip beban lebih; waktunya bukan kurva IEC dan tidak boleh dipakai memilih proteksi nyata.',
    tryIt: 'Tutup MCB dan jalankan; tunggu sampai trip, lalu coba reset.',
    group: 'Proteksi',
    verified: true,
  },
  'simbol-baru': {
    title: 'Peraga simbol',
    summary: 'Papan peraga simbol. PE berdiri sendiri dan tidak disatukan dengan N pada sisi beban.',
    tryIt: 'Bandingkan tampilannya di tab Papan Virtual dan Diagram IEC 60617.',
    group: 'Dasar',
    verified: true,
  },
}

/** Display order: simple circuits first, then motor control, then protection. */
export const EXAMPLE_GROUPS: readonly ExampleGroup[] = [
  'Dasar',
  'Kontrol industri',
  'Kontrol motor',
  'Proteksi',
]

const INDUSTRIAL_META: Record<IndustrialCircuitExampleKey, Omit<CircuitExample, 'key' | 'build'>> = {
  'psu-pnp-relay': { title: '24 VDC · PNP → relay', summary: 'Sensor PNP menyuplai +V ke koil relay ketika target terdeteksi.', tryIt: 'Jalankan, lalu klik sensor untuk membandingkan OUT aktif dan tidak aktif.', group: 'Kontrol industri', verified: true },
  'psu-npn-relay': { title: '24 VDC · NPN → relay', summary: 'Sensor NPN menarik sisi koil ke 0 V ketika target terdeteksi.', tryIt: 'Jalankan, lalu klik sensor; perhatikan polaritas wiring berbeda dari PNP.', group: 'Kontrol industri', verified: true },
  'trafo-start-stop-relay': { title: 'Trafo kontrol · START–STOP', summary: 'Sekunder 24 VAC memberi rangkaian STOP, START, self-hold, relay kontrol, dan lampu perintah.', tryIt: 'Tekan START lalu lepas; tekan STOP untuk menjatuhkan relay.', group: 'Kontrol industri', verified: true },
  'motor-feeder-lengkap': { title: 'Feeder motor lengkap', summary: 'Disconnector → motor breaker → kontaktor → overload → motor fixed-STAR, dengan PE dan kontrol overload.', tryIt: 'Jalankan; buka QS atau QF untuk memutus ketiga fasa.', group: 'Kontrol motor', verified: true },
  'forward-reverse-interlock': { title: 'Forward–reverse interlock', summary: 'Dua kontaktor memakai interlock listrik silang dan mekanis untuk mencegah penutupan bersamaan.', tryIt: 'Aktifkan satu arah lalu coba arah lawan.', group: 'Kontrol motor', verified: true },
  'phase-monitor-dropout': {
    title: 'RM17TG20 · urutan/fasa hilang',
    summary: 'Input L1/L2/L3 menggerakkan dua kontak changeover otomatis: hijau untuk urutan sehat, merah untuk fault.',
    tryIt: 'Jalankan, lalu hapus satu kabel sense atau tukar L1/L2 untuk melihat output jatuh ke kondisi fault.',
    group: 'Proteksi',
    verified: true,
    references: [{
      label: 'Schneider RM17TG20 — instruction sheet',
      url: 'https://www.se.com/us/en/download/document/S1A1958600/',
    }],
  },
  'product-start-stop-selfhold': {
    title: 'XB5 START–STOP · self-hold',
    summary: 'Station ganda memakai STOP 21–22 NC dan START 13–14 NO; relay MY2 mengunci dirinya dan menyalakan RUN.',
    tryIt: 'Tekan START lalu lepas; RUN tetap menyala. Tekan STOP untuk melepas relay.',
    group: 'Kontrol industri',
    verified: true,
    references: [{
      label: 'Schneider XB5AL73415 — product data sheet',
      url: 'https://iportal.se.com/Contents/docs/SQD-XB5AL73415.PDF',
    }],
  },
  'illuminated-pb-solenoid': {
    title: 'Pushbutton berlampu → solenoid',
    summary: 'Kontak NO 13–14 memberi solenoid 24 VDC; LED integral X1–X2 dipasang paralel pada keluaran perintah.',
    tryIt: 'Tekan-tahan pushbutton; LED dan solenoid aktif bersama, lalu lepas untuk memutus keduanya.',
    group: 'Kontrol industri',
    verified: true,
    references: [{
      label: 'Schneider XB5AW33B5 — 1NO+1NC, LED 24 V',
      url: 'https://www.se.com/us/en/product/XB5AW33B5/',
    }],
  },
  'limit-switch-position-relay': {
    title: 'D4N · posisi → relay',
    summary: 'Kontak posisi NO 33–34 pada D4N slow-action menarik relay 24 V dan lampu indikator.',
    tryIt: 'Klik aktuator D4N; 33–34 menutup dan indikator menyala. Klik lagi untuk kembali normal.',
    group: 'Kontrol industri',
    verified: true,
    references: [{
      label: 'OMRON D4N — contact forms 11–12 / 33–34',
      url: 'https://www.ia.omron.com/data_pdf/cat/d4n_ds_e_10_9_csm1248.pdf?id=1497',
    }],
  },
  'h3cr-on-delay': { title: 'H3CR-A8 · ON-delay', summary: 'Mode A menutup kedua kontak NO setelah waktu set 3 detik.', tryIt: 'Jalankan dan amati lampu baru menyala setelah delay.', group: 'Kontrol industri', verified: true },
  'h3cr-flicker': { title: 'H3CR-A8 · flicker OFF-start', summary: 'Mode B berganti OFF/ON setiap 1 detik selama coil diberi tegangan.', tryIt: 'Jalankan dan amati output tanpa menekan tombol lain.', group: 'Kontrol industri', verified: true },
  'moa-pump-float': { title: 'MAN–OFF–AUTO · pompa', summary: 'MAN memberi relay langsung; AUTO melalui float switch. Lampu PUMP adalah perintah keluaran, bukan simulasi hidraulik.', tryIt: 'Putar selector ke MAN atau AUTO; pada AUTO klik FLOAT.', group: 'Kontrol industri', verified: true },
  'heater-thermostat': { title: 'Heater · thermostat NC', summary: 'Thermostat NC memberi heater sampai kondisi temperatur tercapai dan kontak berpindah.', tryIt: 'Jalankan lalu klik thermostat untuk membuka jalur heater.', group: 'Kontrol industri', verified: true },
}

const LEGACY_EXAMPLES: CircuitExample[] = (
  Object.keys(CIRCUIT_TEST_FIXTURES) as CircuitTestFixtureKey[]
).map((key) => ({
  key,
  build: () => withDefaultGridSpacing(CIRCUIT_TEST_FIXTURES[key]()),
  ...META[key],
}))

const INDUSTRIAL_EXAMPLES: CircuitExample[] = (
  Object.keys(INDUSTRIAL_CIRCUIT_EXAMPLES) as IndustrialCircuitExampleKey[]
).map((key) => ({
  key,
  build: () => withDefaultGridSpacing(INDUSTRIAL_CIRCUIT_EXAMPLES[key]()),
  ...INDUSTRIAL_META[key],
}))

const GLOBAL_TEK_EXAMPLES: CircuitExample[] = (['document', 'corrected'] as const).map((variant) => ({
  key: `globaltek-${variant}`, title: `Global-Tek GT-CR1/BU — ${variant === 'document' ? 'Referensi dokumen' : 'Simulasi koreksi'}`,
  group: 'Dasar', verified: variant === 'corrected',
  summary: variant === 'document' ? 'Salinan sumber pp.15–17 dengan konflik label 41–43 tercatat.' : 'Kontak 41–43 mengikuti 4KM (halaman kontrol). Interpretasi simulasi, bukan revisi pabrikan.',
  tryIt: 'Isi mode dan waktu SJ1/SJ2. Hidupkan POWER, atur level air, lalu START. Sensor dapat diklik.',
  build: () => buildGlobalTek(variant),
}))
export const CIRCUIT_EXAMPLES: readonly CircuitExample[] = [...LEGACY_EXAMPLES, ...INDUSTRIAL_EXAMPLES, ...GLOBAL_TEK_EXAMPLES]
