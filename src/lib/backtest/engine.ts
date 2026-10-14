/**
 * Motor de backtesting cronológico.
 *
 * Garantías anti-lookahead:
 * - La decisión en la vela i usa exclusivamente velas 0..i (índices alineados
 *   de indicadores y niveles calculados solo con datos pasados).
 * - La ejecución de una entrada ocurre en la APERTURA de la vela i+1.
 * - Dentro de una vela donde stop y take-profit podrían tocarse, se asume
 *   el PEOR caso (stop primero) al no conocerse el camino intradiario.
 *
 * Costes aplicados: comisión por lado sobre el nocional y slippage/spread
 * estimado aplicado de forma adversa en cada ejecución.
 */

import type { Candle } from "@/lib/market/types";
import { atr, computeIndicators } from "@/lib/analysis/indicators";
import { evaluateSignalAt } from "@/lib/signals/engine";
import type { SignalEngineConfig } from "@/lib/signals/types";

export interface BacktestConfig {
  initialCapital: number;
  /** Fracción del capital (0-1) comprometida en cada operación. */
  positionFraction: number;
  stopLossAtr: number;
  takeProfitAtr: number;
  maxHoldCandles: number;
  /** Comisión por lado, en %. */
  commissionPercent: number;
  /** Spread + slippage estimado por lado, en % (se aplica adversamente). */
  slippagePercent: number;
  signal: SignalEngineConfig;
}

export type ExitReason =
  | "take-profit"
  | "stop-loss"
  | "senal-contraria"
  | "horizonte-maximo"
  | "fin-del-backtest";

export interface BacktestTrade {
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
  exitReason: ExitReason;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface BacktestMetrics {
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
  /** true si el retorno de la estrategia supera a comprar y mantener. */
  beatsBuyHold: boolean;
  durationDays: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  dataRange: { from: number; to: number; candles: number };
  /** Primer índice evaluable (warmup de indicadores). */
  warmupBars: number;
  notes: string[];
}

interface OpenPosition {
  entryIndex: number;
  entryTime: number;
  entryPrice: number;
  quantity: number;
  stop: number;
  target: number;
  feesPaid: number;
  notionalAtEntry: number;
}

export function runBacktest(closedCandles: Candle[], cfg: BacktestConfig): BacktestResult {
  const notes: string[] = [];
  const n = closedCandles.length;
  const commissionRate = cfg.commissionPercent / 100;
  const slipRate = cfg.slippagePercent / 100;

  const atr14 = atr(closedCandles, 14);
  const ind = computeIndicators(closedCandles);
  const warmup = 220; // MIN_CANDLES_FOR_SIGNAL: EMA200 + margen
  const startEval = Math.min(warmup, Math.max(0, n - 2));
  if (n < warmup + 10) {
    notes.push(
      `Solo ${n} velas: el periodo evaluable es corto y los resultados tienen valor estadístico limitado`,
    );
  }

  let cash = cfg.initialCapital;
  let position: OpenPosition | null = null;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  const markEquity = (i: number) => {
    const price = closedCandles[i].close;
    const equity = cash + (position ? position.quantity * price : 0);
    equityCurve.push({ time: closedCandles[i].time, equity });
  };

  const closePosition = (
    pos: OpenPosition,
    exitIndex: number,
    rawExitPrice: number,
    reason: ExitReason,
  ) => {
    // Slippage adverso a la salida (venta): precio más bajo.
    const exitPrice = rawExitPrice * (1 - slipRate);
    const exitNotional = exitPrice * pos.quantity;
    const exitFee = exitNotional * commissionRate;
    const gross = exitNotional - pos.notionalAtEntry;
    const fees = pos.feesPaid + exitFee;
    const net = gross - fees;
    cash += pos.notionalAtEntry + net; // devuelve principal + PnL neto - fees implícitos
    trades.push({
      direction: "long",
      entryIndex: pos.entryIndex,
      exitIndex,
      entryTime: pos.entryTime,
      exitTime: closedCandles[exitIndex].time,
      entryPrice: pos.entryPrice,
      exitPrice,
      quantity: pos.quantity,
      grossPnl: gross,
      fees,
      netPnl: net,
      netPnlPercent: (net / pos.notionalAtEntry) * 100,
      exitReason: reason,
    });
  };

  for (let i = startEval; i < n; i++) {
    // --- Gestión de posición abierta (antes de nuevas entradas) ---
    if (position) {
      const c = closedCandles[i];
      const heldCandles = i - position.entryIndex;
      // Peor caso: stop antes que objetivo dentro de la misma vela.
      if (c.low <= position.stop) {
        closePosition(position, i, position.stop, "stop-loss");
        position = null;
      } else if (c.high >= position.target) {
        closePosition(position, i, position.target, "take-profit");
        position = null;
      } else if (heldCandles >= cfg.maxHoldCandles) {
        closePosition(position, i, c.close, "horizonte-maximo");
        position = null;
      } else {
        const sig = evaluateSignalAt(closedCandles, i, cfg.signal, {
          symbol: closedCandles[0].symbol,
          market: closedCandles[0].market,
          interval: closedCandles[0].interval,
          freshness: "fresh",
          now: closedCandles[i].time,
        }, ind);
        if (sig.kind === "SELL") {
          closePosition(position, i, c.close, "senal-contraria");
          position = null;
        }
      }
    }

    // --- Entrada potencial: decisión con la vela i cerrada,
    // --- ejecución en la apertura de la vela i+1 ---
    if (!position && i + 1 < n) {
      const sig = evaluateSignalAt(closedCandles, i, cfg.signal, {
        symbol: closedCandles[0].symbol,
        market: closedCandles[0].market,
        interval: closedCandles[0].interval,
        freshness: "fresh",
        now: closedCandles[i].time,
      }, ind);
      if (sig.kind === "BUY" && sig.priceRef > 0) {
        const atrNow = atr14[i];
        if (Number.isNaN(atrNow) || atrNow <= 0) {
          notes.push(`Vela ${i}: ATR no disponible, entrada omitida`);
        } else {
          // Slippage adverso a la entrada (compra): precio más alto.
          const entryPrice = closedCandles[i + 1].open * (1 + slipRate);
          const budget = cash * cfg.positionFraction;
          const quantity = budget / entryPrice;
          const entryNotional = quantity * entryPrice;
          const entryFee = entryNotional * commissionRate;
          cash -= entryNotional;
          position = {
            entryIndex: i + 1,
            entryTime: closedCandles[i + 1].time,
            entryPrice,
            quantity,
            stop: entryPrice - cfg.stopLossAtr * atrNow,
            target: entryPrice + cfg.takeProfitAtr * atrNow,
            feesPaid: entryFee,
            notionalAtEntry: entryNotional,
          };
        }
      }
    }

    markEquity(i);
  }

  // Cierre forzado al final del periodo.
  if (position) {
    closePosition(position, n - 1, closedCandles[n - 1].close, "fin-del-backtest");
    position = null;
  }
  if (equityCurve.length === 0) markEquity(Math.max(startEval, n - 1));

  const finalEquity = cash;

  // Comprar y mantener (sin costes, como referencia).
  const firstEvaluable = closedCandles[startEval];
  const lastCandle = closedCandles[n - 1];
  const buyHoldReturnPercent =
    firstEvaluable && firstEvaluable.close > 0
      ? ((lastCandle.close / firstEvaluable.close) - 1) * 100
      : 0;

  const wins = trades.filter((t) => t.netPnl > 0);
  const losses = trades.filter((t) => t.netPnl <= 0);
  const grossWin = wins.reduce((s, t) => s + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.netPnl, 0));

