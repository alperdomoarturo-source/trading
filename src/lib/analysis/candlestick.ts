import type { Candle } from "@/lib/market/types";

export type CandleDirection = "bullish" | "bearish" | "doji";

export interface CandleAnatomy {
  /** |close - open| */
  body: number;
  /** high - max(open, close) */
  upperWick: number;
  /** min(open, close) - low */
  lowerWick: number;
  /** high - low */
  range: number;
  /** body / range (0-1) */
  bodyRatio: number;
  /** upperWick / lowerWick (Infinity si lowerWick = 0) */
  wickRatio: number;
  direction: CandleDirection;
}

export function anatomy(c: Candle): CandleAnatomy {
  const range = c.high - c.low;
  const body = Math.abs(c.close - c.open);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const direction: CandleDirection =
    body <= range * 0.05 ? "doji" : c.close > c.open ? "bullish" : "bearish";
  return {
    body,
    upperWick,
    lowerWick,
    range,
    bodyRatio: range > 0 ? body / range : 0,
    wickRatio: lowerWick > 0 ? upperWick / lowerWick : upperWick > 0 ? Infinity : 1,
    direction,
  };
}

/** Anatomía normalizada: tamaños expresados como fracción del rango. */
export interface NormalizedAnatomy {
  body: number;
  upperWick: number;
  lowerWick: number;
  direction: CandleDirection;
}

export function normalizedAnatomy(c: Candle): NormalizedAnatomy {
  const a = anatomy(c);
  const r = a.range > 0 ? a.range : 1;
  return {
    body: a.body / r,
    upperWick: a.upperWick / r,
    lowerWick: a.lowerWick / r,
    direction: a.direction,
  };
}
