// Test del driver: nessun dispositivo e nessuna interfaccia grafica, solo analizzatore e casi noti.
// Esecuzione: npm i -D vitest, poi npx vitest run

import { expect, test } from 'vitest'
import { Analizzatore, checksum, type Pacchetto } from './analizzatore'
import {
  comandoLeggiPosizione, comandoLeggiTemperatura, comandoPing,
  comandoScriviPosizione, posizioneDa, temperaturaDa,
} from './sts3215'

const hex = (b: number[]) =>
  b.map(x => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

// ---------- i due test della slide 18 ----------

test("checksum del pacchetto di ping", () => {
  expect(checksum([0x01, 0x02, 0x01])).toBe(0xFB)
})

test("pacchetto frammentato in tre consegne", () => {
  const analizzatore = new Analizzatore()
  const pacchetti: Pacchetto[] = []
  const ricevi = (blocco: number[]) => pacchetti.push(...analizzatore.ricevi(blocco))

  ricevi([0xFF, 0xFF, 0x01])
  ricevi([0x02, 0x01])
  ricevi([0xFB])

  expect(pacchetti.length).toBe(1)
  expect(hex(pacchetti[0].bytes)).toBe('FF FF 01 02 01 FB')
  expect(pacchetti[0].ok).toBe(true)
})

// ---------- esempi delle slide della lezione 2 ----------

test("i comandi costruiti coincidono con gli esempi delle slide", () => {
  expect(hex(comandoPing(1))).toBe('FF FF 01 02 01 FB')
  expect(hex(comandoLeggiPosizione(1))).toBe('FF FF 01 04 02 38 02 BE')
  expect(hex(comandoScriviPosizione(1, 2048))).toBe('FF FF 01 05 03 2A 00 08 C4')
  expect(hex(comandoLeggiTemperatura(1))).toBe('FF FF 01 04 02 3F 01 B8')
})

test("posizione in little-endian: 3000 si scrive B8 0B", () => {
  expect(hex(comandoScriviPosizione(1, 3000))).toContain('2A B8 0B')
})

test("risposta di lettura: FF FF 01 04 00 F4 0B FB vale 3060", () => {
  const [p] = new Analizzatore().ricevi([0xFF, 0xFF, 0x01, 0x04, 0x00, 0xF4, 0x0B, 0xFB])
  expect(p.ok).toBe(true)
  expect(posizioneDa(p)).toBe(3060)
})

test("risposta di temperatura: il byte prima del checksum", () => {
  // FF FF 01 03 00 2A CHK, con 0x2A = 42 gradi: checksum = ~(01 + 03 + 00 + 2A) = 0xD1
  const [p] = new Analizzatore().ricevi([0xFF, 0xFF, 0x01, 0x03, 0x00, 0x2A, 0xD1])
  expect(p.ok).toBe(true)
  expect(temperaturaDa(p)).toBe(42)
})

// ---------- robustezza ----------

test("due risposte in un unico blocco, con byte spuri davanti", () => {
  const analizzatore = new Analizzatore()
  const blocco = [
    0x12, 0x34,
    0xFF, 0xFF, 0x01, 0x02, 0x00, 0xFC,
    0xFF, 0xFF, 0x01, 0x04, 0x00, 0xF4, 0x0B, 0xFB,
  ]
  const pacchetti = analizzatore.ricevi(blocco)
  expect(pacchetti.map(p => hex(p.bytes))).toEqual([
    'FF FF 01 02 00 FC',
    'FF FF 01 04 00 F4 0B FB',
  ])
})

test("checksum errato: il pacchetto è segnalato non valido e il parser si risincronizza", () => {
  const analizzatore = new Analizzatore()
  const pacchetti = analizzatore.ricevi([
    0xFF, 0xFF, 0x01, 0x02, 0x00, 0xFD,   // checksum sbagliato (sarebbe FC)
    0xFF, 0xFF, 0x01, 0x02, 0x00, 0xFC,   // pacchetto valido subito dopo
  ])
  expect(pacchetti.map(p => p.ok)).toEqual([false, true])
})

test("falsa intestazione FF FF con LEN plausibile: non fa perdere il pacchetto successivo", () => {
  const analizzatore = new Analizzatore()
  // FF FF 05 02 AA BB sembra un pacchetto ma il checksum non torna: si avanza di un byte
  const pacchetti = analizzatore.ricevi([
    0xFF, 0xFF, 0x05, 0x02, 0xAA, 0xBB,
    0xFF, 0xFF, 0x01, 0x02, 0x00, 0xFC,
  ])
  expect(pacchetti.filter(p => p.ok).map(p => hex(p.bytes))).toEqual(['FF FF 01 02 00 FC'])
})

test("l'eco della richiesta è riconosciuta e non conta come risposta", () => {
  const richiesta = comandoLeggiPosizione(1)
  const risposta = [0xFF, 0xFF, 0x01, 0x04, 0x00, 0xF4, 0x0B, 0xFB]
  const pacchetti = new Analizzatore().ricevi([...richiesta, ...risposta], richiesta)
  expect(pacchetti.map(p => p.eco)).toEqual([true, false])
  expect(posizioneDa(pacchetti[1])).toBe(3060)
})

test("LEN impossibile: nessun pacchetto e nessun blocco del buffer", () => {
  const analizzatore = new Analizzatore()
  expect(analizzatore.ricevi([0xFF, 0xFF, 0x01, 0x00, 0x00, 0x00])).toEqual([])
  const pacchetti = analizzatore.ricevi([0xFF, 0xFF, 0x01, 0x02, 0x01, 0xFB])
  expect(pacchetti.length).toBe(1)
})
