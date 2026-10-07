// trasporto.ts: il confine fra il driver e il mondo esterno.
// Web Serial in produzione (webSerial.ts), un servo simulato nei test.

export interface Trasporto {
  /** true mentre la linea è aperta */
  readonly aperta: boolean

  /** Apre la linea (con Web Serial va chiamata dentro il gestore di un clic). */
  apri(): Promise<void>

  /** Chiude la linea. */
  chiudi(): Promise<void>

  /** Scrive `daInviare` e consegna a `suByte` i blocchi di byte che arrivano.
   *  Termina quando `suByte` restituisce true, dopo `silenzio` ms senza nuovi byte,
   *  o dopo `primaAttesa` ms se non arriva nulla. */
  scambia(
    daInviare: number[],
    primaAttesa: number,
    silenzio: number,
    suByte: (blocco: Uint8Array) => boolean,
  ): Promise<void>
}
