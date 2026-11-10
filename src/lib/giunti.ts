// giunti.ts: dagli angoli dei due giunti ai passi dei servo, e controllo dei limiti.
// Nessuna dipendenza da React né dal bus.

import { SERVI, OFFSET, SEGNO, LIMITI } from '../config'
import { aPassi } from './conversioni'
import { inversa, type Angoli } from './cinematica'

const [ID1, ID2] = SERVI

/** Angoli -> passi dei due servo (offset e verso di ciascuno). */
export const passiDi = (a: Angoli) =>
  [aPassi(a.t1, OFFSET[ID1], SEGNO[ID1]), aPassi(a.t2, OFFSET[ID2], SEGNO[ID2])]

/** true se i passi stanno dentro i limiti di entrambi i servo. */
export const dentroLimiti = (passi: number[]) =>
  [ID1, ID2].every((id, k) => passi[k] >= LIMITI[id][0] && passi[k] <= LIMITI[id][1])

export type Esito = 'ok' | 'fuori-area' | 'fuori-limiti'

/** Un punto (x, y) è raggiungibile, fuori dall'area del braccio o fuori dai limiti dei servo. */
export const esitoPunto = (x: number, y: number): Esito => {
  const a = inversa(x, y)
  if (!a) return 'fuori-area'
  return dentroLimiti(passiDi(a)) ? 'ok' : 'fuori-limiti'
}
