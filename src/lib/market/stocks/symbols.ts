/**
 * Lista inicial de acciones estadounidenses soportadas (proveedor: Stooq).
 * El mapeo a tickers de Stooq es: símbolo en minúsculas + sufijo ".us"
 * (p. ej. AAPL -> aapl.us, BRK.B -> brk.b.us).
 */

import type { AssetInfo } from "../types";

export interface StockAsset {
  symbol: string;
  name: string;
}

/** Activos de acciones incluidas desde el inicio (ampliable sin tocar la UI). */
export const STOCK_ASSETS: StockAsset[] = [
  { symbol: "AAPL", name: "Apple" },
  { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" },
  { symbol: "GOOGL", name: "Alphabet (clase A)" },
  { symbol: "AMZN", name: "Amazon" },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "TSLA", name: "Tesla" },
  { symbol: "JPM", name: "JPMorgan Chase" },
  { symbol: "XOM", name: "Exxon Mobil" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF" },
];

const BY_SYMBOL = new Map(STOCK_ASSETS.map((a) => [a.symbol, a]));

export function findStockAsset(symbol: string): StockAsset | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

/** Ticker de Stooq para un símbolo de acción (minúsculas + ".us"). */
export function toStooqTicker(symbol: string): string {
  return `${symbol.toLowerCase()}.us`;
}

export function stockAssetInfos(): AssetInfo[] {
  return STOCK_ASSETS.map((a) => ({ symbol: a.symbol, market: "stocks" as const, name: a.name }));
}
