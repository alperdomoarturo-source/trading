"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge, Card, EmptyState, ErrorBox, Loading, Stat } from "@/components/ui";
import { useApi } from "@/lib/client/hooks";
import { useConfig } from "@/lib/client/settings";
import type { MarketsResponse } from "@/lib/client/api-types";
import { fmtDateTime, fmtMoney, fmtNum, fmtPercent, fmtPrice } from "@/lib/format";

/**
 * Paper trading (simulación con dinero ficticio).
 *
 * Persistencia: localStorage del navegador (v1, sin Supabase). La cartera no
 * se comparte entre dispositivos. Al activar Supabase (Etapa 7) la persistencia
 * migra a la base de datos con autenticación.
 *
 * Precios de referencia: último precio del ticker 24 h de Binance.
 */

const PORTFOLIO_KEY = "trading-paper-portfolio-v1";
const CURVE_KEY = "trading-paper-curve-v1";
/** Muestreo de la curva: como mínimo 30 s entre puntos, tope de 5000. */
const CURVE_MIN_GAP_MS = 30_000;
const CURVE_MAX_POINTS = 5000;

interface EquityPoint {
  t: number;
  e: number;
}

function loadCurve(): EquityPoint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CURVE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as EquityPoint[]).slice(-CURVE_MAX_POINTS) : [];
  } catch {
    return [];
  }
}

function saveCurve(c: EquityPoint[]): void {
  try {
    window.localStorage.setItem(CURVE_KEY, JSON.stringify(c));
  } catch {
    // sin localStorage
  }
}

interface PaperPosition {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number; // precio ejecutado (incluye slippage adverso)
  entryTime: number;
  entryFee: number;
  positionFractionUsed: number;
}

interface PaperTrade {
  id: string;
  symbol: string;
  quantity: number;
  entryPrice: number;
  exitPrice: number;
  entryTime: number;
  exitTime: number;
  grossPnl: number;
  fees: number;
  netPnl: number;
}

interface Portfolio {
  initialCapital: number;
  cash: number;
  positions: PaperPosition[];
  closed: PaperTrade[];
  createdAt: number;
}

function loadPortfolio(): Portfolio | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PORTFOLIO_KEY);
    return raw ? (JSON.parse(raw) as Portfolio) : null;
  } catch {
    return null;
  }
}

function savePortfolio(p: Portfolio | null): void {
  try {
    if (p) window.localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(PORTFOLIO_KEY);
  } catch {
    // sin localStorage
  }
}

