import type { AssetInfo } from "./types";

export interface CryptoAsset {
  symbol: string;
  name: string;
}

/** Activos cripto soportados inicialmente (pares contra USDT en Binance). */
export const CRYPTO_ASSETS: CryptoAsset[] = [
  { symbol: "BTCUSDT", name: "Bitcoin" },
  { symbol: "ETHUSDT", name: "Ethereum" },
  { symbol: "SOLUSDT", name: "Solana" },
  { symbol: "BNBUSDT", name: "BNB" },
  { symbol: "XRPUSDT", name: "XRP" },
  { symbol: "ADAUSDT", name: "Cardano" },
  { symbol: "DOGEUSDT", name: "Dogecoin" },
  { symbol: "AVAXUSDT", name: "Avalanche" },
  { symbol: "LINKUSDT", name: "Chainlink" },
  { symbol: "DOTUSDT", name: "Polkadot" },
  { symbol: "LTCUSDT", name: "Litecoin" },
  { symbol: "MATICUSDT", name: "Polygon" },
  { symbol: "ATOMUSDT", name: "Cosmos" },
  { symbol: "NEARUSDT", name: "NEAR Protocol" },
  { symbol: "UNIUSDT", name: "Uniswap" },
];

const BY_SYMBOL = new Map(CRYPTO_ASSETS.map((a) => [a.symbol, a]));

export function findCryptoAsset(symbol: string): CryptoAsset | undefined {
  return BY_SYMBOL.get(symbol.toUpperCase());
}

export function assetInfos(): AssetInfo[] {
  return CRYPTO_ASSETS.map((a) => ({ symbol: a.symbol, market: "crypto" as const, name: a.name }));
}
