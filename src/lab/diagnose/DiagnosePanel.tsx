/**
 * DiagnosePanel — the "mengapa" that appears after a fault.
 *
 * It reads the engine's FaultRecord (code + measured values) and renders the
 * explanation assembled in faultExplanations. The measured current and its limit
 * are shown so the reader can tie the number they watched climb to the reason it
 * tripped — the diagnosable loop closed.
 */

import type { FaultRecord } from '../../engine/index'
import { explainFault } from './faultExplanations'

export interface DiagnosePanelProps {
  fault: FaultRecord
}

export function DiagnosePanel({ fault }: DiagnosePanelProps) {
  const explanation = explainFault(fault)
  // A protective device that opened the short is protection working, not a blast.
  const protectedTrip = fault.code === 'SHORT_CIRCUIT_TRIPPED'
  return (
    <section className="as-lab-diagnose" role="alert" aria-live="assertive">
      <p className="as-lab-diagnose__tag">{protectedTrip ? 'Proteksi bekerja' : 'Rangkaian meledak'}</p>
      <h3 className="as-lab-diagnose__title">{explanation.title}</h3>

      <dl className="as-lab-diagnose__reading">
        <div>
          <dt>{protectedTrip ? 'Arus saat trip' : 'Arus saat meledak'}</dt>
          <dd>{fault.measured.currentAmps.toFixed(1)} A</dd>
        </div>
        {protectedTrip ? (
          fault.measured.ratedAmps !== undefined && (
            <div>
              <dt>Arus pengenal MCB</dt>
              <dd>{fault.measured.ratedAmps.toFixed(1)} A</dd>
            </div>
          )
        ) : (
          <div>
            <dt>Batas aman</dt>
            <dd>{fault.measured.limitAmps.toFixed(1)} A</dd>
          </div>
        )}
      </dl>

      <p className="as-lab-diagnose__why">
        <span className="as-lab-diagnose__lead">Mengapa: </span>
        {explanation.why}
      </p>
      <p className="as-lab-diagnose__fix">
        <span className="as-lab-diagnose__lead">Perbaikan: </span>
        {explanation.fix}
      </p>
    </section>
  )
}


