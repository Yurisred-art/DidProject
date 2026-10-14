// Test di bus e trasporto con una porta e un servo simulati: nessun dispositivo, nessun browser.
// Servono a verificare il ciclo di lettura permanente e la chiusura con la sequenza completa.
// Esecuzione: npx vitest run

import { expect, test } from 'vitest'
import { Bus } from './bus'
import { WebSerial } from './webSerial'
import { checksum } from './analizzatore'
import { comandoLeggiPosizione, leggiPosizione } from './sts3215'
import type { Trasporto } from './trasporto'

/** Pacchetto completo a partire dal corpo: FF FF corpo CHK. */
const pacchetto = (...corpo: number[]) => [0xFF, 0xFF, ...corpo, checksum(corpo)]

/** Risposta di lettura posizione: FF FF ID 04 00 LO HI CHK. */
const rispostaPosizione = (id: number, pos: number) =>
  pacchetto(id, 0x04, 0x00, pos & 0xFF, pos >> 8)

/** Fallisce se la promessa non si conclude entro `ms`: una chiusura che si blocca non deve
 *  bloccare anche il test. */
const entro = <T>(ms: number, p: Promise<T>) =>
  Promise.race([
    p,
    new Promise<never>((_, no) => setTimeout(() => no(new Error(`bloccato oltre ${ms} ms`)), ms)),
  ])

// ---------- servo simulato al posto del trasporto ----------

/** Trasporto finto: a ogni scrittura consegna a suRicezione i pezzi restituiti da `rispondi`,
 *  uno per volta, come arriverebbero sul bus reale. */
function servoSimulato(rispondi: (richiesta: number[]) => number[][]) {
  const scritti: number[][] = []
  const t = {
    aperta: true,
    scritti,
    suRicezione: (_blocco: Uint8Array) => {},
    async apri() {},
    async chiudi() {},
    async scrivi(byte: number[]) {
      scritti.push(byte)
      rispondi(byte).forEach((pezzo, i) =>
        setTimeout(() => t.suRicezione(new Uint8Array(pezzo)), i))
    },
  }
  return t as Trasporto & { scritti: number[][] }
}

test('eco e risposta frammentata in tre consegne: la posizione si legge lo stesso', async () => {
  const servo = servoSimulato(req => {
    const flusso = [...req, ...rispostaPosizione(1, 3060)]
    return [flusso.slice(0, 3), flusso.slice(3, 10), flusso.slice(10)]
  })
  expect(await leggiPosizione(new Bus(servo), 1)).toBe(3060)
})

test('senza risposta lo scambio termina per timeout', async () => {
  const bus = new Bus(servoSimulato(() => []))
  expect(await bus.scambia(comandoLeggiPosizione(1), 20, 10)).toEqual([])
  expect(await leggiPosizione(bus, 1)).toBe(null)
})

test('due richieste insieme restano in coda e ciascuna riceve la propria risposta', async () => {
  const servo = servoSimulato(req => [req, rispostaPosizione(req[2], req[2] === 1 ? 3060 : 1000)])
  const bus = new Bus(servo)
  const [a, b] = await Promise.all([leggiPosizione(bus, 1), leggiPosizione(bus, 2)])
  expect([a, b]).toEqual([3060, 1000])
  expect(servo.scritti.map(r => r[2])).toEqual([1, 2])
})

test('byte che arrivano senza richiesta in corso vengono ignorati', async () => {
  const servo = servoSimulato(req => [req, rispostaPosizione(1, 3060)])
  const bus = new Bus(servo)
  servo.suRicezione(new Uint8Array([0xFF, 0xFF, 0x01, 0x04]))   // inizio di una risposta in ritardo
  expect(await leggiPosizione(bus, 1)).toBe(3060)
})

test('suRisposta riceve le risposte valide e non l\'eco', async () => {
  const servo = servoSimulato(req => [req, rispostaPosizione(1, 3060)])
  const bus = new Bus(servo)
  const viste: number[] = []
  bus.suRisposta = p => viste.push(p.bytes.length)
  await leggiPosizione(bus, 1)
  expect(viste).toEqual([8])
})

