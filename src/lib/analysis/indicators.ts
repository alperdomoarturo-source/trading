/**
 * Indicadores técnicos en TypeScript puro.
 *
 * Convención: toda función devuelve un array de la misma longitud que la
 * entrada, con NaN en las posiciones donde el indicador aún no tiene valor.
 * El valor en el índice i usa exclusivamente datos con índice <= i
 * (sin lookahead), lo que permite su uso seguro en backtesting.
 *
 * Fórmulas siguiendo las definiciones clásicas de Wilder/TA-Lib.
 */

import type { Candle } from "@/lib/market/types";

const NA = Number.NaN;

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NA);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NA);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  out[period - 1] = seed / period;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** Suavizado de Wilder (usado por RSI, ATR, ADX). */
function wilder(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NA);
  if (values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + values[i]) / period;
  }
  return out;
}

export function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(NA);
  if (closes.length <= period) return out;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(Math.max(diff, 0));
    losses.push(Math.max(-diff, 0));
  }
  const avgGain = wilder(gains.slice(1), period);
  const avgLoss = wilder(losses.slice(1), period);
  for (let i = 0; i < avgGain.length; i++) {
    if (Number.isNaN(avgGain[i])) continue;
    const idx = i + 1; // índice en closes
    if (avgLoss[i] === 0) {
      out[idx] = 100;
    } else {
      const rs = avgGain[i] / avgLoss[i];
      out[idx] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    Number.isNaN(emaFast[i]) || Number.isNaN(emaSlow[i]) ? NA : emaFast[i] - emaSlow[i],
  );
  const firstValid = macdLine.findIndex((v) => !Number.isNaN(v));
  const signal = new Array<number>(closes.length).fill(NA);
  if (firstValid >= 0) {
    const validPart = macdLine.slice(firstValid);
    const emaSignal = ema(validPart, signalPeriod);
    for (let i = 0; i < emaSignal.length; i++) {
      if (!Number.isNaN(emaSignal[i])) signal[firstValid + i] = emaSignal[i];
    }
  }
  const histogram = macdLine.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]) ? NA : v - signal[i],
  );
  return { macd: macdLine, signal, histogram };
}

export interface BollingerResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

/** Desviación estándar poblacional móvil (como TA-Lib). */
export function stdev(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NA);
  if (period <= 1) return out;
  const means = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (values[j] - means[i]) ** 2;
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

export function bollinger(closes: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(closes, period);
  const sd = stdev(closes, period);
  const upper = middle.map((m, i) => (Number.isNaN(m) ? NA : m + mult * sd[i]));
  const lower = middle.map((m, i) => (Number.isNaN(m) ? NA : m - mult * sd[i]));
  return { upper, middle, lower };
}

/** True Range de cada vela. */
export function trueRange(candles: Candle[]): number[] {
  return candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
}

export function atr(candles: Candle[], period = 14): number[] {
  return wilder(trueRange(candles), period);
}

export interface AdxResult {
  adx: number[];
  plusDi: number[];
  minusDi: number[];
}

export function adx(candles: Candle[], period = 14): AdxResult {
  const n = candles.length;
  const outAdx = new Array<number>(n).fill(NA);
  const plusDi = new Array<number>(n).fill(NA);
  const minusDi = new Array<number>(n).fill(NA);
  if (n < 2 * period + 1) return { adx: outAdx, plusDi, minusDi };

  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  for (let i = 1; i < n; i++) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const tr = trueRange(candles);
  const smTR = wilder(tr, period);
  const smPlus = wilder(plusDM, period);
  const smMinus = wilder(minusDM, period);

  const dx: number[] = new Array<number>(n).fill(NA);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(smTR[i]) || smTR[i] === 0) continue;
    const pdi = (100 * smPlus[i]) / smTR[i];
    const mdi = (100 * smMinus[i]) / smTR[i];
    plusDi[i] = pdi;
    minusDi[i] = mdi;
    const sum = pdi + mdi;
    dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
  }
  // ADX: primer valor = media de los primeros `period` DX válidos, luego Wilder.
  const firstDx = dx.findIndex((v) => !Number.isNaN(v));
  if (firstDx < 0) return { adx: outAdx, plusDi, minusDi };
  let acc = 0;
  let count = 0;
  let adxValue: number | undefined;
  for (let i = firstDx; i < n; i++) {
    if (Number.isNaN(dx[i])) continue;
    if (adxValue === undefined) {
      if (count < period) {
        acc += dx[i];
        count++;
        if (count === period) {
          adxValue = acc / period;
          outAdx[i] = adxValue;
        }
      }
    } else {
      adxValue = (adxValue * (period - 1) + dx[i]) / period;
      outAdx[i] = adxValue;
    }
  }
  return { adx: outAdx, plusDi, minusDi };
}

