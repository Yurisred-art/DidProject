// Test della scrittura di posizione: il controllo del valore e la scrittura con conferma.
// Esecuzione: npx vitest run

import { expect, test } from 'vitest'
import { Bus } from './bus'
import { checksum } from './analizzatore'
import {
  abilitaCoppia, cambiaId, comandoCoppia, comandoScriviByte, comandoScriviPosizione, comandoSyncWrite,
  posizioneDaStato, scriviInsieme, scriviPosizione, temperaturaDaStato,
} from './sts3215'

const hex = (b: number[]) =>
  b.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

const lancia = (f: () => unknown) => {
  try { f() } catch (e) { return e instanceof RangeError }
  return false
}

test('un valore non ammesso non diventa mai un pacchetto', () => {
  expect(lancia(() => comandoScriviPosizione(1, NaN))).toBe(true)
  expect(lancia(() => comandoScriviPosizione(1, Infinity))).toBe(true)
  expect(lancia(() => comandoScriviPosizione(1, -1))).toBe(true)
  expect(lancia(() => comandoScriviPosizione(1, 4096))).toBe(true)
  expect(lancia(() => comandoScriviPosizione(1, 100.5))).toBe(true)
})

test('i valori estremi 0 e 4095 sono ammessi', () => {
  expect(hex(comandoScriviPosizione(1, 0))).toBe('FF FF 01 05 03 2A 00 00 CC')
  expect(hex(comandoScriviPosizione(1, 4095))).toContain('2A FF 0F')
})

/** REPLY della scheda: status, servo e i byte letti dal bus. */
const reply = (dati: number[], status = 0) => Uint8Array.from([status, 0, ...dati])

/** Risposta di stato di un servo: FF FF ID 02 00 CHK. */
const stato = (id: number) => [0xFF, 0xFF, id, 0x02, 0x00, checksum([id, 0x02, 0x00])]

/** Scheda finta: risponde a ogni TXN con una REPLY; `conferma` dice se il servo risponde. */
function servo(conferma: boolean) {
  return new Bus(async sts => reply(conferma ? stato(sts[2]) : []))
}

test('scriviPosizione: true se il servo conferma', async () => {
  expect(await scriviPosizione(servo(true), 2, 1000)).toBe(true)
})

test('scriviPosizione: false se la scheda non restituisce nessuna risposta del servo', async () => {
  expect(await scriviPosizione(servo(false), 2, 1000)).toBe(false)
})

test('scriviPosizione: false se la REPLY si perde', async () => {
  expect(await scriviPosizione(new Bus(async () => null), 2, 1000)).toBe(false)
})

// ---------- SYNC WRITE e coppia, esempi dell'appendice del protocollo ----------

test('SYNC WRITE: servo 2 a 1500 e servo 1 a 2600, velocità 800, ACC 10', () => {
  expect(hex(comandoSyncWrite([{ id: 2, pos: 1500 }, { id: 1, pos: 2600 }], 800, 10))).toBe(
    'FF FF FE 14 83 29 07 02 0A DC 05 00 00 20 03 01 0A 28 0A 00 00 20 03 CA')
})

test('SYNC WRITE: un valore non ammesso non diventa mai un pacchetto', () => {
  expect(lancia(() => comandoSyncWrite([{ id: 1, pos: 4096 }], 800, 10))).toBe(true)
  expect(lancia(() => comandoSyncWrite([{ id: 1, pos: NaN }], 800, 10))).toBe(true)
  expect(lancia(() => comandoSyncWrite([{ id: 1, pos: 100 }], -1, 10))).toBe(true)
  expect(lancia(() => comandoSyncWrite([{ id: 1, pos: 100 }], 800, 255))).toBe(true)
})

test('TORQUE_ENABLE = 1 sul servo 3: FF FF 03 04 03 28 01 CC', () => {
  expect(hex(comandoCoppia(3, true))).toBe('FF FF 03 04 03 28 01 CC')
})

test('scriviInsieme: true se la scheda accetta (ok o limitato), false se rifiuta o si perde', async () => {
  const voci = [{ id: 1, pos: 1000 }, { id: 2, pos: 2000 }]
  expect(await scriviInsieme(new Bus(async () => reply([], 0)), voci, 800, 10)).toBe(true)
  expect(await scriviInsieme(new Bus(async () => reply([], 1)), voci, 800, 10)).toBe(true)
  expect(await scriviInsieme(new Bus(async () => reply([], 2)), voci, 800, 10)).toBe(false)
  expect(await scriviInsieme(new Bus(async () => null), voci, 800, 10)).toBe(false)
})

