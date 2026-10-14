/**
 * Motor de señales v1: analista técnico explicable basado en reglas ponderadas.
 *
 * Cada condición aporta puntos a favor de una dirección junto con su motivo.
 * La señal final exige confluencia (puntuación >= umbral) y calidad mínima de
 * datos: tendencia medible, volumen suficiente y frescura. Sin confluencia
 * suficiente el sistema recomienda ESPERAR o SIN SEÑAL.
 *
 * Las probabilidades cuantitativas llegan con el modelo ML (Etapa 4); esta
 * versión no inventa porcentajes: expone la puntuación y sus motivos.
 *
 * Reglas anti-engaño:
 * - Solo velas CERRADAS generan señales confirmadas.
 * - Datos rancios (stale) bloquean señales confirmadas.
 * - Sin EMA200 disponible -> DATOS INSUFICIENTES.
 */

import { INTERVAL_MS, type Candle, type Freshness } from "@/lib/market/types";
import { computeIndicators, type IndicatorSuite } from "@/lib/analysis/indicators";
import { detectPatternsAt, type DetectedPattern } from "@/lib/analysis/patterns";
import { computeLevels, type Levels } from "@/lib/analysis/levels";
import {
  MIN_CANDLES_FOR_SIGNAL,
  type Signal,
  type SignalEngineConfig,
  type SignalIndicators,
  type SignalReason,
  type TrendContext,
} from "./types";

interface Context {
  candles: Candle[];
  i: number;
  ind: IndicatorSuite;
  levels: Levels;
  patterns: DetectedPattern[];
  cfg: SignalEngineConfig;
}

interface SideScore {
  score: number;
  reasons: SignalReason[];
}

function num(v: number | undefined): number {
  return v === undefined || Number.isNaN(v) ? 0 : v;
}

/**
 * Separación mínima (fracción) entre medias para hablar de tendencia.
 * Evita llamar "tendencia" a un mercado plano donde las EMAs convergen
 * numéricamente iguales.
 */
const EMA_SEPARATION_LONG = 0.002;
const EMA_SEPARATION_SHORT = 0.001;

function bullTrendStrong(close: number, ema50: number, ema200: number): boolean {
  return close > ema50 && ema50 > ema200 * (1 + EMA_SEPARATION_LONG);
}

function bearTrendStrong(close: number, ema50: number, ema200: number): boolean {
  return close < ema50 && ema50 < ema200 * (1 - EMA_SEPARATION_LONG);
}

function v(arr: number[], i: number): number {
  const x = arr[i];
  return Number.isNaN(x) ? 0 : x;
}

function trendOf(ctx: Context): TrendContext {
  const { candles, i, ind } = ctx;
  const close = candles[i].close;
  const ema50 = v(ind.ema50, i);
  const ema200 = v(ind.ema200, i);
  const adx = v(ind.adx14.adx, i);
  const plusDi = v(ind.adx14.plusDi, i);
  const minusDi = v(ind.adx14.minusDi, i);
  if (adx >= ctx.cfg.minAdx) {
    if (plusDi > minusDi && close > ema50 && ema50 > ema200) return "up";
    if (minusDi > plusDi && close < ema50 && ema50 < ema200) return "down";
  }
  return "range";
}

