// conversioni.ts: passi del servo <-> radianti. Nessuna dipendenza da React né dal bus.
// Dentro il codice si lavora in radianti; i gradi servono solo per mostrare i valori.

export const PASSI_GIRO = 4096
export const CENTRO = 2048

/** Passi -> radianti, rispetto all'offset del giunto (angolo 0). */
export const aRadianti = (passi: number, offset = CENTRO) =>
  ((passi - offset) / PASSI_GIRO) * 2 * Math.PI

/** Radianti -> passi interi, rispetto all'offset del giunto. */
export const aPassi = (rad: number, offset = CENTRO) =>
  Math.round(offset + (rad / (2 * Math.PI)) * PASSI_GIRO)

/** Solo per la presentazione. */
export const aGradi = (rad: number) => (rad * 180) / Math.PI
