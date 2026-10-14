import { describe, expect, it } from "vitest";
import { computeFreshness, normalizeCandles, splitClosed } from "@/lib/market/normalize";
import type { Candle } from "@/lib/market/types";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function mk(
  time: number,
  open = 100,
  high = 101,
  low = 99,
  close = 100.5,
  overrides: Partial<Candle> = {},
): Candle {
  return {
    symbol: "BTCUSDT",
    market: "crypto",
    interval: "1h",
    time,
    open,
    high,
    low,
    close,
    volume: 10,
    provider: "binance",
    closed: true,
    ...overrides,
  };
}

describe("normalizeCandles", () => {
  it("descarta velas OHLC incoherentes", () => {
    const bad1 = mk(NOW, 100, 99, 101, 100); // high < low
    const bad2 = mk(NOW + HOUR, 100, 102, 99, 103); // close > high
    const bad3 = mk(NOW + 2 * HOUR, -1, 102, -2, 100); // precio negativo
    const good = mk(NOW + 3 * HOUR);
    const { candles, removed } = normalizeCandles([bad1, bad2, bad3, good], NOW + 4 * HOUR);
    expect(removed).toBe(3);
    expect(candles).toHaveLength(1);
    expect(candles[0].time).toBe(NOW + 3 * HOUR);
  });

  it("elimina duplicados conservando la última aparición", () => {
    const a = mk(NOW, 100, 101, 99, 100);
    const b = mk(NOW, 100, 102, 99, 101);
    const c = mk(NOW + HOUR);
    const { candles } = normalizeCandles([a, b, c], NOW + 2 * HOUR);
    expect(candles).toHaveLength(2);
    expect(candles[0].close).toBe(101);
  });

  it("ordena cronológicamente ascendente", () => {
    const c3 = mk(NOW + 2 * HOUR);
    const c1 = mk(NOW);
    const c2 = mk(NOW + HOUR);
    const { candles } = normalizeCandles([c3, c1, c2], NOW + 3 * HOUR);
    expect(candles.map((c) => c.time)).toEqual([NOW, NOW + HOUR, NOW + 2 * HOUR]);
  });

  it("marca como abierta la vela cuyo intervalo no terminó", () => {
    const closed1 = mk(NOW);
    const forming = mk(NOW + HOUR, 100, 101, 99, 100.5);
    const { candles } = normalizeCandles([closed1, forming], NOW + HOUR + 1000);
    expect(candles[0].closed).toBe(true);
    expect(candles[1].closed).toBe(false);
  });
});

describe("computeFreshness", () => {
  it("fresca cuando la última vela cerró hace poco", () => {
    const candles = [mk(NOW), mk(NOW + HOUR)];
    const { freshness } = computeFreshness(candles, "1h", NOW + 2 * HOUR + 5 * 60_000);
    expect(freshness).toBe("fresh");
  });

  it("rancia cuando pasaron varios intervalos", () => {
    const candles = [mk(NOW), mk(NOW + HOUR)];
    const { freshness } = computeFreshness(candles, "1h", NOW + 10 * HOUR);
    expect(freshness).toBe("stale");
  });
});

describe("splitClosed", () => {
  it("separa la vela en formación", () => {
    const closed = [mk(NOW), mk(NOW + HOUR)];
    const forming = { ...mk(NOW + 2 * HOUR), closed: false };
    const { closed: c, forming: f } = splitClosed([...closed, forming]);
    expect(c).toHaveLength(2);
    expect(f?.time).toBe(NOW + 2 * HOUR);
  });

  it("sin vela en formación devuelve todo cerrado", () => {
    const closed = [mk(NOW), mk(NOW + HOUR)];
    const { closed: c, forming: f } = splitClosed(closed);
    expect(c).toHaveLength(2);
    expect(f).toBeNull();
  });
});
