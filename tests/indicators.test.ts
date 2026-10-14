import { describe, expect, it } from "vitest";
import {
  adx,
  atr,
  bollinger,
  computeIndicators,
  ema,
  macd,
  rangePosition,
  relativeVolume,
  rsi,
  sma,
} from "@/lib/analysis/indicators";
import type { Candle } from "@/lib/market/types";

const NA = Number.NaN;

function mkCandle(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): Candle {
  return {
    symbol: "TESTUSDT",
    market: "crypto",
    interval: "1h",
    time: 1_700_000_000_000 + i * 3_600_000,
    open,
    high,
    low,
    close,
    volume,
    provider: "test",
    closed: true,
  };
}

describe("sma", () => {
  it("calcula la media móvil simple con NaN inicial", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([NA, NA, 2, 3, 4]);
  });
});

describe("ema", () => {
  it("semilla con SMA y aplica el factor k", () => {
    const out = ema([2, 4, 6, 8, 10], 3);
    expect(out[2]).toBeCloseTo(4);
    expect(out[3]).toBeCloseTo(6);
    expect(out[4]).toBeCloseTo(8);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(Number.isNaN(out[1])).toBe(true);
  });
});

describe("rsi", () => {
  it("devuelve 100 en subida constante", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const out = rsi(closes, 14);
    expect(out[29]).toBeCloseTo(100);
  });

  it("devuelve 0 en bajada constante", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 - i);
    const out = rsi(closes, 14);
    expect(out[29]).toBeCloseTo(0);
  });

  it("ronda 50 en movimientos alternos simétricos", () => {
    const closes: number[] = [100];
    for (let i = 0; i < 40; i++) closes.push(closes[i] + (i % 2 === 0 ? 2 : -2));
    const out = rsi(closes, 14);
    expect(out[out.length - 1]).toBeGreaterThan(45);
    expect(out[out.length - 1]).toBeLessThan(55);
  });
});

describe("macd", () => {
  it("es coherente con ema12 - ema26", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 5) * 10 + i * 0.5);
    const { macd: line } = macd(closes);
    const e12 = ema(closes, 12);
    const e26 = ema(closes, 26);
    for (let i = 25; i < closes.length; i++) {
      expect(line[i]).toBeCloseTo(e12[i] - e26[i], 8);
    }
  });
});

describe("bollinger", () => {
  it("bandas iguales con precios constantes", () => {
    const closes = new Array(30).fill(100);
    const { upper, middle, lower } = bollinger(closes, 20, 2);
    expect(upper[29]).toBeCloseTo(100);
    expect(lower[29]).toBeCloseTo(100);
    expect(middle[29]).toBeCloseTo(100);
  });

  it("banda superior mayor que inferior con volatilidad", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    const { upper, lower } = bollinger(closes, 20, 2);
    expect(upper[29]).toBeGreaterThan(lower[29]);
  });
});

describe("atr y adx", () => {
  it("ATR constante con rango constante", () => {
    const candles = Array.from({ length: 30 }, (_, i) => mkCandle(i, 100, 101, 99, 100.5));
    const out = atr(candles, 14);
    expect(out[29]).toBeCloseTo(2, 6);
  });

  it("ADX alto con +DI dominante en tendencia alcista", () => {
    const candles = Array.from({ length: 80 }, (_, i) =>
      mkCandle(i, 100 + i, 101 + i, 99 + i, 100.5 + i),
    );
    const { adx: adxLine, plusDi, minusDi } = adx(candles, 14);
    expect(adxLine[79]).toBeGreaterThan(25);
    expect(plusDi[79]).toBeGreaterThan(minusDi[79]);
  });
});

describe("volumen relativo y posición en rango", () => {
  it("volumen relativo 1 cuando el volumen es constante", () => {
    const vols = new Array(30).fill(100);
    const out = relativeVolume(vols, 20);
    expect(out[29]).toBeCloseTo(1);
  });

  it("posición 1 en el máximo del rango y 0 en el mínimo", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(mkCandle(i, 100, 105, 95, 100));
    const lastHigh = mkCandle(30, 100, 105, 95, 105);
    const lastLow = mkCandle(30, 100, 105, 95, 95);
    expect(rangePosition([...candles, lastHigh], 20)[30]).toBeCloseTo(1);
    expect(rangePosition([...candles, lastLow], 20)[30]).toBeCloseTo(0);
  });
});

describe("sin lookahead (invariancia por prefijo)", () => {
  it("el valor en i no cambia al calcular sobre un prefijo", () => {
    const candles = Array.from({ length: 300 }, (_, i) =>
      mkCandle(
        i,
        100 + Math.sin(i / 7) * 8 + i * 0.2,
        102 + Math.sin(i / 7) * 8 + i * 0.2,
        98 + Math.sin(i / 7) * 8 + i * 0.2,
        101 + Math.sin(i / 7) * 8 + i * 0.2,
        100 + (i % 5) * 30,
      ),
    );
    const full = computeIndicators(candles);
    const k = 250;
    const prefix = computeIndicators(candles.slice(0, k));
    const fields = [
      "ema9",
      "ema20",
      "ema50",
      "ema200",
      "sma20",
      "sma50",
      "rsi14",
      "relVol20",
      "rangePos20",
      "histVol20",
      "atrPct",
      "ret1",
      "ret3",
      "ret5",
      "trendSlope",
    ] as const;
    for (const f of fields) {
      for (let i = 200; i < k; i++) {
        expect(prefix[f][i]).toBeCloseTo(full[f][i], 9);
      }
    }
    for (let i = 200; i < k; i++) {
      expect(prefix.macd.histogram[i]).toBeCloseTo(full.macd.histogram[i], 9);
      expect(prefix.bollinger.upper[i]).toBeCloseTo(full.bollinger.upper[i], 9);
      expect(prefix.adx14.adx[i]).toBeCloseTo(full.adx14.adx[i], 9);
      expect(prefix.adx14.plusDi[i]).toBeCloseTo(full.adx14.plusDi[i], 9);
    }
  });
});
