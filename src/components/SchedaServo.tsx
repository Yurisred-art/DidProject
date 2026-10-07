// SchedaServo.tsx: presentazione e comandi. Non conosce il protocollo: usa solo ciò che
// espone useServo.

import { useState } from 'react'
import type { ServoApi } from '../hooks/useServo'
import { POS_MAX } from '../driver/sts3215'

// posizioni prefissate della croce (0 = giù, 4096 = giro intero)
const POS = { giu: 0, sinistra: 1024, su: 2048, destra: 3072 }

export function SchedaServo({ servo }: { servo: ServoApi }) {
  const { aperta, occupato, tempAttiva, telemetria, log, aggiungi } = servo
  const [testo, setTesto] = useState('')               // campo esadecimale
  const [decimale, setDecimale] = useState('')         // campo posizione decimale

  /** Converte il campo esadecimale in byte (spazi, virgole o "0x" ammessi) e li invia. */
  const invia = () => {
    let daInviare: number[]
    try {
      const token = testo.trim().split(/[\s,;]+/).filter(Boolean)
      if (token.length === 0) throw new Error('Inserisci almeno un byte')
      daInviare = token.map(t => {
        const p = t.replace(/^0x/i, '')
        if (!/^[0-9a-f]{1,2}$/i.test(p)) throw new Error(`Byte non valido: "${t}"`)
        return parseInt(p, 16)
      })
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + (e as Error).message, errore: true }])
      return
    }
    servo.eseguiComando(daInviare)
  }

  /** Controlla il valore decimale (0-4095) e porta il servo in quella posizione. */
  const vai = () => {
    const v = decimale.trim()
    if (!/^\d+$/.test(v) || Number(v) > POS_MAX) {
      aggiungi([{ testo: `Errore: inserisci un intero tra 0 e ${POS_MAX}`, errore: true }])
      return
    }
    servo.vaiA(Number(v))
  }

  // i controlli sono disabilitati a linea chiusa o mentre un comando è in corso
  const bloccato = !aperta || occupato

  return (
    <>
      {/* riga 1: gestione linea */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={servo.apri} disabled={aperta}>Apri linea</button>
        <button onClick={servo.chiudi} disabled={!aperta || occupato}>Chiudi linea</button>
        <span>Linea: {aperta ? 'aperta' : 'chiusa'}</span>
      </div>

      {/* riga 2: ping, invio byte esadecimali, svuota log */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={servo.ping} disabled={bloccato}>Ping</button>
        <input
          value={testo}
          onChange={e => setTesto(e.target.value)}
          placeholder="FF FF 01 02 01 FB"
          style={{ width: 300, fontFamily: 'monospace' }}
          disabled={bloccato}
        />
        <button onClick={invia} disabled={bloccato}>Invia</button>
        <button onClick={servo.svuotaLog}>Clear</button>
      </div>

      {/* riga 3: posizione in decimale */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          value={decimale}
          onChange={e => setDecimale(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !bloccato && vai()}
          placeholder={`Posizione (0-${POS_MAX})`}
          style={{ width: 150, fontFamily: 'monospace' }}
          disabled={bloccato}
        />
        <button onClick={vai} disabled={bloccato}>Vai</button>
      </div>

      {/* riga 4: toggle temperatura */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={servo.commutaTemperatura} disabled={!aperta}>
          Temperatura: {tempAttiva ? 'ON' : 'OFF'}
        </button>
        <span style={{ fontFamily: 'monospace' }}>
          {telemetria.temp !== null ? `${telemetria.temp}°` : '--°'}
        </span>
      </div>

      {/* croce direzionale: posizioni prefissate */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gridTemplateRows: 'repeat(3, 48px)',
        gap: 6, marginTop: 16, alignItems: 'center', justifyItems: 'center',
      }}>
        <button style={{ gridColumn: 2, gridRow: 1 }} title={`Posizione ${POS.su}`}
          onClick={() => servo.vaiA(POS.su)} disabled={bloccato}>▲</button>
        <button style={{ gridColumn: 1, gridRow: 2 }} title={`Posizione ${POS.sinistra}`}
          onClick={() => servo.vaiA(POS.sinistra)} disabled={bloccato}>◀</button>
        <button style={{ gridColumn: 3, gridRow: 2 }} title={`Posizione ${POS.destra}`}
          onClick={() => servo.vaiA(POS.destra)} disabled={bloccato}>▶</button>
        <button style={{ gridColumn: 2, gridRow: 3 }} title={`Posizione ${POS.giu}`}
          onClick={() => servo.vaiA(POS.giu)} disabled={bloccato}>▼</button>
      </div>

      {/* log in colonna a sinistra, più recente in alto; gli errori sono in rosso */}
      <div style={{ marginTop: 16, textAlign: 'left', fontFamily: 'monospace' }}>
        {log.map(v => (
          <div key={v.id} style={{ color: v.errore ? 'red' : undefined, marginBottom: 4 }}>
            {v.testo}
          </div>
        ))}
      </div>
    </>
  )
}
