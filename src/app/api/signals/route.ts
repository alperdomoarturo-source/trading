import { getCandles, isValidInterval } from "@/lib/market";
import { evaluateCurrentSignal } from "@/lib/signals/engine";
import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import { BadRequestError, jsonError, parseInterval, parseSymbol } from "@/lib/validation";
import { SIGNAL_LABELS } from "@/lib/signals/types";


const MAX_SYMBOLS = 10;

/**
 * GET /api/signals?symbols=BTCUSDT,ETHUSDT&interval=1h
 * Señal explicables actual para cada símbolo. Sin symbols, usa la vigilancia
 * por defecto.
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
      symbols.map(async (symbol) => {
        const series = await getCandles(symbol, interval, 500);
        const signal = evaluateCurrentSignal(series.candles, DEFAULT_CONFIG.signals, {
          symbol,
          market: "crypto",
          interval,
          freshness: series.meta.freshness,
        });
        return { symbol, label: SIGNAL_LABELS[signal.kind], signal };
      }),
    );

    const signals = results.map((r, i) =>
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
