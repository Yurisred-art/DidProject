import { useEffect, useRef, useState } from 'react'
import './App.css'

const ID = 1  // ID del servo usato da Vai, croce direzionale e temperatura

// posizioni prefissate della croce (0 = giù, 4096 = giro intero)
const POS = { giu: 0, sinistra: 1024, su: 2048, destra: 3072 }

/** Formatta un array di byte in esadecimale: [255, 1] -> "0xFF 0x01" */
const hex = (b: number[]) =>
  b.map(x => '0x' + x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

/** Calcola il checksum di un pacchetto completo: ~(ID + LEN + ... + ultimo parametro) & 0xFF.
 *  Esclude i due 0xFF iniziali e l'ultimo byte (il checksum stesso). */
const checksum = (p: number[]) => ~p.slice(2, -1).reduce((a, b) => a + b, 0) & 0xFF

/** Costruisce un pacchetto completo: FF FF ID LEN ISTR PARAMS... CHK.
 *  LEN e checksum vengono calcolati automaticamente. */
const costruisci = (id: number, istruzione: number, params: number[]) => {
  const corpo = [id, params.length + 2, istruzione, ...params]
  return [0xFF, 0xFF, ...corpo, ~corpo.reduce((a, b) => a + b, 0) & 0xFF]
}

// READ di 1 byte all'indirizzo 0x3F (temperatura interna): FF FF 01 04 02 3F 01 B8
const CMD_TEMP = costruisci(ID, 0x02, [0x3F, 0x01])

/** Attende `ms` millisecondi (da usare con await). */
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

type Voce = { id: number; testo: string; errore?: boolean }                // riga del log
type Pacchetto = { bytes: number[]; ok: boolean; atteso: number }          // pacchetto ricevuto + esito checksum

function App() {
  const [count, setCount] = useState(0)
  const [aperta, setAperta] = useState(false)          // stato della linea seriale
  const [occupato, setOccupato] = useState(false)      // true mentre un comando è in esecuzione
  const [testo, setTesto] = useState('')               // campo esadecimale
  const [decimale, setDecimale] = useState('')         // campo posizione decimale
  const [tempAttiva, setTempAttiva] = useState(false)  // toggle temperatura
  const [temp, setTemp] = useState<number | null>(null)
  const [log, setLog] = useState<Voce[]>([])
  const portaRef = useRef<any>(null)
  const buf = useRef<number[]>([])   // buffer del parser, persiste tra una lettura e l'altra
  const nextId = useRef(0)           // contatore per le chiavi del log
  const coda = useRef<Promise<unknown>>(Promise.resolve())  // coda delle operazioni sulla seriale

  /** Esegue una sola operazione alla volta sulla seriale: ogni chiamata parte
   *  quando la precedente è finita. Evita conflitti di lock tra Ping, Invia,
   *  Vai, croce e polling della temperatura. */
  const serializza = <T,>(fn: () => Promise<T>): Promise<T> => {
    const r = coda.current.then(fn, fn)
    coda.current = r.catch(() => {})
    return r
  }

  /** Aggiunge voci al log in ordine cronologico; la più recente finisce in alto. */
  const aggiungi = (voci: { testo: string; errore?: boolean }[]) => {
    const nuove = voci.map(v => ({ id: nextId.current++, ...v }))
    setLog(prev => [...nuove.reverse(), ...prev])
  }

  /** Chiede la porta all'utente e la apre a 1 Mbaud. */
  const apri = async () => {
    try {
      const porta = await (navigator as any).serial.requestPort();
      await porta.open({ baudRate: 1000000 });
      portaRef.current = porta
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
      await serializza(async () => { await portaRef.current?.close() })
      aggiungi([{ testo: 'Linea chiusa' }])
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + String(e), errore: true }])
    } finally {
      portaRef.current = null
      buf.current = []
      setAperta(false)
    }
  }

  /** Invia il ping (FF FF 01 02 01 FB) e mostra nel log la risposta grezza. */
  const ping = () => eseguiComando([0xFF, 0xFF, 0x01, 0x02, 0x01, 0xFB])
  /*
  const ping = () => serializza(async () => {
    const porta = portaRef.current
    const scrittore = porta.writable.getWriter();
    const lettore   = porta.readable.getReader();
    try {
      const ping = [0xFF, 0xFF, 0x01, 0x02, 0x01, 0xFB];
      await scrittore.write(new Uint8Array(ping));

      // se entro 1 secondo non arriva nulla, annulla la lettura
      const timer = setTimeout(() => lettore.cancel(), 1000)
      const { value } = await lettore.read();
      clearTimeout(timer)

      if (value) {
        const response = [...value];
        console.log("risposta:", response);
        aggiungi([{ testo: 'Ping, risposta: ' + hex(response) }])
      } else {
        aggiungi([{ testo: 'Ping: nessuna risposta dal dispositivo (timeout)', errore: true }])
      }
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + String(e), errore: true }])
    } finally {
      scrittore.releaseLock()
      lettore.releaseLock()
    }
  })
  */

  /** Scrive i byte sulla seriale e legge la risposta con il parser a buffer persistente
   *  (i pacchetti frammentati vengono ricomposti). Termina dopo `silenzio` ms senza nuovi
   *  byte, o dopo `primaAttesa` ms se non arriva nulla. Restituisce i pacchetti completi
   *  con l'esito del checksum. */
  const scambia = (daInviare: number[], primaAttesa = 1000, silenzio = 300) =>
    serializza(async () => {
      const porta = portaRef.current
      const scrittore = porta.writable.getWriter()
      const lettore = porta.readable.getReader()
      const trovati: Pacchetto[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await scrittore.write(new Uint8Array(daInviare))
        timer = setTimeout(() => lettore.cancel(), primaAttesa)
        while (true) {
          const { value, done } = await lettore.read()
          if (done) break
          clearTimeout(timer)
          timer = setTimeout(() => lettore.cancel(), silenzio)

          // parser: accumula i byte e estrae i pacchetti completi
          buf.current.push(...value)
          while (buf.current.length >= 4) {
            if (buf.current[0] !== 0xFF || buf.current[1] !== 0xFF) { buf.current.shift(); continue }
            const totale = 4 + buf.current[3]          // FF FF + ID + LEN + corpo
            if (buf.current.length < totale) break     // pacchetto incompleto
            const p = buf.current.splice(0, totale)
            const atteso = checksum(p)
            trovati.push({ bytes: p, ok: atteso === p[p.length - 1], atteso })
          }
        }
      } finally {
        clearTimeout(timer)
        scrittore.releaseLock()
        lettore.releaseLock()
      }
      return trovati
    })

  /** Legge la posizione attuale del servo (READ di 2 byte all'indirizzo 0x38, little-endian).
   *  Restituisce null se non arriva una risposta valida (scarta l'eventuale echo). */
  const leggiPosizione = async (id: number): Promise<number | null> => {
    const pacchetti = await scambia(costruisci(id, 0x02, [0x38, 0x02]), 300, 50)
    const r = [...pacchetti].reverse().find(p =>
      p.ok && p.bytes.length === 8 && p.bytes[2] === id &&
      !(p.bytes[4] === 0x02 && p.bytes[5] === 0x38)   // scarta l'eventuale echo del comando
    )
    return r ? r.bytes[5] | (r.bytes[6] << 8) : null
  }

  /** Legge la posizione ogni 100 ms finché resta uguale per 3 letture consecutive
   *  (massimo circa 4 s), poi scrive nel log la posizione raggiunta. */
  const attendiPosizione = async (id: number, obiettivo?: number) => {
    let ultima: number | null = null
    let stabili = 0
    for (let i = 0; i < 40 && stabili < 2; i++) {
      await pausa(100)
      const pos = await leggiPosizione(id)
      if (pos === null) continue
      if (pos === ultima) stabili++
      else { ultima = pos; stabili = 0 }
    }
    if (ultima === null) {
      aggiungi([{ testo: 'Posizione: nessuna risposta alla lettura', errore: true }])
      return
    }
    aggiungi([{
      testo: `Posizione raggiunta: ${ultima} (0x${ultima.toString(16).padStart(4, '0').toUpperCase()})` +
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
      aggiungi([{ testo: 'TX: ' + hex(daInviare) }])
      const ricevuti = await scambia(daInviare)
      aggiungi(ricevuti.map(p => p.ok
        ? { testo: 'RX: ' + hex(p.bytes) + ' ✓ checksum OK' }
        : { testo: `RX: ${hex(p.bytes)} ✗ checksum errato (atteso 0x${p.atteso.toString(16).padStart(2, '0').toUpperCase()})`, errore: true }))
      if (ricevuti.length === 0) {
        aggiungi([{ testo: 'Nessun pacchetto completo ricevuto (timeout)', errore: true }])
      }

      // se era una scrittura della posizione obiettivo (0x2A), legge dove arriva il servo
      const id = daInviare[2]
      if (daInviare[4] === 0x03 && daInviare[5] === 0x2A && id !== 0xFE) {
        const obiettivo = daInviare.length >= 8 ? daInviare[6] | (daInviare[7] << 8) : undefined
        await attendiPosizione(id, obiettivo)
      }
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + String(e), errore: true }])
    } finally {
      setOccupato(false)
    }
  }

  /** Finché il toggle è attivo e la linea è aperta, invia CMD_TEMP ogni 1 s e
   *  mostra il byte prima del checksum. Se il servo non risponde mostra "--°"
   *  e scrive un solo errore nel log. Il cleanup ferma il ciclo. */
  useEffect(() => {
    if (!tempAttiva || !aperta) return
    let annullato = false
    let erroreNotificato = false

    ;(async () => {
      while (!annullato) {
        const inizio = Date.now()
        try {
          const pacchetti = await scambia(CMD_TEMP, 300, 50)
          // risposta: FF FF 01 03 00 <temp> CHK (scarta l'eventuale echo del comando, lungo 8 byte)
          const r = pacchetti.find(p =>
            p.ok && p.bytes.length === 7 && p.bytes[2] === ID && p.bytes[3] === 0x03)
          if (annullato) break
          if (r) {
            setTemp(r.bytes[r.bytes.length - 2])   // ultimo byte prima del checksum
            erroreNotificato = false
          } else {
            setTemp(null)
            if (!erroreNotificato) {
              aggiungi([{ testo: 'Temperatura: nessuna risposta valida', errore: true }])
              erroreNotificato = true
            }
          }
        } catch (e) {
          if (annullato) break
          setTemp(null)
          if (!erroreNotificato) {
            aggiungi([{ testo: 'Temperatura, errore: ' + String(e), errore: true }])
            erroreNotificato = true
          }
        }
        // mantiene il periodo di 1000 ms tra una lettura e l'altra
        const resto = 1000 - (Date.now() - inizio)
        if (resto > 0) await pausa(resto)
      }
    })()

    return () => { annullato = true; setTemp(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempAttiva, aperta])

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
    eseguiComando(daInviare)
  }

  /** Converte il valore decimale (0-65535) in FF FF 01 05 03 2A lo hi chk e lo invia. */
  const vai = () => {
    const v = decimale.trim()
    if (!/^\d+$/.test(v) || Number(v) > 65535) {
      aggiungi([{ testo: 'Errore: inserisci un intero tra 0 e 65535', errore: true }])
      return
    }
    const pos = Number(v)
    eseguiComando(costruisci(ID, 0x03, [0x2A, pos & 0xFF, pos >> 8]))
  }

  /** Porta il servo a una posizione prefissata (usata dai tasti della croce). */
  const vaiA = (pos: number) =>
    eseguiComando(costruisci(ID, 0x03, [0x2A, pos & 0xFF, pos >> 8]))

  // i controlli sono disabilitati a linea chiusa o mentre un comando è in corso
  const bloccato = !aperta || occupato

  return (
    <>
      {/* riga 1: gestione linea */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={apri} disabled={aperta}>Apri linea</button>
        <button onClick={chiudi} disabled={!aperta || occupato}>Chiudi linea</button>
        <span>Linea: {aperta ? 'aperta' : 'chiusa'}</span>
      </div>

      {/* riga 2: ping, invio byte esadecimali, svuota log */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button onClick={ping} disabled={bloccato}>Ping</button>
        <input
          value={testo}
          onChange={e => setTesto(e.target.value)}
          placeholder="FF FF 01 02 01 FB"
          style={{ width: 300, fontFamily: 'monospace' }}
          disabled={bloccato}
        />
        <button onClick={invia} disabled={bloccato}>Invia</button>
        <button onClick={() => setLog([])}>Clear</button>
      </div>

      {/* riga 3: posizione in decimale */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <input
          value={decimale}
          onChange={e => setDecimale(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !bloccato && vai()}
          placeholder="Posizione (0-65535)"
          style={{ width: 150, fontFamily: 'monospace' }}
          disabled={bloccato}
        />
        <button onClick={vai} disabled={bloccato}>Vai</button>
      </div>

      {/* riga 4: toggle temperatura */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={() => setTempAttiva(t => !t)} disabled={!aperta}>
          Temperatura: {tempAttiva ? 'ON' : 'OFF'}
        </button>
        <span style={{ fontFamily: 'monospace' }}>{temp !== null ? `${temp}°` : '--°'}</span>
      </div>

      {/* croce direzionale: posizioni prefissate */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 64px)', gridTemplateRows: 'repeat(3, 48px)',
        gap: 6, marginTop: 16, alignItems: 'center', justifyItems: 'center',
      }}>
        <button style={{ gridColumn: 2, gridRow: 1 }} title={`Posizione ${POS.su}`}
          onClick={() => vaiA(POS.su)} disabled={bloccato}>▲</button>
        <button style={{ gridColumn: 1, gridRow: 2 }} title={`Posizione ${POS.sinistra}`}
          onClick={() => vaiA(POS.sinistra)} disabled={bloccato}>◀</button>
        <button style={{ gridColumn: 3, gridRow: 2 }} title={`Posizione ${POS.destra}`}
          onClick={() => vaiA(POS.destra)} disabled={bloccato}>▶</button>
        <button style={{ gridColumn: 2, gridRow: 3 }} title={`Posizione ${POS.giu}`}
          onClick={() => vaiA(POS.giu)} disabled={bloccato}>▼</button>
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

export default App