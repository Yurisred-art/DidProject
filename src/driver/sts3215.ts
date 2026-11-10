// sts3215.ts: dà un significato ai byte dei registri del servo.
// Costruisce i comandi e decodifica le risposte; per comunicare usa il bus (ora via Wi-Fi: il
// pacchetto STS è il payload di un TXN, ma qui non cambia nulla).

import type { Bus } from './bus'
import { checksum, type Pacchetto } from './analizzatore'

// il servo ha 4096 posizioni (0..4095): un valore più alto viene saturato dal firmware senza errori
export const POS_MAX = 4095

export const ISTR = { PING: 0x01, LETTURA: 0x02, SCRITTURA: 0x03, SYNC_SCRITTURA: 0x83 } as const
export const ID_DIFFUSIONE = 0xFE

export const REG_ID = 0x05                   // 5, 1 byte, in memoria permanente (EEPROM)
export const REG_BLOCCO_EEPROM = 0x37        // 55, 1 byte: 0 = scrittura EEPROM consentita, 1 = bloccata
export const ID_MAX = 253                    // 254 (0xFE) è l'ID di diffusione, 255 non è usabile
export const REG_POSIZIONE_OBIETTIVO = 0x2A  // 42, 2 byte, little-endian
export const REG_POSIZIONE_CORRENTE = 0x38   // 56, 2 byte, little-endian
export const REG_TEMPERATURA = 0x3F          // 63, 1 byte
export const REG_COPPIA = 0x28               // 40, 1 byte: TORQUE_ENABLE, 1 = servo in coppia
export const REG_ACCELERAZIONE = 0x29        // 41: da qui lo SYNC WRITE scrive 7 byte per servo
export const REG_STATO = 40                  // la telemetria contiene i registri 40-70, in ordine

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
  controllaPosizione(pos)
  return costruisci(id, ISTR.SCRITTURA, [REG_POSIZIONE_OBIETTIVO, pos & 0xFF, pos >> 8])
}

/** Lancia RangeError se la posizione non è un intero da 0 a POS_MAX. */
const controllaPosizione = (pos: number) => {
  if (!Number.isInteger(pos) || pos < 0 || pos > POS_MAX)
    throw new RangeError(`Posizione non valida: ${pos} (ammesso un intero da 0 a ${POS_MAX})`)
}

/** SYNC WRITE (0x83) in diffusione: scrive accelerazione, posizione, tempo e velocità di più servo
 *  con un solo pacchetto, quindi partono insieme. Nessun servo risponde.
 *  FF FF FE LEN 83 29 07 { ID ACC POS_LO POS_HI 00 00 VEL_LO VEL_HI }... CHK */
export const comandoSyncWrite = (voci: { id: number; pos: number }[], velocita: number, acc: number) => {
  if (!Number.isInteger(velocita) || velocita < 0 || velocita > 0xFFFF)
    throw new RangeError(`Velocità non valida: ${velocita}`)
  if (!Number.isInteger(acc) || acc < 0 || acc > 254)
    throw new RangeError(`Accelerazione non valida: ${acc} (ammesso un intero da 0 a 254)`)
  const params = [REG_ACCELERAZIONE, 7]
  for (const { id, pos } of voci) {
    controllaPosizione(pos)
    params.push(id, acc, pos & 0xFF, pos >> 8, 0x00, 0x00, velocita & 0xFF, velocita >> 8)
  }
  return costruisci(ID_DIFFUSIONE, ISTR.SYNC_SCRITTURA, params)
}

/** WRITE di TORQUE_ENABLE: FF FF ID 04 03 28 VALORE CHK. */
export const comandoCoppia = (id: number, attiva: boolean) =>
  costruisci(id, ISTR.SCRITTURA, [REG_COPPIA, attiva ? 1 : 0])

/** READ di 1 byte all'indirizzo 0x3F (temperatura interna): FF FF 01 04 02 3F 01 B8 */
export const comandoLeggiTemperatura = (id: number) =>
  costruisci(id, ISTR.LETTURA, [REG_TEMPERATURA, 0x01])

// ---------- decodifica ----------

/** Risposta di lettura posizione: FF FF ID 04 STATO LO HI CHK, little-endian. */
export const posizioneDa = (p: Pacchetto) => p.bytes[5] | (p.bytes[6] << 8)

/** Risposta di lettura temperatura: FF FF ID 03 STATO TEMP CHK. */
export const temperaturaDa = (p: Pacchetto) => p.bytes[p.bytes.length - 2]

/** Temperatura da uno status frame della telemetria: FF FF ID 21 ERR DATI[31] CHK, dove i dati
 *  sono i registri 40-70. Il registro 63 è il byte 23 dei dati, cioè il byte 28 del frame. */