function bullConditions(ctx: Context): SideScore {
  const { candles, i, ind, levels, patterns, cfg } = ctx;
  const c = candles[i];
  const close = c.close;
  const rsi = v(ind.rsi14, i);
  const rsiPrev = i >= 1 ? v(ind.rsi14, i - 1) : 50;
  const hist = v(ind.macd.histogram, i);
  const histPrev = i >= 1 ? v(ind.macd.histogram, i - 1) : 0;
  const relVol = v(ind.relVol20, i);
  const atr = v(ind.atr14, i);
  const adx = v(ind.adx14.adx, i);
  const ema50 = v(ind.ema50, i);
  const ema200 = v(ind.ema200, i);
  const ema20 = v(ind.ema20, i);
  const bbLower = v(ind.bollinger.lower, i);
  const reasons: SignalReason[] = [];

  // 1. Tendencia alcista confirmada.
  if (bullTrendStrong(close, ema50, ema200)) {
    reasons.push({ text: "Tendencia alcista: precio sobre EMA50 y EMA50 sobre EMA200", weight: 18 });
  } else if (close > ema20 * (1 + EMA_SEPARATION_SHORT) && ema20 > ema50 * (1 + EMA_SEPARATION_SHORT)) {
    reasons.push({ text: "Estructura de corto plazo alcista (EMA20 > EMA50)", weight: 8 });
  }

  // 2. RSI en recuperación desde sobreventa.
  if (rsi < 35 && rsi >= rsiPrev) {
    reasons.push({ text: `RSI ${rsi.toFixed(1)} en zona de sobreventa y girando al alza`, weight: 10 });
  } else if (rsiPrev < 30 && rsi >= 30) {
    reasons.push({ text: `RSI saliendo de sobreventa (${rsiPrev.toFixed(1)} -> ${rsi.toFixed(1)})`, weight: 10 });
  }

  // 3. MACD a favor.
  if (hist > 0 && hist > histPrev) {
    reasons.push({ text: "Histograma MACD positivo y creciente", weight: 10 });
  } else if (histPrev <= 0 && hist > 0) {
    reasons.push({ text: "Cruce alcista reciente del MACD sobre su señal", weight: 10 });
  }

  // 4. Patrón de vela alcista con volumen que lo respalda.
  const bullPatterns = patterns.filter(
    (p) => p.direction === "bullish" && p.index >= i - 1 && p.index <= i,
  );
  if (bullPatterns.length > 0) {
    if (relVol >= cfg.minRelativeVolume) {
      const w = Math.round(12 * Math.max(...bullPatterns.map((p) => p.strength)));
      reasons.push({
        text: `Patrón alcista ${bullPatterns.map((p) => p.name).join(", ")} con volumen relativo ${relVol.toFixed(2)}x`,
        weight: w,
      });
    } else {
      reasons.push({ text: `Patrón alcista ${bullPatterns.map((p) => p.name).join(", ")} SIN volumen suficiente (relVol ${relVol.toFixed(2)}x)`, weight: 2 });
    }
  }

  // 5. Rechazo en soporte cercano.
  const support = levels.nearestSupport;
  if (support && atr > 0) {
    const dist = (close - support.price) / atr;
    if (dist >= 0 && dist <= cfg.maxLevelDistanceAtr) {
      reasons.push({
        text: `Precio a ${dist.toFixed(2)} ATR del soporte (${support.price.toFixed(4)}, ${support.touches} toques)`,
        weight: 8,
      });
    }
  }

  // 6. Ruptura al alza de resistencia con volumen.
  const resistance = levels.nearestResistance;
  if (resistance && i >= 1) {
    const prevClose = candles[i - 1].close;
    if (prevClose <= resistance.price && close > resistance.price && relVol >= 1.3) {
      reasons.push({
        text: `Ruptura de resistencia ${resistance.price.toFixed(4)} con volumen relativo ${relVol.toFixed(2)}x`,
        weight: 15,
      });
    }
  }

  // 7. Reversión a la media: cierre bajo banda inferior con RSI bajo.
  if (bbLower > 0 && close < bbLower && rsi < 32) {
    reasons.push({ text: "Cierre bajo la banda de Bollinger inferior con RSI < 32", weight: 8 });
  }

  // 8. Divergencia alcista simple de OBV.
  if (i >= 5) {
    const obvNow = ind.obv[i];
    const obv5 = ind.obv[i - 5];
    const price5 = candles[i - 5].close;
    if (obvNow > obv5 && close <= price5) {
      reasons.push({ text: "OBV subiendo mientras el precio no: posible acumulación", weight: 6 });
    }
  }

  // 9. Contexto de tendencia del ADX.
  if (adx >= cfg.minAdx && v(ind.adx14.plusDi, i) > v(ind.adx14.minusDi, i)) {
    reasons.push({ text: `ADX ${adx.toFixed(1)} con +DI sobre -DI: tendencia con sesgo alcista`, weight: 8 });
  }

  const score = Math.min(100, reasons.reduce((s, r) => s + r.weight, 0));
  return { score, reasons };
}

