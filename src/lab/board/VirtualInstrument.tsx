import { terminalCountForComponent, type PlacedComponent } from '../../engine/index'
import { useContentPackAsset } from '../../runtime/assets'
import {
  virtualActuatorRect,
  virtualAssetLayout,
  virtualStatusRect,
  type Point,
} from './geometry'

interface VirtualInstrumentProps {
  component: PlacedComponent
  active?: boolean
  status?: string
  terminalPoint: (index: number) => Point
}

function PackedVirtualImage({ path }: { path: string }) {
  const href = useContentPackAsset('wiring-virtual', path)
  if (!href) {
    if (path.startsWith('globaltek-')) return <g>
      <rect x={100} y={110} width={1050} height={1010} rx={40} fill="#cbd5e1" stroke="#334155" strokeWidth={12} />
      <text x={627} y={540} textAnchor="middle" fontSize={80} fill="#0f172a">{path.includes('transformer') ? '415 / 110–220 V' : path.includes('heater') ? 'HEATER 3~' : 'FAN'}</text>
      <text x={627} y={645} textAnchor="middle" fontSize={48} fill="#334155">Simbol cadangan · media opsional</text>
    </g>
    return <rect x={0} y={0} width={1254} height={1254} rx={90} className="as-lab-board__field-asset-placeholder" />
  }
  return (
    <image
      href={href}
      x={0}
      y={0}
      width={1254}
      height={1254}
      preserveAspectRatio="none"
      className="as-lab-board__field-asset-image"
    />
  )
}

function stateOf(component: PlacedComponent, active: boolean): string | undefined {
  const spec = component.spec
  switch (spec.kind) {
    case 'SWITCH':
      return spec.closed ? 'closed' : 'open'
    case 'SWITCH_2WAY':
      return spec.toL2 ? 'l2' : 'l1'
    case 'SWITCH_CROSS':
      return spec.crossed ? 'crossed' : 'straight'
    case 'CONTACT_2STATE':
      if (spec.drivenBy) return active ? 'actuated' : 'normal'
      if (component.modelId === 'PHASE_MONITOR_RM17TG20') {
        return active ? 'actuated' : 'normal'
      }
      return spec.actuated ? 'actuated' : 'normal'
    case 'LIMIT_SWITCH':
    case 'SENSOR_3WIRE':
      return spec.actuated ? 'actuated' : 'normal'
    case 'SELECTOR_3POS':
      return `position-${spec.pos}`
    case 'FUSE':
      return spec.blown ? 'blown' : 'normal'
    case 'TERMINAL_BLOCK':
      return spec.open || spec.fuseBlown ? 'open' : 'closed'
    case 'ESTOP':
      return spec.pressed ? 'pressed' : 'normal'
    case 'PUSHBUTTON':
      return spec.pressed ? 'pressed' : 'released'
    case 'BREAKER_1P':
    case 'BREAKER_3P':
      return spec.on ? 'on' : 'off'
    default:
      return undefined
  }
}

/**
 * Field-equipment projection. The bitmap and every terminal anchor share the
 * exact same source-pixel viewBox transform from `virtualAssetLayout`.
 */
