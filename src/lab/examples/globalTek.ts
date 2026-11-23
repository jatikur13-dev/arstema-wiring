import type { Board, ComponentSpec, Terminal, Wire } from '../../engine/index'
import { resolvedTerminalDefinitions } from '../../engine/index'
import { OVERLOAD_SPEC, MOTOR_3PH_SPEC, BREAKER_3P_SPEC } from '../scenario/topic1a'
import { withDefaultGridSpacing } from './defaultLayout'

export const GLOBAL_TEK_DOCUMENT = 'Conveyor Type Single Tank (BU) Manual (1).pdf · GT-CR1/BU · pp.15–17'
export const GLOBAL_TEK_KEYS = ['globaltek-document', 'globaltek-corrected'] as const
export type GlobalTekKey = typeof GLOBAL_TEK_KEYS[number]
const t = (componentId: string, index: number): Terminal => ({ componentId, index })

/** Literal labelled net schedule, not a second simulated state machine. Every
 * join below produces an editable physical wire; deleting it affects the solve. */
export function buildGlobalTek(variant: 'document' | 'corrected'): Board {
  const board: Board = {
    domain: 'ac-three-phase-balanced', components: {}, wires: {},
    reference: {
      templateId: `globaltek-${variant}`, variant,
      title: `Global-Tek GT-CR1/BU — ${variant === 'document' ? 'Referensi dokumen' : 'Simulasi koreksi'}`,
      document: GLOBAL_TEK_DOCUMENT,
      notes: [
        '415 V tiga fasa + PE. Manual menyebut 50 Hz; gambar daya menyebut 50/60 Hz. Perhitungan beban memakai model resistif RMS.',
        'Halaman 15: 41–43 = kontak 4KM. Halaman 17: kontak tersebut digambar di 3KM. Koreksi mengikuti halaman kontrol, bukan revisi pabrikan.',
        'Halaman 16 menampilkan 3K dua kali dan tidak menamai 4K. Identitas proteksi mengikuti halaman 17; posisi panel disusun ulang.',
        'Halaman 15 memasok 2FU dari 207, sedangkan tap 220 V pada p.17 bernomor 205. Referensi membiarkan 207 terpisah; varian koreksi menambahkan jumper 205–207 secara eksplisit (interpretasi, bukan revisi pabrikan).',
        'Kondisi sensor dioperasikan sebagai kontak: normal COM–NC, aktif COM–NO. Hubungan posisi mekanis/level air terhadap kontak harus diperiksa di mesin; tidak diasumsikan sebagai proteksi dry-run tersertifikasi.',
        'Model koil, impedansi motor, karakteristik proteksi, fan dan solenoid adalah contoh simulasi. Daya motor adalah nameplate mekanik, bukan hasil ukur input.',
        'Heater memakai ekuivalen delta seimbang 9 kW, bukan klaim konfigurasi belitan pabrikan. PE tidak disatukan dengan net 2.',
        'Motor menggunakan ekuivalen resistif STAR dengan enam terminal simulasi; manual hanya menggambar tiga terminal masuk. Terminal tambahan dan resistansi bukan data belitan pabrikan.',
        'Nomor terminal generik COM/NC/NO melengkapi kontak tanpa nomor pada manual. Label POWER L12/L13 bertabrakan dengan feeder heater; sambungan diikuti secara geometris, net internal tetap terpisah. Tulisan 97 AMP / 35 mm² pada p.17 tidak dipakai untuk mengarang kurva proteksi.',
        'SJ1/SJ2: pilih mode dan waktu sebelum Run. Sensor level, suhu dan posisi digerakkan manual; tidak ada simulasi air/termal.',
      ],
      conflicts: [{ id: 'aux-41-43', resolved: variant === 'corrected', description: variant === 'document'
        ? 'Kontak 41–43 berbeda: 4KM (p.15) / 3KM (p.17). Run diblokir; pilih template Simulasi koreksi.'
        : 'Interpretasi koreksi 41–43: mengikuti koil 4KM seperti p.15. Susunan p.17 tidak dianggap revisi resmi.' }],
    },
  }
  const nets = new Map<string, Terminal>()
  let seq = 0
  function add(id: string, spec: ComponentSpec, x: number, y: number, description: string, pages = [15], label = id) {
    board.components[id] = { id, spec, cell: { x, y }, source: { label, description, pages } }
  }
  function net(number: string, pins: Terminal[], pages = [15]) {
    for (const pin of pins) {
      const root = nets.get(number)
      if (!root) nets.set(number, pin)
      else if (root.componentId !== pin.componentId || root.index !== pin.index) {
        const id = `GT-${++seq}`
        board.wires[id] = { id, from: root, to: pin, source: { number, pages } }
        // A real editable distribution chain, not dozens of long spokes from TR.
        // Ideal-net connectivity is unchanged; each intermediate jumper is explicit.
        if (!['L11','L21','L31','53','37'].includes(number)) nets.set(number, pin)
      }
    }
  }
  function pair(numberA: string, numberB: string, id: string, a = 0, b = 1, pages = [15]) {
    net(numberA, [t(id, a)], pages); net(numberB, [t(id, b)], pages)
  }
  function contact(id: string, owner: string, kind: 'relay' | 'contactor', no: boolean, a: string, b: string, x: number, y: number) {
    const pages = id === 'AUX-41-43' ? [15,17] : id === '5KM-DETERGENT' || id === 'J4-RINSE-AID' ? [17] : [15]
    add(id, { kind: 'CONTACT_2STATE', actuated: false, drivenBy: { id: owner, kind } }, x, y, `${owner} kontak ${no ? 'NO' : 'NC'} · kabel ${a}–${b}`, pages, owner)
    // J1 alone specifies 12 (line 7) / 11 (line 9) explicitly on p.15.
    pair(a, b, id, id === 'J1-12-11' ? 1 : 0, id === 'J1-12-11' ? 0 : no ? 2 : 1, pages)
  }
  function sensor(id: string, description: string, a: string, b: string, x: number, y: number, no = false) {
    add(id, { kind: 'CONTACT_2STATE', actuated: false }, x, y, description)
    pair(a, b, id, 0, no ? 2 : 1)
  }
  function coil(id: string, a: string, x: number, y: number, description: string) {
    add(id, { kind: 'RELAY', coilResistanceOhms: 5500, pickupAmps: 0.015 }, x, y, description)
    pair(a, '2', id)
  }
  function timer(id: string, a: string, x: number, y: number) {
    add(id, { kind: 'TIMER', model: 'GENERIC_CONFIGURABLE', configured: false, starDurationMs: 0, transitionDelayMs: 0 }, x, y, 'Timer generik; model/mode/waktu pabrikan tidak tercantum')
    pair(a, '2', id)
  }
  add('SUPPLY', { kind: 'SOURCE_3PH', vLineToLineVolts: 415, tripAmps: 100 }, 0, 0, 'Suplai 415 V; terminal N internal tidak dihubungkan', [17], 'L1/L2/L3')
  add('PE', { kind: 'GROUND' }, 0, 18, 'Protective earth', [16, 17])
  net('PE', [t('PE', 0)], [16, 17])
  for (let p = 0; p < 3; p++) net(`L${p + 1}`, [t('SUPPLY', p)], [17])
  const feeders = ['4K', '1K', '2K', '3K']
  const feedNets = [['L11', 'L21', 'L31'], ['L12', 'L22', 'L32'], ['L13', 'L23', 'L33'], ['L14', 'L24', 'L34']]
  feeders.forEach((id, i) => {
    add(id, { ...BREAKER_3P_SPEC, on: i === 0, protectionDisabled: true }, 7 + i * 12, 0, 'Pemutus tiga kutub; rating/kurva trip tidak ditentukan manual', [16, 17])
    for (let p = 0; p < 3; p++) pair(`L${p + 1}`, feedNets[i][p], id, p * 2, p * 2 + 1, [17])
  })
  add('POWER', { kind: 'SWITCH', closed: false }, 0, 5, 'POWER kontrol trafo', [16, 17])
  pair('L11', 'TR-PRIMARY', 'POWER', 0, 1, [17])
  add('TR', { kind: 'SOURCE', emfVolts: 110, tripAmps: 100, transformer: { primaryVolts: 415, tapVolts: [110, 220] } }, 0, 10, 'Trafo ideal primer 415 V; sekunder 0/110/220 V', [16, 17])
  pair('TR-PRIMARY', 'L2', 'TR', 0, 1, [17])
  net('2', [t('TR', 2)], [15, 17]); net('1', [t('TR', 3)], [15, 17]); net('205', [t('TR', 4)], [17])
  ;['1FU', '2FU', '3FU', '4FU'].forEach((id, i) => {
    add(id, { kind: 'FUSE', blown: false }, i * 5, 22, 'Sekring; rating tidak tercantum', [15, 16, 17])
    pair(i === 0 ? '1' : i === 1 ? '207' : '205', ['7', '209', '401', '405'][i], id, 0, 1, [15, 17])
  })
  if (variant === 'corrected') {
    const id = 'GT-ALIAS-205-207'
    board.wires[id] = { id, from: t('TR', 4), to: t('2FU', 0), source: { number: '205↔207', pages: [15, 17], note: 'Interpretasi tap 220 V menuju fan/lampu; nomor sumber berbeda.' } }
  }
  const motorIds = ['M1', 'M2']
  const contactors = ['5KM', '4KM', '3KM', '1KM', '2KM']
  contactors.forEach((id, i) => {
    const x = 7 + i * 10
    add(id, { kind: 'CONTACTOR', ratedCoilVolts: 110, coilResistanceOhms: 5500 }, x, 7, ['Conveyor', 'Wash motor', 'Wash tank heat', 'Booster A/B', 'Booster C/D'][i], [15, 16, 17])
    pair(['53', '55', '19', '49', '49'][i], i < 2 ? `FR-${i}` : '2', id)
    const feeder = i < 2 ? 0 : i - 1
    for (let p = 0; p < 3; p++) pair(feedNets[feeder][p], `${id}-OUT-${p}`, id, 2 + p * 2, 3 + p * 2, [17])
    if (i < 2) {
      const ol = `FR${i + 1}`
      add(ol, { ...OVERLOAD_SPEC, ratedCurrentAmps: i === 0 ? 2 : 8 }, x, 12, `${motorIds[i]} overload; kurva/arus contoh simulasi`, [15, 16, 17], 'FR')
      pair(`FR-${i}`, '2', ol, 6, 7)
      add(motorIds[i], { ...MOTOR_3PH_SPEC, windingResistanceOhms: 415 ** 2 / (i === 0 ? 200 : 1500) }, x, 17, i === 0 ? 'Conveyor motor 0,2 kW' : 'Wash motor 1,5 kW', [17])
      for (let p = 0; p < 3; p++) {
        pair(`${id}-OUT-${p}`, `${motorIds[i]}-${p}`, ol, p * 2, p * 2 + 1, [17])
        net(`${motorIds[i]}-${p}`, [t(motorIds[i], p * 2)], [17])
        net(`${motorIds[i]}-STAR`, [t(motorIds[i], p * 2 + 1)], [17])
      }
      net('PE', [t(motorIds[i], 6)], [17])
    } else {
      const heaters = i === 2 ? ['WASH-HEATER'] : i === 3 ? ['BOOSTER-A', 'BOOSTER-B'] : ['BOOSTER-C', 'BOOSTER-D']
      heaters.forEach((h, hi) => {
        add(h, { kind: 'LOAD', symbol: 'heater', resistanceOhms: 3 * 415 ** 2 / 9000, ratedCurrentAmps: 30,
          threePhase: { powerWatts: 9000, lineVolts: 415 } }, x + hi * 5, 14 + hi * 5, 'Heater 9 kW; ekuivalen tiga fasa seimbang', [17])
        for (let p = 0; p < 3; p++) net(`${id}-OUT-${p}`, [t(h, p)], [17])
        net('PE', [t(h, 3)], [17])
      })
    }
  })
  // Control schedule, p.15: explicit line numbers retain cross-page identity.
  contact('J1-12-11', 'J1', 'relay', false, '7', '9', 0, 29)
  coil('J5', '9', 0, 45, 'Tank heat relay')
  timer('SJ1', '9', 5, 45)
  sensor('LEVEL-LOW', 'Wash tank low level · kontak manual NC/NO; posisi fisik perlu verifikasi', '7', '9', 10, 29)
  sensor('LEVEL-HIGH', 'Wash tank high level · kontak manual NC/NO; posisi fisik perlu verifikasi', '9', '11', 10, 34)
  pair('11', '13', 'SJ1', 2, 3)
  coil('J1', '13', 10, 45, 'Wash tank level relay')
  add('SV1', { kind: 'LOAD', symbol: 'solenoid_valve', resistanceOhms: 1210, ratedCurrentAmps: 1 }, 15, 45, 'Fill solenoid 110 V; 10 W contoh')
  pair('13', '2', 'SV1')
  contact('J5-HEAT', 'J5', 'relay', true, '7', '15', 20, 29)
  sensor('3TAS', 'Wash thermostat; aktif=suhu tercapai', '15', '17', 20, 34)
  contact('1KM-NC', '1KM', 'contactor', false, '17', '19', 20, 39)
  sensor('DOOR', 'Door magnetic switch; aktif=pintu terbuka', '7', '23', 25, 29)
  add('STOP', { kind: 'PUSHBUTTON', normallyOpen: false, pressed: false }, 25, 34, 'STOP NC')
  pair('23', '25', 'STOP')
  add('START', { kind: 'PUSHBUTTON', normallyOpen: true, pressed: false }, 25, 39, 'START NO')
  pair('25', '27', 'START')
  contact('J2-HOLD', 'J2', 'relay', true, '25', '27', 30, 39)
  sensor('KN', 'Conveyor clutch overload switch; aktif=macet', '27', '29', 25, 44)
  sensor('F', 'Kontak F pada dokumen; normal tertutup', '29', '31', 25, 49)
  contact('J3-START', 'J3', 'relay', false, '31', '33', 25, 54)
  coil('J2', '33', 25, 59, 'Start/self-hold relay')
  sensor('X1', 'Wash rack actuator; aktif=rak masuk', '27', '35', 35, 44, true)
  coil('J3', '35', 35, 49, 'Wash actuator relay')
  sensor('2K-MODE', 'Manual/Auto; normal=Auto (jalur timer tersambung), aktif=Manual', '27', '37', 40, 44)
  contact('J3-TIMER', 'J3', 'relay', false, '37', '39', 40, 49)
  timer('SJ2', '39', 40, 54)
  sensor('X2', 'Rinse rack actuator; aktif=rak di bilas', '27', '41', 45, 44, true)
  contact('AUX-41-43', variant === 'corrected' ? '4KM' : '3KM', 'contactor', true, '41', '43', 45, 49)
  coil('J4', '43', 45, 54, 'Rinse relay')
  contact('J4-RINSE', 'J4', 'relay', true, '7', '45', 50, 29)
  contact('J1-RINSE', 'J1', 'relay', true, '23', '45', 50, 34)
  add('SV2', { kind: 'LOAD', symbol: 'solenoid_valve', resistanceOhms: 1210, ratedCurrentAmps: 1 }, 50, 45, 'Rinse solenoid 110 V; 10 W contoh')
  pair('45', '2', 'SV2')
  sensor('1TAS', 'Rinse thermostat; aktif=suhu tercapai', '7', '47', 55, 29)
  sensor('2TAS', 'Booster over-temperature protector; aktif=overheat', '47', '49', 55, 34)
  pair('7', '51', 'SJ2', 2, 3)
  contact('J2-MOTORS', 'J2', 'relay', true, '51', '53', 60, 39)
  // The 5KM NO contact starts wash only after the conveyor contactor picks up.
  pair('53', '55', '5KM', 8, 9)
  contact('5KM-DETERGENT', '5KM', 'contactor', true, '401', '403', 5, 60)
  contact('J4-RINSE-AID', 'J4', 'relay', true, '405', '407', 10, 60)
  for (const [i, id] of ['FAN1', 'FAN2', 'POWER-LAMP'].entries()) {
    add(id, { kind: 'LOAD', symbol: i === 2 ? 'lamp' : 'fan', resistanceOhms: i === 2 ? 9680 : 2420, ratedCurrentAmps: 1 }, i * 5, 66,
      i === 2 ? 'Power lamp 220 V; 5 W contoh' : `Fan ${i + 1}, 220 V; beban 20 W contoh`, [15], i === 2 ? 'Power Lamp' : `M${i + 1} Fan`)
    pair('209', '2', id)
  }
  // Terminal strip A–A p.16. Repeated designations represent real jumpered blocks.
  const strip = ['PE','PE','403','407','209','2','2','2','7','7','7','9','9','11','13','15','17','23','25','27','27','27','29','31','35','37','41','45','49']
  strip.forEach((name, i) => {
    const id = `X-AA-${i + 1}`
    add(id, { kind: 'TERMINAL_BLOCK' }, (i % 15) * 3, 74 + Math.floor(i / 15) * 5, `Terminal A–A posisi ${i + 1} · ${name}`, [16], name)
    net(name, [t(id, 0)], [16])
  })
  // Keep original field-wire designations, including repeated U2/V2/W2 on p.17.
  // These are labels only: identity and electrical connectivity never use text.
  for (const w of Object.values(board.wires)) {
    if (!w.source) continue
    const n=w.source.number
    if (/^M[12]-[012]$/.test(n)) w.source.number = `${['U','V','W'][Number(n.slice(-1))]}${n.startsWith('M1') ? 5 : 4}`
    const heaterPin=[w.from,w.to].find(p=>board.components[p.componentId]?.spec.kind==='LOAD' &&
      (board.components[p.componentId].spec as {threePhase?:unknown}).threePhase && p.index<3)
    if(heaterPin && n.includes('-OUT-')) {
      w.source.number=`${['U','V','W'][heaterPin.index]}${heaterPin.componentId==='WASH-HEATER'?3:heaterPin.componentId==='BOOSTER-A'?1:2}`
      w.source.note='Label p.17; U2/V2/W2 berulang pada beberapa heater, tanpa menyatukan rangkaian lewat nama.'
    }
    if(n.includes('-STAR') || n.includes('-OUT-') || n.startsWith('FR-')) w.source.note ??= 'Identitas internal segmen tanpa nomor pada manual; bukan nomor pabrikan.'
    if(n==='TR-PRIMARY') {w.source.number='L13 (POWER)';w.source.note='L13 cabang POWER, terpisah dari feeder booster L13.'}
    if(n==='L11' && [w.from,w.to].some(p=>p.componentId==='POWER')) {w.source.number='L12 (POWER)';w.source.note='Cabang POWER tersambung ke L11; label lokal L12 p.17 terpisah dari feeder tank L12.'}
  }
  // Three-cell aisles remain around control devices without routing an 85×75
  // mostly empty canvas. Two rows retain the terminal strip's sequential order.
  for (const c of Object.values(board.components)) c.cell={x:Math.round(c.cell.x*.6),y:Math.round(c.cell.y*.6)}
  strip.forEach((_name,i)=>{board.components[`X-AA-${i+1}`].cell={x:(i%15)*2,y:44+Math.floor(i/15)*3}})
  return withDefaultGridSpacing(board)
}

