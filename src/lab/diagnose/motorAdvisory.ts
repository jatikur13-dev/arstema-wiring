/**
 * Motor advisory — the "why it only hums" explanation (M1).
 *
 * A capacitorless single-phase motor is NOT a fault: it energises and hums but
 * cannot start. The engine reports the status code (HUMMING); the sentence a
 * beginner reads is assembled here, the same fault-code ↔ diagnosis separation
 * used for the explosion panel.
 */
export interface MotorAdvisory {
  title: string
  why: string
}

export function motorHummingAdvisory(): MotorAdvisory {
  return {
    title: 'Motor berdengung, tidak berputar',
    why: 'Motor 1-fasa butuh kapasitor di belitan bantu (aux) untuk mulai berputar. Tanpa kapasitor tidak ada beda fasa → tidak ada torsi awal → motor hanya berdengung dan menarik arus tinggi. Tambahkan kapasitor antara terminal bantu (aux) dan salah satu terminal utama motor.',
  }
}


