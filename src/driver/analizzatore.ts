// analizzatore.ts: ricostruisce i pacchetti dal flusso di byte e ne verifica il checksum.
// Nessuna dipendenza da React né dal browser.

export type Pacchetto = {
  bytes: number[]    // pacchetto completo, intestazione e checksum compresi
  ok: boolean        // esito del checksum
  atteso: number     // checksum calcolato
  eco: boolean       // true se è la copia della richiesta rimandata indietro dal bus
}

/** Vero se i due array contengono gli stessi byte nello stesso ordine. */
export const uguali = (a: number[], b: number[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

/** Checksum del corpo del pacchetto (ID LEN ISTR PARAMS...), senza i due 0xFF iniziali
 *  e senza il checksum stesso: ~somma & 0xFF. Esempio: checksum([0x01, 0x02, 0x01]) = 0xFB. */
export const checksum = (corpo: number[]) => ~corpo.reduce((a, b) => a + b, 0) & 0xFF                                       //questa funzione viene usata per i test

/** Calcola il checksum di un pacchetto completo: esclude i due 0xFF iniziali e l'ultimo byte. */
const checksumPacchetto = (p: number[]) => checksum(p.slice(2, -1))                                                         // questa è usata nel parser

export class Analizzatore {
  /** buffer: accumula i byte finché il pacchetto è completo */
  private buf: number[] = []

  /** Aggiunge i byte ricevuti e restituisce i pacchetti completi che riesce a estrarre.
   *  `richiesta` sono i byte appena inviati: il pacchetto uguale a quella richiesta è l'eco
   *  che il bus rimanda indietro e viene marcato `eco`. */
  ricevi(nuovi: ArrayLike<number>, richiesta: number[] = []): Pacchetto[] {
    const trovati: Pacchetto[] = []
    this.buf.push(...Array.from(nuovi))

    while (this.buf.length >= 4) {
      if (this.buf[0] !== 0xFF || this.buf[1] !== 0xFF) { this.buf.shift(); continue }
      const len = this.buf[3]
      if (len < 2) { this.buf.shift(); continue }  // LEN impossibile: falsa intestazione
      const totale = 4 + len                       // FF FF + ID + LEN + corpo
      if (this.buf.length < totale) break          // pacchetto incompleto
      const p = this.buf.slice(0, totale)
      const atteso = checksumPacchetto(p)
      const valido = atteso === p[p.length - 1]

      if (uguali(p, richiesta)) {                  // eco della richiesta
        trovati.push({ bytes: p, ok: valido, atteso, eco: true })
        this.buf.splice(0, totale)
      } else if (valido) {                         // risposta valida
        trovati.push({ bytes: p, ok: true, atteso, eco: false })
        this.buf.splice(0, totale)
      } else {                                     // falso pacchetto: avanza di un solo byte
        trovati.push({ bytes: p, ok: false, atteso, eco: false })
        this.buf.shift()
      }
    }
    return trovati
  }

  /** Scarta i byte incompleti rimasti nel buffer. */
  svuota() {
    this.buf = []
  }
}
