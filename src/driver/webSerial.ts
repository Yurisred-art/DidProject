// webSerial.ts: porta seriale del browser (Web Serial API) a 1 Mbaud.
// Scrittura e lettura sono quelle già in uso: lettore e scrittore vengono presi e rilasciati
// a ogni scambio, quindi nessun lock resta attivo fra un'operazione e l'altra.

import type { Trasporto } from './trasporto'

export const BAUD_RATE = 1000000

export class WebSerial implements Trasporto {
  private porta: any = null

  get aperta() {
    return this.porta !== null
  }

  /** Chiede la porta all'utente e la apre. */
  async apri() {
    const porta = await (navigator as any).serial.requestPort();
    await porta.open({ baudRate: BAUD_RATE });
    this.porta = porta
  }

  async chiudi() {
    try {
      await this.porta?.close()
    } finally {
      this.porta = null
    }
  }

  async scambia(
    daInviare: number[],
    primaAttesa: number,
    silenzio: number,
    suByte: (blocco: Uint8Array) => boolean,
  ) {
    const porta = this.porta
    const scrittore = porta.writable.getWriter()
    const lettore = porta.readable.getReader()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await scrittore.write(new Uint8Array(daInviare))
      timer = setTimeout(() => lettore.cancel(), primaAttesa)
      while (true) {
        const { value, done } = await lettore.read()
        if (done) break
        clearTimeout(timer)
        timer = setTimeout(() => lettore.cancel(), silenzio)
        if (suByte(value)) break
      }
    } finally {
      clearTimeout(timer)
      scrittore.releaseLock()
      lettore.releaseLock()
    }
  }
}
