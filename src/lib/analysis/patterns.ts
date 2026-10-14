/**
 * Detección de patrones de velas japonesas.
 *
 * Implementaciones inspiradas en las definiciones clásicas de TA-Lib,
 * adaptadas con umbrales proporcionales al rango de cada vela (no absolutos).
 *
 * Importante: un patrón detectado NO es una señal. La validez contextual
 * (tendencia previa, soporte/resistencia, volumen, volatilidad) la evalúa el
 * motor de señales. Aquí solo se identifican figuras geométricas.
 */

import type { Candle } from "@/lib/market/types";
import { anatomy } from "./candlestick";

export type PatternDirection = "bullish" | "bearish" | "neutral";

export interface DetectedPattern {
  /** Nombre del patrón, p. ej. "Bullish Engulfing". */
  name: string;
  direction: PatternDirection;
  /** Índice de la vela de cierre del patrón. */
  index: number;
  /** Número de velas que componen el patrón. */
  length: number;
  /** Fuerza geométrica 0-1 (qué tan marcada es la figura). */
  strength: number;
}

/** Cuerpo medio de las últimas 10 velas (normalización tipo TA-Lib). */
function avgBody(candles: Candle[], index: number): number {
  const from = Math.max(0, index - 9);
  let sum = 0;
  let count = 0;
  for (let i = from; i <= index; i++) {
    sum += anatomy(candles[i]).body;
    count++;
  }
  return count > 0 ? sum / count : 0;
}

function isBullish(c: Candle): boolean {
  return c.close > c.open;
}

function isBearish(c: Candle): boolean {
  return c.close < c.open;
}

interface Detector {
  name: string;
  length: number;
  detect(candles: Candle[], i: number): PatternDirection | null;
}

const detectors: Detector[] = [
  {
    name: "Doji",
    length: 1,
    detect(candles, i) {
      const a = anatomy(candles[i]);
      if (a.range <= 0) return null;
      if (a.bodyRatio <= 0.1) return "neutral";
      return null;
    },
  },
  {
    name: "Hammer",
    length: 1,
    detect(candles, i) {
      const a = anatomy(candles[i]);
      if (a.range <= 0 || a.body === 0) return null;
      // Mecha inferior >= 2x cuerpo, mecha superior pequeña (<= 25% del rango).
      if (a.lowerWick >= 2 * a.body && a.upperWick <= a.range * 0.25) return "bullish";
      return null;
    },
  },
  {
    name: "Inverted Hammer",
    length: 1,
    detect(candles, i) {
      const a = anatomy(candles[i]);
      if (a.range <= 0 || a.body === 0) return null;
      if (a.upperWick >= 2 * a.body && a.lowerWick <= a.range * 0.25) return "bullish";
      return null;
    },
  },
  {
    name: "Shooting Star",
    length: 1,
    detect(candles, i) {
      const a = anatomy(candles[i]);
      if (a.range <= 0 || a.body === 0) return null;
      if (a.upperWick >= 2 * a.body && a.lowerWick <= a.range * 0.25) return "bearish";
      return null;
    },
  },
  {
    name: "Bullish Engulfing",
    length: 2,
    detect(candles, i) {
      if (i < 1) return null;
      const prev = candles[i - 1];
      const cur = candles[i];
      if (isBearish(prev) && isBullish(cur)) {
        if (cur.close > prev.open && cur.open < prev.close) return "bullish";
      }
      return null;
    },
  },
  {
    name: "Bearish Engulfing",
    length: 2,
    detect(candles, i) {
      if (i < 1) return null;
      const prev = candles[i - 1];
      const cur = candles[i];
      if (isBullish(prev) && isBearish(cur)) {
        if (cur.close < prev.open && cur.open > prev.close) return "bearish";
      }
      return null;
    },
  },
  {
    name: "Bullish Harami",
    length: 2,
    detect(candles, i) {
      if (i < 1) return null;
      const prev = candles[i - 1];
      const cur = candles[i];
      const ab = avgBody(candles, i);
      if (isBearish(prev) && isBullish(cur)) {
        const prevBig = anatomy(prev).body >= ab;
        const inside = cur.open > prev.close && cur.close < prev.open;
        if (prevBig && inside && anatomy(cur).body < anatomy(prev).body * 0.6) return "bullish";
      }
      return null;
    },
  },
  {
    name: "Bearish Harami",
    length: 2,
    detect(candles, i) {
      if (i < 1) return null;
      const prev = candles[i - 1];
      const cur = candles[i];
      const ab = avgBody(candles, i);
      if (isBullish(prev) && isBearish(cur)) {
        const prevBig = anatomy(prev).body >= ab;
        const inside = cur.open < prev.close && cur.close > prev.open;
        if (prevBig && inside && anatomy(cur).body < anatomy(prev).body * 0.6) return "bearish";
      }
      return null;
    },
  },
  {
    name: "Morning Star",
    length: 3,
    detect(candles, i) {
      if (i < 2) return null;
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];
      const ab = avgBody(candles, i);
      if (ab <= 0) return null;
      if (
        isBearish(c1) &&
        anatomy(c1).body >= ab &&
        anatomy(c2).body <= ab * 0.4 &&
        isBullish(c3) &&
        c3.close > c1.close + (c1.open - c1.close) / 2
      ) {
        return "bullish";
      }
      return null;
    },
  },
  {
    name: "Evening Star",
    length: 3,
    detect(candles, i) {
      if (i < 2) return null;
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];
      const ab = avgBody(candles, i);
      if (ab <= 0) return null;
      if (
        isBullish(c1) &&
        anatomy(c1).body >= ab &&
        anatomy(c2).body <= ab * 0.4 &&
        isBearish(c3) &&
        c3.close < c1.close - (c1.close - c1.open) / 2
      ) {
        return "bearish";
      }
      return null;
    },
  },
  {
    name: "Three White Soldiers",
    length: 3,
    detect(candles, i) {
      if (i < 2) return null;
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];
      const ab = avgBody(candles, i);
      if (ab <= 0) return null;
      const all = [c1, c2, c3];
      if (!all.every(isBullish)) return null;
      if (!(c2.close > c1.close && c3.close > c2.close)) return null;
      if (!all.every((c) => anatomy(c).body >= ab * 0.7)) return null;
      if (!all.every((c) => anatomy(c).upperWick <= anatomy(c).body * 0.5)) return null;
      return "bullish";
    },
  },
  {
    name: "Three Black Crows",
    length: 3,
    detect(candles, i) {
      if (i < 2) return null;
      const c1 = candles[i - 2];
      const c2 = candles[i - 1];
      const c3 = candles[i];
      const ab = avgBody(candles, i);
      if (ab <= 0) return null;
      const all = [c1, c2, c3];
      if (!all.every(isBearish)) return null;
      if (!(c2.close < c1.close && c3.close < c2.close)) return null;
      if (!all.every((c) => anatomy(c).body >= ab * 0.7)) return null;
      if (!all.every((c) => anatomy(c).lowerWick <= anatomy(c).body * 0.5)) return null;
      return "bearish";
    },
  },
];

