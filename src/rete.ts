// rete.ts: parametri del collegamento Wi-Fi con la scheda (ESP32-C6, firmware luma-esp).
// Un solo posto da modificare quando cambia la scheda; la geometria del braccio resta in config.ts.

import { SERVI, LIMITI } from './config'

/** Nome mDNS della scheda: raggiungibile come <nome>.local (predefinito "lamp"). */
export const NOME_SCHEDA = 'lamp'

/** Indirizzo del WebSocket del bus (L06, passo 5: ws://<name>.local/bus). */
export const URL_BUS = `ws://${NOME_SCHEDA}.local/bus`

/** Periodo di lettura dei servo da parte della scheda, che ci spedisce la TELEMETRIA (20-1000 ms). */
export const POLL_MS = 50

/** Se la scheda non riceve nulla per tanto tempo ferma i servo (500-60000 ms). */
export const LINK_TIMEOUT_MS = 3500

/** Keepalive: un frame vuoto ogni secondo, meno di LINK_TIMEOUT_MS / 3 (slide L06). */
export const KEEPALIVE_MS = 1000

/** Velocità (passi/s) e accelerazione (unità da 100 passi/s²) dello SYNC WRITE delle traiettorie.
 *  La velocità non può superare maxSpeed del profilo, altrimenti la scheda la riporta al limite. */
export const VELOCITA = 2000
export const ACCELERAZIONE = 50

/** Profilo inviato alla scheda con config.set: i servo e i limiti vengono da config.ts, così
 *  LIMITI vale sia per il client sia per la scheda (che li impone con il clamp). */
export const PROFILO = {
  name: NOME_SCHEDA,
  pollMs: POLL_MS,
  linkTimeoutMs: LINK_TIMEOUT_MS,
  servos: SERVI.map(id => ({
    id,
    mode: 'position',
    min: LIMITI[id][0],
    max: LIMITI[id][1],
    maxSpeed: VELOCITA,
  })),
}
