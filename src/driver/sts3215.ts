// sts3215.ts: dà un significato ai byte dei registri del servo.
// Costruisce i comandi e decodifica le risposte; per comunicare usa il bus.

import type { Bus } from './bus'
import { checksum, type Pacchetto } from './analizzatore'

// il servo ha 4096 posizioni (0..4095): un valore più alto viene saturato dal firmware senza errori
export const POS_MAX = 4095

export const ISTR = { PING: 0x01, LETTURA: 0x02, SCRITTURA: 0x03 } as const
export const ID_DIFFUSIONE = 0xFE

export const REG_ID = 0x05                   // 5, 1 byte, in memoria permanente (EEPROM)
export const REG_BLOCCO_EEPROM = 0x37        // 55, 1 byte: 0 = scrittura EEPROM consentita, 1 = bloccata
export const ID_MAX = 253                    // 254 (0xFE) è l'ID di diffusione, 255 non è usabile
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

/** WRITE della posizione obiettivo all'indirizzo 0x2A, byte meno significativo per primo.
 *  Un valore non intero, NaN o fuori da 0..POS_MAX non arriva mai sul bus (NaN & 0xFF vale 0:
 *  il servo andrebbe in una posizione sbagliata senza segnalare nulla). */
export const comandoScriviPosizione = (id: number, pos: number) => {
  if (!Number.isInteger(pos) || pos < 0 || pos > POS_MAX)
    throw new RangeError(`Posizione non valida: ${pos} (ammesso un intero da 0 a ${POS_MAX})`)
  return costruisci(id, ISTR.SCRITTURA, [REG_POSIZIONE_OBIETTIVO, pos & 0xFF, pos >> 8])
}

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

// ---------- scrittura con conferma ----------

/** Scrive la posizione obiettivo e aspetta la conferma del servo, con attese brevi: serve alle
 *  traiettorie, dove ogni scambio deve stare nel passo di 20 ms. Restituisce true se è arrivata
 *  una risposta valida da quel servo. Lancia RangeError se la posizione non è ammessa. */
export const scriviPosizione = async (bus: Bus, id: number, pos: number): Promise<boolean> => {
  const pacchetti = await bus.scambia(comandoScriviPosizione(id, pos), 30, 5)
  return pacchetti.some(p => p.ok && !p.eco && p.bytes[2] === id)
}

// ---------- cambio dell'ID ----------

/** WRITE di un byte in un registro: FF FF ID 04 03 REG VALORE CHK. */
export const comandoScriviByte = (id: number, registro: number, valore: number) =>
  costruisci(id, ISTR.SCRITTURA, [registro, valore])

const pausa = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

const haRisposto = (pacchetti: Pacchetto[], id: number) =>
  pacchetti.some(p => p.ok && !p.eco && p.bytes[2] === id)

/** true se un servo risponde al ping con questo ID. */
export const rispondeAlPing = async (bus: Bus, id: number): Promise<boolean> =>
  haRisposto(await bus.scambia(comandoPing(id), 150, 20), id)

/** Cambia l'ID di un servo. Da usare con UN SOLO servo collegato al bus.
 *  Sequenza: ping dell'ID attuale (deve rispondere), ping del nuovo (non deve rispondere),
 *  sblocco della EEPROM, scrittura dell'ID, ping del nuovo ID per verificare, riblocco.
 *  Restituisce l'esito e un messaggio da mostrare. */
export const cambiaId = async (bus: Bus, attuale: number, nuovo: number)
  : Promise<{ ok: boolean; messaggio: string }> => {
  const valido = (n: number) => Number.isInteger(n) && n >= 0 && n <= ID_MAX
  if (!valido(attuale) || !valido(nuovo))
    return { ok: false, messaggio: `ID non valido: ammessi interi da 0 a ${ID_MAX}` }
  if (attuale === nuovo)
    return { ok: false, messaggio: 'L\'ID nuovo coincide con quello attuale' }

  if (!(await rispondeAlPing(bus, attuale)))
    return { ok: false, messaggio: `Nessun servo risponde all'ID ${attuale}` }
  if (await rispondeAlPing(bus, nuovo))
    return { ok: false, messaggio: `Un servo risponde già all'ID ${nuovo}: scollega gli altri servo o scegli un altro ID` }

  // 1. sblocca la scrittura in EEPROM
  const sbloccato = haRisposto(await bus.scambia(comandoScriviByte(attuale, REG_BLOCCO_EEPROM, 0), 300, 50), attuale)
  if (!sbloccato)
    return { ok: false, messaggio: 'Il servo non ha confermato lo sblocco della EEPROM: ID non cambiato' }

  // 2. scrive il nuovo ID (il servo può rispondere con il vecchio o con il nuovo: non conta)
  await bus.scambia(comandoScriviByte(attuale, REG_ID, nuovo), 300, 50)
  await pausa(50)

  // 3. verifica: ora deve rispondere il nuovo ID
  if (!(await rispondeAlPing(bus, nuovo)))
    return { ok: false, messaggio: `Dopo la scrittura nessun servo risponde all'ID ${nuovo}: ID non cambiato` }

  // 4. riblocca la EEPROM, ora con il nuovo ID
  const bloccato = haRisposto(await bus.scambia(comandoScriviByte(nuovo, REG_BLOCCO_EEPROM, 1), 300, 50), nuovo)
  return {
    ok: true,
    messaggio: `ID cambiato da ${attuale} a ${nuovo}` +
      (bloccato ? '' : ' (la EEPROM non ha confermato il riblocco: riaccendere il servo)'),
  }
}

/** Legge la temperatura. Restituisce null se non arriva una risposta valida. */
export const leggiTemperatura = async (bus: Bus, id: number): Promise<number | null> => {
  const pacchetti = await bus.scambia(comandoLeggiTemperatura(id), 300, 50)
  // risposta: FF FF 01 03 00 <temp> CHK (l'eco del comando, lungo 8 byte, è esclusa)
  const r = pacchetti.find(p =>
    p.ok && !p.eco && p.bytes.length === 7 && p.bytes[2] === id && p.bytes[3] === 0x03)
  return r ? temperaturaDa(r) : null
}
