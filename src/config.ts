// config.ts: parametri del braccio. Un solo posto da modificare quando cambia il montaggio.

/** ID dei servo sul bus: il primo è la spalla, il secondo il gomito. Ne verranno altri. */
export const SERVI = [1, 2]

/** Lunghezze dei bracci in mm, misurate fra gli assi dei giunti (20 cm di braccio, 17,5 cm utili). */
export const L1 = 175
export const L2 = 175

/** +1 = prima soluzione (gomito basso, θ2 > 0), -1 = seconda soluzione. */
export const GOMITO = +1

/** Posizione in passi che corrisponde all'angolo 0 di ciascun giunto.
 *  PROVVISORI: vanno misurati con la dima (braccia allineate lungo x). */
export const OFFSET: Record<number, number> = { 1: 2048, 2: 2048 }
