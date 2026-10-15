// Test della matematica in /lib: nessun dispositivo, nessuna interfaccia.
// Gli esempi numerici delle slide (L = 100) valgono per qualunque L, perché gli angoli non
// dipendono dalla scala: con L = 175 mm si scalano i punti di 1,75.
// Esecuzione: npx vitest run

import { expect, test } from 'vitest'
import { L1, L2 } from '../config'
import { aGradi, aPassi, aRadianti } from './conversioni'
import { inversa, puntaX, puntaY } from './cinematica'
import {
  cerchio, lineare, primoPuntoNonRaggiungibile, raccordo, sagitta, segmento, velocitaCerchio,
} from './traiettoria'

const rad = (g: number) => (g * Math.PI) / 180
const K = L1 / 100          // fattore di scala rispetto agli esempi con L = 100

// ---------- conversioni ----------

test('3072 passi sono 90° (1,5708 rad); 2048 è lo zero', () => {
  expect(aRadianti(3072)).toBeCloseTo(Math.PI / 2, 4)
  expect(aRadianti(2048)).toBe(0)
  expect(aPassi(0)).toBe(2048)
})

test('con un offset diverso lo zero si sposta', () => {
  expect(aRadianti(1000, 1000)).toBe(0)
  expect(aPassi(0, 1000)).toBe(1000)
})

test('con segno -1 il verso si inverte: 3072 passi diventano -90° e il ritorno torna ai passi', () => {
  expect(aRadianti(3072, 2048, -1)).toBeCloseTo(-Math.PI / 2, 4)
  expect(aPassi(Math.PI / 2, 2048, -1)).toBe(1024)
  expect(aPassi(aRadianti(1500, 2048, -1), 2048, -1)).toBe(1500)
})

test('50 passi sono circa 4,4°', () => {
  expect(aGradi(aRadianti(2048 + 50))).toBeCloseTo(4.395, 2)
})

test('andata e ritorno su 1000 angoli: errore sotto un passo (0,00077 rad)', () => {
  let peggiore = 0
  for (let i = 0; i < 1000; i++) {
    const a = ((i * 0.6180339887) % 1) * 2 * Math.PI - Math.PI
    peggiore = Math.max(peggiore, Math.abs(aRadianti(aPassi(a)) - a))
  }
  expect(peggiore).toBeLessThan(0.00077)
})

// ---------- cinematica diretta ----------

test('diretta: (0°,0°) -> (L1+L2, 0)', () => {
  expect(puntaX(0, 0)).toBeCloseTo(2 * K * 100, 9)
  expect(puntaY(0, 0)).toBeCloseTo(0, 9)
})

test('diretta: (90°,0°) -> (0, L1+L2)', () => {
  expect(puntaX(rad(90), 0)).toBeCloseTo(0, 9)
  expect(puntaY(rad(90), 0)).toBeCloseTo(2 * K * 100, 9)
})

test('diretta: (0°,90°) -> (L1, L2)', () => {
  expect(puntaX(0, rad(90))).toBeCloseTo(L1, 9)
  expect(puntaY(0, rad(90))).toBeCloseTo(L2, 9)
})

// ---------- cinematica inversa ----------

test('inversa: esempio della slide, bersaglio (120,90) con L = 100 -> θ2 = 82,8°, θ1 = -4,5°', () => {
  const a = inversa(120 * K, 90 * K)!
  expect(aGradi(a.t2)).toBeCloseTo(82.8, 1)
  expect(aGradi(a.t1)).toBeCloseTo(-4.5, 1)
})

test('inversa: punto fuori dall\'area raggiungibile -> null, non NaN', () => {
  expect(inversa(L1 + L2 + 1, 0)).toBeNull()
  expect(inversa(1000, 1000)).toBeNull()
  expect(inversa(NaN, 0)).toBeNull()
})

test('inversa: punto sul bordo (braccio teso) è raggiungibile', () => {
  const a = inversa(L1 + L2, 0)!
  expect(a.t2).toBe(0)
  expect(a.t1).toBe(0)
})

test('diretta e inversa su 100 punti casuali: errore sotto 0,001 mm', () => {
  let peggiore = 0
  for (let i = 1; i <= 100; i++) {
    const r = ((i * 0.6180339887) % 1) * (L1 + L2) * 0.98 + 1
    const a = ((i * 0.7548776662) % 1) * 2 * Math.PI - Math.PI
    const x = r * Math.cos(a), y = r * Math.sin(a)
    const s = inversa(x, y)!
    peggiore = Math.max(peggiore, Math.hypot(puntaX(s.t1, s.t2) - x, puntaY(s.t1, s.t2) - y))
  }
  expect(peggiore).toBeLessThan(0.001)
})

// ---------- traiettorie ----------

test('raccordo: 0, 1/2, 1 e velocità nulla agli estremi', () => {
  expect(raccordo(0)).toBe(0)
  expect(raccordo(0.5)).toBe(0.5)
  expect(raccordo(1)).toBe(1)
  const h = 1e-6
  expect((raccordo(h) - raccordo(0)) / h).toBeLessThan(1e-5)
  expect((raccordo(1) - raccordo(1 - h)) / h).toBeLessThan(1e-5)
  expect(lineare(0.3)).toBe(0.3)
})

test('segmento: estremi e punto medio', () => {
  const p = segmento({ x: 0, y: 0 }, { x: 100, y: 50 })
  expect(p(0)).toEqual({ x: 0, y: 0 })
  expect(p(1)).toEqual({ x: 100, y: 50 })
  expect(p(0.5)).toEqual({ x: 50, y: 25 })
})

test('cerchio: si chiude, ha il raggio giusto', () => {
  const c = cerchio(250, 0, 50)
  expect(c(0).x).toBeCloseTo(c(1).x, 9)
  expect(c(0).y).toBeCloseTo(c(1).y, 9)
  expect(Math.hypot(c(0.3).x - 250, c(0.3).y)).toBeCloseTo(50, 9)
})

test('sagitta f = r(1 - cos(α/2)): quadrato inscritto, e cala col quadrato di N', () => {
  expect(sagitta(100, 4)).toBeCloseTo(100 * (1 - Math.SQRT1_2), 9)
  expect(sagitta(100, 100) / sagitta(100, 200)).toBeCloseTo(4, 1)
})

test('velocità sulla circonferenza r = 200 mm in 4 s: media 314, picco 471 mm/s', () => {
  const v = velocitaCerchio(200, 4)
  expect(v.media).toBeCloseTo(314.16, 1)
  expect(v.picco).toBeCloseTo(471.24, 1)
})

test('percorso interamente raggiungibile -> null; con un tratto fuori -> il punto', () => {
  expect(primoPuntoNonRaggiungibile(cerchio(250, 0, 50))).toBeNull()
  const fuori = primoPuntoNonRaggiungibile(cerchio(300, 0, 100))!
  expect(Math.hypot(fuori.x, fuori.y) > L1 + L2).toBe(true)
})
