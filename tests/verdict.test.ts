import { describe, expect, it } from "vitest";
import { decideVerdict, MILD_EDGE, OBSERVATIONAL_EDGE } from "@/lib/signals/verdict";

const probs = (up: number, neutral: number, down: number) => ({ up, neutral, down });

describe("decideVerdict", () => {
  it("da prioridad a la señal confirmada por el motor de reglas", () => {
    const v = decideVerdict({ signalKind: "BUY", score: 72, probabilities: probs(0.3, 0.4, 0.3) });
    expect(v.tier).toBe("rule_signal");
    expect(v.label).toBe("SEÑAL: COMPRAR");
    expect(v.direction).toBe("up");
    expect(v.detail).toContain("72");
  });

  it("sube a nivel observacional sólo con margen >= 8 puntos", () => {
    const mild = decideVerdict({ signalKind: "NONE", probabilities: probs(0.34, 0.36, 0.3) });
    expect(mild.tier).toBe("ml_mild");
    const strong = decideVerdict({ signalKind: "NONE", probabilities: probs(0.42, 0.28, 0.3) });
    expect(strong.tier).toBe("ml_observational");
    expect(strong.tone).toBe("up");
    expect(strong.direction).toBe("up");
  });

  it("bajada: invierte el tono y la dirección", () => {
    const v = decideVerdict({ signalKind: "WAIT", probabilities: probs(0.3, 0.3, 0.45) });
    expect(v.tier).toBe("ml_observational");
    expect(v.label).toBe("VENTA OBSERVACIONAL");
    expect(v.direction).toBe("down");
  });

  it("el umbral observacional es exactamente 8 puntos", () => {
    expect(OBSERVATIONAL_EDGE).toBe(0.08);
    expect(MILD_EDGE).toBe(0.01);
    // margen justo de 0.08 (0.40 vs 0.32) cae en observacional
    expect(decideVerdict({ signalKind: "NONE", probabilities: probs(0.4, 0.28, 0.32) }).tier).toBe(
      "ml_observational",
    );
    // 0.07 de margen se queda en tendencia leve
    expect(decideVerdict({ signalKind: "NONE", probabilities: probs(0.39, 0.29, 0.32) }).tier).toBe("ml_mild");
    // y el detalle avisa que puede ser ruido
    const mild = decideVerdict({ signalKind: "NONE", probabilities: probs(0.3 + MILD_EDGE, 0.35, 0.35 - MILD_EDGE) });
    expect(mild.tier).toBe("ml_mild");
    expect(mild.detail).toContain("ruido plausible");
  });

  it("empate técnico: neutral y sin dirección que cronometrar", () => {
    const v = decideVerdict({ signalKind: "NONE", probabilities: probs(0.34, 0.33, 0.331) });
    expect(v.tier).toBe("ml_tie");
    expect(v.tone).toBe("neutral");
    expect(v.direction).toBeNull();
  });

  it("sin modelo ML explica el motivo recibido", () => {
    const v = decideVerdict({
      signalKind: "NONE",
      probabilities: null,
      mlMessage: "Sin modelo ML entrenado para ADAUSDT 1h.",
    });
    expect(v.tier).toBe("no_model");
    expect(v.direction).toBeNull();
    expect(v.detail).toContain("ADAUSDT");
  });

  it("sin datos o con error no inventa veredicto", () => {
    expect(decideVerdict({ signalKind: "DATA_ERROR", probabilities: null }).label).toBe("SIN DATOS");
    const insufficient = decideVerdict({ signalKind: "INSUFFICIENT_DATA", probabilities: null });
    expect(insufficient.tier).toBe("no_data");
    expect(insufficient.direction).toBeNull();
  });
});
