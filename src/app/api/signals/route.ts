import { getCandles, isValidInterval } from "@/lib/market";
import { INTERVAL_MS } from "@/lib/market/types";
import { evaluateCurrentSignal } from "@/lib/signals/engine";
import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import { BadRequestError, jsonError, parseInterval, parseSymbol } from "@/lib/validation";
import { SIGNAL_LABELS } from "@/lib/signals/types";
import { decideVerdict } from "@/lib/signals/verdict";
import { estimateTrendDuration } from "@/lib/simulation/duration";
import { loadModel, predictWithModel } from "@/lib/ml/inference";
import type { PredictionProbabilities } from "@/lib/ml/types";
import type { SymbolOverview } from "@/lib/client/api-types";

const MAX_SYMBOLS = 10;

/**
 * GET /api/signals?symbols=BTCUSDT,ETHUSDT&interval=1h
 * Señal explicables + veredicto direccional (reglas y/o ML) + ventana temporal
 * estimada de la tendencia, para cada símbolo de la vigilancia.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const interval = parseInterval(url.searchParams.get("interval"), DEFAULT_CONFIG.defaultInterval);
    if (!isValidInterval(interval)) {
      return jsonError(400, `Intervalo no soportado: ${interval}`);
    }
    const rawSymbols = url.searchParams.get("symbols");
    const symbols = rawSymbols
      ? rawSymbols.split(",").map(parseSymbol).slice(0, MAX_SYMBOLS)
      : DEFAULT_CONFIG.watchlist.slice(0, MAX_SYMBOLS);

    const results = await Promise.allSettled(
      symbols.map(async (symbol): Promise<SymbolOverview> => {
        const series = await getCandles(symbol, interval, 500);
        const signal = evaluateCurrentSignal(series.candles, DEFAULT_CONFIG.signals, {
          symbol,
          market: "crypto",
          interval,
          freshness: series.meta.freshness,
        });

        let probabilities: PredictionProbabilities | null = null;
        let horizon: number | null = null;
        let mlMessage: string | null = null;
        const model = loadModel(symbol, interval);
        if (!model) {
          mlMessage = `Sin modelo ML entrenado para ${symbol} ${interval}; entrena con ml/train.py.`;
        } else if (model.validityStatus !== "valid") {
          mlMessage = `El modelo de ${symbol} ${interval} no superó al baseline fuera de muestra (${model.validityStatus}).`;
        } else {
          const result = predictWithModel(
            series.candles,
            model,
            { freshness: series.meta.freshness, fetchedAt: series.meta.fetchedAt },
            symbol,
            interval,
          );
          if (result.available) {
            probabilities = result.probabilities;
            horizon = result.horizon;
          } else {
            mlMessage = result.message;
          }
        }

        const verdict = decideVerdict({
          signalKind: signal.kind,
          score: signal.score,
          probabilities,
          mlMessage,
        });
        const intervalMs = INTERVAL_MS[interval] ?? 3_600_000;
        const trendWindow = verdict.direction
          ? estimateTrendDuration({
              candles: series.candles,
              direction: verdict.direction,
              intervalMs,
              horizonCandles: horizon,
            })
          : null;

        return {
          symbol,
          label: SIGNAL_LABELS[signal.kind],
          signal,
          verdict,
          prediction: probabilities && horizon !== null ? { probabilities, horizon } : null,
          trendWindow,
        };
      }),
    );

    const signals: SymbolOverview[] = results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : {
            symbol: symbols[i],
            label: SIGNAL_LABELS.DATA_ERROR,
            signal: {
              kind: "DATA_ERROR" as const,
              direction: null,
              symbol: symbols[i],
              market: "crypto" as const,
              interval,
              generatedAt: Date.now(),
              candleTime: 0,
              priceRef: 0,
              horizonCandles: DEFAULT_CONFIG.signals.horizonCandles,
              score: 0,
              bullScore: 0,
              bearScore: 0,
              reasons: [
                {
                  text: `No se pudieron obtener datos: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`,
                  weight: 0,
                },
              ],
              freshness: "unknown" as const,
              warnings: [],
              validUntil: 0,
            },
            verdict: decideVerdict({ signalKind: "DATA_ERROR", probabilities: null }),
            prediction: null,
            trendWindow: null,
          },
    );

    return Response.json(
      { interval, generatedAt: Date.now(), signals },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(500, "Error generando señales", err instanceof Error ? err.message : String(err));
  }
}