test('abilitaCoppia: legge la posizione, la scrive come obiettivo, poi attiva la coppia', async () => {
  const visti: string[] = []
  const bus = new Bus(async sts => {
    visti.push(hex(Array.from(sts)))
    if (sts[4] === 0x02)   // lettura posizione: FF FF ID 04 00 LO HI CHK
      return reply([0xFF, 0xFF, sts[2], 0x04, 0x00, 0xF4, 0x0B, checksum([sts[2], 0x04, 0x00, 0xF4, 0x0B])])
    return reply(stato(sts[2]))
  })
  expect(await abilitaCoppia(bus, 1)).toBe(true)
  expect(visti.length).toBe(3)
  expect(visti[1]).toContain('2A F4 0B')              // obiettivo = posizione letta (3060)
  expect(visti[2]).toBe('FF FF 01 04 03 28 01 CE')    // coppia attiva
})

test('abilitaCoppia: se il servo non risponde alla lettura non scrive nulla', async () => {
  let n = 0
  const bus = new Bus(async () => { n++; return reply([]) })
  expect(await abilitaCoppia(bus, 1)).toBe(false)
  expect(n).toBe(1)
})

// ---------- telemetria: registri 40-70 in uno status frame da 37 byte ----------

test('temperatura e posizione da uno status frame della telemetria', () => {
  const dati = new Array(31).fill(0)
  dati[56 - 40] = 0xF4; dati[57 - 40] = 0x0B      // posizione 3060
  dati[63 - 40] = 42                              // temperatura
  const corpo = [3, 0x21, 0x00, ...dati]
  const bytes = [0xFF, 0xFF, ...corpo, checksum(corpo)]
  const p = { bytes, ok: true, atteso: bytes[36], eco: false }
  expect(bytes.length).toBe(37)
  expect(temperaturaDaStato(p)).toBe(42)
  expect(posizioneDaStato(p)).toBe(3060)
})

// ---------- cambio dell'ID ----------

test('comandi del cambio ID: sblocco EEPROM e scrittura dell\'ID', () => {
  expect(hex(comandoScriviByte(1, 0x37, 0))).toBe('FF FF 01 04 03 37 00 C0')
  expect(hex(comandoScriviByte(1, 0x05, 2))).toBe('FF FF 01 04 03 05 02 F0')
})

/** Bus finto con i servo indicati (ID iniziali). Rispondono solo al proprio ID; l'ID si cambia
 *  solo a EEPROM sbloccata, come nel servo vero. */
function busConServo(ids: number[], eepromBloccabile = true) {
  const servi = ids.map(id => ({ id, blocco: 1 }))
  const bus = new Bus(async sts => {
    const s = servi.find(x => x.id === sts[2])
    if (!s) return reply([])                       // nessun servo con quell'ID: la REPLY non ha dati
    if (sts[4] === 3 && sts[5] === 0x37) s.blocco = sts[6]
    if (sts[4] === 3 && sts[5] === 0x05 && (s.blocco === 0 || !eepromBloccabile)) s.id = sts[6]
    return reply(stato(sts[2]))
  })
  return { bus, servi }
}

test('cambiaId: un solo servo con ID 1 diventa 2 e la EEPROM resta bloccata', async () => {
  const { bus, servi } = busConServo([1])
  const r = await cambiaId(bus, 1, 2)
  expect(r.ok).toBe(true)
  expect(servi[0].id).toBe(2)
  expect(servi[0].blocco).toBe(1)
})

test('cambiaId: rifiuta se un altro servo risponde già al nuovo ID', async () => {
  const { bus, servi } = busConServo([1, 2])
  const r = await cambiaId(bus, 1, 2)
  expect(r.ok).toBe(false)
  expect(servi[0].id).toBe(1)
})

test('cambiaId: nessun servo all\'ID attuale', async () => {
  const { bus } = busConServo([5])
  expect((await cambiaId(bus, 1, 2)).ok).toBe(false)
})

test('cambiaId: valori non validi o uguali non toccano il bus', async () => {
  const { bus, servi } = busConServo([1])
  expect((await cambiaId(bus, 1, 254)).ok).toBe(false)
  expect((await cambiaId(bus, 1, 1.5)).ok).toBe(false)
  expect((await cambiaId(bus, 1, 1)).ok).toBe(false)
  expect(servi[0].id).toBe(1)
})
