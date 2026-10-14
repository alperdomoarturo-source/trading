/**
 * Estimación de soportes y resistencias.
 *
 * Método: pivotes fractales (máximos/mínimos locales con ventana k) sobre las
 * últimas velas, agrupados por proximidad relativa al ATR. La fuerza de un
 * nivel es el número de toques del cluster.
 *
 * Solo usa velas del pasado respecto al índice evaluado (sin lookahead),
 * por lo que es seguro en backtesting pasando el slice correspondiente.
 */

import type { Candle } from "@/lib/market/types";
import { atr } from "./indicators";

export interface Level {
  price: number;
  type: "support" | "resistance";
  /** Número de pivotes agrupados en el nivel. */
  touches: number;
}

export interface Levels {
  supports: Level[];
  resistances: Level[];
  nearestSupport?: Level;
  nearestResistance?: Level;
}

const SWING_WINDOW = 3;

interface Pivot {
  price: number;
  time: number;
}

function findPivots(candles: Candle[], endIndex: number): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  const start = Math.max(0, endIndex - 200); // ventana acotada
  // El último pivote válido necesita SWING_WINDOW velas a su derecha.
  const lastPivot = endIndex - SWING_WINDOW;
  for (let i = start + SWING_WINDOW; i <= lastPivot; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - SWING_WINDOW; j <= i + SWING_WINDOW; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ price: candles[i].high, time: candles[i].time });
    if (isLow) lows.push({ price: candles[i].low, time: candles[i].time });
  }
  return { highs, lows };
}

function cluster(pivots: Pivot[], tolerance: number): Pivot[][] {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters: Pivot[][] = [];
  for (const p of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(p.price - last[last.length - 1].price) <= tolerance) {
      last.push(p);
    } else {
      clusters.push([p]);
    }
  }
  return clusters;
}

/**
 * Calcula niveles de soporte/resistencia respecto al cierre de la vela
 * `index` (inclusive). Usa hasta 200 velas hacia atrás.
 * `precomputedAtr` acepta el ATR(14) de la serie completa (alineado por
 * índice, sin lookahead) para evitar recalcularlo en backtesting.
 */
export function computeLevels(candles: Candle[], index: number, precomputedAtr?: number[]): Levels {
  const { highs, lows } = findPivots(candles, index);
  let atrVal = precomputedAtr?.[index];
  if (atrVal === undefined || Number.isNaN(atrVal)) {
    const atrValues = atr(candles.slice(0, index + 1), 14);
    atrVal = [...atrValues].reverse().find((v) => !Number.isNaN(v)) ?? 0;
  }
  const refPrice = candles[index]?.close ?? 0;
  const tolerance = atrVal > 0 ? atrVal * 0.5 : refPrice * 0.005;

  const supports: Level[] = cluster(lows, tolerance)
    .filter((c) => (c.reduce((s, p) => s + p.price, 0) / c.length) < refPrice)
    .map((c) => ({
      price: c.reduce((s, p) => s + p.price, 0) / c.length,
      type: "support" as const,
      touches: c.length,
    }))
    .sort((a, b) => b.price - a.price);

  const resistances: Level[] = cluster(highs, tolerance)
    .filter((c) => (c.reduce((s, p) => s + p.price, 0) / c.length) > refPrice)
    .map((c) => ({
      price: c.reduce((s, p) => s + p.price, 0) / c.length,
      type: "resistance" as const,
      touches: c.length,
    }))
    .sort((a, b) => a.price - b.price);

  return {
    supports: supports.slice(0, 5),
    resistances: resistances.slice(0, 5),
    nearestSupport: supports[0],
    nearestResistance: resistances[0],
  };
}