/**
 * Detecta los patrones presentes en el índice i (vela de cierre del patrón).
 * Un mismo patrón Inverted Hammer / Shooting Star comparte geometría: se
 * resuelve por la tendencia previa (TA-Lib usa tendencia; aquí se aplica
 * el mismo criterio con la pendiente de las últimas 5 velas).
 */
export function detectPatternsAt(candles: Candle[], i: number): DetectedPattern[] {
  const out: DetectedPattern[] = [];
  if (i < 0 || i >= candles.length) return out;

  // Tendencia previa corta para desambiguar estrellas.
  const trendUp = shortTrendUp(candles, i);

  for (const det of detectors) {
    if (det.name === "Inverted Hammer" || det.name === "Shooting Star") {
      // Misma geometría: mecha superior larga. Dirección según tendencia previa.
      const a = anatomy(candles[i]);
      if (a.range > 0 && a.body > 0 && a.upperWick >= 2 * a.body && a.lowerWick <= a.range * 0.25) {
        if (det.name === "Inverted Hammer" && !trendUp) {
          out.push({ name: det.name, direction: "bullish", index: i, length: 1, strength: patternStrength(a.body, a.range) });
          continue;
        }
        if (det.name === "Shooting Star" && trendUp) {
          out.push({ name: det.name, direction: "bearish", index: i, length: 1, strength: patternStrength(a.body, a.range) });
        }
      }
      continue;
    }
    const direction = det.detect(candles, i);
    if (direction) {
      const a = anatomy(candles[i]);
      out.push({
        name: det.name,
        direction,
        index: i,
        length: det.length,
        strength: patternStrength(a.body, a.range),
      });
    }
  }
  return out;
}

function shortTrendUp(candles: Candle[], i: number): boolean {
  const from = Math.max(0, i - 4);
  if (from >= i) return false;
  return candles[i].close > candles[from].close;
}

function patternStrength(body: number, range: number): number {
  if (range <= 0) return 0;
  // Más fuerza cuanto más cuerpo tiene la vela de cierre respecto a su rango.
  return Math.min(1, body / range + 0.3);
}

/**
 * Detecta patrones en las últimas `lookback` velas de la serie.
 * Excluye la vela en formación (la última sin cerrar) si existe.
 */
export function detectRecentPatterns(candles: Candle[], lookback = 30): DetectedPattern[] {
  if (candles.length === 0) return [];
  let end = candles.length - 1;
  if (!candles[end].closed) end--;
  const start = Math.max(0, end - lookback + 1);
  const out: DetectedPattern[] = [];
  for (let i = start; i <= end; i++) {
    out.push(...detectPatternsAt(candles, i));
  }
  return out;
}
