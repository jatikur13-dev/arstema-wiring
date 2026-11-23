import type { Board, TimerSpec } from '../engine/index'
import { circuitRunRequirements } from '../engine/runRequirements'
import { globalTekTerminalName } from './examples/globalTek'

export function GlobalTekPanel({ board, timing, mode, open, onOpenChange }: {
  board: Board
  timing: (id: string, duration: number, transfer: number) => void
  mode: (id: string, mode: NonNullable<TimerSpec['mode']>) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  if (!board.reference) return null
  const issues = circuitRunRequirements(board)
  return <details className="as-lab__source-panel" open={open} onToggle={(event) => onOpenChange(event.currentTarget.open)}>
    <summary>{board.reference.title}</summary>
    <p>{board.reference.document}</p>
    {board.reference.conflicts.map((c) => <p key={c.id}>{c.description}</p>)}
    <p>Setelan timer simulasi — isi dari perangkat atau pilih nilai latihan sendiri.</p>
    {Object.values(board.components).filter((c) => c.spec.kind === 'TIMER' && c.spec.model === 'GENERIC_CONFIGURABLE').map((c) => {
      const spec = c.spec as TimerSpec
      return <div className="as-lab__timer-config" key={c.id}>
        <label>{c.id} mode <select aria-label={`${c.id} mode simulasi`} value={spec.mode ?? ''}
          onChange={(e) => mode(c.id, e.target.value as NonNullable<TimerSpec['mode']>)}>
          <option value="" disabled>Pilih mode</option>
          <option value="A">ON-delay</option><option value="E">Interval</option>
          <option value="B">Berkedip mulai OFF</option><option value="B2">Berkedip mulai ON</option>
          <option value="J">Pulsa setelah delay</option>
        </select></label>
        <label>Waktu (detik) <input aria-label={`${c.id} waktu detik`} type="number" min="0.1" max="86400" step="0.1"
          value={spec.starDurationMs ? spec.starDurationMs / 1000 : ''}
          onChange={(e) => timing(c.id, Number(e.target.value) * 1000, 0)} /></label>
      </div>
    })}
    {issues.length > 0 && <p role="status">{issues.join(' ')}</p>}
    <details><summary>Catatan sumber dan parameter</summary>{board.reference.notes.map((note) => <p key={note}>{note}</p>)}</details>
    <details><summary>Komponen dan daftar sambungan ({Object.keys(board.wires).length})</summary>
      <div className="as-lab__source-table"><table><thead><tr><th>Komponen</th><th>Keterangan</th><th>Hal.</th></tr></thead><tbody>
        {Object.values(board.components).map((c) => <tr key={c.id}><td>{c.id}</td><td>{c.source?.description}</td><td>{c.source?.pages.join(', ')}</td></tr>)}
      </tbody></table><table><thead><tr><th>Kabel</th><th>Dari</th><th>Ke</th><th>Hal.</th></tr></thead><tbody>
        {Object.values(board.wires).map((w) => <tr key={w.id}><td title={w.source?.note}>{w.source?.number ?? w.id}</td><td>{globalTekTerminalName(board, w.from)}</td><td>{globalTekTerminalName(board, w.to)}</td><td>{w.source?.pages.join(', ')}</td></tr>)}
      </tbody></table></div>
    </details>
  </details>
}
