// trasporto.ts: il confine fra il driver e il mondo esterno.
// Web Serial in produzione (webSerial.ts), un servo simulato nei test.
//
// Il trasporto non conosce il protocollo: scrive byte e consegna i blocchi di byte che
// arrivano, nell'ordine e con i frammenti che gli capitano, tramite `suRicezione`.

export interface Trasporto {
  /** true mentre la linea è aperta */
  readonly aperta: boolean

  /** Chiamata per ogni blocco di byte ricevuto, per tutta la durata della sessione.
   *  La assegna chi usa il trasporto (il bus). */
  suRicezione: (blocco: Uint8Array) => void

  /** Apre la linea (con Web Serial va chiamata dentro il gestore di un clic). */
  apri(): Promise<void>

  /** Rilascia la risorsa: ferma la lettura, libera i lock e chiude la porta. */
  chiudi(): Promise<void>

  /** Scrive i byte sulla linea. */
  scrivi(byte: number[]): Promise<void>
}
