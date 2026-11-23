import type { BoardProjection } from '../../engine/index'

export interface InitialCameraRequest<BoardIdentity> {
  board: BoardIdentity
  provisionalApplied: boolean
}

/**
 * Small identity-based lifecycle for automatic camera work. It intentionally has
 * no knowledge of components, wires, or the solver: an edit produces a new Board
 * identity and therefore cannot accidentally consume an old centring request.
 */
export class InitialCameraRequests<BoardIdentity> {
  private readonly requests = new Map<
    BoardProjection,
    InitialCameraRequest<BoardIdentity>
  >()

  constructor(board: BoardIdentity) {
    this.requestAll(board)
  }

  requestAll(board: BoardIdentity): void {
    this.request('iec', board)
    this.request('virtual', board)
  }

  request(projection: BoardProjection, board: BoardIdentity): void {
    this.requests.set(projection, { board, provisionalApplied: false })
  }

  pending(
    projection: BoardProjection,
    board: BoardIdentity,
  ): InitialCameraRequest<BoardIdentity> | null {
    const request = this.requests.get(projection)
    return request?.board === board ? request : null
  }

  applied(
    projection: BoardProjection,
    request: InitialCameraRequest<BoardIdentity>,
    routingReady: boolean,
  ): void {
    if (this.requests.get(projection) !== request) return
    if (routingReady) this.requests.delete(projection)
    else request.provisionalApplied = true
  }

  cancel(projection: BoardProjection): void {
    this.requests.delete(projection)
  }
}
