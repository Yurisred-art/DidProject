// useTraiettoria.ts: porta la punta del braccio in un punto o lungo una circonferenza.
// Usa la matematica di /lib (cinematica, traiettoria, conversioni) e il bus tramite useServo.
// Nello stato solo `inMoto`; il timer e il numero della corsa in corso stanno nei ref.

import { useEffect, useRef, useState } from 'react'
import type { ServoApi } from './useServo'
import { POS_MAX } from '../driver/sts3215'
import { SERVI, OFFSET } from '../config'
import { aPassi, aRadianti, aGradi } from '../lib/conversioni'
import { inversa, puntaX, puntaY, type Angoli } from '../lib/cinematica'
import {
  cerchio, raccordo, primoPuntoNonRaggiungibile, velocitaCerchio,
  type Percorso,
} from '../lib/traiettoria'

const PERIODO_MS = 20          // 50 Hz
const FALLITE_MAX = 5          // conferme mancate consecutive prima di fermarsi
const SALTO_MAX = 2048         // mezzo giro in un solo campione: discontinuità, non movimento

const [ID1, ID2] = SERVI

/** Angoli -> passi dei due servo. */
const passiDi = (a: Angoli) => [aPassi(a.t1, OFFSET[ID1]), aPassi(a.t2, OFFSET[ID2])]

