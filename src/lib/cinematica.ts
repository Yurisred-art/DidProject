// cinematica.ts: braccio planare a due giunti rotoidali (2R).
// Origine sull'asse del primo giunto, x in avanti, y a sinistra, angoli in radianti
// positivi in senso antiorario; θ1 dall'asse x, θ2 relativo al primo braccio.

import { L1, L2, GOMITO } from '../config'

const TOLLERANZA = 1e-9

// ---------- cinematica diretta ----------

export const puntaX = (t1: number, t2: number) => L1 * Math.cos(t1) + L2 * Math.cos(t1 + t2)
export const puntaY = (t1: number, t2: number) => L1 * Math.sin(t1) + L2 * Math.sin(t1 + t2)

// ---------- cinematica inversa ----------

export type Angoli = { t1: number; t2: number }

/** Angoli dei due giunti per portare la punta in (x, y); null se il punto è fuori dall'area
 *  raggiungibile. La raggiungibilità si controlla PRIMA di acos, che altrimenti dà NaN. */
export const inversa = (x: number, y: number): Angoli | null => {
  const r2 = x * x + y * y
  let c2 = (r2 - L1 * L1 - L2 * L2) / (2 * L1 * L2)
  if (!Number.isFinite(c2) || Math.abs(c2) > 1 + TOLLERANZA) return null
  c2 = Math.max(-1, Math.min(1, c2))            // satura gli errori di arrotondamento
  const t2 = GOMITO * Math.acos(c2)
  const t1 = Math.atan2(y, x) - Math.atan2(L2 * Math.sin(t2), L1 + L2 * Math.cos(t2))
  return { t1, t2 }
}