export default function PaperTradingPage() {
  const { config, hydrated } = useConfig();
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [curve, setCurve] = useState<EquityPoint[]>([]);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState({ symbol: "BTCUSDT", fraction: 0.5 });
  const [confirmReset, setConfirmReset] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPortfolio(loadPortfolio());
    setCurve(loadCurve());
    setReady(true);
  }, []);

  const markets = useApi<MarketsResponse>("/api/markets", 60_000);
  const prices = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of markets.data?.assets ?? []) {
      if (a.price !== undefined) map.set(a.symbol, a.price);
    }
    return map;
  }, [markets.data]);

  function persist(next: Portfolio) {
    savePortfolio(next);
    setPortfolio(next);
  }

  function createPortfolio() {
    if (!hydrated) return;
    persist({
      initialCapital: config.paper.initialCapital,
      cash: config.paper.initialCapital,
      positions: [],
      closed: [],
      createdAt: Date.now(),
    });
    const start = [{ t: Date.now(), e: config.paper.initialCapital }];
    setCurve(start);
    saveCurve(start);
    setMessage(null);
    setConfirmReset(false);
  }

  function openPosition() {
    if (!portfolio || !hydrated) return;
    const price = prices.get(form.symbol);
    if (!price) {
      setMessage(`No hay precio disponible para ${form.symbol}; inténtalo de nuevo.`);
      return;
    }
    const slip = config.costs.slippagePercent / 100;
    const commission = config.costs.commissionPercent / 100;
    const entryPrice = price * (1 + slip);
    const budget = portfolio.cash * Math.min(1, Math.max(0.01, form.fraction));
    const quantity = budget / entryPrice;
    const notional = quantity * entryPrice;
    const entryFee = notional * commission;
    const totalCost = notional + entryFee;
    if (totalCost > portfolio.cash) {
      setMessage("El coste total (nocional + comisión) supera el efectivo disponible.");
      return;
    }
    persist({
      ...portfolio,
      cash: portfolio.cash - totalCost,
      positions: [
        ...portfolio.positions,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          symbol: form.symbol,
          quantity,
          entryPrice,
          entryTime: Date.now(),
          entryFee,
          positionFractionUsed: form.fraction,
        },
      ],
    });
    setMessage(
      `Posición abierta: ${fmtNum(quantity, 6)} ${form.symbol} a ${fmtPrice(entryPrice)} (incluye slippage estimado).`,
    );
  }

  function closePosition(id: string) {
    if (!portfolio || !hydrated) return;
    const pos = portfolio.positions.find((p) => p.id === id);
    if (!pos) return;
    const price = prices.get(pos.symbol);
    if (!price) {
      setMessage(`No hay precio actual para ${pos.symbol}; inténtalo de nuevo.`);
      return;
    }
    const slip = config.costs.slippagePercent / 100;
    const commission = config.costs.commissionPercent / 100;
    const exitPrice = price * (1 - slip);
    const exitNotional = pos.quantity * exitPrice;
    const exitFee = exitNotional * commission;
    const entryNotional = pos.quantity * pos.entryPrice;
    const gross = exitNotional - entryNotional;
    const fees = pos.entryFee + exitFee;
    const net = gross - fees;
    persist({
      ...portfolio,
      cash: portfolio.cash + exitNotional - exitFee,
      positions: portfolio.positions.filter((p) => p.id !== id),
      closed: [
        {
          id: pos.id,
          symbol: pos.symbol,
          quantity: pos.quantity,
          entryPrice: pos.entryPrice,
          exitPrice,
          entryTime: pos.entryTime,
          exitTime: Date.now(),
          grossPnl: gross,
          fees,
          netPnl: net,
        },
        ...portfolio.closed,
      ],
    });
    setMessage(
      `Posición cerrada: PnL neto ${fmtMoney(net)} (bruto ${fmtMoney(gross)}, costes ${fmtMoney(fees)}).`,
    );
  }

  const equity = useMemo(() => {
    if (!portfolio) return 0;
    let total = portfolio.cash;
    for (const p of portfolio.positions) {
      total += p.quantity * (prices.get(p.symbol) ?? p.entryPrice);
    }
    return total;
  }, [portfolio, prices]);

  const totalPnl = portfolio ? equity - portfolio.initialCapital : 0;
  const closedPnl = portfolio ? portfolio.closed.reduce((s, t) => s + t.netPnl, 0) : 0;

  // Muestreo de la curva: solo mientras la página está abierta (sin procesos
  // en segundo plano en el plan gratuito).
  useEffect(() => {
    if (!ready || !portfolio) return;
    const last = curve[curve.length - 1];
    if (!last || Date.now() - last.t >= CURVE_MIN_GAP_MS) {
      const next = [...curve, { t: Date.now(), e: equity }].slice(-CURVE_MAX_POINTS);
      setCurve(next);
      saveCurve(next);
    }
  }, [ready, portfolio, equity, curve]);

  const maxDrawdownPct = useMemo(() => {
    let peak = -Infinity;
    let dd = 0;
    for (const p of curve) {
      if (p.e > peak) peak = p.e;
      if (peak > 0) dd = Math.max(dd, ((peak - p.e) / peak) * 100);
    }
    return dd;
  }, [curve]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Paper trading</h1>
        <p className="text-sm text-muted">
          Cartera ficticia con comisiones y slippage estimados · persistida en este
          navegador · sin dinero real
        </p>
      </div>

      {!ready || (markets.loading && !markets.data) ? (
        <Loading label="Consultando precios…" />
      ) : markets.error && !markets.data ? (
        <ErrorBox title="No se pudieron consultar precios" message={markets.error} />
      ) : !portfolio ? (
        <Card title="Crear cartera de simulación">
          <p className="text-sm text-muted">
            Se creará una cartera con{" "}
            <strong className="text-foreground">
              {fmtMoney(hydrated ? config.paper.initialCapital : 0)}
            </strong>{" "}
            de dinero ficticio (configurable en Ajustes).
          </p>
          <button
            onClick={createPortfolio}
            className="mt-3 rounded-md bg-accent/20 px-4 py-2 text-sm font-semibold text-accent border border-accent/50 hover:bg-accent/30"
          >
            Crear cartera
          </button>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Capital inicial" value={fmtMoney(portfolio.initialCapital)} />
            <Stat
              label="Capital total actual"
              value={fmtMoney(equity)}
              tone={totalPnl >= 0 ? "up" : "down"}
              hint={`PnL total ${fmtMoney(totalPnl)} (${fmtPercent((totalPnl / portfolio.initialCapital) * 100)})`}
            />
            <Stat label="Efectivo disponible" value={fmtMoney(portfolio.cash)} />
            <Stat
              label="PnL de operaciones cerradas"
              value={fmtMoney(closedPnl)}
              tone={closedPnl >= 0 ? "up" : "down"}
              hint={`${portfolio.closed.length} cerradas · ${portfolio.positions.length} abiertas`}
            />
          </div>

          <Card title="Abrir posición simulada">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-xs text-muted">Activo</span>
                <select
                  value={form.symbol}
                  onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
                  className="input"
                >
                  {[...prices.keys()].sort().map((s) => (
                    <option key={s} value={s}>
                      {s} — {fmtPrice(prices.get(s))}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-muted">
                  Fracción del efectivo ({fmtNum(form.fraction * 100, 0)} %)
                </span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={form.fraction * 100}
                  onChange={(e) => setForm((f) => ({ ...f, fraction: Number(e.target.value) / 100 }))}
                  className="w-full"
                />
              </label>
              <div className="flex items-end">
                <button
                  onClick={openPosition}
                  disabled={portfolio.cash <= 0}
                  className="w-full rounded-md bg-up/20 px-4 py-2 text-sm font-semibold text-up border border-up/50 hover:bg-up/30 disabled:opacity-50"
                >
                  Comprar (simulado)
                </button>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Se aplican comisión del{" "}
              {hydrated ? config.costs.commissionPercent : "…"} % por lado y slippage
              estimado del {hydrated ? config.costs.slippagePercent : "…"} % (ajustables en
              Ajustes). Solo posiciones largas en v1.
            </p>
          </Card>

          {message && (
            <div className="rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm">
              {message}
            </div>
          )}

          <Card title="Curva de capital">
            {curve.length < 2 ? (
              <EmptyState message="Aún no hay suficientes puntos: la curva se muestrea aproximadamente cada 30 s mientras esta página permanece abierta." />
            ) : (
              <>
                <EquitySparkline points={curve} initial={portfolio.initialCapital} />
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <Stat label="Puntos registrados" value={curve.length} />
                  <Stat
                    label="Drawdown máximo"
                    value={fmtPercent(maxDrawdownPct)}
                    tone={maxDrawdownPct > 0 ? "down" : undefined}
                  />
                  <Stat label="Último punto" value={fmtDateTime(curve[curve.length - 1].t)} />
                </div>
                <p className="mt-2 text-[11px] text-muted">
                  La línea discontinua marca el capital inicial. Con Vercel Hobby no
                  existen procesos permanentes: para una curva continua e histórica se
                  requeriría persistencia en Supabase (Etapa 7).
                </p>
              </>
            )}
          </Card>

          <Card title="Posiciones abiertas">
            {portfolio.positions.length === 0 ? (
              <EmptyState message="Sin posiciones abiertas." />
            ) : (
              <div className="overflow-x-auto">
                <table className="table-terminal w-full text-sm">
                  <thead>
                    <tr>
                      <th>Activo</th>
                      <th className="text-right">Cantidad</th>
                      <th className="text-right">Precio entrada</th>
                      <th className="text-right">Precio actual</th>
                      <th className="text-right">PnL no realizado</th>
                      <th>Abierta</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.positions.map((p) => {
                      const current = prices.get(p.symbol) ?? p.entryPrice;
                      const unrealized = p.quantity * (current - p.entryPrice) - p.entryFee;
                      return (
                        <tr key={p.id}>
                          <td className="font-mono">{p.symbol}</td>
                          <td className="text-right font-mono">{fmtNum(p.quantity, 6)}</td>
                          <td className="text-right font-mono">{fmtPrice(p.entryPrice)}</td>
                          <td className="text-right font-mono">{fmtPrice(current)}</td>
                          <td className={`text-right font-mono ${unrealized >= 0 ? "text-up" : "text-down"}`}>
                            {fmtMoney(unrealized)}
                          </td>
                          <td className="text-xs text-muted">{fmtDateTime(p.entryTime)}</td>
                          <td>
                            <button
                              onClick={() => closePosition(p.id)}
                              className="rounded-md border border-down/50 bg-down/10 px-3 py-1 text-xs text-down hover:bg-down/20"
                            >
                              Cerrar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Historial de operaciones cerradas">
            {portfolio.closed.length === 0 ? (
              <EmptyState message="Aún no hay operaciones cerradas." />
            ) : (
              <div className="overflow-x-auto max-h-80 overflow-y-auto">
                <table className="table-terminal w-full text-sm">
                  <thead>
                    <tr>
                      <th>Activo</th>
                      <th className="text-right">Cantidad</th>
                      <th className="text-right">Entrada</th>
                      <th className="text-right">Salida</th>
                      <th className="text-right">PnL bruto</th>
                      <th className="text-right">Costes</th>
                      <th className="text-right">PnL neto</th>
                      <th>Cerrada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.closed.map((t) => (
                      <tr key={t.id}>
                        <td className="font-mono">{t.symbol}</td>
                        <td className="text-right font-mono">{fmtNum(t.quantity, 6)}</td>
                        <td className="text-right font-mono">{fmtPrice(t.entryPrice)}</td>
                        <td className="text-right font-mono">{fmtPrice(t.exitPrice)}</td>
                        <td className="text-right font-mono">{fmtMoney(t.grossPnl)}</td>
                        <td className="text-right font-mono text-muted">{fmtMoney(t.fees)}</td>
                        <td className={`text-right font-mono ${t.netPnl >= 0 ? "text-up" : "text-down"}`}>
                          {fmtMoney(t.netPnl)}
                        </td>
                        <td className="text-xs text-muted">{fmtDateTime(t.exitTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Zona peligrosa">
            {!confirmReset ? (
              <button
                onClick={() => setConfirmReset(true)}
                className="rounded-md border border-down/50 bg-down/10 px-4 py-2 text-sm text-down hover:bg-down/20"
              >
                Reiniciar cartera de simulación
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-warning">
                  ¿Seguro? Se borrará el historial de esta cartera. Esta acción no se
                  puede deshacer.
                </span>
                <button
                  onClick={() => {
                    savePortfolio(null);
                    setPortfolio(null);
                    saveCurve([]);
                    setCurve([]);
                    setConfirmReset(false);
                    setMessage(null);
                  }}
                  className="rounded-md border border-down bg-down/20 px-4 py-2 text-sm font-semibold text-down hover:bg-down/30"
                >
                  Sí, borrar todo
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="rounded-md border border-border-subtle bg-surface-2 px-4 py-2 text-sm"
                >
                  Cancelar
                </button>
              </div>
            )}
          </Card>
        </>
      )}

      <p className="text-xs text-muted">
        <Badge tone="warning">Simulación</Badge> Los precios de ejecución provienen del
        ticker de 24 h de Binance y no simulan un libro de órdenes real. La curva de
        capital histórica completa y el seguimiento de señales emitidas llegarán con la
        persistencia en Supabase (Etapa 7).
      </p>
    </div>
  );
}

/** Curva de capital en SVG puro (sin dependencias): línea sobre capital inicial. */
function EquitySparkline({ points, initial }: { points: EquityPoint[]; initial: number }) {
  const values = points.map((p) => p.e);
  const min = Math.min(...values, initial);
  const max = Math.max(...values, initial);
  const span = max - min || 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * 100;
  const y = (e: number) => 38 - ((e - min) / span) * 36;
  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(2)},${y(p.e).toFixed(2)}`)
    .join(" ");
  const rising = values[values.length - 1] >= initial;
  const baseY = y(initial);
  return (
    <svg
      viewBox="0 0 100 40"
      preserveAspectRatio="none"
      className="h-32 w-full"
      role="img"
      aria-label="Curva de capital del portafolio simulado"
    >
      <line
        x1={0}
        x2={100}
        y1={baseY}
        y2={baseY}
        stroke="currentColor"
        className="text-muted"
        strokeWidth={0.6}
        strokeDasharray="2 2"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        className={rising ? "text-up" : "text-down"}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
