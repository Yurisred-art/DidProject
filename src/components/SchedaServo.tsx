// SchedaServo.tsx: presentazione e comandi. Non conosce il protocollo: usa solo ciò che
// espone useServo. Struttura di prima; le parti che dipendono dal servo si ripetono per ogni ID.

import { useState } from 'react'
import type { ServoApi } from '../hooks/useServo'
import { POS_MAX } from '../driver/sts3215'
import { SERVI } from '../config'

// posizioni prefissate della croce (0 = giù, 4096 = giro intero)
const POS = { giu: 0, sinistra: 1024, su: 2048, destra: 3072 }

export function SchedaServo({ servo, inMoto = false }: { servo: ServoApi; inMoto?: boolean }) {
  const { aperta, occupato, tempAttiva, telemetria, log, aggiungi } = servo
  const [testo, setTesto] = useState('')               // campo esadecimale
  const [decimale, setDecimale] = useState<Record<number, string>>({})   // campo posizione, per servo
  const [idAttuale, setIdAttuale] = useState('1')      // cambio ID: quello che il servo ha ora
  const [idNuovo, setIdNuovo] = useState('2')          // cambio ID: quello da assegnare

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

  /** Controlla il valore decimale (0-4095) e porta il servo `id` in quella posizione. */
  const vai = (id: number) => {
    const v = (decimale[id] ?? '').trim()
    if (!/^\d+$/.test(v) || Number(v) > POS_MAX) {
      aggiungi([{ testo: `Errore: inserisci un intero tra 0 e ${POS_MAX}`, errore: true }])
      return
    }
    servo.vaiA(id, Number(v))
  }

  /** Cambia l'ID dopo una conferma esplicita: scrive in memoria permanente nel servo. */
  const cambiaId = () => {
    const a = idAttuale.trim(), n = idNuovo.trim()
    if (!/^\d+$/.test(a) || !/^\d+$/.test(n)) {
      aggiungi([{ testo: 'Errore: gli ID devono essere numeri interi', errore: true }])
      return
    }
    if (!window.confirm(
      `Cambiare l'ID del servo da ${a} a ${n}?\n\n` +
      'Deve essere collegato UN SOLO servo al bus: l\'ID viene scritto nella memoria permanente del servo.')) return
    servo.cambiaId(Number(a), Number(n))
  }

  // i controlli sono disabilitati a linea chiusa, durante un comando o durante una traiettoria
  const bloccato = !aperta || occupato || inMoto

  return (
    <>
      {/* riga 1: gestione linea */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={servo.apri} disabled={aperta}>Apri linea</button>
        <button onClick={servo.chiudi} disabled={!aperta || occupato}>Chiudi linea</button>
        <span>Linea: {aperta ? 'aperta' : 'chiusa'}</span>
        <button onClick={servo.commutaTemperatura} disabled={!aperta}>
          Temperatura: {tempAttiva ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* riga 2: invio byte esadecimali, svuota log */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
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

      {/* cambio ID: solo con un servo collegato al bus */}
      <fieldset style={{ marginBottom: 12, textAlign: 'left' }}>
        <legend>Cambia ID (un solo servo sul bus)</legend>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          ID attuale <input value={idAttuale} onChange={e => setIdAttuale(e.target.value)}
            style={{ width: 60, fontFamily: 'monospace' }} disabled={bloccato} />
          nuovo <input value={idNuovo} onChange={e => setIdNuovo(e.target.value)}
            style={{ width: 60, fontFamily: 'monospace' }} disabled={bloccato} />
          <button onClick={cambiaId} disabled={bloccato}>Cambia ID</button>
        </div>
      </fieldset>

      {/* un blocco per ogni servo: ping, posizione, temperatura, croce */}
      {SERVI.map(id => {
        const temp = telemetria[id]?.temp ?? null
        return (
          <fieldset key={id} style={{ marginBottom: 12, textAlign: 'left' }}>
            <legend>Servo {id}</legend>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <button onClick={() => servo.ping(id)} disabled={bloccato}>Ping</button>
              <input
                value={decimale[id] ?? ''}
                onChange={e => setDecimale(d => ({ ...d, [id]: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && !bloccato && vai(id)}
                placeholder={`Posizione (0-${POS_MAX})`}
                style={{ width: 150, fontFamily: 'monospace' }}
                disabled={bloccato}
              />
              <button onClick={() => vai(id)} disabled={bloccato}>Vai</button>
              <span style={{ fontFamily: 'monospace' }}>
                {temp !== null ? `${temp}°` : '--°'}
              </span>
            </div>

            {/* croce direzionale: posizioni prefissate */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gridTemplateRows: 'repeat(3, 48px)',
              gap: 6, alignItems: 'center', justifyItems: 'center',
            }}>
              <button style={{ gridColumn: 2, gridRow: 1 }} title={`Posizione ${POS.su}`}
                onClick={() => servo.vaiA(id, POS.su)} disabled={bloccato}>▲</button>
              <button style={{ gridColumn: 1, gridRow: 2 }} title={`Posizione ${POS.sinistra}`}
                onClick={() => servo.vaiA(id, POS.sinistra)} disabled={bloccato}>◀</button>
              <button style={{ gridColumn: 3, gridRow: 2 }} title={`Posizione ${POS.destra}`}
                onClick={() => servo.vaiA(id, POS.destra)} disabled={bloccato}>▶</button>
              <button style={{ gridColumn: 2, gridRow: 3 }} title={`Posizione ${POS.giu}`}
                onClick={() => servo.vaiA(id, POS.giu)} disabled={bloccato}>▼</button>
            </div>
          </fieldset>
        )
      })}

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
