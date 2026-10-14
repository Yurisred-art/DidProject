// webSerial.ts: porta seriale del browser (Web Serial API) a 1 Mbaud.
//
// Ciclo di vita della risorsa (lezione 3):
//   richiesta  requestPort(), ammessa solo dentro un gestore di evento
//   apertura   open({ baudRate }), poi lettore e scrittore presi una volta sola
//   uso        un ciclo di lettura resta attivo per tutta la sessione
//   rilascio   si ferma il ciclo, si liberano i lock su lettore e scrittore, si chiude la porta

import type { Trasporto } from './trasporto'

export const BAUD_RATE = 1000000

export class WebSerial implements Trasporto {
  suRicezione: (blocco: Uint8Array) => void = () => {}

  private porta: any = null
  private lettore: ReadableStreamDefaultReader<Uint8Array> | null = null
  private scrittore: WritableStreamDefaultWriter<Uint8Array> | null = null
  private ciclo: Promise<void> | null = null   // il ciclo di lettura in esecuzione
  private attivo = false                       // false = il ciclo deve fermarsi

  get aperta() {
    return this.porta !== null
  }

  /** Chiede la porta all'utente, la apre a 1 Mbaud e avvia il ciclo di lettura. */
  async apri() {
    if (this.porta) return
    const porta = await (navigator as any).serial.requestPort();
    await porta.open({ baudRate: BAUD_RATE });
    try {
      this.scrittore = porta.writable.getWriter()
      this.lettore = porta.readable.getReader()
    } catch (e) {
      // apertura a metà: non lasciare la porta occupata
      this.scrittore?.releaseLock()
      this.scrittore = null
      await porta.close().catch(() => {})
      throw e
    }
    this.porta = porta
    this.attivo = true
    this.ciclo = this.leggi(this.lettore!)
  }

  /** Ciclo di lettura: consegna a `suRicezione` ogni blocco che arriva, finché `attivo`.
   *  Termina se la lettura fallisce (per esempio cavo scollegato) o il flusso si chiude;
   *  un errore nel gestore `suRicezione` invece viene registrato e la lettura continua. */
  private async leggi(lettore: ReadableStreamDefaultReader<Uint8Array>) {
    while (this.attivo) {
      let esito: ReadableStreamReadResult<Uint8Array>
      try {
        esito = await lettore.read()
      } catch {
        break
      }
      if (esito.done) break
      try {
        this.suRicezione(esito.value)
      } catch (e) {
        // un errore in chi riceve i byte non deve fermare la lettura per il resto della sessione
        console.error('Errore in suRicezione:', e)
      }
    }
  }

  async scrivi(byte: number[]) {
    if (!this.scrittore) throw new Error('Linea non aperta')
    await this.scrittore.write(new Uint8Array(byte))
  }

  /** Rilascio completo, nell'ordine:
   *  1. arresto del ciclo
   *  2. cancel() sul lettore: sblocca la read in attesa
   *  3. attesa della fine del ciclo
   *  4. rilascio dei lock su lettore e scrittore
   *  5. chiusura della porta
   *  Va chiamata sia su comando dell'utente sia quando il componente viene smontato. */
  async chiudi() {
    const { porta, lettore, scrittore, ciclo } = this
    if (!porta) return
    this.attivo = false                                   // 1. arresto del ciclo
    try {
      if (lettore) await lettore.cancel().catch(() => {}) // 2. sblocca la read in attesa
      if (ciclo) await ciclo.catch(() => {})              // 3. il ciclo è finito
      lettore?.releaseLock()                              // 4. libera i lock
      scrittore?.releaseLock()
      await porta.close()                                 // 5. chiude la porta
    } finally {
      this.porta = null
      this.lettore = null
      this.scrittore = null
      this.ciclo = null
    }
  }
}
