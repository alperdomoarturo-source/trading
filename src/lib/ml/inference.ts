/**
 * Inferencia ML en el servidor (Etapa 4).
 *
 * Carga el JSON ligero exportado por `ml/export_model.py` (entrenamiento
 * offline en la máquina del usuario; Vercel Hobby solo sirve inferencia) y
 * puntúa la fila de características de la última vela cerrada.
 *
 * Principio rector: NUNCA se inventan probabilidades. Si falta el modelo,
 * hay menos velas cerradas que `minCandles`, algún feature no es finito o
 * el modelo está marcado `not_valid`, se devuelve un resultado
 * `available: false` con un motivo legible por máquina.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import type { Candle } from "@/lib/market/types";
import { lastClosedFeatureVector } from "@/lib/ml/features";
import type {
  MlModelFile,
  MlModelMetrics,
  PlattEnsembleScorer,
  PlattFold,
  PredictionResult,
} from "@/lib/ml/types";

export const MODELS_DIR = path.join(process.cwd(), "data", "models");

const cache = new Map<string, MlModelFile | null>();

export function modelFileName(symbol: string, interval: string): string {
  return `model-${symbol.toUpperCase()}-${interval}-v1.json`;
}

function parseModel(raw: string): MlModelFile | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MlModelFile>;
    if (
      parsed.schema !== "ml-model-v2" ||
      !Array.isArray(parsed.featureNames) ||
      !Array.isArray(parsed.labelClasses) ||
      !parsed.scorer ||
      parsed.scorer.type !== "platt-decision-ensemble" ||
      typeof parsed.validityStatus !== "string" ||
      !Number.isInteger(parsed.minCandles) ||
      !Number.isInteger(parsed.horizon)
    ) {
      return null;
    }
    const scorer = parsed.scorer;
    const n = scorer.classes.length;
    if (n < 2 || scorer.folds.length === 0) return null;
    const nFeatures = parsed.featureNames.length;
    for (const fold of scorer.folds) {
      if (
        fold.weights.length !== n ||
        fold.intercepts.length !== n ||
        fold.sigmoidA.length !== n ||
        fold.sigmoidB.length !== n
      ) {
        return null;
      }
      if (fold.weights.some((w) => w.length !== nFeatures)) return null;
    }
    return parsed as MlModelFile;
  } catch {
    return null;
  }
}

/** Carga con caché por proceso; un error de lectura equivale a "no hay modelo". */
export function loadModel(symbol: string, interval: string): MlModelFile | null {
  const key = `${symbol.toUpperCase()}:${interval}`;
  if (cache.has(key)) return cache.get(key) ?? null;
  let model: MlModelFile | null = null;
  try {
    const file = path.join(MODELS_DIR, modelFileName(symbol, interval));
    model = parseModel(readFileSync(file, "utf8"));
  } catch {
    model = null;
  }
  cache.set(key, model);
  return model;
}

/** Solo para tests: vacía la caché en memoria. */
export function clearModelCache(): void {
  cache.clear();
}

function sigmoid(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const z = Math.exp(x);
  return z / (1 + z);
}

/** Puntuación de un pliegue: logits z → Platt por clase expit(-(A·z+B)) → normalizar. */
function scoreFold(fold: PlattFold, x: readonly number[]): number[] | null {
  const n = fold.intercepts.length;
  const scores: number[] = [];
  for (let k = 0; k < n; k++) {
    let z = fold.intercepts[k];
    const w = fold.weights[k];
    for (let j = 0; j < w.length; j++) {
      const v = x[j];
      if (!Number.isFinite(v)) return null;
      z += w[j] * v;
    }
    if (!Number.isFinite(z)) return null;
    scores.push(sigmoid(-(fold.sigmoidA[k] * z + fold.sigmoidB[k])));
  }
  const total = scores.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(total) || total === 0) return scores.map(() => 1 / n);
  return scores.map((s) => s / total);
}

