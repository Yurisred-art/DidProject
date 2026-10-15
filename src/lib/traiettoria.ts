// traiettoria.ts: percorso (geometria, s in [0,1]) + legge oraria (t -> s) = traiettoria.
// Nessuna dipendenza da React né dal bus.

import { inversa } from './cinematica'

export type Punto = { x: number; y: number }
export type Percorso = (s: number) => Punto
export type LeggeOraria = (t: number) => number

// ---------- percorsi ----------

/** Segmento da A a B. */
export const segmento = (A: Punto, B: Punto): Percorso => {
  const puntoDelSegmento: Percorso = s => ({
    x: A.x + s * (B.x - A.x),
    y: A.y + s * (B.y - A.y),
  })
  return puntoDelSegmento
}

/** Circonferenza di centro (cx, cy) e raggio dato, percorsa una volta per s da 0 a 1. */
export const cerchio = (cx: number, cy: number, raggio: number): Percorso => {
  const puntoDelCerchio: Percorso = s => ({
    x: cx + raggio * Math.cos(2 * Math.PI * s),
    y: cy + raggio * Math.sin(2 * Math.PI * s),
  })
  return puntoDelCerchio
}

// ---------- leggi orarie ----------

/** Velocità costante. */
export const lineare: LeggeOraria = t => t

/** Raccordo cubico: parte e arriva con velocità nulla. */
export const raccordo: LeggeOraria = t => t * t * (3 - 2 * t)

// ---------- verifiche di progetto ----------

/** Errore massimo (sagitta) quando la circonferenza è approssimata da N corde: f = r(1 - cos(α/2)). */
export const sagitta = (raggio: number, N: number) => {
  const alfa = (2 * Math.PI) / N
  return raggio * (1 - Math.cos(alfa / 2))
}

/** Sviluppo della circonferenza e velocità media e di picco del raccordo (picco = media × 1,5). */
export const velocitaCerchio = (raggio: number, durata: number) => {
  const sviluppo = 2 * Math.PI * raggio
  const media = sviluppo / durata
  return { sviluppo, media, picco: media * 1.5 }
}

/** Primo punto del percorso (campionato) che il braccio non raggiunge, o null se sono tutti raggiungibili. */
export const primoPuntoNonRaggiungibile = (percorso: Percorso, campioni = 360): Punto | null => {
  for (let i = 0; i <= campioni; i++) {
    const p = percorso(i / campioni)
    if (!inversa(p.x, p.y)) return p
  }
  return null
}
