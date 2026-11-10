// useServo.ts: ponte fra il driver e lo stato di React.
// Risorsa (bus, socket) nei ref; nello stato solo ciò che viene mostrato.
// Il collegamento ai servo passa dal WebSocket della scheda Wi-Fi (useBus), non più dalla seriale.

import { useEffect, useRef, useState } from 'react'
import { Bus } from '../driver/bus'
import type { Pacchetto } from '../driver/analizzatore'
import { PROTOCOLLO, STATO_RISPOSTA, TIPO, leggiTelemetria, type Risposta } from '../driver/protocollo'
import {
  ID_DIFFUSIONE, ISTR, REG_POSIZIONE_OBIETTIVO,
  abilitaCoppia, cambiaId as cambiaIdServo, comandoPing, comandoScriviPosizione, leggiPosizione,
  scriviInsieme, scriviPosizione, temperaturaDaStato,
} from '../driver/sts3215'
import { SERVI, LIMITI } from '../config'
import { ACCELERAZIONE, KEEPALIVE_MS, PROFILO, URL_BUS, VELOCITA } from '../rete'
import { useBus, type Json } from './useBus'

/** Formatta un array di byte in esadecimale: [255, 1] -> "0xFF 0x01" */
const hex = (b: number[]) =>
  b.map(x => '0x' + x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

/** Attende `ms` millisecondi (da usare con await). */
const pausa = (ms: number) => new Promise(r => setTimeout(r, ms))

type Voce = { id: number; testo: string; errore?: boolean }  // riga del log
type Telemetria = Record<number, { temp: number | null }>   // grandezze mostrate in vista, per ID

const telemetriaVuota = (): Telemetria =>
  Object.fromEntries(SERVI.map(id => [id, { temp: null }]))

export type ServoApi = ReturnType<typeof useServo>

export function useServo() {
  const [aperta, setAperta] = useState(false)          // linea armata: i movimenti sono consentiti
  const [connessa, setConnessa] = useState(false)      // socket aperto, protocollo 8, profilo caricato
  const [occupato, setOccupato] = useState(false)      // true mentre un comando è in esecuzione
  const [tempAttiva, setTempAttiva] = useState(false)  // toggle temperatura
  const [telemetria, setTelemetria] = useState<Telemetria>(telemetriaVuota)
  const [log, setLog] = useState<Voce[]>([])
  const ultima = useRef<Telemetria>(telemetriaVuota()) // ultimo valore acquisito: nessun render
  const ultimoAgg = useRef<Record<number, number>>({}) // quando è arrivato, per servo (ms)
  const tempAttivaRef = useRef(false)                  // il timer della vista legge sempre l'ultimo valore
  tempAttivaRef.current = tempAttiva
  const nextId = useRef(0)                             // contatore per le chiavi del log
  const statoNotificato = useRef<Map<number, number>>(new Map())  // ultimo byte di stato segnalato per servo
  const esitoNotificato = useRef('')                   // ultimo esito della scheda segnalato
  const ultimoSeqPush = useRef<number | null>(null)    // per contare i push persi (requisito 9)
  const pushPersi = useRef(0)

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

  /** Scrive nel log un rifiuto o un clamp della scheda, una volta finché non cambia. */
  const segnalaEsito = (r: Risposta) => {
    if (r.status === 0) { esitoNotificato.current = ''; return }
    const testo = `Scheda: ${STATO_RISPOSTA[r.status] ?? 'status ' + r.status}` +
      (r.servo ? ` (servo ${r.servo})` : '')
    if (testo === esitoNotificato.current) return
    esitoNotificato.current = testo
    aggiungi([{ testo, errore: r.status > 1 }])
  }

  /** Eventi spontanei della scheda. Quelli sconosciuti si ignorano (requisito 10). */
  const suEvento = (ev: Json) => {
    if (ev.event === 'released') {
      setAperta(false)
      aggiungi([{ testo: `Servo ${String(ev.servo)} rilasciato dal guardiano (${String(ev.reason)}, ` +
        `valore ${String(ev.value)}): premere Apri linea per riarmare`, errore: true }])
    } else if (ev.event === 'parked') {
      aggiungi([{ testo: 'Collegamento troppo lento: la scheda ha fermato i servo (parked)', errore: true }])
    } else if (ev.event === 'estop') {
      setAperta(false)
      aggiungi([{ testo: `Arresto di emergenza (${String(ev.source)}): premere Apri linea per ripartire`, errore: true }])
    }
  }

  /** Il seq dei push (TELEMETRIA e TRACE) è un contatore condiviso: un salto = push persi (requisito 9). */
  const contaPush = (seq: number) => {
    const prec = ultimoSeqPush.current
    if (prec !== null) {
      const persi = (seq - prec - 1) & 0xffff
      if (persi > 0) {
        pushPersi.current += persi
        aggiungi([{ testo: `Telemetria: ${persi} push persi (totale ${pushPersi.current})`, errore: true }])
      }
    }
    ultimoSeqPush.current = seq
  }

  /** TELEMETRIA: arriva da sola ogni pollMs, con gli status frame dei servo che hanno risposto.
   *  Al posto del vecchio polling della temperatura. */
  const suTelemetria = (payload: Uint8Array) => {
    for (const p of leggiTelemetria(payload)) {
      controllaStato(p)
      const id = p.bytes[2]
      if (ultima.current[id]) {
        ultima.current[id].temp = temperaturaDaStato(p)
        ultimoAgg.current[id] = Date.now()
      }
    }
  }

  // il WebSocket verso la scheda (L06, passi 1-5); i gestori stanno in un ref dentro useBus
  const rete = useBus(URL_BUS, {
    onEvent: suEvento,
    onBinary: (type, seq, _light, payload) => {
      if (type === TIPO.TELEMETRIA || type === TIPO.TRACE) contaPush(seq)
      if (type === TIPO.TELEMETRIA) suTelemetria(payload)
    },
  })

  // risorsa: nessun render. Il bus incapsula i pacchetti STS nei TXN di rete.txn
  const busRef = useRef<Bus | null>(null)
  if (busRef.current === null) busRef.current = new Bus(rete.txn)
  const bus = busRef.current
  useEffect(() => {
    bus.suRisposta = controllaStato
    bus.suEsito = segnalaEsito
  })

  /** Prepara la scheda dopo la connessione: versione del protocollo, poi profilo (L06, passo 5 e
   *  sequenza di sessione). Il profilo si può cambiare solo da disarmata, quindi se la scheda è
   *  armata (sessione precedente) la si disarma prima. Restituisce true se la scheda è pronta. */
  const avvia = async (cancellaEstop: boolean): Promise<boolean> => {
    const r = await rete.request('status')
    if (r.protocol !== PROTOCOLLO) {            // requisito 1: un'altra versione, si chiude
      aggiungi([{ testo: `Protocollo ${String(r.protocol)} invece di ${PROTOCOLLO}: connessione chiusa`, errore: true }])
      rete.close()
      return false
    }
    if (r.state === 'estop') {
      if (!cancellaEstop) {
        aggiungi([{ testo: 'Arresto di emergenza attivo: premere Apri linea per cancellarlo', errore: true }])
        return false
      }
      const c = await rete.request('estop.clear')
      if (!c.ok) {
        aggiungi([{ testo: `estop.clear rifiutato: ${String(c.error)}`, errore: true }])
        return false
      }
    } else if (r.state === 'armed') {
      await rete.request('disarm')               // requisito 8: disarmata prima di config.set
    }
    const c = await rete.request('config.set', { profile: PROFILO }, 3000)
    if (!c.ok) {
      aggiungi([{ testo: `config.set rifiutato: ${String(c.error)}${c.message ? ' - ' + String(c.message) : ''}`, errore: true }])
      return false
    }
    setConnessa(true)
    return true
  }

  /** Appena il socket si apre: controlla la versione e carica il profilo. Se si chiude, la linea
   *  non è più armata. Il seq dei push riparte da capo a ogni connessione. */
  useEffect(() => {
    ultimoSeqPush.current = null
    if (rete.state !== 'open') { setConnessa(false); setAperta(false); return }
    let annullato = false
    ;(async () => {
      try {
        if (await avvia(false) && !annullato)
          aggiungi([{ testo: `Scheda collegata (protocollo ${PROTOCOLLO}, profilo "${PROFILO.name}")` }])
      } catch (e) {
        if (!annullato) aggiungi([{ testo: 'Errore: ' + (e as Error).message, errore: true }])
      }
    })()
    return () => { annullato = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rete.state])

  /** Keepalive (L06, passo 5): un frame vuoto ogni secondo tiene vivo il link watchdog della scheda,
   *  che ferma i servo se non riceve nulla per linkTimeoutMs (requisito 3). */
  useEffect(() => {
    if (rete.state !== 'open') return
    const t = setInterval(() => rete.sendTxn(new Uint8Array(0)), KEEPALIVE_MS)
    return () => clearInterval(t)
  }, [rete.state, rete.sendTxn])

  /** Arma la scheda (requisito 7: prima di coppia e movimenti) e mette in coppia i servo. */
  const apri = async () => {
    setOccupato(true)
    try {
      if (!(await avvia(true))) return
      const a = await rete.request('arm', {}, 3000)
      if (!a.ok) {
        aggiungi([{ testo: `arm rifiutato: ${String(a.error)}${a.message ? ' - ' + String(a.message) : ''}`, errore: true }])
        return
      }
      const mancanti = Array.isArray(a.missing) ? (a.missing as unknown[]).map(Number) : []
      if (mancanti.length)
        aggiungi([{ testo: `Servo non trovati sul bus: ${mancanti.join(', ')}`, errore: true }])
      setAperta(true)
      aggiungi([{ testo: 'Linea aperta (scheda armata)' }])
      // arm non scrive nulla sui servo: la coppia si abilita qui
      for (const id of SERVI) {
        if (mancanti.includes(id)) continue
        const ok = await abilitaCoppia(bus, id)
        aggiungi([{ testo: ok ? `Servo ${id}: coppia abilitata` : `Servo ${id}: coppia non abilitata`, errore: !ok }])
      }
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + (e as Error).message, errore: true }])
    } finally {
      setOccupato(false)
    }
  }

  /** Disarma la scheda: i movimenti vengono rifiutati, il collegamento resta aperto. */
  const chiudi = async () => {
    setTempAttiva(false)
    setAperta(false)       // prima di tutto: ferma subito le traiettorie in corso
    setOccupato(true)
    try {
      const r = await rete.request('disarm')
      aggiungi([r.ok
        ? { testo: 'Linea chiusa (scheda disarmata)' }
        : { testo: `disarm rifiutato: ${String(r.error)}`, errore: true }])
    } catch (e) {
      aggiungi([{ testo: 'Errore: ' + (e as Error).message, errore: true }])
    } finally {
      statoNotificato.current.clear()
      setOccupato(false)
    }
  }

  /** Legge la posizione ogni 100 ms finché resta uguale per 3 letture consecutive
   *  (massimo circa 4 s), poi scrive nel log la posizione raggiunta e la restituisce
   *  (null se il servo non ha mai risposto). */
  const attendiPosizione = async (id: number, obiettivo?: number): Promise<number | null> => {
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
      aggiungi([{ testo: `Servo ${id}, posizione: nessuna risposta alla lettura`, errore: true }])
      return null
    }
    aggiungi([{
      testo: `Servo ${id}, posizione raggiunta: ${ultimaPos} (0x${ultimaPos.toString(16).padStart(4, '0').toUpperCase()})` +
        (obiettivo !== undefined ? `, obiettivo ${obiettivo}` : '') +
        (stabili < 2 ? ' - ancora in movimento' : ''),
    }])
    return ultimaPos
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
        aggiungi([{ testo: 'Nessuna risposta dal servo', errore: true }])
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
  const ping = (id: number) => eseguiComando(comandoPing(id))

  /** Porta un servo a una posizione (usata da Vai e dai tasti della croce).
   *  Una posizione non ammessa viene segnalata nel log e non arriva sul bus. */
  const vaiA = async (id: number, pos: number) => {
    const lim = LIMITI[id]
    if (lim && (pos < lim[0] || pos > lim[1])) {
      aggiungi([{ testo: `Servo ${id}: posizione ${pos} fuori dai limiti (${lim[0]}..${lim[1]}) di config.ts`, errore: true }])
      return
    }
    let comando: number[]
    try {
      comando = comandoScriviPosizione(id, pos)
    } catch (e) {
      aggiungi([{ testo: `Servo ${id}: ${(e as Error).message}`, errore: true }])
      return
    }
    await eseguiComando(comando)
  }

  /** Esegue `fn` tenendo `occupato` acceso (blocca i pulsanti), anche per operazioni lunghe. */
  const conOccupato = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setOccupato(true)
    try { return await fn() } finally { setOccupato(false) }
  }

  /** Cambia l'ID di un servo (con un solo servo sul bus) e scrive l'esito nel log.
   *  Ferma prima la lettura della temperatura, che altrimenti si intromette fra i passaggi. */
  const cambiaId = async (attuale: number, nuovo: number) => {
    setTempAttiva(false)
    await conOccupato(async () => {
      try {
        // l'ID è un registro fuori da 40-49: la scheda lo scrive solo da disarmata (requisito 8)
        if (aperta) {
          setAperta(false)
          await rete.request('disarm')
          aggiungi([{ testo: 'Linea disarmata per scrivere l\'ID: premere Apri linea per riarmare' }])
        }
        const { ok, messaggio } = await cambiaIdServo(bus, attuale, nuovo)
        aggiungi([{ testo: messaggio, errore: !ok }])
        if (ok) aggiungi([{ testo: 'Se serve, aggiungi il nuovo ID a SERVI in config.ts e ricarica la pagina (il profilo si invia alla connessione)' }])
      } catch (e) {
        aggiungi([{ testo: 'Errore: ' + String(e), errore: true }])
      }
    })
  }

  /** Scrittura con conferma e attese brevi, per le traiettorie: true se il servo ha risposto. */
  const scrivi = (id: number, pos: number) => scriviPosizione(bus, id, pos)

  /** Porta più servo alle posizioni indicate con un solo SYNC WRITE, per le traiettorie: i due giunti
   *  partono insieme. true se la scheda ha accettato il frame (ok o limitato). */
  const scriviMolti = (voci: { id: number; pos: number }[]) =>
    scriviInsieme(bus, voci, VELOCITA, ACCELERAZIONE)

  /** Una lettura di posizione, per chi deve sapere dove si trova un servo. */
  const leggi = (id: number) => leggiPosizione(bus, id)

  /** Verso la vista: copia il ref nello stato 5 volte al secondo (slide 11). La temperatura si
   *  mostra solo a toggle attivo e se la telemetria l'ha aggiornata nell'ultimo secondo (un servo
   *  che non risponde sparisce dalla telemetria). Se il valore non è cambiato lo stato resta lo
   *  stesso e React non ridisegna. */
  useEffect(() => {
    const t = setInterval(() => {
      const adesso = Date.now()
      const vista: Telemetria = Object.fromEntries(SERVI.map(id => [id, {
        temp: tempAttivaRef.current && adesso - (ultimoAgg.current[id] ?? 0) < 1000
          ? ultima.current[id].temp : null,
      }]))
      setTelemetria(prev => SERVI.every(id => prev[id].temp === vista[id].temp) ? prev : vista)
    }, 200)
    return () => clearInterval(t)
  }, [])

  return {
    aperta, connessa, statoRete: rete.state, occupato, tempAttiva, telemetria, log,
    apri, chiudi, riconnetti: rete.riconnetti, ping, eseguiComando, vaiA, aggiungi,
    attendiPosizione, conOccupato, scrivi, scriviMolti, leggi, cambiaId,
    commutaTemperatura: () => setTempAttiva(t => !t),
    svuotaLog: () => setLog([]),
  }
}
