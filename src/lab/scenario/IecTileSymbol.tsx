import type { ComponentKind } from '../../engine/index'

/**
 * Mini IEC symbol for a palette tile.
 *
 * The professional tile shows the mark the component will actually leave on the
 * drawing, not an abbreviation of its name. A technician scanning the palette
 * should recognise the part the same way they recognise it on a schematic —
 * a normally-open contact by its broken line, a coil by its box on A1/A2, a
 * heater by its hatched rectangle.
 *
 * These are TILE previews: 40×24, stroke only, no state, no terminals. The
 * board keeps drawing the full symbols; nothing here feeds geometry or the
 * solver.
 */

const W = 40
const H = 24
const MID = H / 2

/** Two lead stubs, left and right, so every symbol sits on the same baseline. */
function Leads({ from = 6, to = W - 6 }: { from?: number; to?: number }) {
  return (
    <>
      <line x1={0} y1={MID} x2={from} y2={MID} />
      <line x1={to} y1={MID} x2={W} y2={MID} />
    </>
  )
}

/** A hinged contact: closed lies flat, open lifts at an angle. */
function Contact({ open, nc = false }: { open: boolean; nc?: boolean }) {
  return (
    <>
      <Leads />
      <circle cx={6} cy={MID} r={1.6} className="as-iec-tile__node" />
      <circle cx={W - 6} cy={MID} r={1.6} className="as-iec-tile__node" />
      <line x1={6} y1={MID} x2={W - 6} y2={open ? MID - 7 : MID} />
      {nc ? <line x1={W - 6} y1={MID - 8} x2={W - 6} y2={MID + 4} /> : null}
    </>
  )
}

function Coil() {
  return (
    <>
      <Leads from={10} to={W - 10} />
      <rect x={10} y={MID - 7} width={W - 20} height={14} />
    </>
  )
}

function CircleGlyph({ text }: { text: string }) {
  return (
    <>
      <Leads from={MID - 2} to={W - MID + 2} />
      <circle cx={W / 2} cy={MID} r={9} />
      <text x={W / 2} y={MID + 3.5} className="as-iec-tile__text">
        {text}
      </text>
    </>
  )
}

function Heater() {
  return (
    <>
      <Leads from={9} to={W - 9} />
      <rect x={9} y={MID - 6} width={W - 18} height={12} />
      {[0, 1, 2].map((i) => (
        <line key={i} x1={14 + i * 6} y1={MID - 6} x2={14 + i * 6} y2={MID + 6} />
      ))}
    </>
  )
}

function Lamp() {
  return (
    <>
      <Leads from={MID - 2} to={W - MID + 2} />
      <circle cx={W / 2} cy={MID} r={8} />
      <line x1={W / 2 - 5.7} y1={MID - 5.7} x2={W / 2 + 5.7} y2={MID + 5.7} />
      <line x1={W / 2 - 5.7} y1={MID + 5.7} x2={W / 2 + 5.7} y2={MID - 5.7} />
    </>
  )
}

function MultiTerminal({ variant }: { variant: 'TWIN' | 'QUATTRO' | 'MULTILEVEL' }) {
  if (variant === 'MULTILEVEL') {
    return (
      <>
        {[5, 12, 19].map((y) => <g key={y}><line x1={0} y1={y} x2={W} y2={y} /><circle cx={10} cy={y} r={1.5} /><circle cx={30} cy={y} r={1.5} /></g>)}
      </>
    )
  }
  const ys = variant === 'TWIN' ? [7, 17] : [7, 17]
  return (
    <>
      {variant === 'TWIN' ? <line x1={0} y1={MID} x2={18} y2={MID} /> : ys.map((y) => <line key={`l${y}`} x1={0} y1={y} x2={18} y2={y} />)}
      {ys.map((y) => <line key={`r${y}`} x1={22} y1={y} x2={W} y2={y} />)}
      <rect x={16} y={4} width={8} height={16} />
      <line x1={18} y1={MID} x2={22} y2={7} /><line x1={18} y1={MID} x2={22} y2={17} />
    </>
  )
}

