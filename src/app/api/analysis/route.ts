import { getCandles, isValidInterval } from "@/lib/market";
import { computeIndicators } from "@/lib/analysis/indicators";
import { detectRecentPatterns } from "@/lib/analysis/patterns";
import { computeLevels } from "@/lib/analysis/levels";
import { evaluateCurrentSignal } from "@/lib/signals/engine";
import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import { BadRequestError, jsonError, parseInterval, parseLimit, parseSymbol } from "@/lib/validation";


function boundedNumber(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new BadRequestError(`Parámetro fuera de rango (permitido ${min}-${max})`);
  }
  return n;
}

/**
 * GET /api/analysis?symbol=BTCUSDT&interval=1h&limit=500
 * Devuelve velas + indicadores + patrones + niveles + señal explicables.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = parseSymbol(url.searchParams.get("symbol"));
    const interval = parseInterval(url.searchParams.get("interval"));
    if (!isValidInterval(interval)) {
      return jsonError(400, `Intervalo no soportado: ${interval}`);
    }
    const limit = parseLimit(url.searchParams.get("limit"), 500, 1000);
    const signalCfg = {
      ...DEFAULT_CONFIG.signals,
      minScore: boundedNumber(url.searchParams.get("minScore"), DEFAULT_CONFIG.signals.minScore, 10, 95),
      minAdx: boundedNumber(url.searchParams.get("minAdx"), DEFAULT_CONFIG.signals.minAdx, 0, 60),
      horizonCandles: boundedNumber(
        url.searchParams.get("horizon"),
        DEFAULT_CONFIG.signals.horizonCandles,
        1,
        50,
      ),
    };

    const series = await getCandles(symbol, interval, limit);
    const closed = series.candles.filter((c) => c.closed);
    const forming = series.candles.find((c) => !c.closed) ?? null;

    const ind = computeIndicators(series.candles);
    const last = closed.length - 1;
    const patterns = detectRecentPatterns(series.candles, 40);
    const levels = last >= 0 ? computeLevels(closed, last, ind.atr14) : { supports: [], resistances: [] };
    const signal = evaluateCurrentSignal(series.candles, signalCfg, {
      symbol,
      market: "crypto",
      interval,
      freshness: series.meta.freshness,
    });

    const nullify = (arr: number[]): (number | null)[] =>
      arr.map((v) => (Number.isNaN(v) ? null : v));

    return Response.json(
      {
        symbol,
        interval,
        meta: series.meta,
        forming,
        candles: series.candles,
        overlays: {
          ema20: nullify(ind.ema20),
          ema50: nullify(ind.ema50),
          ema200: nullify(ind.ema200),
          bbUpper: nullify(ind.bollinger.upper),
          bbLower: nullify(ind.bollinger.lower),
        },
        indicators: {
          rsi14: nullify(ind.rsi14),
          macdHistogram: nullify(ind.macd.histogram),
          atrPct: nullify(ind.atrPct),
          adx14: nullify(ind.adx14.adx),
          relativeVolume: nullify(ind.relVol20),
        },
        snapshot:
          last >= 0
            ? {
                close: closed[last].close,
                rsi: ind.rsi14[last] ?? null,
                macdHistogram: ind.macd.histogram[last] ?? null,
                atr: ind.atr14[last] ?? null,
                atrPct: ind.atrPct[last] ?? null,
                adx: ind.adx14.adx[last] ?? null,
                ema20: ind.ema20[last] ?? null,
                ema50: ind.ema50[last] ?? null,
                ema200: ind.ema200[last] ?? null,
                relativeVolume: ind.relVol20[last] ?? null,
              }
            : null,
        patterns,
        levels,
        signal,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(502, "Error obteniendo el análisis", err instanceof Error ? err.message : String(err));
  }
}
