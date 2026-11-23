/**
 * Diagnosis — turning an engine fault CODE into a human explanation.
 *
 * This is the feature side of the diagnosable contract (BOS decision M0): the
 * engine reports WHY in a machine code plus the measured values; the sentence a
 * beginner reads is assembled HERE. Keeping the wording out of the engine means
 * it can be reworded, translated, or shortened without touching the mathematics.
 */

import type { FaultRecord } from '../../engine/index'

export interface FaultExplanation {
  title: string
  /** What happened and why, in plain language for an adult beginner. */
  why: string
  /** The one thing that would prevent it. */
  fix: string
}

const CONDUCTOR_ORDER = ['R', 'S', 'T', 'L', '+', 'N', '−']

/** "R dan S", "R, S, dan T"; L and N when the engine named nothing. */
export function joinedConductors(conductors: readonly string[] | undefined): string {
  const list = [...new Set(conductors?.length ? conductors : ['L', 'N'])].sort(
    (a, b) => CONDUCTOR_ORDER.indexOf(a) - CONDUCTOR_ORDER.indexOf(b),
  )
  if (list.length <= 2) return list.join(' dan ')
  return `${list.slice(0, -1).join(', ')}, dan ${list[list.length - 1]}`
}

export function explainFault(fault: FaultRecord): FaultExplanation {
  const joined = joinedConductors(fault.conductors)
  switch (fault.code) {
    case 'SHORT_CIRCUIT_NO_LOAD':
      return {
        title: `Hubung singkat — ${joined} tersambung tanpa beban`,
        why: `${joined} terhubung langsung lewat kabel, tanpa lampu atau beban apa pun di antaranya. Tidak ada yang menahan arus (hambatannya mendekati nol), sehingga arus melonjak terus sampai melewati batas aman sumber.`,
        fix: `Sisipkan sebuah beban — misalnya lampu — pada jalur antara ${joined}. Beban itulah yang menahan arus dan menentukan besarnya.`,
      }
    case 'SHORT_CIRCUIT_TRIPPED': {
      const devices = fault.devices ?? []
      const mcbs = devices.filter((device) => device.kind === 'MCB').map((device) => device.id)
      const fuses = devices.filter((device) => device.kind === 'FUSE').map((device) => device.id)
      const opened = [
        ...(mcbs.length ? [`MCB ${mcbs.join(', ')} trip`] : []),
        ...(fuses.length ? [`sekring ${fuses.join(', ')} putus`] : []),
      ].join(', ')
      const how = [
        ...(mcbs.length ? ['pelepas magnetik MCB memutus seketika'] : []),
        ...(fuses.length ? ['elemen sekring meleleh'] : []),
      ].join(' dan ')
      const reset = [
        ...(mcbs.length ? ['matikan tuas MCB, tekan Reset, lalu nyalakan lagi'] : []),
        ...(fuses.length ? ['ganti sekring dengan mengekliknya'] : []),
      ].join('; ')
      return {
        title: `Hubung singkat — ${opened}`,
        why: `${joined} tersambung langsung tanpa beban di antaranya, sehingga arus melonjak jauh di atas arus pengenal. Proteksi di jalur itu bekerja: ${how}, dan rangkaian di belakangnya kehilangan tegangan.`,
        fix: `Cari dan lepas sambungan yang menghubungkan ${joined} secara langsung. Sesudah itu ${reset}.`,
      }
    }
    case 'LOAD_OVERCURRENT':
      return {
        title: 'Arus melebihi batas beban',
        why: 'Arus yang mengalir lebih besar daripada yang sanggup ditahan beban ini, sehingga beban rusak.',
        fix: 'Gunakan beban dengan hambatan lebih besar, atau turunkan tegangan sumber.',
      }
  }
}