export function obv(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const dir = Math.sign(candles[i].close - candles[i - 1].close);
    out[i] = out[i - 1] + dir * candles[i].volume;
  }
  return out;
}

/** Retorno porcentual de hace n velas: (close[i]/close[i-n] - 1) * 100. */
export function pctReturn(closes: number[], n: number): number[] {
  return closes.map((c, i) => (i >= n && closes[i - n] !== 0 ? ((c / closes[i - n]) - 1) * 100 : NA));
}

/** Volumen relativo: volumen actual / SMA(volumen, period). */
export function relativeVolume(volumes: number[], period = 20): number[] {
  const avg = sma(volumes, period);
  return volumes.map((v, i) => (Number.isNaN(avg[i]) || avg[i] === 0 ? NA : v / avg[i]));
}

/** Distancia porcentual del precio a una media móvil ((close/ma - 1) * 100). */
export function distancePercent(closes: number[], ma: number[]): number[] {
  return closes.map((c, i) => (Number.isNaN(ma[i]) || ma[i] === 0 ? NA : ((c / ma[i]) - 1) * 100));
}

/**
 * Posición del cierre dentro del rango de las últimas `period` velas:
 * 0 = en el mínimo, 1 = en el máximo.
 */
export function rangePosition(candles: Candle[], period = 20): number[] {
  return candles.map((c, i) => {
    if (i < period - 1) return NA;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    return hi === lo ? 0.5 : (c.close - lo) / (hi - lo);
  });
}

/** Volatilidad histórica: desviación típica de retornos de 1 vela (%). */
export function historicalVolatility(closes: number[], period = 20): number[] {
  const rets: number[] = [NA];
  for (let i = 1; i < closes.length; i++) {
    rets.push(closes[i - 1] !== 0 ? ((closes[i] / closes[i - 1]) - 1) * 100 : NA);
  }
  const clean = rets.map((r) => (Number.isNaN(r) ? 0 : r));
  const sd = stdev(clean, period);
  return sd;
}

export interface IndicatorSuite {
  ema9: number[];
  ema20: number[];
  ema50: number[];
  ema200: number[];
  sma20: number[];
  sma50: number[];
  rsi14: number[];
  macd: MacdResult;
  bollinger: BollingerResult;
  atr14: number[];
  adx14: AdxResult;
  obv: number[];
  relVol20: number[];
  rangePos20: number[];
  histVol20: number[];
  /** ATR en porcentaje del precio (volatilidad comparable entre activos). */
  atrPct: number[];
  ret1: number[];
  ret3: number[];
  ret5: number[];
  /** Pendiente de la EMA50 en las últimas 10 velas (%). */
  trendSlope: number[];
}

/** Calcula el conjunto completo de indicadores para una serie de velas. */
export function computeIndicators(candles: Candle[]): IndicatorSuite {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const ema50 = ema(closes, 50);
  const atr14 = atr(candles, 14);
  return {
    ema9: ema(closes, 9),
    ema20: ema(closes, 20),
    ema50,
    ema200: ema(closes, 200),
    sma20: sma(closes, 20),
    sma50: sma(closes, 50),
    rsi14: rsi(closes, 14),
    macd: macd(closes),
    bollinger: bollinger(closes, 20, 2),
    atr14,
    adx14: adx(candles, 14),
    obv: obv(candles),
    relVol20: relativeVolume(volumes, 20),
    rangePos20: rangePosition(candles, 20),
    histVol20: historicalVolatility(closes, 20),
    atrPct: atr14.map((a, i) => (Number.isNaN(a) || closes[i] === 0 ? NA : (a / closes[i]) * 100)),
    ret1: pctReturn(closes, 1),
    ret3: pctReturn(closes, 3),
    ret5: pctReturn(closes, 5),
    trendSlope: ema50.map((m, i) => {
      if (i < 10 || Number.isNaN(m) || Number.isNaN(ema50[i - 10]) || ema50[i - 10] === 0) return NA;
      return ((m / ema50[i - 10]) - 1) * 100;
    }),
  };
}

export function lastValid(arr: number[]): number | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (!Number.isNaN(arr[i])) return arr[i];
  }
  return undefined;
}