function bearConditions(ctx: Context): SideScore {
  const { candles, i, ind, levels, patterns, cfg } = ctx;
  const c = candles[i];
  const close = c.close;
  const rsi = v(ind.rsi14, i);
  const rsiPrev = i >= 1 ? v(ind.rsi14, i - 1) : 50;
  const hist = v(ind.macd.histogram, i);
  const histPrev = i >= 1 ? v(ind.macd.histogram, i - 1) : 0;
  const relVol = v(ind.relVol20, i);
  const atr = v(ind.atr14, i);
  const adx = v(ind.adx14.adx, i);
  const ema50 = v(ind.ema50, i);
  const ema200 = v(ind.ema200, i);
  const ema20 = v(ind.ema20, i);
  const bbUpper = v(ind.bollinger.upper, i);
  const reasons: SignalReason[] = [];

  if (bearTrendStrong(close, ema50, ema200)) {
    reasons.push({ text: "Tendencia bajista: precio bajo EMA50 y EMA50 bajo EMA200", weight: 18 });
  } else if (close < ema20 * (1 - EMA_SEPARATION_SHORT) && ema20 < ema50 * (1 - EMA_SEPARATION_SHORT)) {
    reasons.push({ text: "Estructura de corto plazo bajista (EMA20 < EMA50)", weight: 8 });
  }

  if (rsi > 65 && rsi <= rsiPrev) {
    reasons.push({ text: `RSI ${rsi.toFixed(1)} en sobrecompra y girando a la baja`, weight: 10 });
  } else if (rsiPrev > 70 && rsi <= 70) {
    reasons.push({ text: `RSI saliendo de sobrecompra (${rsiPrev.toFixed(1)} -> ${rsi.toFixed(1)})`, weight: 10 });
  }

  if (hist < 0 && hist < histPrev) {
    reasons.push({ text: "Histograma MACD negativo y decreciente", weight: 10 });
  } else if (histPrev >= 0 && hist < 0) {
    reasons.push({ text: "Cruce bajista reciente del MACD bajo su señal", weight: 10 });
  }

  const bearPatterns = patterns.filter(
    (p) => p.direction === "bearish" && p.index >= i - 1 && p.index <= i,
  );
  if (bearPatterns.length > 0) {
    if (relVol >= cfg.minRelativeVolume) {
      const w = Math.round(12 * Math.max(...bearPatterns.map((p) => p.strength)));
      reasons.push({
        text: `Patrón bajista ${bearPatterns.map((p) => p.name).join(", ")} con volumen relativo ${relVol.toFixed(2)}x`,
        weight: w,
      });
    } else {
      reasons.push({ text: `Patrón bajista ${bearPatterns.map((p) => p.name).join(", ")} SIN volumen suficiente (relVol ${relVol.toFixed(2)}x)`, weight: 2 });
    }
  }

  const resistance = levels.nearestResistance;
  if (resistance && atr > 0) {
    const dist = (resistance.price - close) / atr;
    if (dist >= 0 && dist <= cfg.maxLevelDistanceAtr) {
      reasons.push({
        text: `Precio a ${dist.toFixed(2)} ATR de la resistencia (${resistance.price.toFixed(4)}, ${resistance.touches} toques)`,
        weight: 8,
      });
    }
  }

  const support = levels.nearestSupport;
  if (support && i >= 1) {
    const prevClose = candles[i - 1].close;
    if (prevClose >= support.price && close < support.price && relVol >= 1.3) {
      reasons.push({
        text: `Pérdida del soporte ${support.price.toFixed(4)} con volumen relativo ${relVol.toFixed(2)}x`,
        weight: 15,
      });
    }
  }

  if (bbUpper > 0 && close > bbUpper && rsi > 68) {
    reasons.push({ text: "Cierre sobre la banda de Bollinger superior con RSI > 68", weight: 8 });
  }

  if (i >= 5) {
    const obvNow = ind.obv[i];
    const obv5 = ind.obv[i - 5];
    const price5 = candles[i - 5].close;
    if (obvNow < obv5 && close >= price5) {
      reasons.push({ text: "OBV bajando mientras el precio no: posible distribución", weight: 6 });
    }
  }

  if (adx >= cfg.minAdx && v(ind.adx14.minusDi, i) > v(ind.adx14.plusDi, i)) {
    reasons.push({ text: `ADX ${adx.toFixed(1)} con -DI sobre +DI: tendencia con sesgo bajista`, weight: 8 });
  }

  const score = Math.min(100, reasons.reduce((s, r) => s + r.weight, 0));
  return { score, reasons };
}

function snapshotIndicators(ctx: Context): SignalIndicators {
  const { i, ind } = ctx;
  return {
    adx: num(ind.adx14.adx[i]),
    plusDi: num(ind.adx14.plusDi[i]),
    minusDi: num(ind.adx14.minusDi[i]),
    rsi: num(ind.rsi14[i]),
    atrPct: num(ind.atrPct[i]),
    relativeVolume: num(ind.relVol20[i]),
    ema20: num(ind.ema20[i]),
    ema50: num(ind.ema50[i]),
    ema200: num(ind.ema200[i]),
    macdHistogram: num(ind.macd.histogram[i]),
    trend: trendOf(ctx),
    rangePosition: num(ind.rangePos20[i]),
  };
}

/**
 * Núcleo del motor: evalúa la señal en la vela cerrada `i`.
 * `candles` debe contener solo velas cerradas hasta `i` (inclusive).
 * `precomputed` permite reutilizar indicadores ya calculados sobre la serie
 * completa (los arrays son alineados y sin lookahead, por lo que el valor
 * en `i` es idéntico al calculado sobre el prefijo).
 */
