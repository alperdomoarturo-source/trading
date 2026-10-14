import { getHistoricalCandles, isValidInterval } from "@/lib/market";
import { runBacktest } from "@/lib/backtest/engine";
import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import { BadRequestError, jsonError, parseInterval, parseSymbol } from "@/lib/validation";

export const maxDuration = 60;

interface BacktestRequest {
  symbol?: string;
  interval?: string;
  days?: number;
  initialCapital?: number;
  positionFraction?: number;
  stopLossAtr?: number;
  takeProfitAtr?: number;
  maxHoldCandles?: number;
  commissionPercent?: number;
  slippagePercent?: number;
  minScore?: number;
  minAdx?: number;
}

function bounded(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new BadRequestError(`Parámetro fuera de rango (permitido ${min}-${max})`);
  }
  return n;
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  const out: T[] = [];
  for (let i = 0; i < arr.length; i += step) out.push(arr[i]);
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1]);
  return out;
}

/** POST /api/backtest — ejecuta un backtest sobre datos históricos reales. */
export async function POST(request: Request) {
  try {
    let body: BacktestRequest;
    try {
      body = (await request.json()) as BacktestRequest;
    } catch {
      return jsonError(400, "Cuerpo JSON inválido");
    }
    if (!body.symbol) return jsonError(400, "Falta symbol");
    const symbol = parseSymbol(body.symbol);
    const interval = parseInterval(body.interval ?? null, DEFAULT_CONFIG.defaultInterval);
    if (!isValidInterval(interval)) {
      return jsonError(400, `Intervalo no soportado: ${interval}`);
    }
    const days = bounded(body.days, DEFAULT_CONFIG.signals.backtestDays, 7, 730);
    const cfg = {
      initialCapital: bounded(body.initialCapital, DEFAULT_CONFIG.backtest.initialCapital, 100, 10_000_000),
      positionFraction: bounded(body.positionFraction, DEFAULT_CONFIG.backtest.positionFraction, 0.05, 1),
      stopLossAtr: bounded(body.stopLossAtr, DEFAULT_CONFIG.backtest.stopLossAtr, 0.5, 10),
      takeProfitAtr: bounded(body.takeProfitAtr, DEFAULT_CONFIG.backtest.takeProfitAtr, 0.5, 20),
      maxHoldCandles: Math.round(bounded(body.maxHoldCandles, DEFAULT_CONFIG.backtest.maxHoldCandles, 2, 500)),
      commissionPercent: bounded(body.commissionPercent, DEFAULT_CONFIG.costs.commissionPercent, 0, 2),
      slippagePercent: bounded(body.slippagePercent, DEFAULT_CONFIG.costs.slippagePercent, 0, 2),
      signal: {
        ...DEFAULT_CONFIG.signals,
        minScore: bounded(body.minScore, DEFAULT_CONFIG.signals.minScore, 10, 95),
        minAdx: bounded(body.minAdx, DEFAULT_CONFIG.signals.minAdx, 0, 60),
      },
    };

    const series = await getHistoricalCandles(symbol, interval, days);
    const closed = series.candles.filter((c) => c.closed);
    if (closed.length < 250) {
      return Response.json(
        {
          error: "Datos insuficientes para el backtest",
          details: `Solo hay ${closed.length} velas cerradas para ${symbol} en ${interval} durante ${days} días. Prueba un periodo más largo o un intervalo menor.`,
          meta: series.meta,
        },
        { status: 422 },
      );
    }

    const result = runBacktest(closed, cfg);

    return Response.json(
      {
        symbol,
        interval,
        days,
        config: cfg,
        meta: { ...series.meta, warnings: [...series.meta.warnings, ...result.notes] },
        metrics: result.metrics,
        dataRange: result.dataRange,
        warmupBars: result.warmupBars,
        equityCurve: downsample(result.equityCurve, 400),
        trades: downsample(result.trades, 300),
        tradeCount: result.trades.length,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(502, "Error ejecutando el backtest", err instanceof Error ? err.message : String(err));
  }
}
