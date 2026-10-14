/**
 * Fachada unificada de proveedores de datos de mercado.
 *
 * Todos los proveedores deben exponer la misma interfaz (MarketProvider) para
 * poder añadir acciones estadounidenses en el futuro sin reescribir la app.
 * El resultado siempre pasa por normalización y validación.
 */

import { fetchHistoricalKlines, fetchKlines, fetchTickers, ping } from "./binance";
import { buildSeries, detectGaps, normalizeCandles } from "./normalize";
import { cached } from "./cache";
import { INTERVALS, type AssetInfo, type CandleSeries, type Interval, type Market } from "./types";
import { assetInfos } from "./symbols";
import { stooqProvider } from "./stocks/stooq";
import { stockAssetInfos } from "./stocks/symbols";

export interface MarketProvider {
  readonly id: string;
  readonly market: Market;
  getCandles(symbol: string, interval: string, limit: number): Promise<CandleSeries>;
  getTickers(symbols: string[]): Promise<Map<string, { price: number; changePercent24h: number }>>;
  ping(): Promise<boolean>;
}

const binanceProvider: MarketProvider = {
  id: "binance",
  market: "crypto",
  async getCandles(symbol: string, interval: string, limit: number): Promise<CandleSeries> {
    const fetchedAt = Date.now();
    const raw = await fetchKlines(symbol, interval, limit);
    const { candles, removed } = normalizeCandles(raw);
    const warnings: string[] = [];
    if (removed > 0) warnings.push(`${removed} velas inválidas descartadas`);
    const gaps = detectGaps(candles, interval as Interval);
    if (gaps.length > 0) {
      warnings.push(`${gaps.length} huecos temporales detectados en la serie`);
    }
    return buildSeries(candles, { provider: "binance", fetchedAt, warnings });
  },
  getTickers: fetchTickers,
  ping,
};

/** Proveedores registrados. */
const providers: MarketProvider[] = [binanceProvider, stooqProvider];

export function getProvider(market: Market): MarketProvider | undefined {
  return providers.find((p) => p.market === market);
}

export function isValidInterval(interval: string): interval is Interval {
  return (INTERVALS as readonly string[]).includes(interval);
}

/** TTL de la caché de velas: medio intervalo, entre 15s y 5 minutos. */
function candleTtlMs(interval: string): number {
  const ms: Record<string, number> = {
    "1m": 15_000,
    "3m": 30_000,
    "5m": 30_000,
    "15m": 60_000,
    "30m": 90_000,
    "1h": 120_000,
    "2h": 180_000,
    "4h": 300_000,
    "6h": 300_000,
    "8h": 300_000,
    "12h": 300_000,
    "1d": 600_000,
    "3d": 600_000,
    "1w": 600_000,
  };
  return ms[interval] ?? 60_000;
}

/** Obtiene velas normalizadas desde la caché o el proveedor correspondiente. */
export async function getCandles(
  symbol: string,
  interval: string,
  limit: number,
  market: Market = "crypto",
): Promise<CandleSeries> {
  const provider = getProvider(market);
  if (!provider) {
    throw new Error(`No hay proveedor registrado para el mercado ${market}`);
  }
  const key = `klines:${provider.id}:${symbol.toUpperCase()}:${interval}:${limit}`;
  return cached(key, candleTtlMs(interval), () => provider.getCandles(symbol, interval, limit));
}

/**
 * Serie histórica larga para backtesting (paginada, hasta ~20 000 velas).
 * Caché más larga: los datos históricos cerrados no cambian.
 */
export async function getHistoricalCandles(
  symbol: string,
  interval: string,
  days: number,
  market: Market = "crypto",
): Promise<CandleSeries> {
  const provider = getProvider(market);
  if (!provider) {
    throw new Error(`No hay proveedor registrado para el mercado ${market}`);
  }
  if (market === "stocks") {
    // El paginado histórico sigue siendo específico de Binance; para acciones
    // se sirve la serie larga vía getCandles del proveedor Stooq.
    throw new Error("Histórico paginado solo disponible para cripto por ahora; use getCandles con market=stocks");
  }
  const key = `hklines:${provider.id}:${symbol.toUpperCase()}:${interval}:${days}`;
  return cached(key, 15 * 60_000, async () => {
    const fetchedAt = Date.now();
    const raw = await fetchHistoricalKlines(symbol, interval, days);
    const { candles, removed } = normalizeCandles(raw);
    const warnings: string[] = [];
    if (removed > 0) warnings.push(`${removed} velas inválidas descartadas`);
    const first = candles[0];
    const expectedStart = fetchedAt - days * 86_400_000;
    if (!first || first.time > expectedStart + 2 * 86_400_000) {
      warnings.push("El histórico disponible es más corto que el periodo solicitado");
    }
    return buildSeries(candles, { provider: provider.id, fetchedAt, warnings });
  });
}

export async function getTickers(
  symbols: string[],
  market: Market = "crypto",
): Promise<Map<string, { price: number; changePercent24h: number }>> {
  const provider = getProvider(market);
  if (!provider || symbols.length === 0) return new Map();
  const key = `tickers:${provider.id}:${symbols.slice().sort().join(",")}`;
  return cached(key, 20_000, () => provider.getTickers(symbols));
}

/** Lista de activos con precio/variación cuando el proveedor responde. */
export async function listAssets(market: Market = "crypto"): Promise<{
  assets: AssetInfo[];
  providerStatus: "ok" | "error";
  error?: string;
}> {
  const provider = getProvider(market);
  if (!provider) {
    return { assets: [], providerStatus: "error", error: `Mercado ${market} no disponible todavía` };
  }
  const base = market === "crypto" ? assetInfos() : stockAssetInfos();
  try {
    const tickers = await getTickers(base.map((a) => a.symbol), market);
    return {
      assets: base.map((a) => {
        const t = tickers.get(a.symbol);
        return t
          ? { ...a, price: t.price, changePercent24h: t.changePercent24h }
          : { ...a };
      }),
      providerStatus: "ok",
    };
  } catch (err) {
    return {
      assets: base,
      providerStatus: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
