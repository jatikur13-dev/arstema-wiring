import { describe, expect, it } from 'vitest'
import { InitialCameraRequests } from './initialCamera'

describe('Wiring initial-camera lifecycle', () => {
  it('requests both projections for a newly opened or replaced board', () => {
    const board = {}
    const requests = new InitialCameraRequests(board)
    expect(requests.pending('iec', board)).not.toBeNull()
    expect(requests.pending('virtual', board)).not.toBeNull()

    const replacement = {}
    requests.requestAll(replacement)
    expect(requests.pending('iec', board)).toBeNull()
    expect(requests.pending('iec', replacement)).not.toBeNull()
  })

  it('keeps a provisional request only until final routing is applied', () => {
    const board = {}
    const requests = new InitialCameraRequests(board)
    const pending = requests.pending('iec', board)
    expect(pending).not.toBeNull()
    requests.applied('iec', pending!, false)
    expect(requests.pending('iec', board)?.provisionalApplied).toBe(true)
    requests.applied('iec', pending!, true)
    expect(requests.pending('iec', board)).toBeNull()
  })

  it('rejects late metrics after an edit and lets user interaction cancel correction', () => {
    const loadedBoard = {}
    const editedBoard = {}
    const requests = new InitialCameraRequests(loadedBoard)
    expect(requests.pending('iec', editedBoard)).toBeNull()
    requests.cancel('iec')
    expect(requests.pending('iec', loadedBoard)).toBeNull()
  })

  it('can request first-visit centring for one projection without moving the other', () => {
    const board = {}
    const requests = new InitialCameraRequests(board)
    requests.cancel('iec')
    requests.cancel('virtual')
    requests.request('virtual', board)
    expect(requests.pending('virtual', board)).not.toBeNull()
    expect(requests.pending('iec', board)).toBeNull()
  })
})
