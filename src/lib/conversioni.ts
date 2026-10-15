// conversioni.ts: passi del servo <-> radianti. Nessuna dipendenza da React né dal bus.
// Dentro il codice si lavora in radianti; i gradi servono solo per mostrare i valori.

export const PASSI_GIRO = 4096
export const CENTRO = 2048

/** Passi -> radianti, rispetto all'offset del giunto (angolo 0).
 *  `segno` vale -1 per un servo montato al contrario (aumentando i passi gira in senso orario). */
export const aRadianti = (passi: number, offset = CENTRO, segno = 1) =>
  segno * ((passi - offset) / PASSI_GIRO) * 2 * Math.PI

/** Radianti -> passi interi, rispetto all'offset del giunto e al suo verso. */
export const aPassi = (rad: number, offset = CENTRO, segno = 1) =>
  Math.round(offset + segno * (rad / (2 * Math.PI)) * PASSI_GIRO)

/** Solo per la presentazione. */
export const aGradi = (rad: number) => (rad * 180) / Math.PI
