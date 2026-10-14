import type { Candle, CandleSeries, Freshness, Interval } from "./types";
import { INTERVAL_MS } from "./types";

/** Valida que una vela OHLCV sea coherente. */
export function isValidCandle(c: Candle): boolean {
  const nums = [c.time, c.open, c.high, c.low, c.close, c.volume];
  if (nums.some((n) => !Number.isFinite(n))) return false;
  if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) return false;
  if (c.high < Math.max(c.open, c.close)) return false;
  if (c.low > Math.min(c.open, c.close)) return false;
  if (c.low > c.high) return false;
  if (c.time <= 0) return false;
  return true;
}

/**
 * Normaliza una serie de velas:
 * - descarta velas inválidas
 * - elimina duplicados por timestamp (conserva la última)
 * - ordena cronológicamente de forma ascendente
 * - marca la última vela como abierta/cerrada según el reloj real
 */
export function normalizeCandles(
  raw: Candle[],
  now: number = Date.now(),
): { candles: Candle[]; removed: number } {
  const valid: Candle[] = [];
  let removed = 0;
  const byTime = new Map<number, Candle>();
  for (const c of raw) {
    if (!isValidCandle(c)) {
      removed++;
      continue;
    }
    byTime.set(c.time, c);
  }
  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
  // Marcar cierre: una vela está cerrada si su intervalo ya terminó.
  for (const c of sorted) {
    const ms = INTERVAL_MS[c.interval];
    c.closed = ms ? c.time + ms <= now : true;
  }
  return { candles: sorted, removed };
}

/** Detecta huecos en la serie (para cripto 24/7 deberían ser raros). */
export function detectGaps(candles: Candle[], interval: Interval): number[] {
  const ms = INTERVAL_MS[interval];
  if (!ms) return [];
  const gaps: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].time - candles[i - 1].time;
    if (diff > ms * 1.5) gaps.push(candles[i - 1].time);
  }
  return gaps;
}

export function computeFreshness(
  candles: Candle[],
  interval: string,
  now: number = Date.now(),
): { freshness: Freshness; lastCandleAgeMs?: number } {
  if (candles.length === 0) return { freshness: "unknown" };
  const last = candles[candles.length - 1];
  const ms = INTERVAL_MS[interval];
  if (!ms) return { freshness: "unknown" };
  // Edad desde el cierre esperado de la última vela.
  const ageMs = now - (last.time + ms);
  // Tolerancia: hasta 2 intervalos de retraso se considera fresco
  // (los proveedores agregan la vela con cierto retardo).
  return { freshness: ageMs <= ms * 2 ? "fresh" : "stale", lastCandleAgeMs: ageMs };
}

export function buildSeries(
  candles: Candle[],
  meta: Omit<CandleSeries["meta"], "freshness" | "lastCandleAgeMs" | "warnings"> & {
    warnings?: string[];
  },
): CandleSeries {
  const { freshness, lastCandleAgeMs } = computeFreshness(candles, candles[0]?.interval ?? "");
  return {
    candles,
    meta: {
      ...meta,
      freshness: candles.length ? freshness : "unknown",
      lastCandleAgeMs,
      warnings: meta.warnings ?? [],
    },
  };
}

/** Divide la serie en velas cerradas y la vela en formación (si existe). */
export function splitClosed(series: Candle[]): { closed: Candle[]; forming: Candle | null } {
  if (series.length === 0) return { closed: [], forming: null };
  const last = series[series.length - 1];
  if (!last.closed) return { closed: series.slice(0, -1), forming: last };
  return { closed: series, forming: null };
}
