// MappaArea.tsx: vista dall'alto dell'area che la punta può raggiungere, con i limiti dei servo
// e, sopra, il cerchio che si sta per tracciare. x verso destra, y verso l'alto, base al centro.

import { L1, L2 } from '../config'
import { esitoPunto } from '../lib/giunti'
import { cerchio } from '../lib/traiettoria'

const RAGGIO_MAX = L1 + L2          // mm
const PASSO = 10                    // mm, lato di ogni cella
const LATO = 400                    // px
const SCALA = LATO / (2 * RAGGIO_MAX + 20)
const C = LATO / 2

const px = (x: number) => C + x * SCALA
const py = (y: number) => C - y * SCALA

/** Le celle dipendono solo da config.ts: si calcolano una volta sola. */
const celle = (() => {
  let ok = '', limiti = ''
  const s = PASSO * SCALA
  for (let x = -RAGGIO_MAX; x < RAGGIO_MAX; x += PASSO) {
    for (let y = -RAGGIO_MAX; y < RAGGIO_MAX; y += PASSO) {
      const e = esitoPunto(x + PASSO / 2, y + PASSO / 2)
      if (e === 'fuori-area') continue
      const r = `M${px(x).toFixed(1)} ${(py(y) - s).toFixed(1)}h${s.toFixed(1)}v${s.toFixed(1)}h${(-s).toFixed(1)}z`
      if (e === 'ok') ok += r; else limiti += r
    }
  }
  return { ok, limiti }
})()

type Props = { cx: number; cy: number; raggio: number; x: number; y: number }

export function MappaArea({ cx, cy, raggio, x, y }: Props) {
  // cerchio previsto: 120 punti, e quanti sono fuori area o fuori limiti
  let tracciato = ''
  let fuori = 0
  const cerchioValido = [cx, cy, raggio].every(Number.isFinite) && raggio > 0
  if (cerchioValido) {
    const c = cerchio(cx, cy, raggio)
    const N = 120
    for (let i = 0; i <= N; i++) {
      const p = c(i / N)
      tracciato += (i === 0 ? 'M' : 'L') + px(p.x).toFixed(1) + ' ' + py(p.y).toFixed(1)
      if (esitoPunto(p.x, p.y) !== 'ok') fuori++
    }
  }
  const puntoValido = Number.isFinite(x) && Number.isFinite(y)

  return (
    <div style={{ textAlign: 'left', marginTop: 20 }}>
      <svg width={LATO} height={LATO} style={{ border: '1px solid #888', background: '#fff' }}>
        <path d={celle.ok} fill="#7bc47f" />
        <path d={celle.limiti} fill="#f0b25a" />
        {/* assi: base in (0,0), x a destra, y in alto */}
        <line x1={0} y1={C} x2={LATO} y2={C} stroke="#999" strokeWidth={0.5} />
        <line x1={C} y1={0} x2={C} y2={LATO} stroke="#999" strokeWidth={0.5} />
        <circle cx={C} cy={C} r={4} fill="#333" />
        {cerchioValido && <path d={tracciato} fill="none" stroke={fuori ? '#d33' : '#1a4fd6'} strokeWidth={2} />}
        {puntoValido && <circle cx={px(x)} cy={py(y)} r={4} fill="#d33" />}
      </svg>
      <div style={{ fontFamily: 'monospace', fontSize: 12 }}>
        verde = raggiungibile · arancione = dentro l'area ma fuori dai limiti dei servo · base al centro, x a destra, y in alto
        {cerchioValido && (fuori
          ? <div style={{ color: 'red' }}>Cerchio: {fuori} punti su 121 fuori area o fuori limiti (verrà rifiutato)</div>
          : <div>Cerchio: tutto raggiungibile</div>)}
      </div>
    </div>
  )
}
