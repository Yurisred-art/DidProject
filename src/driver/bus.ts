// bus.ts: lo scambio con i servo attraverso la scheda Wi-Fi. Non conosce né React né il
// significato dei registri: incapsula il pacchetto STS in un TXN e ne rilegge la REPLY.
//
// Prima il bus scriveva sulla seriale, aspettava il silenzio e scartava l'eco. Ora la scheda
// esegue lo scambio sul bus dei servo e ci restituisce i byte letti in una REPLY, abbinata
// alla richiesta dal numero di sequenza: niente eco, niente silenzio da misurare.

import { Analizzatore, type Pacchetto } from './analizzatore'
import { leggiReply, type Risposta } from './protocollo'

/** Spedisce un TXN con questo pacchetto STS e restituisce il payload della REPLY con lo stesso
 *  seq, o null se non arriva entro `timeoutMs` (o il socket non è aperto). È txn() di useBus. */
export type InviaTxn = (sts: Uint8Array, timeoutMs: number) => Promise<Uint8Array | null>

export class Bus {
  /** Chiamata per ogni risposta valida di un servo: serve a controllare il byte di stato. */
  suRisposta: (p: Pacchetto) => void = () => {}

  /** Chiamata per ogni REPLY ricevuta, con il suo status (0 ok, 1 limitato, altri = rifiuto). */
  suEsito: (r: Risposta) => void = () => {}

  private inviaTxn: InviaTxn

  constructor(inviaTxn: InviaTxn) {
    this.inviaTxn = inviaTxn
  }

  /** Invia il pacchetto e restituisce la REPLY così com'è (null se si perde). Serve a chi non
   *  si aspetta dati, come lo SYNC WRITE, ma vuole sapere se la scheda l'ha accettato. */
  richiedi = async (daInviare: number[], timeoutMs = 1000): Promise<Risposta | null> => {
    const payload = await this.inviaTxn(Uint8Array.from(daInviare), timeoutMs)
    const risposta = payload ? leggiReply(payload) : null
    if (risposta) this.suEsito(risposta)
    return risposta
  }

  /** Invia il pacchetto e restituisce i pacchetti di risposta dei servo, con l'esito del checksum.
   *  Se la REPLY si perde o la scheda rifiuta la richiesta restituisce una lista vuota (il motivo
   *  del rifiuto arriva a `suEsito`). La stessa firma di prima, con un solo tempo massimo. */
  scambia = async (daInviare: number[], timeoutMs = 1000): Promise<Pacchetto[]> => {
    const risposta = await this.richiedi(daInviare, timeoutMs)
    if (!risposta || risposta.status > 1) return []
    const pacchetti = new Analizzatore().ricevi(risposta.dati)
    for (const p of pacchetti) if (p.ok) this.suRisposta(p)
    return pacchetti
  }
}
