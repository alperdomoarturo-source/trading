/**
 * Ventana temporal estimada de una tendencia.
 *
 * No adivina el futuro: mide, en las velas cerradas que la app ya tiene,
 * cuánto duran las rachas en la dirección del veredicto (mediana y rango
 * intercuartílico) y compara con la racha en curso. El resultado es una
 * ventana estadística, no una fecha de término.
 */

import type { Candle } from "@/lib/market/types";

export type TrendDirection = "up" | "down";

export interface TrendDurationEstimate {
  direction: TrendDirection;
  intervalMs: number;
  candlesAnalysed: number;
  /** Velas consecutivas ya en la dirección, contando desde la última cerrada. */
  streakCandles: number;
  /** Rachas en esa dirección medidas en la ventana analizada. */
  runsAnalysed: number;
  medianRunCandles: number;
  /** P25–P75 de la duración total de las rachas (velas). */
  typicalRunRangeCandles: [number, number];
  /** Ventana restante estimada: p25 y p75 menos la racha actual (≥0). */
  remainingCandles: [number, number];
  remainingMs: [number, number];
  /** Fracción de rachas históricas que duraron ≤ la racha actual (0..1). */
  exhaustedShare: number;
  /** La racha actual ya igualó o superó la duración típica. */
  streakAlreadyTypical: boolean;
  horizonCandles: number | null;
  /** El extremo superior de la ventana excede lo que el modelo ML evalúa. */
  beyondHorizon: boolean;
  /** Epoch ms de apertura de la última vela cerrada (ancla para fechas). */
  anchorClosedTime: number;
}

const MIN_CLOSED_CANDLES = 60;
const MIN_RUNS = 8;

function quantile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

/**
 * Racha en curso + distribución de rachas pasadas en la dirección pedida.
 * Devuelve null si faltan velas o si la muestra de rachas es demasiado corta
 * para hablar de duraciones sin inventar.
 */
export function estimateTrendDuration(input: {
  candles: Candle[];
  direction: TrendDirection;
  intervalMs: number;
  horizonCandles?: number | null;
}): TrendDurationEstimate | null {
  const { direction, intervalMs, horizonCandles = null } = input;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const closed = (input.candles ?? []).filter(
    (c) => c.closed && Number.isFinite(c.close) && Number.isFinite(c.time),
  );
  if (closed.length < MIN_CLOSED_CANDLES) return null;

  const signs: number[] = [];
  for (let i = 1; i < closed.length; i++) {
    const diff = closed[i].close - closed[i - 1].close;
    signs.push(diff > 0 ? 1 : diff < 0 ? -1 : 0);
  }
  const want = direction === "up" ? 1 : -1;

  let streak = 0;
  for (let i = signs.length - 1; i >= 0; i--) {
    if (signs[i] === want) streak++;
    else break;
  }

  const runs: number[] = [];
  let current = 0;
  for (const s of signs) {
    if (s === want) current++;
    else {
      if (current > 0) runs.push(current);
      current = 0;
    }
  }
  if (current > 0) runs.push(current);
  if (runs.length < MIN_RUNS) return null;

  const sorted = [...runs].sort((a, b) => a - b);
  const p25 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const p75 = quantile(sorted, 0.75);
  const remaining: [number, number] = [Math.max(0, p25 - streak), Math.max(0, p75 - streak)];
  const exhaustedShare = runs.filter((r) => r <= streak).length / runs.length;

  return {
    direction,
    intervalMs,
    candlesAnalysed: closed.length,
    streakCandles: streak,
    runsAnalysed: runs.length,
    medianRunCandles: median,
    typicalRunRangeCandles: [p25, p75],
    remainingCandles: remaining,
    remainingMs: [remaining[0] * intervalMs, remaining[1] * intervalMs],
    exhaustedShare,
    streakAlreadyTypical: streak >= p75,
    horizonCandles,
    beyondHorizon: remaining[1] > (horizonCandles ?? remaining[1]),
    anchorClosedTime: closed[closed.length - 1].time,
  };
}
