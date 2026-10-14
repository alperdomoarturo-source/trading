import { getTickers } from "@/lib/market";
import { BadRequestError, jsonError, parseSymbol } from "@/lib/validation";

/**
 * GET /api/ticker?symbol=BTCUSDT
 * Precio de la última operación (no la última vela cerrada), con caché de 20s
 * en servidor. Es provisional: la vela en formación sigue siendo provisional
 * y el motor de señales sólo usa velas cerradas.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = parseSymbol(url.searchParams.get("symbol"));
    const ticker = (await getTickers([symbol])).get(symbol);
    if (!ticker) {
      return jsonError(502, `El proveedor no devolvió precio para ${symbol}`);
    }
    return Response.json(
      {
        symbol,
        price: ticker.price,
        changePercent24h: ticker.changePercent24h,
        fetchedAt: Date.now(),
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(502, "Error obteniendo el precio", err instanceof Error ? err.message : String(err));
  }
}