export function VirtualInstrument({
  component,
  active = false,
  status,
  terminalPoint,
}: VirtualInstrumentProps) {
  const layout = virtualAssetLayout(component)
  const actuator = virtualActuatorRect(component)
  const stateRegion = virtualStatusRect(component, 'state') ?? actuator
  const glowRegion = virtualStatusRect(component, 'glow') ?? actuator
  const motionRegion = virtualStatusRect(component, 'motion')
  const energizedRegion = virtualStatusRect(component, 'energized')
  const tripRegion = virtualStatusRect(component, 'trip')
  const count = terminalCountForComponent(component)
  const terminals = Array.from({ length: count }, (_unused, index) =>
    terminalPoint(index),
  )
  const state = stateOf(component, active)
  const isLamp =
    component.spec.kind === 'INDICATOR' ||
    (component.spec.kind === 'LOAD' &&
      (component.spec.symbol ?? 'lamp') === 'lamp')
  const isMotor =
    component.spec.kind === 'MOTOR' || component.spec.kind === 'MOTOR_3PH'
  const isSensor = component.spec.kind === 'SENSOR_3WIRE'
  const isIntegralPilot = component.modelId === 'ILLUMINATED_PB_XB5AW33B5'
  const terminalBlockLabel = component.spec.kind === 'TERMINAL_BLOCK'
    ? ({
        PHOENIX_UT25_BU: 'N',
        PHOENIX_UT25_PE: 'PE',
        PHOENIX_UT4_HESI: 'FUSE',
        PHOENIX_UT4_MT: 'MT',
        PHOENIX_UT25_TWIN: 'TWIN',
        PHOENIX_UT25_QUATTRO: 'QUATTRO',
        PHOENIX_UT25_PE_L_L: 'PE/L/L',
        FEED_THROUGH: 'X',
      } as const)[component.spec.model ?? 'FEED_THROUGH']
    : null

  return (
    <g
      className="as-lab-board__field-instrument"
      data-instrument-kind={component.spec.kind}
      data-active={active || undefined}
      data-status={status}
      data-state={state}
      pointerEvents="none"
    >
      {layout.layers.map((item) => (
        <svg
          key={item.id}
          x={item.bounds.x}
          y={item.bounds.y}
          width={item.bounds.width}
          height={item.bounds.height}
          viewBox={`${item.sourceViewBox.x} ${item.sourceViewBox.y} ${item.sourceViewBox.width} ${item.sourceViewBox.height}`}
          preserveAspectRatio="xMidYMid meet"
          overflow="hidden"
          className="as-lab-board__field-asset"
          data-asset-layer={item.id}
          data-source-viewbox={`${item.sourceViewBox.x},${item.sourceViewBox.y},${item.sourceViewBox.width},${item.sourceViewBox.height}`}
        >
          <PackedVirtualImage path={item.src} />
        </svg>
      ))}

      {component.spec.kind === 'CONTACTOR' && (
        <text
          x={terminals[10]?.x}
          y={(terminals[10]?.y ?? 0) - 9}
          textAnchor="middle"
          className="as-lab-board__field-aux-label"
        >
          NC
        </text>
      )}

      {terminalBlockLabel && (
        <text
          x={layout.bounds.x + layout.bounds.width / 2}
          y={layout.bounds.y + 13}
          textAnchor="middle"
          className="as-lab-board__field-aux-label"
        >
          {terminalBlockLabel}
        </text>
      )}

      {glowRegion && ((isLamp && active) || isIntegralPilot && active || (isSensor && state === 'actuated')) && (
        <ellipse
          cx={glowRegion.x + glowRegion.width / 2}
          cy={glowRegion.y + glowRegion.height / 2}
          rx={Math.max(8, glowRegion.width * 0.48)}
          ry={Math.max(8, glowRegion.height * 0.48)}
          className="as-lab-board__field-glow"
        />
      )}

      {stateRegion && state && (
        <rect
          x={stateRegion.x}
          y={stateRegion.y}
          width={stateRegion.width}
          height={stateRegion.height}
          rx={Math.min(7, stateRegion.width * 0.2)}
          className="as-lab-board__field-state-overlay"
          data-state={state}
        />
      )}

      {energizedRegion && active && (
        <rect
          x={energizedRegion.x}
          y={energizedRegion.y}
          width={energizedRegion.width}
          height={energizedRegion.height}
          rx={Math.min(7, energizedRegion.width * 0.2)}
          className="as-lab-board__field-energized-overlay"
        />
      )}

      {tripRegion && status === 'tripped' && (
        <rect
          x={tripRegion.x}
          y={tripRegion.y}
          width={tripRegion.width}
          height={tripRegion.height}
          rx={Math.min(7, tripRegion.width * 0.2)}
          className="as-lab-board__field-trip-overlay"
        />
      )}

      {isMotor && active && motionRegion && (
        <circle
          cx={motionRegion.x + motionRegion.width / 2}
          cy={motionRegion.y + motionRegion.height / 2}
          r={Math.min(motionRegion.width, motionRegion.height) * 0.42}
          className="as-lab-board__field-motor-running"
        />
      )}

      <g className="as-lab-board__physical-terminal-anchors">
        {terminals.map((terminal, index) => (
          <circle
            key={index}
            cx={terminal.x}
            cy={terminal.y}
            r={6.5}
            className="as-lab-board__physical-terminal-anchor"
            data-terminal-key={`${component.id}:${index}`}
            data-terminal-index={index}
          />
        ))}
      </g>
    </g>
  )
}
