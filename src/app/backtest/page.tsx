"use client";

import { useState } from "react";
import { Badge, Card, EmptyState, ErrorBox, Loading, Stat } from "@/components/ui";
import { useConfig } from "@/lib/client/settings";
import type { BacktestResponse } from "@/lib/client/api-types";
import { CRYPTO_ASSETS } from "@/lib/market/symbols";
import { fmtDateTime, fmtMoney, fmtNum, fmtPercent, fmtPrice } from "@/lib/format";

const INTERVAL_OPTIONS = ["15m", "1h", "4h", "1d"];
const EXIT_LABEL: Record<string, string> = {
  "take-profit": "Objetivo",
  "stop-loss": "Stop",
  "senal-contraria": "Señal contraria",
  "horizonte-maximo": "Horizonte máximo",
  "fin-del-backtest": "Fin del periodo",
};

export default function BacktestPage() {
  const { config, hydrated } = useConfig();
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setIntervalState] = useState("1h");
  const [days, setDays] = useState(180);
  const [costs, setCosts] = useState({ commission: config.costs.commissionPercent, slippage: config.costs.slippagePercent });
  const [risk, setRisk] = useState({
    stopLossAtr: config.backtest.stopLossAtr,
    takeProfitAtr: config.backtest.takeProfitAtr,
    maxHoldCandles: config.backtest.maxHoldCandles,
    minScore: config.signals.minScore,
    minAdx: config.signals.minAdx,
    initialCapital: config.backtest.initialCapital,
  });
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          interval,
          days,
          commissionPercent: costs.commission,
          slippagePercent: costs.slippage,
          stopLossAtr: risk.stopLossAtr,
          takeProfitAtr: risk.takeProfitAtr,
          maxHoldCandles: risk.maxHoldCandles,
          minScore: risk.minScore,
          minAdx: risk.minAdx,
          initialCapital: risk.initialCapital,
        }),
      });
      const body = (await res.json()) as BacktestResponse & { error?: string; details?: string };
      if (!res.ok) {
        setError(`${body.error ?? res.statusText}${body.details ? `: ${body.details}` : ""}`);
        return;
      }
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Backtesting</h1>
        <p className="text-sm text-muted">
          Estrategia cronológica con velas reales de Binance · sin lookahead · costes
          aplicados en cada ejecución
        </p>
      </div>

      <Card title="Parámetros">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Activo">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="input"
            >
              {CRYPTO_ASSETS.map((a) => (
                <option key={a.symbol} value={a.symbol}>
                  {a.name} ({a.symbol})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Temporalidad">
            <select value={interval} onChange={(e) => setIntervalState(e.target.value)} className="input">
              {INTERVAL_OPTIONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Días de historia">
            <input
              type="number"
              min={7}
              max={730}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="input"
            />
          </Field>
          <Field label="Capital inicial (ficticio)">
            <input
              type="number"
              min={100}
              step={100}
              value={risk.initialCapital}
              onChange={(e) => setRisk((r) => ({ ...r, initialCapital: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <Field label="Comisión por lado (%)">
            <input
              type="number"
              min={0}
              max={2}
              step={0.01}
              value={costs.commission}
              onChange={(e) => setCosts((c) => ({ ...c, commission: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <Field label="Spread + slippage por lado (%)">
            <input
              type="number"
              min={0}
              max={2}
              step={0.01}
              value={costs.slippage}
              onChange={(e) => setCosts((c) => ({ ...c, slippage: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <Field label="Stop-loss (× ATR)">
            <input
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={risk.stopLossAtr}
              onChange={(e) => setRisk((r) => ({ ...r, stopLossAtr: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <Field label="Take-profit (× ATR)">
            <input
              type="number"
              min={0.5}
              max={20}
              step={0.5}
              value={risk.takeProfitAtr}
              onChange={(e) => setRisk((r) => ({ ...r, takeProfitAtr: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <Field label="Máx. velas en posición">
            <input
              type="number"
              min={2}
              max={500}
              value={risk.maxHoldCandles}
              onChange={(e) => setRisk((r) => ({ ...r, maxHoldCandles: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <Field label="Umbral de señal (puntuación)">
            <input
              type="number"
              min={10}
              max={95}
              value={risk.minScore}
              onChange={(e) => setRisk((r) => ({ ...r, minScore: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <Field label="ADX mínimo">
            <input
              type="number"
              min={0}
              max={60}
              value={risk.minAdx}
              onChange={(e) => setRisk((r) => ({ ...r, minAdx: Number(e.target.value) }))}
              className="input"
            />
          </Field>
          <div className="flex items-end">
            <button
              onClick={() => void run()}
              disabled={loading}
              className="w-full rounded-md bg-accent/20 px-4 py-2 text-sm font-semibold text-accent border border-accent/50 hover:bg-accent/30 disabled:opacity-50"
            >
              {loading ? "Ejecutando…" : "Ejecutar backtest"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted">
          Los costes son estimaciones configurables, no las comisiones reales de ningún
          intermediario. La estrategia solo abre posiciones largas (v1).
        </p>
      </Card>

      {loading && <Loading label="Descargando historia y simulando operaciones…" />}
      {error && <ErrorBox title="El backtest no se pudo ejecutar" message={error} />}

      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Retorno total"
              value={fmtPercent(result.metrics.totalReturnPercent)}
              tone={result.metrics.totalReturnPercent >= 0 ? "up" : "down"}
              hint={`vs comprar y mantener ${fmtPercent(result.metrics.buyHoldReturnPercent)}`}
            />
            <Stat
              label="Capital final"
              value={fmtMoney(result.metrics.finalEquity)}
              hint={`inicial ${fmtMoney(result.metrics.initialCapital)}`}
            />
            <Stat
              label="Operaciones"
              value={result.metrics.tradeCount}
              hint={`${result.metrics.wins} ganadoras · ${result.metrics.losses} perdedoras`}
            />
            <Stat
              label="% Acierto"
              value={fmtNum(result.metrics.winRatePercent, 1)}
              hint="una tasa alta no implica rentabilidad"
            />
            <Stat
              label="Factor de beneficio"
              value={result.metrics.profitFactor === null ? "∞ (sin pérdidas)" : fmtNum(result.metrics.profitFactor, 2)}
              hint="ganancias acumuladas / pérdidas acumuladas"
            />
            <Stat
              label="Drawdown máximo"
              value={fmtNum(result.metrics.maxDrawdownPercent, 1)}
              tone="down"
            />
            <Stat
              label="Expectativa por operación"
              value={fmtMoney(result.metrics.expectancyPerTrade)}
              tone={result.metrics.expectancyPerTrade >= 0 ? "up" : "down"}
            />
            <Stat
              label="Comisiones acumuladas"
              value={fmtMoney(result.metrics.totalFees)}
              hint={`${fmtNum(result.metrics.durationDays, 0)} días de datos`}
            />
          </div>

          {result.metrics.annualizedReturnPercent !== null && (
            <Card title="Retorno anualizado">
              <p className="font-mono text-lg">
                {fmtPercent(result.metrics.annualizedReturnPercent)}{" "}
                <span className="text-sm text-muted">
                  (estimado por anualización geométrica; solo orientativo)
                </span>
              </p>
            </Card>
          )}

          <Card title="Curva de capital vs comprar y mantener">
            <EquityChart
              points={result.equityCurve}
              initial={result.metrics.initialCapital}
              symbol={result.symbol}
            />
          </Card>

          {result.meta.warnings.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              {result.meta.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}

          <Card
            title={`Operaciones (${result.tradeCount} totales${result.trades.length < result.tradeCount ? `, se muestran ${result.trades.length}` : ""})`}
          >
            {result.trades.length === 0 ? (
              <EmptyState message="La estrategia no abrió ninguna posición con estos parámetros." />
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="table-terminal w-full text-sm">
                  <thead>
                    <tr>
                      <th>Entrada</th>
                      <th>Salida</th>
                      <th className="text-right">Precio ent.</th>
                      <th className="text-right">Precio sal.</th>
                      <th className="text-right">PnL bruto</th>
                      <th className="text-right">Costes</th>
                      <th className="text-right">PnL neto</th>
                      <th className="text-right">%</th>
                      <th>Motivo de salida</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, idx) => (
                      <tr key={idx}>
                        <td>{fmtDateTime(t.entryTime)}</td>
                        <td>{fmtDateTime(t.exitTime)}</td>
                        <td className="text-right font-mono">{fmtPrice(t.entryPrice)}</td>
                        <td className="text-right font-mono">{fmtPrice(t.exitPrice)}</td>
                        <td className="text-right font-mono">{fmtMoney(t.grossPnl)}</td>
                        <td className="text-right font-mono text-muted">{fmtMoney(t.fees)}</td>
                        <td className={`text-right font-mono ${t.netPnl >= 0 ? "text-up" : "text-down"}`}>
                          {fmtMoney(t.netPnl)}
                        </td>
                        <td className={`text-right font-mono ${t.netPnl >= 0 ? "text-up" : "text-down"}`}>
                          {fmtPercent(t.netPnlPercent)}
                        </td>
                        <td>
                          <Badge>{EXIT_LABEL[t.exitReason] ?? t.exitReason}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="text-xs text-muted">
            Un backtest positivo no garantiza resultados futuros. La validación
            walk-forward y la comparación entre modelos llegarán con la Etapa 4 (ML) y
            la Etapa 12 (validación estadística).
          </p>
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function EquityChart({
  points,
  initial,
  symbol,
}: {
  points: { time: number; equity: number }[];
  initial: number;
  symbol: string;
}) {
  if (points.length < 2) return <EmptyState message="Sin curva de capital." />;
  const w = 900;
  const h = 220;
  const values = points.map((p) => p.equity);
  const min = Math.min(...values, initial);
  const max = Math.max(...values, initial);
  const range = max - min || 1;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / range) * (h - 20) - 10;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(" ");
  const baseY = y(initial);
  const last = points[points.length - 1];
  const up = last.equity >= initial;
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Curva de capital del backtest">
        <line x1={0} x2={w} y1={baseY} y2={baseY} stroke="#8b96a5" strokeDasharray="4 4" strokeWidth={1} />
        <path
          d={path}
          fill="none"
          stroke={up ? "#26a69a" : "#ef5350"}
          strokeWidth={2}
        />
      </svg>
      <div className="flex justify-between text-xs text-muted font-mono">
        <span>{fmtDateTime(points[0].time)}</span>
        <span>
          {symbol} · inicial {fmtMoney(initial)} · final {fmtMoney(last.equity)}
        </span>
        <span>{fmtDateTime(last.time)}</span>
      </div>
    </div>
  );
}
