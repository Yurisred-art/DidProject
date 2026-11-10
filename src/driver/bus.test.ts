// Test del bus con una scheda simulata: nessuna rete, nessun browser, nessun servo.
// La scheda finta riceve il pacchetto STS di un TXN e restituisce il payload di una REPLY.
// Esecuzione: npx vitest run

import { expect, test } from 'vitest'
import { Bus } from './bus'
import { checksum } from './analizzatore'
import { comandoLeggiPosizione, leggiPosizione } from './sts3215'

/** Pacchetto completo a partire dal corpo: FF FF corpo CHK. */
const pacchetto = (...corpo: number[]) => [0xFF, 0xFF, ...corpo, checksum(corpo)]

/** Risposta di lettura posizione: FF FF ID 04 00 LO HI CHK. */
const rispostaPosizione = (id: number, pos: number) =>
  pacchetto(id, 0x04, 0x00, pos & 0xFF, pos >> 8)

/** Payload di una REPLY: status, servo, dati. */
const reply = (dati: number[], status = 0, servo = 0) => Uint8Array.from([status, servo, ...dati])

test('la REPLY con la posizione del servo si legge come prima', async () => {
  const bus = new Bus(async sts => reply(rispostaPosizione(sts[2], 3060)))
  expect(await leggiPosizione(bus, 1)).toBe(3060)
})

test('il pacchetto STS arriva intatto alla scheda', async () => {
  const visti: number[][] = []
  const bus = new Bus(async sts => { visti.push(Array.from(sts)); return reply(rispostaPosizione(1, 100)) })
  await leggiPosizione(bus, 1)
  expect(visti).toEqual([comandoLeggiPosizione(1)])
})

test('REPLY persa (timeout o socket chiuso): lista vuota, nessuna eccezione', async () => {
  const bus = new Bus(async () => null)
  expect(await bus.scambia(comandoLeggiPosizione(1), 20)).toEqual([])
  expect(await leggiPosizione(bus, 1)).toBe(null)
})

test('REPLY troppo corta: trattata come persa', async () => {
  const bus = new Bus(async () => Uint8Array.from([0]))
  expect(await bus.richiedi(comandoLeggiPosizione(1))).toBe(null)
})

test('rifiuto della scheda: lista vuota e il motivo arriva a suEsito', async () => {
  const bus = new Bus(async () => reply([], 2, 1))      // 2 = stato non valido, servo 1
  const esiti: number[][] = []
  bus.suEsito = r => esiti.push([r.status, r.servo])
  expect(await bus.scambia(comandoLeggiPosizione(1))).toEqual([])
  expect(esiti).toEqual([[2, 1]])
})

test('valore limitato (status 1): i dati del servo arrivano comunque', async () => {
  const bus = new Bus(async () => reply(rispostaPosizione(1, 3060), 1, 1))
  const esiti: number[] = []
  bus.suEsito = r => esiti.push(r.status)
  expect(await leggiPosizione(bus, 1)).toBe(3060)
  expect(esiti).toEqual([1])
})

test('suEsito riceve anche le REPLY ok, così si può azzerare l\'ultimo avviso', async () => {
  const bus = new Bus(async sts => reply(rispostaPosizione(sts[2], 1)))
  const esiti: number[] = []
  bus.suEsito = r => esiti.push(r.status)
  await leggiPosizione(bus, 1)
  expect(esiti).toEqual([0])
})

test('suRisposta riceve le risposte valide dei servo', async () => {
  const bus = new Bus(async () => reply(rispostaPosizione(1, 3060)))
  const viste: number[] = []
  bus.suRisposta = p => viste.push(p.bytes.length)
  await leggiPosizione(bus, 1)
  expect(viste).toEqual([8])
})

test('SYNC READ di due servo: le due risposte nello stesso REPLY si separano', async () => {
  const bus = new Bus(async () => reply([...rispostaPosizione(1, 3060), ...rispostaPosizione(2, 1000)]))
  const pacchetti = await bus.scambia([0x00])
  expect(pacchetti.map(p => p.bytes[2])).toEqual([1, 2])
  expect(pacchetti.every(p => p.ok)).toBe(true)
})

test('un byte corrotto nella risposta è segnalato e non fa perdere il servo dopo', async () => {
  const guasta = rispostaPosizione(1, 3060)
  guasta[5] ^= 0xFF
  const bus = new Bus(async () => reply([...guasta, ...rispostaPosizione(2, 1000)]))
  const pacchetti = await bus.scambia([0x00])
  expect(pacchetti.filter(p => p.ok).map(p => p.bytes[2])).toEqual([2])
  expect(pacchetti.some(p => !p.ok)).toBe(true)
})

test('più richieste insieme: ciascuna riceve la propria REPLY', async () => {
  const bus = new Bus(async sts => {
    await new Promise(r => setTimeout(r, sts[2] === 1 ? 10 : 1))   // la seconda risponde prima
    return reply(rispostaPosizione(sts[2], sts[2] === 1 ? 3060 : 1000))
  })
  const [a, b] = await Promise.all([leggiPosizione(bus, 1), leggiPosizione(bus, 2)])
  expect([a, b]).toEqual([3060, 1000])
})
