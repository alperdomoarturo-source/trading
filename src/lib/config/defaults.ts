/**
 * Configuración por defecto de la plataforma.
 * Todos los valores son ajustables desde /settings (persistidos en localStorage
 * del navegador) sin modificar código.
 */

export interface PlatformConfig {
  /** Activos vigilados por defecto (par de Binance). */
  watchlist: string[];
  /** Temporalidad por defecto. */
  defaultInterval: string;
  /** Velas solicitadas al proveedor. */
  candleLimit: number;
  /** Umbrales del motor de señales. */
  signals: {
    /** Puntuación mínima (0-100) para emitir COMPRA/VENTA SIMULADA. */
    minScore: number;
    /** Puntuación mínima para recomendar "esperar" (confluencia parcial). */
    waitScore: number;
    /** ADX mínimo para considerar que hay tendencia operable. */
    minAdx: number;
    /** Volumen relativo mínimo para validar un patrón. */
    minRelativeVolume: number;
    /** Máxima distancia a soporte/resistencia (en ATR) para validar rechazo. */
    maxLevelDistanceAtr: number;
    /** Horizonte de la señal en velas. */
    horizonCandles: number;
    /** Días de datos para backtesting por defecto. */
    backtestDays: number;
  };
  /** Costes estimados de la simulación (porcentajes por operación). */
  costs: {
    /** Comisión por lado en %. */
    commissionPercent: number;
    /** Coste total de spread + slippage estimado, en %. */
    slippagePercent: number;
  };
  /** Parámetros del paper trading. */
  paper: {
    initialCapital: number;
    /** Fracción del capital comprometida por operación (0-1). */
    positionFraction: number;
  };
  /** Parámetros del backtest. */
  backtest: {
    initialCapital: number;
    positionFraction: number;
    /** Stop-loss en múltiplos de ATR. */
    stopLossAtr: number;
    /** Take-profit en múltiplos de ATR. */
    takeProfitAtr: number;
    /** Máximo de velas en una posición si no ocurre nada. */
    maxHoldCandles: number;
  };
}

export const DEFAULT_CONFIG: PlatformConfig = {
  watchlist: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"],
  defaultInterval: "1h",
  candleLimit: 500,
  signals: {
    /** Calibrado con datos reales de BTC/ETH 1h: la confluencia típica máxima
     * ronda 40 puntos; umbrales por encima de ~50 casi nunca se alcanzan. */
    minScore: 35,
    waitScore: 18,
    minAdx: 20,
    minRelativeVolume: 1.1,
    maxLevelDistanceAtr: 1.5,
    horizonCandles: 5,
    backtestDays: 180,
  },
  costs: {
    commissionPercent: 0.1,
    slippagePercent: 0.05,
  },
  paper: {
    initialCapital: 10_000,
    positionFraction: 0.95,
  },
  backtest: {
    initialCapital: 10_000,
    positionFraction: 0.95,
    stopLossAtr: 2,
    takeProfitAtr: 3,
    maxHoldCandles: 48,
  },
};
