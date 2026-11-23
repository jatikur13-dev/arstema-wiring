import {
  routeBoardWires,
  type Rect,
  type TerminalKeepOut,
  type WireRouteRequest,
} from './geometry'

interface RoutingWorkerRequest {
  requestId: number
  key: string
  requests: WireRouteRequest[]
  obstacles: Rect[]
  terminalKeepOuts: TerminalKeepOut[]
}

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RoutingWorkerRequest>) => void) | null
  postMessage(message: unknown): void
}

scope.onmessage = (event) => {
  const { requestId, key, requests, obstacles, terminalKeepOuts } = event.data
  const geometries = routeBoardWires(requests, obstacles, terminalKeepOuts)
  scope.postMessage({ requestId, key, geometries })
}