export function useTraiettoria(servo: ServoApi) {
  const [inMoto, setInMoto] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const corsa = useRef(0)                        // cambia a ogni avvio e a ogni arresto
  const servoRef = useRef(servo)                 // il timer legge sempre l'ultima versione
  servoRef.current = servo

  const log = (testo: string, errore = false) => servoRef.current.aggiungi([{ testo, errore }])

  const fermaTimer = () => {
    if (timer.current !== null) clearInterval(timer.current)
    timer.current = null
  }

  /** Interrompe la traiettoria in corso (il servo resta dov'è). */
  const ferma = () => {
    corsa.current++
    fermaTimer()
    setInMoto(false)
  }

  // smontaggio o linea chiusa: il timer non deve continuare a scrivere
  useEffect(() => () => { corsa.current++; fermaTimer() }, [])
  useEffect(() => { if (!servo.aperta) ferma() }, [servo.aperta])

  /** Scrive gli angoli sui due servo e dice se entrambi hanno confermato.
   *  Un valore non ammesso (NaN, fuori scala) fa lanciare RangeError dal driver. */
  const inviaAngoli = async (a: Angoli) => {
    const [p1, p2] = passiDi(a)
    const ok1 = await servoRef.current.scrivi(ID1, p1)
    const ok2 = await servoRef.current.scrivi(ID2, p2)
    return ok1 && ok2
  }

  /** Posizione della punta ricavata dalle posizioni lette (cinematica diretta). */
  const puntaDa = (pos1: number, pos2: number) => {
    const t1 = aRadianti(pos1, OFFSET[ID1])
    const t2 = aRadianti(pos2, OFFSET[ID2])
    return { x: puntaX(t1, t2), y: puntaY(t1, t2) }
  }

  // ---------- obiettivo 1: raggiungere un punto ----------

  const vaiAlPunto = async (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return log('Punto non valido', true)
    const a = inversa(x, y)
    if (!a) return log(`Punto (${x}, ${y}) fuori dall'area raggiungibile`, true)
    const [p1, p2] = passiDi(a)
    if (p1 < 0 || p1 > POS_MAX || p2 < 0 || p2 > POS_MAX)
      return log(`Punto (${x}, ${y}): posizioni ${p1} e ${p2} fuori scala (0..${POS_MAX}), controllare gli offset`, true)

    await servo.conOccupato(async () => {
      log(`Obiettivo (${x}, ${y}) mm: θ1 = ${aGradi(a.t1).toFixed(1)}°, θ2 = ${aGradi(a.t2).toFixed(1)}°`)
      try {
        const ok = await inviaAngoli(a)
        if (!ok) log('Un servo non ha confermato la scrittura', true)
        const [r1, r2] = await Promise.all([
          servo.attendiPosizione(ID1, p1),
          servo.attendiPosizione(ID2, p2),
        ])
        if (r1 === null || r2 === null) return
        const p = puntaDa(r1, r2)
        log(`Punta raggiunta in (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) mm, errore ${Math.hypot(p.x - x, p.y - y).toFixed(1)} mm`)
      } catch (e) {
        log('Errore: ' + String(e), true)
      }
    })
  }

  // ---------- obiettivo 2: tracciare una circonferenza ----------

  /** Controlla prima di muoversi che tutto il percorso sia raggiungibile, entro la corsa dei servo
   *  e senza salti. Restituisce il messaggio d'errore, o null se va bene. */
  const verifica = (percorso: Percorso, campioni = 360): string | null => {
    const fuori = primoPuntoNonRaggiungibile(percorso, campioni)
    if (fuori) return `Il punto (${fuori.x.toFixed(0)}, ${fuori.y.toFixed(0)}) è fuori dall'area raggiungibile`
    let prec: number[] | null = null
    for (let i = 0; i <= campioni; i++) {
      const p = percorso(i / campioni)
      const passi = passiDi(inversa(p.x, p.y)!)
      if (passi.some(v => v < 0 || v > POS_MAX))
        return `Il percorso richiede posizioni fuori scala (${passi.join(', ')}): controllare gli offset`
      if (prec && passi.some((v, k) => Math.abs(v - prec![k]) > SALTO_MAX))
        return 'Il percorso attraversa una discontinuità degli angoli'
      prec = passi
    }
    return null
  }

  const tracciaCerchio = async (cx: number, cy: number, raggio: number, durataS: number) => {
    if (![cx, cy, raggio, durataS].every(Number.isFinite) || raggio <= 0 || durataS <= 0)
      return log('Parametri della circonferenza non validi', true)
    if (inMoto) return

    const percorso = cerchio(cx, cy, raggio)
    const errore = verifica(percorso)
    if (errore) return log(errore, true)

    const questa = ++corsa.current
    setInMoto(true)
    const vel = velocitaCerchio(raggio, durataS)
    log(`Circonferenza di centro (${cx}, ${cy}), raggio ${raggio} mm in ${durataS} s: ` +
      `velocità media ${vel.media.toFixed(0)} mm/s, di picco ${vel.picco.toFixed(0)} mm/s`)

    try {
      // 1. porta la punta all'inizio del percorso e aspetta che arrivi
      const p0 = percorso(0)
      const a0 = inversa(p0.x, p0.y)!
      await inviaAngoli(a0)
      const [s1, s2] = passiDi(a0)
      await Promise.all([servoRef.current.attendiPosizione(ID1, s1), servoRef.current.attendiPosizione(ID2, s2)])
      if (corsa.current !== questa) return

      // 2. percorre la circonferenza: il parametro viene dall'orologio, non dal conteggio dei tick
      const inizio = performance.now()
      let inVolo = false     // uno scambio è ancora in corso: il tick viene saltato, non accodato
      let fallite = 0

      const interrompi = (motivo: string) => {
        if (corsa.current !== questa) return
        ferma()
        log(motivo, true)
      }

      const fine = async () => {
        fermaTimer()
        try {
          const pf = percorso(1)                       // punto finale esatto
          await inviaAngoli(inversa(pf.x, pf.y)!)
          if (corsa.current === questa) log('Circonferenza completata')
        } catch (e) {
          log('Errore: ' + String(e), true)
        } finally {
          if (corsa.current === questa) setInMoto(false)
        }
      }

      const passo = async () => {
        if (corsa.current !== questa || inVolo) return
        const t = (performance.now() - inizio) / (durataS * 1000)
        if (t >= 1) return fine()
        const p = percorso(raccordo(t))
        const a = inversa(p.x, p.y)
        if (!a) return interrompi('Punto non raggiungibile durante la traiettoria')
        inVolo = true
        try {
          const ok = await inviaAngoli(a)
          fallite = ok ? 0 : fallite + 1
          if (fallite >= FALLITE_MAX) interrompi('Servo senza conferma: traiettoria interrotta')
        } catch (e) {
          interrompi('Errore: ' + String(e))
        } finally {
          inVolo = false
        }
      }

      timer.current = setInterval(passo, PERIODO_MS)
    } catch (e) {
      if (corsa.current === questa) { ferma(); log('Errore: ' + String(e), true) }
    }
  }

  return { inMoto, vaiAlPunto, tracciaCerchio, ferma }
}