  let maxDrawdown = 0;
  let peak = -Infinity;
  for (const p of equityCurve) {
    peak = Math.max(peak, p.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - p.equity) / peak) * 100);
  }

  const from = closedCandles[0]?.time ?? 0;
  const to = lastCandle?.time ?? 0;
  const durationDays = Math.max(1, (to - from) / 86_400_000);
  const totalReturnPercent = ((finalEquity / cfg.initialCapital) - 1) * 100;
  const annualized =
    durationDays >= 30 && finalEquity > 0
      ? ((finalEquity / cfg.initialCapital) ** (365 / durationDays) - 1) * 100
      : null;

  if (trades.length < 20) {
    notes.push(
      `Solo ${trades.length} operaciones: la muestra es pequeña para conclusiones estadísticas`,
    );
  }

  return {
    trades,
    equityCurve,
    metrics: {
      initialCapital: cfg.initialCapital,
      finalEquity,
      totalReturnPercent,
      annualizedReturnPercent: annualized,
      tradeCount: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRatePercent: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      avgWin: wins.length > 0 ? grossWin / wins.length : 0,
      avgLoss: losses.length > 0 ? -grossLoss / losses.length : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? null : 0,
      maxDrawdownPercent: maxDrawdown,
      expectancyPerTrade: trades.length > 0 ? (grossWin - grossLoss) / trades.length : 0,
      totalFees: trades.reduce((s, t) => s + t.fees, 0),
      buyHoldReturnPercent,
      beatsBuyHold: totalReturnPercent > buyHoldReturnPercent,
      durationDays,
    },
    dataRange: { from, to, candles: n },
    warmupBars: startEval,
    notes,
  };
}
