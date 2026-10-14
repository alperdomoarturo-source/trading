import { describe, expect, it } from "vitest";
import { evaluateSignalAt } from "@/lib/signals/engine";
import { MIN_CANDLES_FOR_SIGNAL, type SignalEngineConfig } from "@/lib/signals/types";
import type { Candle } from "@/lib/market/types";

const HOUR = 3_600_000;

function mk(i: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
  return {
    symbol: "BTCUSDT",
    market: "crypto",
    interval: "1h",
    time: 1_700_000_000_000 + i * HOUR,
    open,
    high,
    low,
    close,
    volume,
    provider: "test",
    closed: true,
  };
}

/** Tendencia alcista sostenida con pullbacks suaves. */
function uptrend(n: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const drift = 0.15;
    const pull = Math.sin(i / 9) * 0.8;
    const open = price;
    const close = price + drift + pull * 0.5;
    const high = Math.max(open, close) + 0.6 + Math.abs(Math.sin(i / 4)) * 0.4;
    const low = Math.min(open, close) - 0.6 - Math.abs(Math.cos(i / 5)) * 0.4;
    const volume = 100 + (i % 7) * 25;
    candles.push(mk(i, open, high, low, close, volume));
    price = close;
  }
  return candles;
}

const RELAXED: SignalEngineConfig = {
  minScore: 25,
  waitScore: 10,
  minAdx: 10,
  minRelativeVolume: 1.1,
  maxLevelDistanceAtr: 1.5,
  horizonCandles: 5,
};

const META = {
  symbol: "BTCUSDT",
  market: "crypto" as const,
  interval: "1h",
  freshness: "fresh" as const,
};

describe("motor de señales", () => {
  it("datos insuficientes cuando no hay historial para EMA200", () => {
    const candles = uptrend(100);
    const sig = evaluateSignalAt(candles, candles.length - 1, RELAXED, { ...META, now: candles[99].time });
    expect(sig.kind).toBe("INSUFFICIENT_DATA");
    expect(sig.reasons[0].text).toContain("velas cerradas");
  });

  it("en tendencia alcista sostenida emite COMPRA con motivos", () => {
    const candles = uptrend(MIN_CANDLES_FOR_SIGNAL + 30);
    const i = candles.length - 1;
    const sig = evaluateSignalAt(candles, i, RELAXED, { ...META, now: candles[i].time });
    expect(sig.kind).toBe("BUY");
    expect(sig.direction).toBe("long");
    expect(sig.reasons.length).toBeGreaterThan(0);
    expect(sig.reasons[0].text.length).toBeGreaterThan(10);
    expect(sig.score).toBeGreaterThanOrEqual(RELAXED.minScore);
    expect(sig.indicators?.trend).toBe("up");
  });

  it("umbral alto degrada la señal a ESPERAR", () => {
    const candles = uptrend(MIN_CANDLES_FOR_SIGNAL + 30);
    const i = candles.length - 1;
    const strict = { ...RELAXED, minScore: 95 };
    const sig = evaluateSignalAt(candles, i, strict, { ...META, now: candles[i].time });
    expect(["WAIT", "NONE"]).toContain(sig.kind);
    expect(sig.warnings.join(" ")).toMatch(/umbral|esperar/i);
  });

  it("datos rancios bloquean señales confirmadas", () => {
    const candles = uptrend(MIN_CANDLES_FOR_SIGNAL + 30);
    const i = candles.length - 1;
    const sig = evaluateSignalAt(candles, i, RELAXED, {
      ...META,
      freshness: "stale",
      now: candles[i].time,
    });
    expect(sig.kind).not.toBe("BUY");
    expect(sig.warnings.join(" ")).toContain("desactualizados");
  });

  it("los motivos están ordenados por peso y la puntuación es coherente", () => {
    const candles = uptrend(MIN_CANDLES_FOR_SIGNAL + 30);
    const i = candles.length - 1;
    const sig = evaluateSignalAt(candles, i, RELAXED, { ...META, now: candles[i].time });
    const weights = sig.reasons.map((r) => r.weight);
    const sorted = [...weights].sort((a, b) => b - a);
    expect(weights).toEqual(sorted);
    expect(sig.bullScore).toBeGreaterThanOrEqual(sig.bearScore);
    expect(sig.score).toBeLessThanOrEqual(100);
  });
});
