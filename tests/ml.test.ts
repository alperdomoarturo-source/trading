import { describe, expect, it } from "vitest";
import { ML_FEATURE_NAMES, lastClosedFeatureVector, buildFeatureSeries } from "@/lib/ml/features";
import { scoreEnsemble, predictWithModel } from "@/lib/ml/inference";
import type { Candle } from "@/lib/market/types";
import type { MlModelFile, PlattEnsembleScorer, PlattFold } from "@/lib/ml/types";

const NA = Number.NaN;

function mkCandle(i: number, open: number, high: number, low: number, close: number, volume = 100): Candle {
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

/** Serie plana: open 100, high 101, low 99, close 100.5, volumen 100. */
function flatSeries(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => mkCandle(i, 100, 101, 99, 100.5));
}

function fakeModel(overrides: Partial<MlModelFile> = {}): MlModelFile {
  const base = fakeScorer();
  return {
    schema: "ml-model-v2",
    name: "logistic-calibrated",
    version: 1,
    symbol: "TESTUSDT",
    interval: "1h",
    trainedAt: 1_700_000_000_000,
    horizon: 5,
    labelClasses: ["DOWN", "NEUTRAL", "UP"],
    featureNames: [...ML_FEATURE_NAMES],
    minCandles: 350,
    scorer: base,
    threshold: { k: 0.5, minMovePct: 0.15 },
    dataWindow: { candlesClosed: 4000, nSamples: 3000, fromMs: 0, toMs: 1, source: "binance" },
    metrics: {
      finalTest: {
        baseline_momentum: { balancedAccuracy: 0.34 },
        logistic_calibrated: { balancedAccuracy: 0.4 },
      },
    },
    validityStatus: "valid",
    notes: [],
    ...overrides,
  };
}

function fakeFold(weights?: number[][], intercepts?: number[]): PlattFold {
  const zero = [0, 0, 0].map(() => new Array<number>(ML_FEATURE_NAMES.length).fill(0));
  return {
    weights: weights ?? zero,
    intercepts: intercepts ?? [0, 0, 0],
    sigmoidA: [1, 1, 1],
    sigmoidB: [0, 0, 0],
  };
}

/** Scorer trivial de 26 features: un pliegue con pesos/interceptos nulos → uniforme. */
function fakeScorer(weights?: number[][], intercepts?: number[]): PlattEnsembleScorer {
  return {
    type: "platt-decision-ensemble",
    classes: ["DOWN", "NEUTRAL", "UP"],
    folds: [fakeFold(weights, intercepts)],
  };
}

/** Réplica independiente de la fórmula esperada (Platt con el signo de sklearn). */
function expectedFoldProbs(z: number[], A: number[], B: number[]): number[] {
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const s = z.map((zk, k) => sig(-(A[k] * zk + B[k])));
  const t = s.reduce((a, b) => a + b, 0);
  return s.map((v) => v / t);
}

