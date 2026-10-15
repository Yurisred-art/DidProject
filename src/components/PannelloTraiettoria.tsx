// PannelloTraiettoria.tsx: obiettivo 1 (raggiungere un punto) e obiettivo 2 (tracciare una circonferenza).

import { useState } from 'react'
import { useTraiettoria } from '../hooks/useTraiettoria'
import { velocitaCerchio } from '../lib/traiettoria'

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
const campo = { width: 70, fontFamily: 'monospace' } as const

export function PannelloTraiettoria({ bloccato, inMoto, vaiAlPunto, tracciaCerchio, ferma }:
  { bloccato: boolean } & ReturnType<typeof useTraiettoria>) {
  const [x, setX] = useState('250')
  const [y, setY] = useState('0')
  const [cx, setCx] = useState('250')
  const [cy, setCy] = useState('0')
  const [raggio, setRaggio] = useState('50')
  const [durata, setDurata] = useState('4')

  const r = num(raggio)
  const d = num(durata)
  const vel = r > 0 && d > 0 ? velocitaCerchio(r, d) : null

  return (
    <fieldset style={{ marginBottom: 12, textAlign: 'left' }}>
      <legend>Traiettoria (mm)</legend>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span>Punto</span>
        x <input style={campo} value={x} onChange={e => setX(e.target.value)} disabled={bloccato} />
        y <input style={campo} value={y} onChange={e => setY(e.target.value)} disabled={bloccato} />
        <button onClick={() => vaiAlPunto(num(x), num(y))} disabled={bloccato}>Vai al punto</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span>Cerchio</span>
        cx <input style={campo} value={cx} onChange={e => setCx(e.target.value)} disabled={bloccato} />
        cy <input style={campo} value={cy} onChange={e => setCy(e.target.value)} disabled={bloccato} />
        raggio <input style={campo} value={raggio} onChange={e => setRaggio(e.target.value)} disabled={bloccato} />
        durata (s) <input style={campo} value={durata} onChange={e => setDurata(e.target.value)} disabled={bloccato} />
        <button onClick={() => tracciaCerchio(num(cx), num(cy), r, d)} disabled={bloccato}>Traccia</button>
        <button onClick={ferma} disabled={!inMoto}>Ferma</button>
      </div>
      {vel && (
        <div style={{ marginTop: 8, fontFamily: 'monospace' }}>
          velocità media {vel.media.toFixed(0)} mm/s, di picco {vel.picco.toFixed(0)} mm/s
        </div>
      )}
    </fieldset>
  )
}