export function evaluateSignalAt(
  candles: Candle[],
  i: number,
  cfg: SignalEngineConfig,
  meta: { symbol: string; market: "crypto" | "stocks"; interval: string; freshness: Freshness; now?: number },
  precomputed?: IndicatorSuite,
): Signal {
  const now = meta.now ?? Date.now();
  const intervalMs = INTERVAL_MS[meta.interval] ?? 3_600_000;
  const candle = candles[i];
  const base = {
    symbol: meta.symbol,
    market: meta.market,
    interval: meta.interval,
    generatedAt: now,
    candleTime: candle.time,
    priceRef: candle.close,
    horizonCandles: cfg.horizonCandles,
    freshness: meta.freshness,
    validUntil: candle.time + intervalMs * (cfg.horizonCandles + 1),
    warnings: [] as string[],
  };

  const ind = precomputed ?? computeIndicators(candles);

  if (candles.length < MIN_CANDLES_FOR_SIGNAL || Number.isNaN(ind.ema200[i])) {
    return {
      ...base,
      kind: "INSUFFICIENT_DATA",
      direction: null,
      score: 0,
      bullScore: 0,
      bearScore: 0,
      reasons: [
        {
          text: `Se necesitan al menos ${MIN_CANDLES_FOR_SIGNAL} velas cerradas para evaluar la señal (hay ${candles.length})`,
          weight: 0,
        },
      ],
      validUntil: candle.time + intervalMs,
    };
  }

  const patterns = [...detectPatternsAt(candles, i), ...detectPatternsAt(candles, Math.max(0, i - 1))];
  const levels = computeLevels(candles, i, ind.atr14);
  const ctx: Context = { candles, i, ind, levels, patterns, cfg };

  const bull = bullConditions(ctx);
  const bear = bearConditions(ctx);
  const trend = trendOf(ctx);
  const adx = num(ind.adx14.adx[i]);

  const stale = meta.freshness === "stale";
  if (stale) base.warnings.push("Datos desactualizados: la señal no puede confirmarse");

  const net = bull.score - bear.score;
  const direction: "long" | "short" = net >= 0 ? "long" : "short";
  const score = Math.min(100, Math.abs(net));
  const reasons = (net >= 0 ? bull.reasons : bear.reasons)
    .slice()
    .sort((a, b) => b.weight - a.weight);
  const opposite = net >= 0 ? bear.reasons : bull.reasons;

  let kind: Signal["kind"];
  if (stale) {
    kind = "NONE";
  } else if (score >= cfg.minScore && adx >= cfg.minAdx) {
    kind = net >= 0 ? "BUY" : "SELL";
  } else if (score >= cfg.waitScore) {
    kind = "WAIT";
  } else {
    kind = "NONE";
  }

  const blocking: string[] = [];
  if (score < cfg.minScore) {
    blocking.push(`puntuación ${score} por debajo del umbral ${cfg.minScore}`);
  }
  if (adx < cfg.minAdx) {
    blocking.push(`ADX ${adx.toFixed(1)} por debajo del mínimo ${cfg.minAdx}`);
  }

  return {
    ...base,
    kind,
    direction: kind === "BUY" || kind === "SELL" ? direction : null,
    score,
    bullScore: bull.score,
    bearScore: bear.score,
    reasons,
    indicators: snapshotIndicators(ctx),
    levels: {
      nearestSupport: levels.nearestSupport?.price,
      supportTouches: levels.nearestSupport?.touches,
      nearestResistance: levels.nearestResistance?.price,
      resistanceTouches: levels.nearestResistance?.touches,
    },
    patterns: patterns.filter((p) => p.index >= i - 1).map((p) => p.name),
    warnings: [
      ...base.warnings,
      ...(kind === "WAIT" || kind === "NONE"
        ? [`Sin ventaja suficiente (${blocking.join("; ")}): se recomienda esperar`]
        : []),
      ...(opposite.length > 0 ? [`Contra-argumentos: ${opposite.slice(0, 2).map((r) => r.text).join("; ")}`] : []),
      ...(trend === "range" && kind !== "NONE" ? ["Mercado en rango: señales contra-tendencia tienen menor probabilidad histórica"] : []),
    ],
  };
}

/**
 * Evalúa la señal actual de una serie (usa solo velas cerradas; la vela en
 * formación se ignora para señales confirmadas).
 */
export function evaluateCurrentSignal(
  series: Candle[],
  cfg: SignalEngineConfig,
  meta: { symbol: string; market: "crypto" | "stocks"; interval: string; freshness: Freshness; now?: number },
): Signal {
  const closed = series.filter((c) => c.closed);
  if (closed.length === 0) {
    const now = meta.now ?? Date.now();
    return {
      kind: "INSUFFICIENT_DATA",
      direction: null,
      symbol: meta.symbol,
      market: meta.market,
      interval: meta.interval,
      generatedAt: now,
      candleTime: 0,
      priceRef: 0,
      horizonCandles: cfg.horizonCandles,
      score: 0,
      bullScore: 0,
      bearScore: 0,
      reasons: [{ text: "No hay velas cerradas disponibles", weight: 0 }],
      freshness: meta.freshness,
      warnings: [],
      validUntil: now,
    };
  }
  return evaluateSignalAt(closed, closed.length - 1, cfg, meta);
}