test('scrittura fallita: l\'errore arriva a chi chiama e il bus non resta bloccato', async () => {
  const servo = servoSimulato(req => [req, rispostaPosizione(1, 3060)])
  const scrivi = servo.scrivi.bind(servo)
  let prima = true
  servo.scrivi = async byte => {
    if (prima) { prima = false; throw new Error('porta scollegata') }
    return scrivi(byte)
  }
  const bus = new Bus(servo)
  let errore = ''
  try { await leggiPosizione(bus, 1) } catch (e) { errore = (e as Error).message }
  expect(errore).toBe('porta scollegata')
  expect(await leggiPosizione(bus, 1)).toBe(3060)
})

// ---------- porta seriale finta al posto di Web Serial ----------

/** Porta finta con stream veri. close() si comporta come quella reale: fallisce se lettore o
 *  scrittore hanno ancora il lock. `eventi` registra l'ordine delle operazioni. */
function portaFinta() {
  const eventi: string[] = []
  const scritti: number[][] = []
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let suScrittura: (byte: number[]) => void = () => {}

  const readable = new ReadableStream<Uint8Array>({
    start(c) { controller = c },
    cancel() { eventi.push('cancel') },
  })
  const writable = new WritableStream<Uint8Array>({
    write(blocco) {
      const byte = Array.from(blocco)
      scritti.push(byte)
      suScrittura(byte)
    },
  })
  const porta = {
    readable,
    writable,
    async open(_opzioni: { baudRate: number }) { eventi.push('open') },
    async close() {
      if (readable.locked || writable.locked) throw new TypeError('stream ancora bloccati')
      eventi.push('close')
    },
  }

  // navigator.serial finto, che consegna sempre questa porta
  Object.defineProperty(globalThis, 'navigator', {
    value: { serial: { requestPort: async () => porta } },
    configurable: true,
    writable: true,
  })

  return {
    porta,
    eventi,
    scritti,
    arriva: (byte: number[]) => controller.enqueue(new Uint8Array(byte)),
    rispondiA: (f: (byte: number[]) => void) => { suScrittura = f },
  }
}

test('con la porta finta: eco e risposta arrivano dal ciclo di lettura', async () => {
  const f = portaFinta()
  const bus = new Bus(new WebSerial())
  await bus.apri()
  f.rispondiA(req => { f.arriva(req); f.arriva(rispostaPosizione(1, 3060)) })
  expect(await leggiPosizione(bus, 1)).toBe(3060)
  await bus.chiudi()
})

test('chiusura nell\'ordine delle slide: cancel, lock rilasciati, poi close', async () => {
  const f = portaFinta()
  const bus = new Bus(new WebSerial())
  await bus.apri()
  f.rispondiA(req => { f.arriva(req); f.arriva(rispostaPosizione(1, 3060)) })
  await leggiPosizione(bus, 1)

  await entro(1000, bus.chiudi())

  expect(f.eventi).toEqual(['open', 'cancel', 'close'])
  expect(f.porta.readable.locked).toBe(false)
  expect(f.porta.writable.locked).toBe(false)
  expect(bus.aperta).toBe(false)
})

test('chiusura con la read in attesa: non si blocca', async () => {
  const f = portaFinta()
  const bus = new Bus(new WebSerial())
  await bus.apri()                       // il ciclo di lettura è già fermo su read()
  await entro(1000, bus.chiudi())
  expect(f.eventi).toEqual(['open', 'cancel', 'close'])
})

test('chiusura senza che la linea sia stata aperta: non fa nulla', async () => {
  const f = portaFinta()
  await entro(1000, new Bus(new WebSerial()).chiudi())
  expect(f.eventi).toEqual([])
})

test('un errore nel gestore delle risposte non ferma il ciclo di lettura', async () => {
  const f = portaFinta()
  const bus = new Bus(new WebSerial())
  await bus.apri()
  f.rispondiA(req => { f.arriva(req); f.arriva(rispostaPosizione(1, 3060)) })

  bus.suRisposta = () => { throw new Error('errore nel gestore') }
  await bus.scambia(comandoLeggiPosizione(1), 30, 20)

  bus.suRisposta = () => {}
  expect(await leggiPosizione(bus, 1)).toBe(3060)
  await entro(1000, bus.chiudi())
})
