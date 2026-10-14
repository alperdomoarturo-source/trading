/**
 * Veredicto direccional de un par: una sola fuente de verdad para los
 * umbrales, tanto en la tarjeta "Plan de acción" como en el panel de activos
 * vigilados y el centro de señales.
 *
 * Los niveles van del caso confirmadas (motor de reglas) al sesgo pequeño del
 * modelo ML, y cada uno se etiqueta con su propia fuerza: un margen fino del
 * ML nunca se presenta como señal operativa.
 */

import type { PredictionProbabilities } from "@/lib/ml/types";
import type { SignalKind } from "./types";

/** Margen (P top − P segunda) a partir del cual el ML merece nivel observacional. */
export const OBSERVATIONAL_EDGE = 0.08;
/** Margen mínimo para hablar de tendencia leve. Por debajo, empate técnico. */
export const MILD_EDGE = 0.01;

export type VerdictTier =
  | "rule_signal"
  | "ml_observational"
  | "ml_mild"
  | "ml_tie"
  | "no_model"
  | "no_data";

export interface Verdict {
  tier: VerdictTier;
  tone: "up" | "down" | "neutral";
  /** Etiqueta corta, igual en lista y en detalle. */
  label: string;
  /** Una frase con los números que sustentan la etiqueta. */
  detail: string;
  /** Dirección que se puede cronometrar (null sin tendencia). */
  direction: "up" | "down" | null;
}

const pct = (x: number) => Math.round(x * 100);

export function decideVerdict(input: {
  signalKind: SignalKind;
  score?: number;
  probabilities: PredictionProbabilities | null;
  /** Mensaje del /api/prediction cuando available=false (motivo honesto). */
  mlMessage?: string | null;
}): Verdict {
  const { signalKind, score, probabilities, mlMessage } = input;

  if (signalKind === "INSUFFICIENT_DATA" || signalKind === "DATA_ERROR") {
    return {
      tier: "no_data",
      tone: "neutral",
      label: signalKind === "INSUFFICIENT_DATA" ? "SIN DATOS SUFICIENTES" : "SIN DATOS",
      detail:
        signalKind === "INSUFFICIENT_DATA"
          ? "Faltan velas cerradas para evaluar (se necesitan 220+)."
          : "No se pudieron obtener datos del proveedor.",
      direction: null,
    };
  }

  if (signalKind === "BUY") {
    return {
      tier: "rule_signal",
      tone: "up",
      label: "SEÑAL: COMPRAR",
      detail: `Confluencia del motor de reglas${score !== undefined ? ` (score ${score})` : ""}; el ML no la desmiente.`,
      direction: "up",
    };
  }
  if (signalKind === "SELL") {
    return {
      tier: "rule_signal",
      tone: "down",
      label: "SEÑAL: VENDER",
      detail: `Confluencia del motor de reglas${score !== undefined ? ` (score ${score})` : ""}; el ML no la desmiente.`,
      direction: "down",
    };
  }

  if (!probabilities) {
    return {
      tier: "no_model",
      tone: "neutral",
      label: "ESPERAR — sin modelo ML",
      detail: mlMessage ?? "Las reglas no alcanzan umbral y no hay modelo ML para este par/intervalo.",
      direction: null,
    };
  }

  const { up, down } = probabilities;
  const diff = up - down;
  const edge = Math.abs(diff);
  const numbers = `P↑ ${pct(up)} % vs P↓ ${pct(down)} % (margen ${pct(edge)} pts)`;

  if (edge >= OBSERVATIONAL_EDGE) {
    return {
      tier: "ml_observational",
      tone: diff > 0 ? "up" : "down",
      label: diff > 0 ? "COMPRA OBSERVACIONAL" : "VENTA OBSERVACIONAL",
      detail: `Solo el modelo ML inclina la balanza (${numbers}); el motor de reglas NO confirma, así que no es señal operativa.`,
      direction: diff > 0 ? "up" : "down",
    };
  }
  if (edge >= MILD_EDGE) {
    return {
      tier: "ml_mild",
      tone: diff > 0 ? "up" : "down",
      label: diff > 0 ? "TENDENCIA LEVE A COMPRAR" : "TENDENCIA LEVE A VENDER",
      detail: `El ML favorece levemente ${diff > 0 ? "la subida" : "la bajada"} (${numbers}). Con precisión fuera de muestra ~0.38, ese margen es ruido plausible: solo observación.`,
      direction: diff > 0 ? "up" : "down",
    };
  }
  return {
    tier: "ml_tie",
    tone: "neutral",
    label: "ESPERAR (empate ML)",
    detail: `El ML está prácticamente empatado (${numbers}) y las reglas no confirman dirección.`,
    direction: null,
  };
}
