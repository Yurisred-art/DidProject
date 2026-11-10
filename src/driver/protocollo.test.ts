// Test dei frame binari del protocollo luma-esp: nessuna rete, solo array di byte.
// Esecuzione: npx vitest run

import { expect, test } from 'vitest'
import { checksum } from './analizzatore'
import { LUNGHEZZA_STATUS, leggiReply, leggiTelemetria } from './protocollo'

/** Status frame della telemetria: FF FF id 21 errore dati[31] checksum. */
const statusFrame = (id: number, err = 0, temp = 40) => {
  const dati = new Array(31).fill(0)
  dati[63 - 40] = temp
  const corpo = [id, 0x21, err, ...dati]
  return [0xFF, 0xFF, ...corpo, checksum(corpo)]
}

test('REPLY: status, servo e i dati del servo, dall\'esempio dell\'appendice', () => {
  // REPLY di un WRITE da disarmata: 02 0B 00 <light> 02 03 -> payload = status 2, servo 3
  expect(leggiReply(Uint8Array.from([0x02, 0x03]))).toEqual({ status: 2, servo: 3, dati: [] })
  expect(leggiReply(Uint8Array.from([0x00, 0x00, 0xFF, 0xFF, 0x01]))).toEqual({ status: 0, servo: 0, dati: [0xFF, 0xFF, 0x01] })
})

test('REPLY più corta di due byte: non valida', () => {
  expect(leggiReply(Uint8Array.from([]))).toBe(null)
  expect(leggiReply(Uint8Array.from([0]))).toBe(null)
})

test('lo status frame è lungo 37 byte', () => {
  expect(statusFrame(1).length).toBe(LUNGHEZZA_STATUS)
})

test('telemetria con due servo: due frame, nell\'ordine del profilo', () => {
  const f = leggiTelemetria(Uint8Array.from([...statusFrame(2), ...statusFrame(1)]))
  expect(f.map(p => p.bytes[2])).toEqual([2, 1])
  expect(f.every(p => p.ok)).toBe(true)
})

test('telemetria vuota (nessun servo ha risposto): nessun frame', () => {
  expect(leggiTelemetria(Uint8Array.from([]))).toEqual([])
})

test('un frame con il checksum sbagliato è scartato, quello dopo si legge', () => {
  const guasto = statusFrame(1)
  guasto[10] ^= 0x55
  const f = leggiTelemetria(Uint8Array.from([...guasto, ...statusFrame(2)]))
  expect(f.map(p => p.bytes[2])).toEqual([2])
})

test('un frame troncato non fa slittare il successivo: la ricerca ricomincia da FF FF id 21', () => {
  const troncato = statusFrame(1).slice(0, 20)
  const f = leggiTelemetria(Uint8Array.from([...troncato, ...statusFrame(2), ...statusFrame(3)]))
  expect(f.map(p => p.bytes[2])).toEqual([2, 3])
})

test('byte spuri davanti e in mezzo non impediscono di trovare i frame', () => {
  const f = leggiTelemetria(Uint8Array.from([0x12, 0x34, ...statusFrame(1), 0x99, ...statusFrame(2)]))
  expect(f.map(p => p.bytes[2])).toEqual([1, 2])
})

test('il byte di errore dello status frame è il quinto', () => {
  const [p] = leggiTelemetria(Uint8Array.from(statusFrame(1, 0x20)))
  expect(p.bytes[4]).toBe(0x20)
})
