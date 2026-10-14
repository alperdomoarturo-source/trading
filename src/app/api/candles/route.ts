import { getCandles, isValidInterval } from "@/lib/market";
import {
  BadRequestError,
  jsonError,
  parseInterval,
  parseLimit,
  parseMarketParam,
  parseSymbol,
} from "@/lib/validation";

/** GET /api/candles?symbol=BTCUSDT&interval=1h&limit=500&market=crypto|stocks */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = parseSymbol(url.searchParams.get("symbol"));
    const interval = parseInterval(url.searchParams.get("interval"));
    if (!isValidInterval(interval)) {
      return jsonError(400, `Intervalo no soportado: ${interval}`);
    }
    const market = parseMarketParam(url.searchParams.get("market"));
    // Stooq (acciones) solo publica 1d y 1w; se valida antes de llamar al proveedor.
    if (market === "stocks" && interval !== "1d" && interval !== "1w") {
      return jsonError(400, "intervalo no disponible para acciones; use 1d o 1w");
    }
    const limit = parseLimit(url.searchParams.get("limit"), 500, 1000);
    const series = await getCandles(symbol, interval, limit, market);
    return Response.json(series, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(502, "Error obteniendo velas del proveedor", err instanceof Error ? err.message : String(err));
  }
}
