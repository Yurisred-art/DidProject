// useBus.ts: il WebSocket verso la scheda luma-esp, in un hook separato dall'interfaccia.
// Le righe sono quelle dei passi 1-4 delle slide L06 (slide 32-35); le aggiunte sono segnate.
// Socket, id e seq stanno nei ref (cambiarli non deve ridisegnare), lo stato nello useState.

import { useCallback, useEffect, useRef, useState } from 'react'

// ---------- passo 1: aprire e chiudere la connessione ----------

type BusState = 'connecting' | 'open' | 'closing' | 'closed'
const STATES: BusState[] = ['connecting', 'open', 'closing', 'closed']

// ---------- passo 2: ricevere testo e binario ----------

export type Json = { [k: string]: unknown }
export type Reply = Json & { id?: number; ok: boolean; error?: string }
type Handlers = {
  onEvent?: (ev: Json) => void
  onBinary?: (type: number, seq: number, light: number,
              payload: Uint8Array) => void
}

// ---------- passo 4 ----------

const RING_OFF = new Uint8Array(36)               // 12 LED × RGB, spenti

export function useBus(url: string, handlers: Handlers = {}) {
  const ws = useRef<WebSocket | null>(null)       // il socket
  const [state, setState] = useState<BusState>('closed')
  const h = useRef(handlers)                      // ultimi gestori
  h.current = handlers

  // passo 3
  const pending = useRef(new Map<number, (r: Reply) => void>())
  const nextId = useRef(1)
  // passo 4
  const nextSeq = useRef(0)
  // aggiunta: i TXN in attesa della REPLY, seq → funzione che risolve la Promise (requisito 4)
  const attesaTxn = useRef(new Map<number, (payload: Uint8Array) => void>())
  // aggiunta: un socket CLOSED è definitivo, per riconnettersi se ne crea uno nuovo
  const [tentativo, setTentativo] = useState(0)

  useEffect(() => {
    const sock = new WebSocket(url)
    sock.binaryType = 'arraybuffer'
    ws.current = sock
    // aggiunta: il socket vecchio, chiuso dal cleanup, non deve sovrascrivere lo stato del nuovo
    const sync = () => { if (ws.current === sock) setState(STATES[sock.readyState]) }
    sync()                                        // CONNECTING
    sock.onopen = sync                            // OPEN
    sock.onclose = sync                           // CLOSED
    sock.onerror = () => console.warn('errore WebSocket')
    sock.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
      if (typeof ev.data === 'string') {          // testo: JSON
        const msg = JSON.parse(ev.data) as Json
        if ('event' in msg) h.current.onEvent?.(msg)
        else pending.current.get(msg.id as number)?.(msg as Reply)
      } else {                                    // binario
        const v = new DataView(ev.data)
        const type = v.getUint8(0)
        const seq = v.getUint16(1, true)          // little-endian
        const light = v.getUint8(3)
        const payload = new Uint8Array(ev.data, 4)
        if (type === 0x02) attesaTxn.current.get(seq)?.(payload)   // aggiunta: REPLY al suo TXN
        h.current.onBinary?.(type, seq, light, payload)
      }
    }
    return () => sock.close()                     // smontaggio
  }, [url, tentativo])

  // passo 3: richieste JSON con id e timeout
  const request = useCallback((cmd: string, args: Json = {},
                               timeoutMs = 1000) =>
    new Promise<Reply>((resolve, reject) => {
      const sock = ws.current
      if (!sock || sock.readyState !== WebSocket.OPEN)
        return reject(new Error('non connesso'))
      const id = nextId.current++
      const timer = setTimeout(() => {            // risposta persa
        pending.current.delete(id)
        reject(new Error(`timeout: ${cmd}`))
      }, timeoutMs)
      pending.current.set(id, (r) => {            // risposta arrivata
        clearTimeout(timer)
        pending.current.delete(id)
        resolve(r)
      })
      sock.send(JSON.stringify({ cmd, id, ...args }))
    }), [])

  // passo 4: inviare un frame binario
  const sendTxn = useCallback((sts: Uint8Array, light = 0,
                               ring = RING_OFF) => {
    const sock = ws.current
    if (!sock || sock.readyState !== WebSocket.OPEN) return -1
    const seq = nextSeq.current
    nextSeq.current = (seq + 1) & 0xffff          // u16: riparte da 0
    const buf = new Uint8Array(40 + sts.length)
    const v = new DataView(buf.buffer)
    v.setUint8(0, 0x01)                           // type = TXN
    v.setUint16(1, seq, true)                     // seq, little-endian
    v.setUint8(3, light)                          // lampada: 0 per ora
    buf.set(ring, 4)                              // corona: 36 byte
    buf.set(sts, 40)                              // pacchetto STS
    sock.send(buf)
    return seq                                    // per abbinare la REPLY
  }, [])

  // aggiunta: sendTxn + attesa della REPLY con lo stesso seq, con timeout (requisiti 4 e 5).
  // Risolve con il payload della REPLY, o con null se si perde o il socket non è aperto:
  // il chiamante non deve gestire un'eccezione per ogni risposta mancata.
  const txn = useCallback((sts: Uint8Array, timeoutMs = 1000) =>
    new Promise<Uint8Array | null>((resolve) => {
      const seq = sendTxn(sts)
      if (seq < 0) return resolve(null)
      const timer = setTimeout(() => {            // REPLY persa
        attesaTxn.current.delete(seq)
        resolve(null)
      }, timeoutMs)
      attesaTxn.current.set(seq, (payload) => {   // REPLY arrivata
        clearTimeout(timer)
        attesaTxn.current.delete(seq)
        resolve(payload)
      })
    }), [sendTxn])

  const close = useCallback(() => ws.current?.close(), [])
  const riconnetti = useCallback(() => setTentativo((t) => t + 1), [])

  return { state, request, sendTxn, txn, close, riconnetti }
}
