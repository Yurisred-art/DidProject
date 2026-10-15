// Test della scrittura di posizione: il controllo del valore e la scrittura con conferma.
// Esecuzione: npx vitest run

import { expect, test } from 'vitest'
import { Bus } from './bus'
import { checksum } from './analizzatore'
import { comandoScriviPosizione, scriviPosizione } from './sts3215'
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
