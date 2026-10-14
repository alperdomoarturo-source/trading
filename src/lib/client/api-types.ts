import type { Candle, CandleSeriesMeta, Market } from "@/lib/market/types";
import type { DetectedPattern } from "@/lib/analysis/patterns";
import type { Levels } from "@/lib/analysis/levels";
import type { Signal } from "@/lib/signals/types";
import type { AssetInfo } from "@/lib/market/types";

export interface MarketsResponse {
  market: Market;
  provider: string;
  providerStatus: "ok" | "error";
  error?: string;
  assets: AssetInfo[];
  fetchedAt: number;
  notes: string[];
}

export interface AnalysisResponse {
  symbol: string;
  interval: string;
  meta: CandleSeriesMeta;
  forming: Candle | null;
  candles: Candle[];
  overlays: {
    ema20: (number | null)[];
    ema50: (number | null)[];
    ema200: (number | null)[];
    bbUpper: (number | null)[];
    bbLower: (number | null)[];
  };
  indicators: {
    rsi14: (number | null)[];
    macdHistogram: (number | null)[];
    atrPct: (number | null)[];
    adx14: (number | null)[];
    relativeVolume: (number | null)[];
  };
  snapshot: {
    close: number;
    rsi: number | null;
    macdHistogram: number | null;
    atr: number | null;
    atrPct: number | null;
    adx: number | null;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    relativeVolume: number | null;
  } | null;
  patterns: DetectedPattern[];
  levels: Levels;
  signal: Signal;
}

export interface SignalsResponse {
  interval: string;
  generatedAt: number;
  signals: { symbol: string; label: string; signal: Signal }[];
}

export interface BacktestResponse {
  symbol: string;
  interval: string;
  days: number;
  metrics: {
    initialCapital: number;
    finalEquity: number;
    totalReturnPercent: number;
    annualizedReturnPercent: number | null;
    tradeCount: number;
    wins: number;
    losses: number;
    winRatePercent: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number | null;
    maxDrawdownPercent: number;
    expectancyPerTrade: number;
    totalFees: number;
    buyHoldReturnPercent: number;
    beatsBuyHold: boolean;
    durationDays: number;
  };
  dataRange: { from: number; to: number; candles: number };
  warmupBars: number;
  equityCurve: { time: number; equity: number }[];
  trades: {
    direction: "long";
    entryIndex: number;
    exitIndex: number;
    entryTime: number;
    exitTime: number;
    entryPrice: number;
    exitPrice: number;
    quantity: number;
    grossPnl: number;
    fees: number;
    netPnl: number;
    netPnlPercent: number;
    exitReason: string;
  }[];
  tradeCount: number;
  meta: CandleSeriesMeta & { warnings: string[] };
}
