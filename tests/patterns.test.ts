import { describe, expect, it } from "vitest";
import { detectPatternsAt } from "@/lib/analysis/patterns";
import type { Candle } from "@/lib/market/types";

function mk(
  i: number,
  open: number,
  high: number,
  low: number,
  close: number,
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
    volume: 100,
    provider: "test",
    closed: true,
  };
}

function names(candles: Candle[], index: number): string[] {
  return detectPatternsAt(candles, index).map((p) => p.name);
}

describe("patrones de una vela", () => {
  it("detecta Doji", () => {
    const c = [mk(0, 100, 101, 99, 100.05)];
    expect(names(c, 0)).toContain("Doji");
  });

  it("detecta Hammer (mecha inferior larga)", () => {
    const c = [mk(0, 100.5, 100.8, 97, 100.2)];
    expect(names(c, 0)).toContain("Hammer");
  });

  it("detecta Inverted Hammer tras caída", () => {
    // Geometría de mecha superior larga; tendencia previa a la baja.
    const c = [
      mk(0, 110, 110.5, 108, 108.2),
      mk(1, 108, 108.4, 105, 105.4),
      mk(2, 105, 105.3, 103, 103.3),
      mk(3, 103, 105.3, 102.8, 103.1), // cuerpo pequeño, mecha superior 2.2
    ];
    expect(names(c, 3)).toContain("Inverted Hammer");
  });

  it("detecta Shooting Star tras subida", () => {
    const c = [
      mk(0, 100, 100.5, 99.5, 100.3),
      mk(1, 100.3, 101, 100, 100.8),
      mk(2, 100.8, 101.5, 100.5, 101.3),
      mk(3, 101.3, 103.6, 101.1, 101.5), // cuerpo 0.2, mecha superior 2.1
    ];
    expect(names(c, 3)).toContain("Shooting Star");
  });
});

describe("patrones de dos velas", () => {
  it("detecta Bullish Engulfing", () => {
    const c = [mk(0, 110, 112, 98, 100), mk(1, 99, 112, 98, 111)];
    const found = detectPatternsAt(c, 1);
    expect(found.map((p) => p.name)).toContain("Bullish Engulfing");
    expect(found.find((p) => p.name === "Bullish Engulfing")?.direction).toBe("bullish");
  });

  it("detecta Bearish Engulfing", () => {
    const c = [mk(0, 100, 112, 98, 110), mk(1, 111, 112, 98, 99)];
    const found = detectPatternsAt(c, 1);
    expect(found.map((p) => p.name)).toContain("Bearish Engulfing");
    expect(found.find((p) => p.name === "Bearish Engulfing")?.direction).toBe("bearish");
  });

  it("detecta Bullish Harami", () => {
    const c = [
      // contexto para avgBody
      mk(0, 100, 105, 99, 104),
      mk(1, 104, 106, 100, 105),
      // vela previa: cuerpo grande bajista
      mk(2, 110, 110.5, 96, 97),
      // vela actual: cuerpo pequeño alcista dentro del cuerpo previo
      mk(3, 98, 99.5, 97.5, 99),
    ];
    expect(names(c, 3)).toContain("Bullish Harami");
  });

  it("detecta Bearish Harami", () => {
    const c = [
      mk(0, 105, 106, 99, 100),
      mk(1, 100, 105, 99.5, 104),
      mk(2, 97, 111, 96.5, 110), // cuerpo grande alcista
      mk(3, 109, 109.5, 108, 108.5), // cuerpo pequeño bajista dentro
    ];
    expect(names(c, 3)).toContain("Bearish Harami");
  });
});

describe("patrones de tres velas", () => {
  it("detecta Morning Star", () => {
    const c = [
      mk(0, 100, 105, 99, 104),
      mk(1, 104, 106, 100, 105),
      mk(2, 110, 110.5, 94, 95), // cuerpo bajista grande
      mk(3, 94.9, 95.2, 94, 94.6), // estrella pequeña
      mk(4, 94.5, 106, 94, 105), // alcista que recupera > mitad del cuerpo 1
    ];
    expect(names(c, 4)).toContain("Morning Star");
  });

  it("detecta Evening Star", () => {
    const c = [
      mk(0, 104, 105, 99, 100),
      mk(1, 100, 104.5, 99.5, 104),
      mk(2, 95, 111, 94.5, 110), // cuerpo alcista grande
      mk(3, 110.5, 111, 109.8, 110.2), // estrella pequeña
      mk(4, 106, 106.5, 94, 95.5), // bajista que pierde > mitad del cuerpo 1
    ];
    expect(names(c, 4)).toContain("Evening Star");
  });

  it("detecta Three White Soldiers", () => {
    const c = [
      mk(0, 99, 99.5, 98.5, 99.2),
      mk(1, 100, 105.5, 99.5, 105), // cuerpo 5, mecha sup 0.5
      mk(2, 105.2, 110.8, 105, 110.4), // cuerpo 5.2, mecha sup 0.4
      mk(3, 110.5, 116, 110.2, 115.7), // cuerpo 5.2, mecha sup 0.3
    ];
    expect(names(c, 3)).toContain("Three White Soldiers");
  });

  it("detecta Three Black Crows", () => {
    const c = [
      mk(0, 106, 106.5, 105.5, 106.2),
      mk(1, 105, 105.5, 99.5, 100), // cuerpo 5, mecha inf 0.5
      mk(2, 99.8, 100, 94.5, 95.2), // cuerpo 4.6, mecha inf 0.7
      mk(3, 95, 95.3, 89.8, 90.5), // cuerpo 4.5, mecha inf 0.2
    ];
    expect(names(c, 3)).toContain("Three Black Crows");
  });
});

describe("no falsos positivos obvios", () => {
  it("una vela normal no genera patrones", () => {
    const c = [mk(0, 100, 101, 99, 100.6)];
    expect(detectPatternsAt(c, 0)).toHaveLength(0);
  });
});
