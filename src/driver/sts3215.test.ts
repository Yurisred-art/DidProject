// Test della scrittura di posizione: il controllo del valore e la scrittura con conferma.
// Esecuzione: npx vitest run

import { expect, test } from 'vitest'
import { Bus } from './bus'
import { checksum } from './analizzatore'
import { cambiaId, comandoScriviByte, comandoScriviPosizione, scriviPosizione } from './sts3215'
import type { Trasporto } from './trasporto'

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

/** Servo finto: restituisce eco e, se `conferma`, la risposta di stato. */
function servo(conferma: boolean) {
  const t = {
    aperta: true,
    suRicezione: (_b: Uint8Array) => {},
    async apri() {},
    async chiudi() {},
    async scrivi(byte: number[]) {
      const risposta = conferma ? [0xFF, 0xFF, byte[2], 0x02, 0x00, checksum([byte[2], 0x02, 0x00])] : []
      setTimeout(() => t.suRicezione(new Uint8Array([...byte, ...risposta])), 1)
    },
  }
  return t as Trasporto
}

test('scriviPosizione: true se il servo conferma', async () => {
  expect(await scriviPosizione(new Bus(servo(true)), 2, 1000)).toBe(true)
})

test('scriviPosizione: false se c\'è solo l\'eco, senza risposta', async () => {
  expect(await scriviPosizione(new Bus(servo(false)), 2, 1000)).toBe(false)
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
  const t = {
    aperta: true,
    suRicezione: (_b: Uint8Array) => {},
    async apri() {},
    async chiudi() {},
    async scrivi(byte: number[]) {
      const s = servi.find(x => x.id === byte[2])
      const risposta: number[] = []
      if (s) {
        if (byte[4] === 3 && byte[5] === 0x37) s.blocco = byte[6]
        if (byte[4] === 3 && byte[5] === 0x05 && (s.blocco === 0 || !eepromBloccabile)) s.id = byte[6]
        risposta.push(0xFF, 0xFF, byte[2], 0x02, 0x00, checksum([byte[2], 0x02, 0x00]))
      }
      setTimeout(() => t.suRicezione(new Uint8Array([...byte, ...risposta])), 1)
    },
  }
  return { bus: new Bus(t as Trasporto), servi }
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
