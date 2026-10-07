// sts3215.ts: dà un significato ai byte dei registri del servo.
// Costruisce i comandi e decodifica le risposte; per comunicare usa il bus.

import type { Bus } from './bus'
import { checksum, type Pacchetto } from './analizzatore'

// il servo ha 4096 posizioni (0..4095): un valore più alto viene saturato dal firmware senza errori
export const POS_MAX = 4095

export const ISTR = { PING: 0x01, LETTURA: 0x02, SCRITTURA: 0x03 } as const
export const ID_DIFFUSIONE = 0xFE

export const REG_POSIZIONE_OBIETTIVO = 0x2A  // 42, 2 byte, little-endian
export const REG_POSIZIONE_CORRENTE = 0x38   // 56, 2 byte, little-endian
export const REG_TEMPERATURA = 0x3F          // 63, 1 byte

/** Costruisce un pacchetto completo: FF FF ID LEN ISTR PARAMS... CHK.
 *  LEN e checksum vengono calcolati automaticamente. */
export const costruisci = (id: number, istruzione: number, params: number[]) => {
  const corpo = [id, params.length + 2, istruzione, ...params]
  return [0xFF, 0xFF, ...corpo, checksum(corpo)]
}

// ---------- comandi ----------

/** Ping: FF FF 01 02 01 FB */
export const comandoPing = (id: number) => costruisci(id, ISTR.PING, [])

/** READ di 2 byte all'indirizzo 0x38 (posizione attuale). */
export const comandoLeggiPosizione = (id: number) =>
  costruisci(id, ISTR.LETTURA, [REG_POSIZIONE_CORRENTE, 0x02])

/** WRITE della posizione obiettivo all'indirizzo 0x2A, byte meno significativo per primo. */
export const comandoScriviPosizione = (id: number, pos: number) =>
  costruisci(id, ISTR.SCRITTURA, [REG_POSIZIONE_OBIETTIVO, pos & 0xFF, pos >> 8])

/** READ di 1 byte all'indirizzo 0x3F (temperatura interna): FF FF 01 04 02 3F 01 B8 */
export const comandoLeggiTemperatura = (id: number) =>
  costruisci(id, ISTR.LETTURA, [REG_TEMPERATURA, 0x01])

// ---------- decodifica ----------

/** Risposta di lettura posizione: FF FF ID 04 STATO LO HI CHK, little-endian. */
export const posizioneDa = (p: Pacchetto) => p.bytes[5] | (p.bytes[6] << 8)

/** Risposta di lettura temperatura: FF FF ID 03 STATO TEMP CHK. */
export const temperaturaDa = (p: Pacchetto) => p.bytes[p.bytes.length - 2]

// ---------- letture ----------

/** Legge la posizione attuale del servo (READ di 2 byte all'indirizzo 0x38, little-endian).
 *  Restituisce null se non arriva una risposta valida (l'eco è già esclusa). */
export const leggiPosizione = async (bus: Bus, id: number): Promise<number | null> => {
  const pacchetti = await bus.scambia(comandoLeggiPosizione(id), 300, 50)
  const r = [...pacchetti].reverse().find(p =>
    p.ok && !p.eco && p.bytes.length === 8 && p.bytes[2] === id)
  return r ? posizioneDa(r) : null
}

/** Legge la temperatura. Restituisce null se non arriva una risposta valida. */
export const leggiTemperatura = async (bus: Bus, id: number): Promise<number | null> => {
  const pacchetti = await bus.scambia(comandoLeggiTemperatura(id), 300, 50)
  // risposta: FF FF 01 03 00 <temp> CHK (l'eco del comando, lungo 8 byte, è esclusa)
  const r = pacchetti.find(p =>
    p.ok && !p.eco && p.bytes.length === 7 && p.bytes[2] === id && p.bytes[3] === 0x03)
  return r ? temperaturaDa(r) : null
}
