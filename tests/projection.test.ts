import { describe, expect, it } from "vitest";
import { buildProjection } from "@/lib/simulation/projection";

const BASE = {
  lastClosedTime: 1_700_000_000_000,
  close: 100,
  atrPct: 2,
  intervalMs: 3_600_000,
  horizon: 5,
};

describe("buildProjection (cono hipotético basado en ML + ATR)", () => {
  it("rechaza entradas inválidas sin inventar escenarios", () => {
    expect(buildProjection({ ...BASE, probabilities: null })).toBeNull();
    expect(buildProjection({ ...BASE, probabilities: null, atrPct: null })).toBeNull();
    expect(buildProjection({ ...BASE, probabilities: null, atrPct: 0 })).toBeNull();
    expect(buildProjection({ ...BASE, close: -5, probabilities: { up: 0.5, neutral: 0.3, down: 0.2 } })).toBeNull();
    expect(
      buildProjection({ ...BASE, horizon: 0, probabilities: { up: 0.5, neutral: 0.3, down: 0.2 } }),
    ).toBeNull();
  });

  it("sesgo alcista: trayectoria central creciente y bandas simétricas alrededor", () => {
    const p = buildProjection({
      ...BASE,
      probabilities: { up: 0.55, neutral: 0.25, down: 0.2 },
    })!;
    expect(p.scenario).toBe("up");
    expect(p.edge).toBeCloseTo(0.3, 10);
    expect(p.points.length).toBe(BASE.horizon + 1);
    expect(p.points[0].mid).toBe(BASE.close);
    expect(p.expectedMovePercent).toBeGreaterThan(0);
    for (let k = 1; k <= BASE.horizon; k++) {
      const pt = p.points[k];
      expect(pt.mid).toBeGreaterThan(p.points[k - 1].mid);
      expect(pt.lower).toBeLessThan(pt.mid);
      expect(pt.upper).toBeGreaterThan(pt.mid);
      expect(pt.time).toBe(BASE.lastClosedTime + BASE.intervalMs * k);
      // banda = ATR·√k relativa al mid
      expect(pt.upper / pt.mid - 1).toBeCloseTo((BASE.atrPct / 100) * Math.sqrt(k), 10);
    }
  });

  it("sesgo bajista: trayectoria central decreciente", () => {
    const p = buildProjection({
      ...BASE,
      probabilities: { up: 0.2, neutral: 0.2, down: 0.6 },
    })!;
    expect(p.scenario).toBe("down");
    expect(p.expectedMovePercent).toBeLessThan(0);
    expect(p.points[BASE.horizon].mid).toBeLessThan(BASE.close);
  });

  it("neutro arriba: escenario lateral con deriva cero", () => {
    const p = buildProjection({
      ...BASE,
      probabilities: { up: 0.3, neutral: 0.45, down: 0.25 },
    })!;
    expect(p.scenario).toBe("range");
    expect(p.expectedMovePercent).toBeCloseTo(0, 10);
    // el cono de volatilidad sigue abierto: no se niega la incertidumbre
    expect(p.points[BASE.horizon].upper).toBeGreaterThan(BASE.close);
    expect(p.points[BASE.horizon].lower).toBeLessThan(BASE.close);
  });

  it("margen mínimo: con edge 0 la deriva es 0 aunque el top sea up", () => {
    const p = buildProjection({
      ...BASE,
      probabilities: { up: 0.34, neutral: 0.33, down: 0.33 },
    })!;
    expect(p.scenario).toBe("up");
    expect(p.edge).toBeCloseTo(0.01, 10);
    expect(p.expectedMovePercent).toBeGreaterThan(0);
    expect(p.expectedMovePercent).toBeLessThan(1);
  });

  it("rechaza probabilidades no finitas", () => {
    expect(
      buildProjection({ ...BASE, probabilities: { up: NaN, neutral: 0.5, down: 0.5 } }),
    ).toBeNull();
  });
});
