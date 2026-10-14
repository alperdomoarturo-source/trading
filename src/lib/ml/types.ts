/** Tipos compartidos del motor de predicción ML (Etapa 4). */

import type { Freshness } from "@/lib/market/types";

/** Nombres de las 26 características canónicas; el orden define el vector. */
export type MlFeatureName =
  | "ret_1"
  | "ret_3"
  | "ret_5"
  | "ret_10"
  | "ema20_ratio"
  | "ema20_50_ratio"
  | "ema50_200_ratio"
  | "rsi_14"
  | "macd_hist_norm"
  | "bb_pctb"
  | "atr_pct"
  | "adx_14"
  | "plus_di_14"
  | "minus_di_14"
  | "obv_slope_10"
  | "rel_vol_20"
  | "range_pos_20"
  | "body_ratio"
  | "up_wick_ratio"
  | "low_wick_ratio"
  | "pat_bull_engulfing"
  | "pat_bear_engulfing"
  | "pat_hammer"
  | "pat_doji"
  | "pat_morning_star"
  | "pat_evening_star";

export const CLASS_DOWN = "DOWN";
export const CLASS_NEUTRAL = "NEUTRAL";
export const CLASS_UP = "UP";

/** Un pliegue del ensemble: coeficientes crudos + calibración Platt por clase. */
export interface PlattFold {
  /** weights[k]·x + intercepts[k] = logito decision_function z_k de la clase k. */
  weights: number[][];
  intercepts: number[];
  /** Calibración Platt sobre el logito: expit(-(A_k · z_k + B_k)) (signo de sklearn). */
  sigmoidA: number[];
  sigmoidB: number[];
}

/**
 * Formato exportado por ml/export_model.py — único scorer soportado en JS.
 * Réplica de CalibratedClassifierCV(LogisticRegression multiclase,
 * method="sigmoid", cv=N) en scikit-learn >= 1.6: por pliegue se toma la
 * decision_function (logits z), se aplica Platt por clase
 * (sigmoid(A·z + B)), se normaliza, y predict_proba promedia los pliegues.
 */
export interface PlattEnsembleScorer {
  type: "platt-decision-ensemble";
  /** Etiquetas por posición de probabilidad, p. ej. ["DOWN","NEUTRAL","UP"]. */
  classes: string[];
  folds: PlattFold[];
}

export interface MlModelMetrics {
  walkForward?: Record<string, unknown>;
  finalTest?: Record<string, unknown>;
  selectedModel?: string;
  [key: string]: unknown;
}

export interface MlModelFile {
  schema: "ml-model-v2";
  name: string;
  version: number;
  symbol: string;
  interval: string;
  /** Epoch ms de entrenamiento (offline, en la máquina del usuario). */
  trainedAt: number;
  horizon: number;
  labelClasses: string[];
  featureNames: MlFeatureName[];
  /** Velas cerradas mínimas para poder puntuar. */
  minCandles: number;
  scorer: PlattEnsembleScorer;
  threshold: { k: number; minMovePct: number };
  dataWindow: {
    candlesClosed: number;
    nSamples: number;
    fromMs: number;
    toMs: number;
    source: string;
  };
  metrics: MlModelMetrics;
  /** "valid" solo si el modelo superó al baseline out-of-sample. */
  validityStatus: "valid" | "not_ready";
  notes: string[];
}

export type PredictionDirection = "up" | "neutral" | "down";

export interface PredictionProbabilities {
  up: number;
  neutral: number;
  down: number;
}

/** Motivos legibles por máquina por los que no hay predicción. */
export type PredictionUnavailableReason =
  | "model_missing"
  | "insufficient_candles"
  | "invalid_features"
  | "model_not_valid"
  | "symbol_interval_mismatch";

export type PredictionResult =
  | {
      available: true;
      probabilities: PredictionProbabilities;
      direction: PredictionDirection;
      horizon: number;
      model: { name: string; version: number; symbol: string; interval: string };
      trainedAt: number;
      dataFreshness: {
        freshness: Freshness;
        fetchedAt: number;
        lastClosedCandleTime: number;
      };
      validityNote: string;
    }
  | { available: false; reason: PredictionUnavailableReason; message: string };