export const temperaturaDaStato = (p: Pacchetto) => p.bytes[5 + REG_TEMPERATURA - REG_STATO]

/** Posizione attuale da uno status frame della telemetria (registri 56-57, little-endian). */
export const posizioneDaStato = (p: Pacchetto) => {
  const i = 5 + REG_POSIZIONE_CORRENTE - REG_STATO
  return p.bytes[i] | (p.bytes[i + 1] << 8)
}

// ---------- letture ----------

/** Legge la posizione attuale del servo (READ di 2 byte all'indirizzo 0x38, little-endian).
 *  Restituisce null se non arriva una risposta valida (l'eco è già esclusa). */
export const leggiPosizione = async (bus: Bus, id: number): Promise<number | null> => {
  const pacchetti = await bus.scambia(comandoLeggiPosizione(id), 300)
  const r = [...pacchetti].reverse().find(p =>
    p.ok && !p.eco && p.bytes.length === 8 && p.bytes[2] === id)
  return r ? posizioneDa(r) : null
}

// ---------- scrittura con conferma ----------

/** Scrive la posizione obiettivo e aspetta la conferma del servo. Restituisce true se è arrivata
 *  una risposta valida da quel servo. Lancia RangeError se la posizione non è ammessa. */
export const scriviPosizione = async (bus: Bus, id: number, pos: number): Promise<boolean> => {
  const pacchetti = await bus.scambia(comandoScriviPosizione(id, pos), 200)
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
  haRisposto(await bus.scambia(comandoPing(id), 200), id)

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
  const sbloccato = haRisposto(await bus.scambia(comandoScriviByte(attuale, REG_BLOCCO_EEPROM, 0), 300), attuale)
  if (!sbloccato)
    return { ok: false, messaggio: 'Il servo non ha confermato lo sblocco della EEPROM: ID non cambiato' }

  // 2. scrive il nuovo ID (il servo può rispondere con il vecchio o con il nuovo: non conta)
  await bus.scambia(comandoScriviByte(attuale, REG_ID, nuovo), 300)
  await pausa(50)

  // 3. verifica: ora deve rispondere il nuovo ID
  if (!(await rispondeAlPing(bus, nuovo)))
    return { ok: false, messaggio: `Dopo la scrittura nessun servo risponde all'ID ${nuovo}: ID non cambiato` }

  // 4. riblocca la EEPROM, ora con il nuovo ID
  const bloccato = haRisposto(await bus.scambia(comandoScriviByte(nuovo, REG_BLOCCO_EEPROM, 1), 300), nuovo)
  return {
    ok: true,
    messaggio: `ID cambiato da ${attuale} a ${nuovo}` +
      (bloccato ? '' : ' (la EEPROM non ha confermato il riblocco: riaccendere il servo)'),
  }
}

/** Legge la temperatura. Restituisce null se non arriva una risposta valida. */
export const leggiTemperatura = async (bus: Bus, id: number): Promise<number | null> => {
  const pacchetti = await bus.scambia(comandoLeggiTemperatura(id), 300)
  // risposta: FF FF 01 03 00 <temp> CHK (l'eco del comando, lungo 8 byte, è esclusa)
  const r = pacchetti.find(p =>
    p.ok && !p.eco && p.bytes.length === 7 && p.bytes[2] === id && p.bytes[3] === 0x03)
  return r ? temperaturaDa(r) : null
}

// ---------- scritture per il Wi-Fi ----------

/** Porta più servo alle posizioni indicate con un solo SYNC WRITE e dice se la scheda l'ha accettato
 *  (REPLY ok o limitata). Lo SYNC WRITE non ha risposta dei servo: la conferma è quella della
 *  scheda. Lancia RangeError se una posizione non è ammessa. */
export const scriviInsieme = async (
  bus: Bus, voci: { id: number; pos: number }[], velocita: number, acc: number,
): Promise<boolean> => {
  const r = await bus.richiedi(comandoSyncWrite(voci, velocita, acc), 200)
  return r !== null && r.status <= 1
}

/** Mette il servo in coppia dopo `arm`, che non scrive nulla sui servo. Prima legge la posizione
 *  e la scrive come obiettivo, così il servo si tiene dove si trova e non scatta verso un obiettivo
 *  vecchio (dopo un rilascio del guardiano la coppia è spenta). Restituisce true se ha confermato. */
export const abilitaCoppia = async (bus: Bus, id: number): Promise<boolean> => {
  const pos = await leggiPosizione(bus, id)
  if (pos === null) return false
  if (!(await scriviPosizione(bus, id, pos))) return false
  return haRisposto(await bus.scambia(comandoCoppia(id, true), 300), id)
}