/**
 * Scorer "platt-decision-ensemble": réplica exacta de
 * CalibratedClassifierCV(LogisticRegression multiclase, method="sigmoid", cv=N)
 * de scikit-learn >= 1.6 (calibración de Platt sobre la decision_function,
 * normalizada por pliegue y promediada entre pliegues). Devuelve las
 * probabilidades en el orden de `scorer.classes`.
 */
export function scoreEnsemble(
  scorer: PlattEnsembleScorer,
  features: readonly number[],
): number[] | null {
  const n = scorer.classes.length;
  if (n < 2 || scorer.folds.length === 0) return null;
  const avg = new Array<number>(n).fill(0);
  for (const fold of scorer.folds) {
    if (fold.weights[0]?.length !== features.length) return null;
    const probs = scoreFold(fold, features);
    if (!probs) return null;
    for (let k = 0; k < n; k++) avg[k] += probs[k];
  }
  return avg.map((a) => a / scorer.folds.length);
}

interface FreshnessInput {
  freshness: "fresh" | "stale" | "unknown";
  fetchedAt: number;
}

/** Puntuación pura (sin fs ni red) sobre velas ya obtenidas. */
export function predictWithModel(
  candles: Candle[],
  model: MlModelFile,
  freshness: FreshnessInput,
  symbol: string,
  interval: string,
): PredictionResult {
  if (model.symbol !== symbol.toUpperCase() || model.interval !== interval) {
    return unavailable("symbol_interval_mismatch", "El modelo no corresponde al par símbolo/intervalo pedido.");
  }
  if (model.validityStatus !== "valid") {
    return unavailable(
      "model_not_valid",
      `El modelo exportado tiene validity_status="${model.validityStatus}": no superó al baseline fuera de muestra.`,
    );
  }
  const closed = candles.filter((c) => c.closed);
  if (closed.length < model.minCandles) {
    return unavailable(
      "insufficient_candles",
      `Se requieren ${model.minCandles} velas cerradas y hay ${closed.length}.`,
    );
  }
  const fv = lastClosedFeatureVector(candles);
  if (!fv) {
    return unavailable("invalid_features", "La serie no permite calcular todas las características (faltan datos).");
  }
  const probs = scoreEnsemble(model.scorer, fv.values);
  if (!probs) {
    return unavailable("invalid_features", "El scorer devolvió valores no finitos.");
  }
  const byClass = new Map<string, number>();
  model.scorer.classes.forEach((cls, i) => byClass.set(cls, probs[i]));
  const up = byClass.get("UP") ?? 0;
  const neutral = byClass.get("NEUTRAL") ?? 0;
  const down = byClass.get("DOWN") ?? 0;
  const entries: Array<["up" | "neutral" | "down", number]> = [
    ["up", up],
    ["neutral", neutral],
    ["down", down],
  ];
  const direction = entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0];

  return {
    available: true,
    probabilities: { up, neutral, down },
    direction,
    horizon: model.horizon,
    model: { name: model.name, version: model.version, symbol: model.symbol, interval: model.interval },
    trainedAt: model.trainedAt,
    dataFreshness: {
      freshness: freshness.freshness,
      fetchedAt: freshness.fetchedAt,
      lastClosedCandleTime: closed[closed.length - 1].time,
    },
    validityNote: buildValidityNote(model.metrics),
  };
}

function buildValidityNote(metrics: MlModelMetrics): string {
  const finalTest = metrics.finalTest as Record<string, unknown> | undefined;
  const serving = finalTest?.logistic_calibrated as Record<string, unknown> | undefined;
  const baseline = finalTest?.baseline_momentum as Record<string, unknown> | undefined;
  if (!serving || !baseline) return "Métricas fuera de muestra no disponibles.";
  return (
    `Precisión balanceada fuera de muestra: ${(serving.balancedAccuracy as number).toFixed(3)} ` +
    `frente al baseline ${(baseline.balancedAccuracy as number).toFixed(3)}. ` +
    "Calibración probabilística de Platt (sigmoid). Probabilidades = estimaciones, no garantías."
  );
}

function unavailable(
  reason: Exclude<PredictionResult, { available: true }>["reason"],
  message: string,
): PredictionResult {
  return { available: false, reason, message };
}
