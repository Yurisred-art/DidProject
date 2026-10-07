// useServo.ts: ponte fra il driver e lo stato di React.
// Risorsa (bus, porta) nei ref; nello stato solo ciò che viene mostrato.

import { useEffect, useRef, useState } from 'react'
import { Bus } from '../driver/bus'
import { WebSerial } from '../driver/webSerial'
import type { Pacchetto } from '../driver/analizzatore'
import {
  ID_DIFFUSIONE, ISTR, REG_POSIZIONE_OBIETTIVO,
  comandoPing, comandoScriviPosizione, leggiPosizione, leggiTemperatura,
} from '../driver/sts3215'

const ID = 1  // ID del servo usato da Vai, croce direzionale e temperatura

/** Formatta un array di byte in esadecimale: [255, 1] -> "0xFF 0x01" */
const hex = (b: number[]) =>
  b.map(x => '0x' + x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

/** Attende `ms` millisecondi (da usare con await). */
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

type Voce = { id: number; testo: string; errore?: boolean }  // riga del log
type Telemetria = { temp: number | null }                    // grandezze mostrate in vista

export type ServoApi = ReturnType<typeof useServo>

export function useServo() {
  // risorsa: nessun render
  const busRef = useRef<Bus | null>(null)
  if (busRef.current === null) busRef.current = new Bus(new WebSerial())
  const bus = busRef.current

  const [aperta, setAperta] = useState(false)          // stato della linea seriale
  const [occupato, setOccupato] = useState(false)      // true mentre un comando è in esecuzione
  const [tempAttiva, setTempAttiva] = useState(false)  // toggle temperatura
  const [telemetria, setTelemetria] = useState<Telemetria>({ temp: null })
  const [log, setLog] = useState<Voce[]>([])
  const ultima = useRef<Telemetria>({ temp: null })    // ultimo valore acquisito: nessun render
  const nextId = useRef(0)                             // contatore per le chiavi del log
  const statoNotificato = useRef<Map<number, number>>(new Map())  // ultimo byte di stato segnalato per servo

  /** Aggiunge voci al log in ordine cronologico; la più recente finisce in alto. */
  const aggiungi = (voci: { testo: string; errore?: boolean }[]) => {
    const nuove = voci.map(v => ({ id: nextId.current++, ...v }))
    setLog(prev => [...nuove.reverse(), ...prev])
  }

  /** Controlla il byte di stato di una risposta (posizione 4) e lo scrive nel log solo
   *  quando cambia, così il polling della temperatura non riempie il log. */
  const controllaStato = (p: Pacchetto) => {
    const id = p.bytes[2]
    const stato = p.bytes[4]
    if ((statoNotificato.current.get(id) ?? 0) === stato) return
    statoNotificato.current.set(id, stato)
    aggiungi([stato === 0
      ? { testo: `Servo ${id}: byte di stato tornato a 0` }
      : { testo: `Servo ${id}: byte di stato 0x${stato.toString(16).padStart(2, '0').toUpperCase()} (anomalia)`, errore: true }])
  }
  useEffect(() => { bus.suRisposta = controllaStato })

  /** Chiede la porta all'utente e la apre a 1 Mbaud. */
  const apri = async () => {
    try {
      await bus.apri()
      setAperta(true)
      aggiungi([{ testo: 'Linea aperta' }])
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + String(e), errore: true }])
    }
  }

  /** Ferma la temperatura, aspetta la fine dell'operazione in corso e chiude la porta. */
  const chiudi = async () => {
    setTempAttiva(false)   // ferma la lettura della temperatura
    try {
      await bus.chiudi()
      aggiungi([{ testo: 'Linea chiusa' }])
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + String(e), errore: true }])
    } finally {
      statoNotificato.current.clear()
      setAperta(false)
    }
  }

  /** Rilascio anche quando il componente viene smontato (slide 10). */
  useEffect(() => {
    return () => { if (bus.aperta) void bus.chiudi() }
  }, [bus])

  /** Legge la posizione ogni 100 ms finché resta uguale per 3 letture consecutive
   *  (massimo circa 4 s), poi scrive nel log la posizione raggiunta. */
  const attendiPosizione = async (id: number, obiettivo?: number) => {
    let ultimaPos: number | null = null
    let stabili = 0
    for (let i = 0; i < 40 && stabili < 2; i++) {
      await pausa(100)
      const pos = await leggiPosizione(bus, id)
      if (pos === null) continue
      if (pos === ultimaPos) stabili++
      else { ultimaPos = pos; stabili = 0 }
    }
    if (ultimaPos === null) {
      aggiungi([{ testo: 'Posizione: nessuna risposta alla lettura', errore: true }])
      return
    }
    aggiungi([{
      testo: `Posizione raggiunta: ${ultimaPos} (0x${ultimaPos.toString(16).padStart(4, '0').toUpperCase()})` +
        (obiettivo !== undefined ? `, obiettivo ${obiettivo}` : '') +
        (stabili < 2 ? ' - ancora in movimento' : ''),
    }])
  }

  /** Invia un comando, mostra nel log pacchetti inviati e ricevuti (con checksum) e, se era
   *  una scrittura della posizione obiettivo (0x2A), aspetta e mostra la posizione raggiunta.
   *  Blocca i pulsanti finché non ha finito. */
  const eseguiComando = async (daInviare: number[]) => {
    setOccupato(true)
    try {
      aggiungi([{ testo: 'Inviato: ' + hex(daInviare) }])
      const ricevuti = await bus.scambia(daInviare)
      aggiungi(ricevuti.map(p =>
        p.eco
          ? { testo: 'Eco: ' + hex(p.bytes) }
          : p.ok
            ? { testo: 'Ricevuto: ' + hex(p.bytes) + ' ✓ checksum OK' }
            : { testo: `Ricevuto: ${hex(p.bytes)} ✗ checksum errato (atteso 0x${p.atteso.toString(16).padStart(2, '0').toUpperCase()})`, errore: true }))
      if (ricevuti.every(p => p.eco)) {
        aggiungi([{ testo: 'Nessuna risposta dal servo (timeout)', errore: true }])
      }

      // se era una scrittura della posizione obiettivo (0x2A), legge dove arriva il servo
      const id = daInviare[2]
      if (daInviare[4] === ISTR.SCRITTURA && daInviare[5] === REG_POSIZIONE_OBIETTIVO && id !== ID_DIFFUSIONE) {
        const obiettivo = daInviare.length >= 8 ? daInviare[6] | (daInviare[7] << 8) : undefined
        await attendiPosizione(id, obiettivo)
      }
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + String(e), errore: true }])
    } finally {
      setOccupato(false)
    }
  }

  /** Invia il ping (FF FF 01 02 01 FB) passando dagli stessi controlli degli altri comandi. */
  const ping = () => eseguiComando(comandoPing(ID))

  /** Porta il servo a una posizione (usata da Vai e dai tasti della croce). */
  const vaiA = (pos: number) => eseguiComando(comandoScriviPosizione(ID, pos))

  /** Finché il toggle è attivo e la linea è aperta, legge la temperatura ogni 0.5 s e la
   *  scrive nel ref `ultima`. Se il servo non risponde il valore è null e viene scritto un
   *  solo errore nel log. Il cleanup ferma il ciclo. */
  useEffect(() => {
    if (!tempAttiva || !aperta) return
    let annullato = false
    let erroreNotificato = false

    ;(async () => {
      while (!annullato) {
        const inizio = Date.now()
        try {
          const temp = await leggiTemperatura(bus, ID)
          if (annullato) break
          if (temp !== null) {
            ultima.current.temp = temp
            erroreNotificato = false
          } else {
            ultima.current.temp = null
            if (!erroreNotificato) {
              aggiungi([{ testo: 'Temperatura: nessuna risposta valida', errore: true }])
              erroreNotificato = true
            }
          }
        } catch (e) {
          if (annullato) break
          ultima.current.temp = null
          if (!erroreNotificato) {
            aggiungi([{ testo: 'Temperatura, errore: ' + String(e), errore: true }])
            erroreNotificato = true
          }
        }
        // mantiene il periodo di 500 ms tra una lettura e l'altra
        const resto = 500 - (Date.now() - inizio)
        if (resto > 0) await pausa(resto)
      }
    })()

    return () => { annullato = true; ultima.current.temp = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempAttiva, aperta])

  /** Verso la vista: copia il ref nello stato 5 volte al secondo (slide 11).
   *  Se il valore non è cambiato lo stato resta lo stesso e React non ridisegna. */
  useEffect(() => {
    const t = setInterval(() => {
      setTelemetria(prev => prev.temp === ultima.current.temp ? prev : { ...ultima.current })
    }, 200)
    return () => clearInterval(t)
  }, [])

  return {
    aperta, occupato, tempAttiva, telemetria, log,
    apri, chiudi, ping, eseguiComando, vaiA, aggiungi,
    commutaTemperatura: () => setTempAttiva(t => !t),
    svuotaLog: () => setLog([]),
  }
}
