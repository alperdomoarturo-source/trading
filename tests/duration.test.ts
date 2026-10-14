import { describe, expect, it } from "vitest";
import { describeTrendWindow, estimateTrendDuration, type TrendDurationEstimate } from "@/lib/simulation/duration";
import type { Candle } from "@/lib/market/types";

const HOUR = 3_600_000;

function build(closes: number[], closed = true): Candle[] {
  return closes.map((close, i) => ({
    symbol: "TESTUSDT",
    market: "crypto",
    interval: "1h",
    time: i * HOUR,
    open: i === 0 ? close : closes[i - 1],
    high: Math.max(close, i === 0 ? close : closes[i - 1]),
    low: Math.min(close, i === 0 ? close : closes[i - 1]),
    close,
    volume: 1,
    provider: "test",
    closed,
  }));
}

/** Cierra en 100 + upRuns[i] escalones de +1, con -1 entre cada racha; opcional racha final. */
function upRunSeries(upRuns: number[], trailing = 0): Candle[] {
  let price = 100;
  const closes = [price];
  for (const len of upRuns) {
    for (let i = 0; i < len; i++) closes.push(++price);
    closes.push(--price);
  }
  for (let i = 0; i < trailing; i++) closes.push(++price);
  return build(closes);
}

describe("estimateTrendDuration", () => {
  it("rechaza series demasiado cortas", () => {
    expect(
      estimateTrendDuration({ candles: build(Array.from({ length: 40 }, (_, i) => 100 + (i % 3))), direction: "up", intervalMs: HOUR }),
    ).toBeNull();
  });

  it("rechaza un intervalo inválido", () => {
    expect(
      estimateTrendDuration({ candles: upRunSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3), direction: "up", intervalMs: 0 }),
    ).toBeNull();
  });

  it("mide racha actual, cuartiles y ventana restante sobre las rachas pasadas", () => {
    const est = estimateTrendDuration({
      candles: upRunSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3),
      direction: "up",
      intervalMs: HOUR,
      horizonCandles: 5,
    });
    expect(est).not.toBeNull();
    expect(est?.candlesAnalysed).toBe(94);
    expect(est?.streakCandles).toBe(3);
    expect(est?.runsAnalysed).toBe(13);
    expect(est?.typicalRunRangeCandles).toEqual([3, 9]);
    expect(est?.medianRunCandles).toBe(6);
    expect(est?.remainingCandles).toEqual([0, 6]);
    expect(est?.remainingMs).toEqual([0, 6 * HOUR]);
    expect(est?.exhaustedShare).toBeCloseTo(4 / 13, 6);
    expect(est?.streakAlreadyTypical).toBe(false);
    expect(est?.beyondHorizon).toBe(true);
    expect(est?.anchorClosedTime).toBe(93 * HOUR);
  });

  it("una racha muy larga da ventana restante 0 y se marca como agotada", () => {
    const est = estimateTrendDuration({
      candles: upRunSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 20),
      direction: "up",
      intervalMs: HOUR,
    });
    expect(est?.remainingCandles).toEqual([0, 0]);
    expect(est?.streakAlreadyTypical).toBe(true);
    expect(est?.exhaustedShare).toBeCloseTo(1, 6);
  });

  it("sin rachas suficientes en la dirección pedida devuelve null", () => {
    // sólo 2 rachas alcistas en toda la serie
    expect(estimateTrendDuration({ candles: upRunSeries([30, 30]), direction: "up", intervalMs: HOUR })).toBeNull();
  });

  it("ignora la vela en formación al contar", () => {
    const withForming = [...upRunSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3), build([123, 456], false)[1]];
    const est = estimateTrendDuration({ candles: withForming, direction: "up", intervalMs: HOUR });
    expect(est?.streakCandles).toBe(3);
    expect(est?.candlesAnalysed).toBe(94);
  });

  it("cuenta rachas bajistas en la dirección contraria", () => {
    const est = estimateTrendDuration({
      candles: upRunSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3),
      direction: "down",
      intervalMs: HOUR,
    });
    expect(est?.streakCandles).toBe(0);
    expect(est?.runsAnalysed).toBe(12);
    expect(est?.typicalRunRangeCandles).toEqual([1, 1]);
  });
});

describe("describeTrendWindow", () => {
  const base: TrendDurationEstimate = {
    direction: "up",
    intervalMs: HOUR,
    candlesAnalysed: 499,
    streakCandles: 0,
    runsAnalysed: 120,
    medianRunCandles: 2,
    typicalRunRangeCandles: [1, 3],
    remainingCandles: [1, 3],
    remainingMs: [HOUR, 3 * HOUR],
    exhaustedShare: 0,
    streakAlreadyTypical: false,
    horizonCandles: 5,
    beyondHorizon: false,
    anchorClosedTime: 0,
  };

  it("traduce la ventana a velas y a tiempo legible", () => {
    expect(describeTrendWindow(base, "1h")).toBe("ventana restante ≈ 1–3 velas 1h (1 h–3 h)");
  });

  it("evita «<1 min» cuando la ventana puede cerrarse en cualquier momento", () => {
    expect(describeTrendWindow({ ...base, remainingCandles: [0, 3], remainingMs: [0, 3 * HOUR] }, "1h")).toBe(
      "ventana restante ≈ 0–3 velas 1h (hasta 3 h)",
    );
  });

  it("unifica el texto cuando el rango es un solo valor", () => {
    const four = {
      ...base,
      intervalMs: 4 * HOUR,
      remainingCandles: [2, 2] as [number, number],
      remainingMs: [8 * HOUR, 8 * HOUR] as [number, number],
    };
    expect(describeTrendWindow(four, "4h")).toBe("ventana restante ≈ 2 velas 4h (8 h)");
  });

  it("avisa cuando la racha ya va más larga que lo típico", () => {
    const text = describeTrendWindow(
      { ...base, direction: "down", remainingCandles: [0, 0], streakAlreadyTypical: true, streakCandles: 5 },
      "1h",
    );
    expect(text).toContain("la racha (5 velas 1h) ya duró más que el 75 % de las rachas bajistas");
    expect(text).toContain("cerca del final");
  });

  it("marca lo que queda fuera del horizonte del modelo", () => {
    const text = describeTrendWindow({ ...base, remainingCandles: [3, 9], beyondHorizon: true }, "1h");
    expect(text).toContain("el modelo cubre 5 velas y el resto es estadística de rachas");
  });
});
