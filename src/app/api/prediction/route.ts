/**
 * GET /api/prediction?symbol=BTCUSDT&interval=1h
 * Predicción probabilística del modelo ML exportado (inferencia ligera en
 * servidor; el entrenamiento ocurre offline con ml/train.py).
 */

import { getCandles, isValidInterval } from "@/lib/market";
import { predictWithModel, loadModel } from "@/lib/ml/inference";
import { BadRequestError, jsonError, parseInterval, parseSymbol } from "@/lib/validation";

/** Velas necesarias para puntuar (minCandles del modelo + margen de caché). */
const CANDLE_LIMIT = 500;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = parseSymbol(url.searchParams.get("symbol"));
    const interval = parseInterval(url.searchParams.get("interval"));
    if (!isValidInterval(interval)) {
      return jsonError(400, `Intervalo no soportado: ${interval}`);
    }

    const model = loadModel(symbol, interval);
    if (!model) {
      return Response.json(
        {
          symbol,
          interval,
          available: false,
          reason: "model_missing",
          message:
            "No hay modelo exportado para este símbolo/intervalo. Ejecuta el entrenamiento offline (ml/train.py) o consulta un par ya entrenado.",
        },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    // Si el modelo no es válido, respondemos sin descargar velas.
    if (model.validityStatus !== "valid") {
      const result = {
        symbol,
        interval,
        available: false as const,
        reason: "model_not_valid" as const,
        message: `Predicción no disponible: el modelo no superó al baseline fuera de muestra (validity_status="${model.validityStatus}").`,
        validityStatus: model.validityStatus,
        trainedAt: model.trainedAt,
      };
      return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const series = await getCandles(symbol, interval, CANDLE_LIMIT);
    const closed = series.candles.filter((c) => c.closed);
    if (closed.length < model.minCandles) {
      const result = {
        symbol,
        interval,
        available: false as const,
        reason: "insufficient_candles" as const,
        message: `Predicción no disponible: ${closed.length} velas cerradas de ${model.minCandles} necesarias.`,
      };
      return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const result = predictWithModel(
      series.candles,
      model,
      { freshness: series.meta.freshness, fetchedAt: series.meta.fetchedAt },
      symbol,
      interval,
    );
    return Response.json({ symbol, interval, ...result }, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(502, "Error obteniendo la predicción", err instanceof Error ? err.message : String(err));
  }
}
