// bus.ts: una richiesta alla volta sul bus half-duplex, con l'analizzatore che ricostruisce
// i pacchetti di risposta. Non conosce né React né il significato dei registri.

import type { Trasporto } from './trasporto'
import { Analizzatore, type Pacchetto } from './analizzatore'

export class Bus {
  /** Chiamata per ogni risposta valida (non eco): serve a controllare il byte di stato. */
  suRisposta: (p: Pacchetto) => void = () => {}

  private trasporto: Trasporto
  private analizzatore = new Analizzatore()
  private coda: Promise<unknown> = Promise.resolve()  // coda delle operazioni sulla seriale

  constructor(trasporto: Trasporto) {
    this.trasporto = trasporto
  }

  get aperta() {
    return this.trasporto.aperta
  }

  /** Esegue una sola operazione alla volta sulla seriale: ogni chiamata parte
   *  quando la precedente è finita. Evita conflitti di lock tra Ping, Invia,
   *  Vai, croce e polling della temperatura. */
  serializza = <T>(fn: () => Promise<T>): Promise<T> => {
    const r = this.coda.then(fn, fn)
    this.coda = r.catch(() => {})
    return r
  }

  /** Apre la linea (da chiamare dentro il gestore di un clic). */
  apri() {
    return this.trasporto.apri()
  }

  /** Aspetta la fine dell'operazione in corso e chiude la linea. */
  async chiudi() {
    try {
      await this.serializza(() => this.trasporto.chiudi())
    } finally {
      this.analizzatore.svuota()
    }
  }

  /** Scrive i byte sulla seriale e legge la risposta con l'analizzatore
   *  (i pacchetti frammentati vengono ricomposti). Il bus rimanda indietro anche la richiesta
   *  (eco): il pacchetto uguale a quello inviato viene marcato `eco` e non conta come risposta.
   *  Termina appena arriva un pacchetto che non è l'eco, dopo `silenzio` ms senza nuovi byte,
   *  o dopo `primaAttesa` ms se non arriva nulla. Restituisce i pacchetti trovati,
   *  con l'esito del checksum. */
  scambia = (daInviare: number[], primaAttesa = 1000, silenzio = 300) =>
    this.serializza(async () => {
      const trovati: Pacchetto[] = []
      try {
        await this.trasporto.scambia(daInviare, primaAttesa, silenzio, blocco => {
          for (const p of this.analizzatore.ricevi(blocco, daInviare)) {
            trovati.push(p)
            if (p.ok && !p.eco) this.suRisposta(p)
          }
          return trovati.some(p => !p.eco)   // risposta ricevuta: inutile aspettare ancora
        })
      } finally {
        this.analizzatore.svuota()   // eventuali byte incompleti rimasti sono scarti: non devono bloccare lo scambio successivo
      }
      return trovati
    })
}
