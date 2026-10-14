// bus.ts: una richiesta alla volta sul bus half-duplex, con l'analizzatore che ricostruisce
// i pacchetti di risposta. Non conosce né React né il significato dei registri.
//
// La lettura è nel trasporto, che consegna i byte a `suBlocco` per tutta la sessione.
// Il bus tiene traccia della richiesta in attesa e la conclude quando arriva la risposta,
// quando i byte smettono di arrivare o quando scade il tempo.

import type { Trasporto } from './trasporto'
import { Analizzatore, type Pacchetto } from './analizzatore'

/** Richiesta inviata e non ancora conclusa. */
type InAttesa = {
  richiesta: number[]    // byte inviati: servono a riconoscere l'eco
  trovati: Pacchetto[]   // pacchetti ricevuti finora
  fine: () => void       // conclude l'attesa
  riarma: () => void     // da chiamare a ogni blocco: da qui in poi conta il silenzio
}

export class Bus {
  /** Chiamata per ogni risposta valida (non eco): serve a controllare il byte di stato. */
  suRisposta: (p: Pacchetto) => void = () => {}

  private trasporto: Trasporto
  private analizzatore = new Analizzatore()
  private coda: Promise<unknown> = Promise.resolve()  // coda delle operazioni sulla seriale
  private inAttesa: InAttesa | null = null

  constructor(trasporto: Trasporto) {
    this.trasporto = trasporto
    // il ciclo di lettura del trasporto consegna qui i byte, a mano a mano che arrivano
    trasporto.suRicezione = blocco => this.suBlocco(blocco)
  }

  get aperta() {
    return this.trasporto.aperta
  }

  /** Esegue una sola operazione alla volta sulla seriale: ogni chiamata parte
   *  quando la precedente è finita. Evita sovrapposizioni fra Ping, Invia,
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

  /** Aspetta la fine dell'operazione in corso e rilascia la linea. */
  async chiudi() {
    try {
      await this.serializza(() => this.trasporto.chiudi())
    } finally {
      this.analizzatore.svuota()
    }
  }

  /** Riceve ogni blocco di byte dal trasporto. Se nessuna richiesta è in attesa (per esempio
   *  una risposta arrivata dopo il timeout) i byte vengono scartati. */
  private suBlocco(blocco: Uint8Array) {
    const attesa = this.inAttesa
    if (!attesa) return

    for (const p of this.analizzatore.ricevi(blocco, attesa.richiesta)) {
      attesa.trovati.push(p)
      if (p.ok && !p.eco) this.suRisposta(p)
    }
    if (attesa.trovati.some(p => !p.eco)) attesa.fine()   // risposta ricevuta: inutile aspettare ancora
    else attesa.riarma()                                  // sono arrivati byte: ora conta il silenzio
  }

  /** Scrive i byte sulla seriale e aspetta la risposta, che l'analizzatore ricompone anche se
   *  frammentata. Il bus rimanda indietro anche la richiesta (eco): il pacchetto uguale a quello
   *  inviato viene marcato `eco` e non conta come risposta. Termina appena arriva un pacchetto che
   *  non è l'eco, dopo `silenzio` ms senza nuovi byte, o dopo `primaAttesa` ms se non arriva
   *  nulla. Restituisce i pacchetti trovati, con l'esito del checksum. */
  scambia = (daInviare: number[], primaAttesa = 1000, silenzio = 300) =>
    this.serializza(async () => {
      const trovati: Pacchetto[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      let fine: () => void = () => {}
      const finito = new Promise<void>(r => { fine = r })
      const arma = (ms: number) => {
        clearTimeout(timer)
        timer = setTimeout(fine, ms)
      }

      this.analizzatore.svuota()   // byte rimasti da uno scambio precedente non c'entrano con questo
      this.inAttesa = { richiesta: daInviare, trovati, fine, riarma: () => arma(silenzio) }
      try {
        arma(primaAttesa)
        await this.trasporto.scrivi(daInviare)
        await finito
      } finally {
        clearTimeout(timer)
        this.inAttesa = null
        this.analizzatore.svuota()   // eventuali byte incompleti rimasti sono scarti
      }
      return trovati
    })
}
