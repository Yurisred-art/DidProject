// protocollo.ts: i frame binari del protocollo luma-esp (versione 8), solo byte.
// Nessuna dipendenza da React né dalla rete: si testa con array di numeri.
//
// I frame TXN (verso la scheda) li costruisce sendTxn() di useBus, con le righe delle slide.
// Qui si leggono i frame che arrivano: REPLY e TELEMETRIA. Interi in little-endian.

import { checksum, type Pacchetto } from './analizzatore'

/** Versione del protocollo: con un numero diverso si chiude la connessione. */
export const PROTOCOLLO = 8

/** Tipo del frame (primo byte). */
export const TIPO = { TXN: 0x01, REPLY: 0x02, TELEMETRIA: 0x03, TRACE: 0x04 } as const

/** Significato del primo byte del payload di una REPLY, indice = codice. */
export const STATO_RISPOSTA = [
  'ok',
  'valore limitato (clamp) dal profilo',
  'rifiutato: non valido nello stato corrente (serve arm o disarm)',
  'rifiutato: servo mancante o non valido',
  'rifiutato: servo rilasciato dal guardiano (serve arm)',
  'rifiutato: registro non valido',
  'rifiutato: frame malformato',
  'rifiutato: tipo non supportato',
]

/** Payload di una REPLY: status, servo e i byte di risposta del servo letti dal bus. */
export type Risposta = { status: number; servo: number; dati: number[] }

/** Legge il payload di una REPLY (il frame senza le quattro intestazioni): status, servo, dati.
 *  Restituisce null se è più corto dei due byte fissi. */
export const leggiReply = (payload: ArrayLike<number>): Risposta | null =>
  payload.length < 2
    ? null
    : { status: payload[0], servo: payload[1], dati: Array.from(payload).slice(2) }

/** Lunghezza di uno status frame nella telemetria: FF FF id 21 errore dati[31] checksum. */
export const LUNGHEZZA_STATUS = 37

/** Estrae gli status frame dal payload di una TELEMETRIA. Non divide a blocchi da 37 byte: cerca
 *  FF FF <id> 21 e accetta il frame solo se il checksum torna, perché una risposta corrotta
 *  può far slittare quelle dopo. Un servo che non ha risposto non compare. I frame validi hanno
 *  la stessa forma di un pacchetto di stato, quindi si leggono come un Pacchetto. */
export const leggiTelemetria = (payload: ArrayLike<number>): Pacchetto[] => {
  const b = Array.from(payload)
  const trovati: Pacchetto[] = []
  let i = 0
  while (i + LUNGHEZZA_STATUS <= b.length) {
    if (b[i] === 0xFF && b[i + 1] === 0xFF && b[i + 3] === 0x21) {
      const bytes = b.slice(i, i + LUNGHEZZA_STATUS)
      const atteso = checksum(bytes.slice(2, -1))
      if (atteso === bytes[LUNGHEZZA_STATUS - 1]) {
        trovati.push({ bytes, ok: true, atteso, eco: false })
        i += LUNGHEZZA_STATUS      // frame buono: salta tutto
        continue
      }
    }
    i++                            // non è un frame valido: scorre di un byte
  }
  return trovati
}