/** Stable schedule used by the audit panel and documentation exporter. */
export function globalTekWireSchedule(board: Board): { id: string; source: Wire['source']; from: Terminal; to: Terminal }[] {
  return Object.values(board.wires).map(({ id, source, from, to }) => ({ id, source, from, to }))
}

export function globalTekTerminalName(board: Board, pin: Terminal): string {
  const c = board.components[pin.componentId]
  if (!c) return `${pin.componentId}:terminal absent`
  const generic: Partial<Record<ComponentSpec['kind'], string[]>> = {
    SOURCE_3PH: ['L1','L2','L3','N'], CONTACTOR: ['A1','A2','1/L1','2/T1','3/L2','4/T2','5/L3','6/T3','13','14','21','22'],
    BREAKER_3P: ['1','2','3','4','5','6'], OVERLOAD_RELAY: ['1/L1','2/T1','3/L2','4/T2','5/L3','6/T3','95','96','97','98'],
    MOTOR_3PH: ['U1','U2','V1','V2','W1','W2','PE'], CONTACT_2STATE: ['11/COM','12/NC','14/NO'],
    GROUND: ['PE'], TERMINAL_BLOCK: ['1','2'], FUSE: ['1','2'], SWITCH: ['1','2'], LOAD: ['1','2'],
  }
  const name = resolvedTerminalDefinitions(c)?.[pin.index]?.designation ??
    (c.spec.kind === 'PUSHBUTTON' ? (c.spec.normallyOpen ? ['13','14'] : ['21','22']) : generic[c.spec.kind])?.[pin.index]
  return `${pin.componentId}:${name ?? `pin ${pin.index}`}`
}
