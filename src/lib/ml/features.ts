/**
 * Constructor de la fila de características ML en TypeScript.
 *
 * Espejo exacto de `ml/features.py` (que a su vez reimplementa las fórmulas
 * de `src/lib/analysis/indicators.ts` y `src/lib/analysis/patterns.ts`).
 * El orden de `ML_FEATURE_NAMES` define el vector: cualquier cambio debe
 * replicarse en Python y volver a exportar el modelo.
 *
 * Reglas de seguridad: solo velas CERRADAS y solo información con índice <= i
 * (sin lookahead). `lastClosedFeatureVector` devuelve null si la serie es
 * incompleta o algún valor sale NaN: nunca se puntúa con huecos.
 */

import type { Candle } from "@/lib/market/types";
import { computeIndicators, pctReturn } from "@/lib/analysis/indicators";
import { anatomy } from "@/lib/analysis/candlestick";
import { detectPatternsAt } from "@/lib/analysis/patterns";
import type { MlFeatureName } from "@/lib/ml/types";

export const ML_FEATURE_NAMES: readonly MlFeatureName[] = [
  "ret_1",
  "ret_3",
  "ret_5",
  "ret_10",
  "ema20_ratio",
  "ema20_50_ratio",
  "ema50_200_ratio",
  "rsi_14",
  "macd_hist_norm",
  "bb_pctb",
  "atr_pct",
  "adx_14",
  "plus_di_14",
  "minus_di_14",
  "obv_slope_10",
  "rel_vol_20",
  "range_pos_20",
  "body_ratio",
  "up_wick_ratio",
  "low_wick_ratio",
  "pat_bull_engulfing",
  "pat_bear_engulfing",
  "pat_hammer",
  "pat_doji",
  "pat_morning_star",
  "pat_evening_star",
] as const;

export const ML_N_FEATURES = ML_FEATURE_NAMES.length;

/** Nombre del patrón en patterns.ts → flag de feature. */
const PATTERN_TO_FLAG: Record<string, MlFeatureName> = {
  "Bullish Engulfing": "pat_bull_engulfing",
  "Bearish Engulfing": "pat_bear_engulfing",
  Hammer: "pat_hammer",
  Doji: "pat_doji",
  "Morning Star": "pat_morning_star",
  "Evening Star": "pat_evening_star",
};

export interface FeatureSeries {
  rows: number[][];
  /** Índice en la serie de cada fila (misma longitud que `candles`). */
  times: number[];
}

/**
 * Calcula la matriz de características para toda la serie (velas tales
 * cuales). Las primeras filas contendrán NaN (warmup de indicadores);
 * `buildFeatureVector` filtrará.
 */
export function buildFeatureSeries(candles: Candle[]): FeatureSeries {
  const ind = computeIndicators(candles);
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ret10 = pctReturn(closes, 10);

  const rows: number[][] = new Array(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const a = anatomy(c);
    const bbWidth = ind.bollinger.upper[i] - ind.bollinger.lower[i];
    const pctb =
      Number.isNaN(bbWidth) || Number.isNaN(ind.bollinger.lower[i])
        ? Number.NaN
        : bbWidth === 0
          ? 0.5
          : (c.close - ind.bollinger.lower[i]) / bbWidth;

    let obvSlope = Number.NaN;
    if (i >= 10) {
      let sum = 0;
      for (let j = i - 9; j <= i; j++) sum += volumes[j];
      const avgVol = sum / 10;
      if (avgVol > 0) obvSlope = (ind.obv[i] - ind.obv[i - 10]) / (10 * avgVol);
    }

    const range = c.high - c.low;
    const row = [
      ind.ret1[i],
      ind.ret3[i],
      ind.ret5[i],
      ret10[i],
      distance(ind.ema20[i], c.close),
      ratio(ind.ema20[i], ind.ema50[i]),
      ratio(ind.ema50[i], ind.ema200[i]),
      ind.rsi14[i],
      scale100(ind.macd.histogram[i], c.close),
      pctb,
      ind.atrPct[i],
      ind.adx14.adx[i],
      ind.adx14.plusDi[i],
      ind.adx14.minusDi[i],
      obvSlope,
      ind.relVol20[i],
      ind.rangePos20[i],
      a.bodyRatio,
      range > 0 ? a.upperWick / range : 0,
      range > 0 ? a.lowerWick / range : 0,
    ];

    const flags: Record<string, number> = {
      pat_bull_engulfing: 0,
      pat_bear_engulfing: 0,
      pat_hammer: 0,
      pat_doji: 0,
      pat_morning_star: 0,
      pat_evening_star: 0,
    };
    for (const p of detectPatternsAt(candles, i)) {
      const key = PATTERN_TO_FLAG[p.name];
      if (key) flags[key] = 1;
    }
    for (const name of ML_FEATURE_NAMES.slice(20)) row.push(flags[name] ?? 0);

    rows[i] = row;
  }
  return { rows, times: candles.map((c) => c.time) };
}

function distance(ma: number, close: number): number {
  return Number.isNaN(ma) || ma === 0 ? Number.NaN : (close / ma - 1) * 100;
}

function ratio(a: number, b: number): number {
  return Number.isNaN(a) || Number.isNaN(b) || b === 0 ? Number.NaN : (a / b - 1) * 100;
}

function scale100(value: number, close: number): number {
  return Number.isNaN(value) || close === 0 ? Number.NaN : (value / close) * 100;
}

/**
 * Fila de características de la última vela CERRADA. Devuelve null si hay
 * menos de 200 velas cerradas (warmup mínimo: ema50/ema200) o si algún
 * valor no es finito.
 */
export function lastClosedFeatureVector(
  candles: Candle[],
): { values: number[]; time: number } | null {
  const closed = candles.filter((c) => c.closed);
  if (closed.length < 200) return null;
  const series = buildFeatureSeries(closed);
  const row = series.rows[closed.length - 1];
  if (!row || row.some((v) => !Number.isFinite(v))) return null;
  return { values: row, time: closed[closed.length - 1].time };
}
