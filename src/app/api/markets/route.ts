import { getProvider, listAssets } from "@/lib/market";
import { BadRequestError, jsonError, parseMarketParam } from "@/lib/validation";

const STOCKS_NOTES = [
  "Stooq es un proveedor gratuito con datos diferidos de cierre de sesión (EOD); no son precios en tiempo real.",
  "El endpoint gratuito tiene límites de uso por IP: la app cachea y reintenta con prudencia.",
  "Intervalos disponibles para acciones: 1d y 1w.",
];

const CRYPTO_NOTES = [
  "Datos de Binance API pública; cripto opera 24/7.",
];

/** GET /api/markets?market=crypto|stocks — activos soportados con precio y estado del proveedor. */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const market = parseMarketParam(url.searchParams.get("market"));
    const { assets, providerStatus, error } = await listAssets(market);
    return Response.json(
      {
        market,
        provider: getProvider(market)?.id ?? "desconocido",
        providerStatus,
        error,
        assets,
        fetchedAt: Date.now(),
        notes: market === "stocks" ? STOCKS_NOTES : CRYPTO_NOTES,
      },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return Response.json(
      { error: "No se pudo consultar el estado de los mercados", details: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
