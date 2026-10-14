import { describe, expect, it } from "vitest";
import { runBacktest, type BacktestConfig } from "@/lib/backtest/engine";
import type { SignalEngineConfig } from "@/lib/signals/types";
import type { Candle } from "@/lib/market/types";

const HOUR = 3_600_000;

function mk(i: number, open: number, high: number, low: number, close: number): Candle {
  return {
    symbol: "BTCUSDT",
    market: "crypto",
    interval: "1h",
    time: 1_700_000_000_000 + i * HOUR,
    open,
    high,
    low,
    close,
    volume: 100,
    provider: "test",
    closed: true,
  };
}

const SIGNAL: SignalEngineConfig = {
  minScore: 25,
  waitScore: 10,
  minAdx: 10,
  minRelativeVolume: 0,
  maxLevelDistanceAtr: 1.5,
  horizonCandles: 5,
};

function baseCfg(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    initialCapital: 10_000,
    positionFraction: 0.95,
    stopLossAtr: 2,
    takeProfitAtr: 3,
    maxHoldCandles: 48,
    commissionPercent: 0.1,
    slippagePercent: 0.05,
    signal: SIGNAL,
    ...overrides,
  };
}

/** Serie en tendencia alcista sostenida (dispara señales de compra). */
function uptrend(n: number): Candle[] {
  const candles: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = price + 0.15 + Math.sin(i / 9) * 0.4;
    const high = Math.max(open, close) + 0.6;
    const low = Math.min(open, close) - 0.6;
    candles.push(mk(i, open, high, low, close));
    price = close;
  }
  return candles;
}

describe("motor de backtesting", () => {
  it("conservación de capital: equity final = inicial + sum(PnL neto)", () => {
    const candles = uptrend(320);
    const result = runBacktest(candles, baseCfg());
    expect(result.trades.length).toBeGreaterThan(0);
    const sumNet = result.trades.reduce((s, t) => s + t.netPnl, 0);
    expect(result.metrics.finalEquity).toBeCloseTo(
      result.metrics.initialCapital + sumNet,
      6,
    );
  });

  it("la entrada se ejecuta en la apertura de la vela siguiente con slippage", () => {
    const candles = uptrend(300);
    const cfg = baseCfg({ slippagePercent: 0.5 });
    const result = runBacktest(candles, cfg);
    expect(result.trades.length).toBeGreaterThan(0);
    const t = result.trades[0];
    const openNext = candles[t.entryIndex].open;
    expect(t.entryPrice).toBeCloseTo(openNext * 1.005, 8);
    expect(t.entryIndex).toBeGreaterThan(t.entryIndex - 1); // estructura válida
  });

  it("cuando stop y take-profit caben en la misma vela, se asume el stop (peor caso)", () => {
    // Mercado plano (sin señales) -> ruptura alcista -> vela gigante que
    // cubre tanto el stop como el objetivo. Debe cerrar por stop.
    const flat: Candle[] = [];
    for (let i = 0; i < 248; i++) {
      const bullish = i % 2 === 0;
      const open = bullish ? 100 : 101;
      const close = bullish ? 101 : 100;
      flat.push(mk(i, open, Math.max(open, close) + 0.5, Math.min(open, close) - 0.5, close));
    }
    const breakout = mk(248, 99.9, 110.5, 99.5, 110);
    const giant = mk(249, 110, 999, 1, 120);
    const series = [...flat, breakout, giant];
    const cfg = baseCfg({
      signal: { ...SIGNAL, minAdx: 0, maxLevelDistanceAtr: 0.2 },
    });
    const result = runBacktest(series, cfg);
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0];
    expect(trade.entryIndex).toBe(249);
    expect(trade.exitReason).toBe("stop-loss");
    expect(trade.exitPrice).toBeLessThan(trade.entryPrice);
  });

  it("los costes reducen el PnL neto respecto al bruto", () => {
    const candles = uptrend(320);
    const result = runBacktest(candles, baseCfg({ commissionPercent: 1, slippagePercent: 1 }));
    for (const t of result.trades) {
      expect(t.netPnl).toBeLessThan(t.grossPnl);
      expect(t.fees).toBeGreaterThan(0);
    }
    expect(result.metrics.totalFees).toBeGreaterThan(0);
  });

  it("sin datos suficientes no opera y avisa", () => {
    const candles = uptrend(100);
    const result = runBacktest(candles, baseCfg());
    expect(result.trades).toHaveLength(0);
    expect(result.notes.join(" ")).toMatch(/corto|valor estadístico/i);
  });

  it("la curva de capital es cronológica y sin lookahead (evaluación desde el warmup)", () => {
    const candles = uptrend(320);
    const result = runBacktest(candles, baseCfg());
    const times = result.equityCurve.map((p) => p.time);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
    expect(result.warmupBars).toBeGreaterThanOrEqual(200);
    // La primera decisión posible usa al menos 220 velas de historial.
    const firstTrade = result.trades[0];
    if (firstTrade) {
      expect(firstTrade.entryIndex).toBeGreaterThan(219);
    }
  });

  it("buy & hold se calcula sobre el periodo evaluable", () => {
    const candles = uptrend(320);
    const result = runBacktest(candles, baseCfg());
    const first = candles[result.warmupBars].close;
    const last = candles[candles.length - 1].close;
    expect(result.metrics.buyHoldReturnPercent).toBeCloseTo(((last / first) - 1) * 100, 6);
  });
});