describe("scoreEnsemble (scorer platt-decision-ensemble exportado)", () => {
  it("sin calibración (A=1,B=0) normaliza sigmoid(z) por pliegue", () => {
    const fold: PlattFold = {
      weights: [
        [1, 0],
        [0, 1],
        [0, 0],
      ],
      intercepts: [0, 0, 0],
      sigmoidA: [1, 1, 1],
      sigmoidB: [0, 0, 0],
    };
    const scorer: PlattEnsembleScorer = {
      type: "platt-decision-ensemble",
      classes: ["DOWN", "NEUTRAL", "UP"],
      folds: [fold],
    };
    const probs = scoreEnsemble(scorer, [1, 0]);
    expect(probs).not.toBeNull();
    const expected = expectedFoldProbs([1, 0, 0], fold.sigmoidA, fold.sigmoidB);
    probs!.forEach((p, i) => expect(p).toBeCloseTo(expected[i], 12));
    expect(probs!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("aplica la calibración de Platt por clase: expit(-(A·z + B))", () => {
    const fold: PlattFold = {
      weights: [
        [2, 0],
        [0, 3],
        [0, 0],
      ],
      intercepts: [0.5, -0.5, 0],
      sigmoidA: [1.5, 1, 1],
      sigmoidB: [-0.5, 0, 0],
    };
    const scorer: PlattEnsembleScorer = {
      type: "platt-decision-ensemble",
      classes: ["DOWN", "NEUTRAL", "UP"],
      folds: [fold],
    };
    const probs = scoreEnsemble(scorer, [0.5, 0.25]);
    expect(probs).not.toBeNull();
    const z = [2 * 0.5 + 0.5, 3 * 0.25 - 0.5, 0];
    const expected = expectedFoldProbs(z, fold.sigmoidA, fold.sigmoidB);
    probs!.forEach((p, i) => expect(p).toBeCloseTo(expected[i], 12));
  });

  it("predict_proba de sklearn promedia pliegues: aquí se promedian las probabilidades", () => {
    const f1 = fakeFold(); // uniforme
    const f2 = fakeFold(
      [
        new Array(ML_FEATURE_NAMES.length).fill(0),
        new Array(ML_FEATURE_NAMES.length).fill(0),
        new Array(ML_FEATURE_NAMES.length).fill(-100),
      ],
      [0, 0, 0],
    );
    const scorer: PlattEnsembleScorer = {
      type: "platt-decision-ensemble",
      classes: ["DOWN", "NEUTRAL", "UP"],
      folds: [f1, f2],
    };
    const idx = ML_FEATURE_NAMES.indexOf("rel_vol_20");
    const x = new Array<number>(ML_FEATURE_NAMES.length).fill(0);
    x[idx] = 1;
    const probs = scoreEnsemble(scorer, x);
    expect(probs).not.toBeNull();
    // pliegue 1 = 1/3 por clase; pliegue 2 tiene z=[0,0,100] → casi todo UP.
    const f2probs = expectedFoldProbs([0, 0, -100], [1, 1, 1], [0, 0, 0]);
    expect(probs![0]).toBeCloseTo((1 / 3 + f2probs[0]) / 2, 10);
    expect(probs![2]).toBeCloseTo((1 / 3 + f2probs[2]) / 2, 10);
    expect(probs!.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("rechaza features NaN/Infinity y longitud incorrecta", () => {
    const scorer = fakeScorer();
    expect(
      scoreEnsemble(scorer, [...new Array(ML_FEATURE_NAMES.length - 1).fill(0), NA]),
    ).toBeNull();
    expect(
      scoreEnsemble(scorer, new Array(ML_FEATURE_NAMES.length).fill(Infinity)),
    ).toBeNull();
    expect(scoreEnsemble(scorer, [0, 0])).toBeNull();
  });
});

describe("lastClosedFeatureVector (spec canónica, serie plana)", () => {
  it("rechaza series incompletas (<200 velas cerradas)", () => {
    expect(lastClosedFeatureVector(flatSeries(150))).toBeNull();
    expect(lastClosedFeatureVector([])).toBeNull();
  });

  it("devuelve null si la última vela está en formación pero faltan velas", () => {
    const candles = flatSeries(150);
    candles[candles.length - 1].closed = false;
    expect(lastClosedFeatureVector(candles)).toBeNull();
  });

  it("valores calculados a mano para una serie plana", () => {
    const fv = lastClosedFeatureVector(flatSeries(360));
    expect(fv).not.toBeNull();
    const row = fv!.values;
    expect(row.length).toBe(ML_FEATURE_NAMES.length);
    const at = (name: string) => row[ML_FEATURE_NAMES.indexOf(name as never)];
    // Retornos nulos con cierre constante.
    expect(at("ret_1")).toBeCloseTo(0, 12);
    expect(at("ret_10")).toBeCloseTo(0, 12);
    // Anatomía: cuerpo 0.5, rango 2 → 0.25; mecha superior 0.5/2 = 0.25;
    // mecha inferior = min(open,close) - low = 100 - 99 = 1 → 1/2 = 0.5.
    expect(at("body_ratio")).toBeCloseTo(0.25, 12);
    expect(at("up_wick_ratio")).toBeCloseTo(0.25, 12);
    expect(at("low_wick_ratio")).toBeCloseTo(0.5, 12);
    // Posición en rango 20: (100.5 - 99) / (101 - 99) = 0.75.
    expect(at("range_pos_20")).toBeCloseTo(0.75, 12);
    // Volumen relativo 100/100 = 1.
    expect(at("rel_vol_20")).toBeCloseTo(1, 12);
    // ATR = 2 (TR constante) → 2/100.5*100.
    expect(at("atr_pct")).toBeCloseTo((2 / 100.5) * 100, 9);
    // Bollinger con ancho 0 → %B = 0.5 por convención.
    expect(at("bb_pctb")).toBeCloseTo(0.5, 12);
    // RSI: sin caídas (avgLoss = 0) → 100 en ambas implementaciones.
    expect(at("rsi_14")).toBeCloseTo(100, 12);
    // OBV sin dirección → pendiente 0.
    expect(at("obv_slope_10")).toBeCloseTo(0, 12);
    // Patrones con esta geometría: body_ratio 0.25 → no doji; mecha inferior
    // 1.0 >= 2*cuerpo(0.5) y mecha superior 0.5 <= 0.25*rango(2) → Hammer (1).
    // Cierres crecientes solo al cambio de serie → sin engulfing.
    expect(at("pat_doji")).toBe(0);
    expect(at("pat_hammer")).toBe(1);
    expect(at("pat_bull_engulfing")).toBe(0);
  });

  it("detecta flags de patrón en la última vela (doji)", () => {
    const candles = flatSeries(300);
    for (let i = 200; i < candles.length; i++) {
      candles[i] = mkCandle(i, 100, 101, 99, 100);
    }
    const fv = lastClosedFeatureVector(candles);
    expect(fv).not.toBeNull();
    const row = fv!.values;
    expect(row[ML_FEATURE_NAMES.indexOf("pat_doji")]).toBe(1);
    expect(row[ML_FEATURE_NAMES.indexOf("body_ratio")]).toBe(0);
  });

  it("la matriz completa conserva NaN de warmup (sin lookahead)", () => {
    const { rows } = buildFeatureSeries(flatSeries(250));
    expect(Number.isNaN(rows[0][ML_FEATURE_NAMES.indexOf("ret_1")])).toBe(true);
    expect(Number.isFinite(rows[10][ML_FEATURE_NAMES.indexOf("ret_1")])).toBe(true);
    expect(Number.isNaN(rows[0][ML_FEATURE_NAMES.indexOf("ema50_200_ratio")])).toBe(true);
    expect(Number.isFinite(rows[249][ML_FEATURE_NAMES.indexOf("ema50_200_ratio")])).toBe(true);
  });
});

describe("predictWithModel (fallbacks honestos, sin inventar probabilidades)", () => {
  const freshness = { freshness: "fresh" as const, fetchedAt: Date.now() };

  it("modelo not_ready → model_not_valid", () => {
    const model = fakeModel({ validityStatus: "not_ready" });
    const res = predictWithModel(flatSeries(500), model, freshness, "TESTUSDT", "1h");
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("model_not_valid");
  });

  it("velas insuficientes → insufficient_candles", () => {
    const res = predictWithModel(flatSeries(100), fakeModel(), freshness, "TESTUSDT", "1h");
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("insufficient_candles");
  });

  it("par símbolo/intervalo erróneo → symbol_interval_mismatch", () => {
    const res = predictWithModel(flatSeries(500), fakeModel(), freshness, "ETHUSDT", "1h");
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("symbol_interval_mismatch");
  });

  it("features no finitos (cierre 0) → invalid_features", () => {
    const candles = flatSeries(400);
    candles[399] = mkCandle(399, 0, 101, 0, 0);
    const res = predictWithModel(candles, fakeModel(), freshness, "TESTUSDT", "1h");
    expect(res.available).toBe(false);
    if (!res.available) expect(res.reason).toBe("invalid_features");
  });

  it("camino feliz: probabilidades suman 1 y dirección = argmax", () => {
    const res = predictWithModel(flatSeries(400), fakeModel(), freshness, "TESTUSDT", "1h");
    expect(res.available).toBe(true);
    if (res.available) {
      const { up, neutral, down } = res.probabilities;
      expect(up + neutral + down).toBeCloseTo(1, 10);
      // Pesos e interceptos nulos → uniforme 1/3 por clase.
      expect(up).toBeCloseTo(1 / 3, 10);
      expect(neutral).toBeCloseTo(1 / 3, 10);
      expect(down).toBeCloseTo(1 / 3, 10);
      expect(["up", "neutral", "down"]).toContain(res.direction);
      expect(res.horizon).toBe(5);
    }
  });

  it("sesgo direccional: pesos/calibración a favor de UP dominan la probabilidad", () => {
    const W = ML_FEATURE_NAMES.length;
    const weights = [
      new Array(W).fill(0),
      new Array(W).fill(0),
      new Array(W).fill(0),
    ];
    weights[2][ML_FEATURE_NAMES.indexOf("body_ratio")] = -100; // feature finita ~0.25 → z_UP ≈ -25 → expit(25) ≈ 1
    const model = fakeModel({
      scorer: {
        type: "platt-decision-ensemble",
        classes: ["DOWN", "NEUTRAL", "UP"],
        folds: [{ weights, intercepts: [0, 0, 0], sigmoidA: [1, 1, 1], sigmoidB: [10, 10, 0] }],
      },
    });
    const res = predictWithModel(flatSeries(400), model, freshness, "TESTUSDT", "1h");
    expect(res.available).toBe(true);
    if (res.available) {
      expect(res.probabilities.up).toBeGreaterThan(res.probabilities.down);
      expect(res.probabilities.up).toBeGreaterThan(0.9);
      expect(res.direction).toBe("up");
    }
  });
});
