import type { Freshness } from "@/lib/market/types";

export type SignalKind = "BUY" | "SELL" | "WAIT" | "NONE" | "INSUFFICIENT_DATA" | "DATA_ERROR";

export const SIGNAL_LABELS: Record<SignalKind, string> = {
  BUY: "COMPRA SIMULADA",
  SELL: "VENTA SIMULADA",
  WAIT: "ESPERAR",
  NONE: "SIN SEÑAL",
  INSUFFICIENT_DATA: "DATOS INSUFICIENTES",
  DATA_ERROR: "ERROR DE DATOS",
};

export interface SignalReason {
  /** Explicación legible de la condición cumplida. */
  text: string;
  /** Puntos aportados a la puntuación de su dirección. */
  weight: number;
}

export type TrendContext = "up" | "down" | "range";

export interface SignalIndicators {
  adx: number;
  plusDi: number;
  minusDi: number;
  rsi: number;
  atrPct: number;
  relativeVolume: number;
  ema20: number;
  ema50: number;
  ema200: number;
  macdHistogram: number;
  trend: TrendContext;
  rangePosition: number;
}

export interface SignalLevels {
  nearestSupport?: number;
  supportTouches?: number;
  nearestResistance?: number;
  resistanceTouches?: number;
}

export interface Signal {
  kind: SignalKind;
  direction: "long" | "short" | null;
  symbol: string;
  market: "crypto" | "stocks";
  interval: string;
  /** Epoch ms de generación. */
  generatedAt: number;
  /** Epoch ms de la vela cerrada de referencia. */
  candleTime: number;
  /** Precio de referencia (cierre de la vela de referencia). */
  priceRef: number;
  /** Horizonte en velas. */
  horizonCandles: number;
  /** Puntuación neta 0-100 de la dirección dominante. */
  score: number;
  /** Puntuaciones brutas por lado. */
  bullScore: number;
  bearScore: number;
  reasons: SignalReason[];
  indicators?: SignalIndicators;
  levels?: SignalLevels;
  patterns?: string[];
  freshness: Freshness;
  warnings: string[];
  /** Epoch ms hasta la cual la señal se considera vigente. */
  validUntil: number;
}

export interface SignalEngineConfig {
  minScore: number;
  waitScore: number;
  minAdx: number;
  minRelativeVolume: number;
  maxLevelDistanceAtr: number;
  horizonCandles: number;
}

/** Velas mínimas para emitir cualquier señal (EMA200 necesita 200+). */
export const MIN_CANDLES_FOR_SIGNAL = 220;
