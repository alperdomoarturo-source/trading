/**
 * Cono de proyección hipotético (simulación, no promesa de precio futuro).
 *
 * Usa SOLO información que la app ya tiene: la última vela cerrada, el ATR %
 * (volatilidad observada) y las probabilidades del modelo ML calibrado.
 * La trayectoria central deriva dir × ATR × margen por vela; las bandas
 * crecen ±ATR·√k (escalamiento raíz del tiempo). Todo se etiqueta como
 * escenario: nada aquí es un precio "previsto" con garantía.
 */

import type { PredictionProbabilities } from "@/lib/ml/types";

export interface ProjectionPoint {
  /** Epoch ms de la vela hipotética k. */
  time: number;
  mid: number;
  upper: number;
  lower: number;
}

export type ProjectionScenario = "up" | "down" | "range";

export interface Projection {
  scenario: ProjectionScenario;
  /** Probabilidad top menos la segunda (0..1): el margen del modelo. */
  edge: number;
  horizon: number;
  points: ProjectionPoint[];
  /** Movimiento relativo esperado de la trayectoria central, en %. */
  expectedMovePercent: number;
  /** Banda ± superior al final del horizonte, en % respecto al cierre. */
  bandPercentAtHorizon: number;
}

export function buildProjection(input: {
  lastClosedTime: number;
  close: number;
  atrPct: number | null;
  intervalMs: number;
  probabilities: PredictionProbabilities | null;
  horizon: number;
}): Projection | null {
  const { lastClosedTime, close, atrPct, intervalMs, probabilities, horizon } = input;
  if (!Number.isFinite(lastClosedTime) || !Number.isFinite(close) || close <= 0) return null;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  if (!Number.isInteger(horizon) || horizon < 1) return null;
  if (atrPct === null || !Number.isFinite(atrPct) || atrPct <= 0) return null;
  if (!probabilities) return null;

  const sorted = Object.entries(probabilities)
    .filter(([, p]) => Number.isFinite(p))
    .sort((a, b) => b[1] - a[1]);
  if (sorted.length < 3) return null;

  const [topKey, topP] = sorted[0];
  const edge = Math.max(0, topP - sorted[1][1]);
  const scenario: ProjectionScenario = topKey === "up" ? "up" : topKey === "down" ? "down" : "range";
  const dir = scenario === "up" ? 1 : scenario === "down" ? -1 : 0;

  const vol = atrPct / 100;
  const stepPerCandle = dir * vol * edge;

  const points: ProjectionPoint[] = [
    { time: lastClosedTime, mid: close, upper: close, lower: close },
  ];
  for (let k = 1; k <= horizon; k++) {
    const mid = close * Math.pow(1 + stepPerCandle, k);
    const band = vol * Math.sqrt(k);
    points.push({
      time: lastClosedTime + intervalMs * k,
      mid,
      upper: mid * (1 + band),
      lower: mid * (1 - band),
    });
  }

  const last = points[points.length - 1];
  return {
    scenario,
    edge,
    horizon,
    points,
    expectedMovePercent: (last.mid / close - 1) * 100,
    bandPercentAtHorizon: (last.upper / close - 1) * 100,
  };
}
