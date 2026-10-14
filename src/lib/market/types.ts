/** Tipos compartidos de la capa de datos de mercado. */

export type Market = "crypto" | "stocks";

export const INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
] as const;

export type Interval = (typeof INTERVALS)[number];

/** Duración de cada intervalo en milisegundos (para frescura y horizontes). */
export const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

export interface Candle {
  /** Par normalizado, p. ej. BTCUSDT. */
  symbol: string;
  market: Market;
  interval: string;
  /** Epoch en milisegundos UTC de la apertura de la vela. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  provider: string;
  /** false si la vela todavía no cierra (última vela en formación). */
  closed: boolean;
}

export interface AssetInfo {
  symbol: string;
  market: Market;
  /** Nombre legible, p. ej. "Bitcoin". */
  name: string;
  /** Precio actual (o del último cierre disponible). */
  price?: number;
  /** Variación porcentual de las últimas 24h cuando esté disponible. */
  changePercent24h?: number;
}

export type Freshness = "fresh" | "stale" | "unknown";

export interface CandleSeriesMeta {
  provider: string;
  fetchedAt: number;
  freshness: Freshness;
  /** Edad de la última vela en ms desde su cierre esperado. */
  lastCandleAgeMs?: number;
  warnings: string[];
}

export interface CandleSeries {
  candles: Candle[];
  meta: CandleSeriesMeta;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly statusCode?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