function SYMBOL(kind: ComponentKind, key: string) {
  switch (key) {
    case 'BATTERY_24V':
    case 'DIN_PSU_HDR3024':
      return (
        <>
          <Leads from={15} to={25} />
          <line x1={15} y1={MID - 8} x2={15} y2={MID + 8} />
          <line x1={25} y1={MID - 5} x2={25} y2={MID + 5} />
          <text x={8} y={MID - 5} className="as-iec-tile__text">+</text>
          <text x={30} y={MID - 5} className="as-iec-tile__text">−</text>
        </>
      )
    case 'CONTROL_TRANSFORMER_ABL6TS25B':
      return (
        <>
          <Leads from={9} to={W - 9} />
          <path d={`M 11 ${MID - 7} q -5 3 0 6 t 0 6 t 0 6 M 29 ${MID - 7} q 5 3 0 6 t 0 6 t 0 6`} fill="none" />
          <line x1={18} y1={MID - 8} x2={18} y2={MID + 8} />
          <line x1={22} y1={MID - 8} x2={22} y2={MID + 8} />
        </>
      )
    case 'PUSHBUTTON_NC':
      return <Contact nc open={false} />
    case 'PUSHBUTTON_NO':
      return <Contact open />
    case 'LOAD_HEATER':
      return <Heater />
    case 'LOAD_RESISTOR':
      return (
        <>
          <Leads from={9} to={W - 9} />
          <rect x={9} y={MID - 5} width={W - 18} height={10} />
        </>
      )
    case 'LOAD_BELL':
      return (
        <>
          <Leads from={MID - 2} to={W - MID + 2} />
          <path d={`M ${W / 2 - 9} ${MID + 6} A 9 9 0 0 1 ${W / 2 + 9} ${MID + 6} Z`} />
        </>
      )
    case 'SOLENOID_VXE21':
      return (
        <>
          <Leads from={8} to={W - 8} />
          <rect x={8} y={MID - 7} width={14} height={14} />
          <line x1={9} y1={MID + 6} x2={21} y2={MID - 6} />
          <path d={`M 25 ${MID - 7} v 14 M 25 ${MID} h 10`} fill="none" />
        </>
      )
    case 'LIMIT_SWITCH_D4N':
      return (
        <>
          <Contact nc open={false} />
          <line x1={W / 2} y1={1} x2={W / 2} y2={7} strokeDasharray="2 2" />
        </>
      )
    case 'TERMINAL_UT4_HESI':
      return <><Leads from={10} to={W - 10} /><rect x={10} y={MID - 5} width={W - 20} height={10} /><line x1={13} y1={MID} x2={W - 13} y2={MID} /></>
    case 'TERMINAL_UT4_MT':
      return <Contact open />
    case 'TERMINAL_UT25_TWIN':
      return <MultiTerminal variant="TWIN" />
    case 'TERMINAL_UT25_QUATTRO':
      return <MultiTerminal variant="QUATTRO" />
    case 'TERMINAL_UT25_PE_LL':
      return <MultiTerminal variant="MULTILEVEL" />
    case 'TERMINAL_BLOCK':
    case 'TERMINAL_UT25_BU':
    case 'TERMINAL_UT25_PE':
      return (
        <>
          <Leads from={8} to={W - 8} />
          <rect x={8} y={MID - 7} width={W - 16} height={14} />
          <circle cx={14} cy={MID} r={2.5} className="as-iec-tile__node" />
          <circle cx={W - 14} cy={MID} r={2.5} className="as-iec-tile__node" />
          <line x1={14} y1={MID} x2={W - 14} y2={MID} />
        </>
      )
    case 'SENSOR_E2E_PNP_NO':
    case 'SENSOR_E2E_NPN_NO':
    case 'SENSOR_E2E_PNP_NC':
    case 'SENSOR_E2E_NPN_NC':
    case 'SENSOR_E2K_PNP_NO':
    case 'SENSOR_E3Z_PNP_LIGHT_ON':
    case 'SENSOR_E3Z_D61_NPN_LIGHT':
    case 'SENSOR_E3Z_D61_NPN_DARK':
    case 'SENSOR_E3Z_D81_PNP_DARK':
    case 'SENSOR_E2K_X4ME1':
      return (
        <>
          <rect x={10} y={MID - 8} width={23} height={16} />
          <path d={`M 7 ${MID - 5} q -5 5 0 10 M 4 ${MID - 8} q -8 8 0 16`} fill="none" />
          <line x1={33} y1={MID} x2={W} y2={MID} />
        </>
      )
    default:
      break
  }

  switch (kind) {
    case 'SOURCE':
      return <CircleGlyph text="~" />
    case 'SOURCE_3PH':
      return <CircleGlyph text="3~" />
    case 'MOTOR':
      return <CircleGlyph text="M" />
    case 'MOTOR_3PH':
      return <CircleGlyph text="M3" />
    case 'LOAD':
    case 'INDICATOR':
      return <Lamp />
    case 'FUSE':
      return (
        <>
          <Leads from={10} to={W - 10} />
          <rect x={10} y={MID - 5} width={W - 20} height={10} />
          <line x1={10} y1={MID} x2={W - 10} y2={MID} />
        </>
      )
    case 'BREAKER_1P':
    case 'BREAKER_3P':
      return <Contact open />
    case 'SWITCH':
      return <Contact open />
    case 'ESTOP':
      return <Contact nc open={false} />
    case 'CONTACT_2STATE':
    case 'SWITCH_2WAY':
      return (
        <>
          <line x1={0} y1={MID} x2={6} y2={MID} />
          <circle cx={6} cy={MID} r={1.6} className="as-iec-tile__node" />
          <line x1={6} y1={MID} x2={W - 6} y2={MID - 6} />
          <line x1={W - 6} y1={MID - 6} x2={W} y2={MID - 6} />
          <line x1={W - 6} y1={MID + 6} x2={W} y2={MID + 6} />
        </>
      )
    case 'LIMIT_SWITCH':
      return <Contact nc open={false} />
    case 'SENSOR_3WIRE':
      return <CircleGlyph text="B" />
    case 'TERMINAL_BLOCK':
      return <Leads />
    case 'SWITCH_CROSS':
      return (
        <>
          <line x1={0} y1={MID - 6} x2={W} y2={MID + 6} />
          <line x1={0} y1={MID + 6} x2={W} y2={MID - 6} />
          <rect x={12} y={MID - 8} width={16} height={16} />
        </>
      )
    case 'SELECTOR_3POS':
      return (
        <>
          <line x1={0} y1={MID} x2={8} y2={MID} />
          <circle cx={8} cy={MID} r={1.6} className="as-iec-tile__node" />
          <line x1={8} y1={MID} x2={W - 8} y2={MID - 7} />
          <circle cx={W - 6} cy={MID - 7} r={1.4} className="as-iec-tile__node" />
          <circle cx={W - 6} cy={MID} r={1.4} className="as-iec-tile__node" />
          <circle cx={W - 6} cy={MID + 7} r={1.4} className="as-iec-tile__node" />
        </>
      )
    case 'CONTACTOR':
    case 'RELAY':
    case 'TIMER':
      return <Coil />
    case 'OVERLOAD_RELAY':
      return (
        <>
          <Leads from={10} to={W - 10} />
          <rect x={10} y={MID - 7} width={W - 20} height={14} />
          <path d={`M ${W / 2 - 5} ${MID + 3} l 4 -6 l 3 4 l 4 -5`} fill="none" />
        </>
      )
    case 'CAPACITOR':
      return (
        <>
          <Leads from={W / 2 - 4} to={W / 2 + 4} />
          <line x1={W / 2 - 4} y1={MID - 8} x2={W / 2 - 4} y2={MID + 8} />
          <line x1={W / 2 + 4} y1={MID - 8} x2={W / 2 + 4} y2={MID + 8} />
        </>
      )
    case 'GROUND':
      return (
        <>
          <line x1={W / 2} y1={2} x2={W / 2} y2={MID + 1} />
          <line x1={W / 2 - 9} y1={MID + 2} x2={W / 2 + 9} y2={MID + 2} />
          <line x1={W / 2 - 6} y1={MID + 6} x2={W / 2 + 6} y2={MID + 6} />
          <line x1={W / 2 - 3} y1={MID + 10} x2={W / 2 + 3} y2={MID + 10} />
        </>
      )
    default:
      return <Leads />
  }
}

export interface IecTileSymbolProps {
  kind: ComponentKind
  paletteKey: string
}

export function IecTileSymbol({ kind, paletteKey }: IecTileSymbolProps) {
  return (
    <svg
      aria-hidden="true"
      className="as-iec-tile"
      focusable="false"
      viewBox={`0 0 ${W} ${H}`}
    >
      {SYMBOL(kind, paletteKey)}
    </svg>
  )
}
