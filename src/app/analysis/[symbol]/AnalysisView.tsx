"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CandleChart } from "@/components/CandleChart";
import { SignalCard } from "@/components/SignalCard";
import { Badge, Card, EmptyState, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/client/hooks";
import { useConfig } from "@/lib/client/settings";
import type { AnalysisResponse } from "@/lib/client/api-types";
import type { PredictionResult } from "@/lib/ml/types";
import { candleLabel, fmtNum, fmtPercent, fmtPrice, timeAgo } from "@/lib/format";
import { CRYPTO_ASSETS } from "@/lib/market/symbols";

const INTERVAL_OPTIONS = ["15m", "30m", "1h", "4h", "12h", "1d"];

const PATTERN_TONE: Record<string, "up" | "down" | "neutral"> = {
  bullish: "up",
  bearish: "down",
  neutral: "neutral",
};

const PATTERN_LABEL: Record<string, string> = {
  bullish: "Alcista",
  bearish: "Bajista",
  neutral: "Neutral",
};

export function AnalysisView({ symbol: rawSymbol }: { symbol: string }) {
  const symbol = rawSymbol.toUpperCase();
  const { config } = useConfig();
  const [interval, setInterval] = useState<string | null>(null);
  const effectiveInterval = interval ?? config.defaultInterval;
  const [show, setShow] = useState({ ema: true, bb: false, volume: true });

  const url = useMemo(() => {
    const p = new URLSearchParams({
      symbol,
      interval: effectiveInterval,
      limit: String(config.candleLimit),
      minScore: String(config.signals.minScore),
      minAdx: String(config.signals.minAdx),
      horizon: String(config.signals.horizonCandles),
    });
    return `/api/analysis?${p.toString()}`;
  }, [symbol, effectiveInterval, config]);

  const { data, loading, error, fetchedAt, refresh } = useApi<AnalysisResponse>(url, 60_000);

  const asset = CRYPTO_ASSETS.find((a) => a.symbol === symbol);
  const change = data ? data.candles.length > 0 ? ((data.candles[data.candles.length - 1].close / data.candles[Math.max(0, data.candles.length - 25)].close) - 1) * 100 : null : null;
  const recentPatterns = (data?.patterns ?? []).slice().reverse().slice(0, 12);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {asset?.name ?? symbol}{" "}
            <span className="font-mono text-muted">{symbol}</span>
          </h1>
          {data && data.snapshot && (
            <p className="mt-1 font-mono text-2xl">
              {fmtPrice(data.snapshot.close)}{" "}
              <span className={change !== null && change >= 0 ? "text-up" : "text-down"}>
                {fmtPercent(change)}
              </span>
              <span className="ml-2 text-xs text-muted">últimas ~24 velas</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <Badge tone={data.meta.freshness === "fresh" ? "up" : "warning"}>
              {data.meta.freshness === "fresh" ? "Datos frescos" : "Datos rancios"}
              {" · "}
              {timeAgo(fetchedAt ?? data.meta.fetchedAt)}
            </Badge>
          )}
          <button
            onClick={() => void refresh()}
            className="rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-sm hover:border-accent"
          >
            Actualizar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Temporalidad">
          {INTERVAL_OPTIONS.map((i) => (
            <button
              key={i}
              onClick={() => setInterval(i)}
              aria-pressed={effectiveInterval === i}
              className={`rounded-md px-3 py-1.5 text-sm ${
                effectiveInterval === i
                  ? "bg-accent/20 text-accent border border-accent/50"
                  : "bg-surface-2 text-muted border border-border-subtle hover:text-foreground"
              }`}
            >
              {i}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1" role="group" aria-label="Indicadores visibles">
          {(
            [
              ["ema", "EMAs"],
              ["bb", "Bollinger"],
              ["volume", "Volumen"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
              aria-pressed={show[key]}
              className={`rounded-md px-3 py-1.5 text-sm ${
                show[key]
                  ? "bg-surface-2 text-foreground border border-border-subtle"
                  : "bg-transparent text-muted border border-border-subtle"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <Loading label="Obteniendo velas de Binance…" />}
      {error && !data && (
        <ErrorBox
          title="No se pudo obtener el análisis"
          message={`${error} — comprueba tu conexión o el símbolo. Puedes seguir usando otros activos del explorador.`}
        />
      )}
      {data && data.candles.length === 0 && (
        <EmptyState message={`No hay datos para ${symbol} en ${effectiveInterval}.`} />
      )}

      {data && data.candles.length > 0 && (
        <>
          <CandleChart
            candles={data.candles}
            overlays={data.overlays}
            showOverlays={show}
            levels={data.levels}
            patterns={data.patterns.filter((p) => p.index >= data.candles.length - 120)}
            formingLabel={
              data.forming ? "Última vela en formación (provisional)" : null
            }
            height={480}
          />

          {data.meta.warnings.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
              {data.meta.warnings.map((w, i) => (
                <p key={i}>⚠ {w}</p>
              ))}
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Card title="Señal actual">
                <SignalCard signal={data.signal} />
              </Card>

              <Card title="Indicadores de la última vela cerrada">
                {data.snapshot ? (
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <IndicatorTile label="RSI (14)" value={fmtNum(data.snapshot.rsi, 1)} hint={data.snapshot.rsi !== null ? (data.snapshot.rsi > 70 ? "sobrecompra" : data.snapshot.rsi < 30 ? "sobreventa" : "neutral") : undefined} />
                    <IndicatorTile label="ADX (14)" value={fmtNum(data.snapshot.adx, 1)} hint={data.snapshot.adx !== null ? (data.snapshot.adx >= 25 ? "tendencia fuerte" : data.snapshot.adx >= 20 ? "tendencia" : "rango") : undefined} />
                    <IndicatorTile label="MACD hist." value={fmtNum(data.snapshot.macdHistogram, 4)} />
                    <IndicatorTile label="ATR %" value={`${fmtNum(data.snapshot.atrPct, 2)} %`} hint="volatilidad" />
                    <IndicatorTile label="EMA 20" value={fmtPrice(data.snapshot.ema20)} />
                    <IndicatorTile label="EMA 50" value={fmtPrice(data.snapshot.ema50)} />
                    <IndicatorTile label="EMA 200" value={fmtPrice(data.snapshot.ema200)} />
                    <IndicatorTile label="Vol. relativo" value={`${fmtNum(data.snapshot.relativeVolume, 2)}x`} />
                  </div>
                ) : (
                  <EmptyState message="Sin indicadores." />
                )}
              </Card>
            </div>

            <div className="space-y-4">
              <Card title="Patrones recientes">
                {recentPatterns.length === 0 ? (
                  <EmptyState message="Sin patrones detectados en las últimas velas." />
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {recentPatterns.map((p, idx) => (
                      <li key={idx} className="flex items-center justify-between gap-2">
                        <span>{p.name}</span>
                        <span className="flex items-center gap-2">
                          <Badge tone={PATTERN_TONE[p.direction]}>{PATTERN_LABEL[p.direction]}</Badge>
                          <span className="font-mono text-xs text-muted">
                            {candleLabel(data.candles[p.index]?.time ?? 0)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-[11px] text-muted">
                  Un patrón detectado no es una señal por sí mismo: el motor exige
                  tendencia, volumen y contexto antes de operar.
                </p>
              </Card>

              <Card title="Soportes y resistencias">
                <div className="space-y-1.5 text-sm">
                  {data.levels.resistances.slice(0, 3).map((l, i) => (
                    <div key={`r${i}`} className="flex justify-between">
                      <span className="text-down">Resistencia {i + 1}</span>
                      <span className="font-mono">
                        {fmtPrice(l.price)}{" "}
                        <span className="text-xs text-muted">({l.touches} toques)</span>
                      </span>
                    </div>
                  ))}
                  {data.levels.supports.slice(0, 3).map((l, i) => (
                    <div key={`s${i}`} className="flex justify-between">
                      <span className="text-up">Soporte {i + 1}</span>
                      <span className="font-mono">
                        {fmtPrice(l.price)}{" "}
                        <span className="text-xs text-muted">({l.touches} toques)</span>
                      </span>
                    </div>
                  ))}
                  {data.levels.supports.length === 0 && data.levels.resistances.length === 0 && (
                    <EmptyState message="Sin niveles claros en la ventana analizada." />
                  )}
                </div>
                <p className="mt-3 text-[11px] text-muted">
                  Niveles estimados por pivotes fractales agrupados; no son garantía de
                  reacción del precio.
                </p>
              </Card>

              <PredictionPanel symbol={symbol} interval={effectiveInterval} />
            </div>
          </div>

          <p className="text-xs text-muted">
            Proveedor: {data.meta.provider} · Intervalo: {data.interval} ·{" "}
            {data.candles.length} velas · Descargado {timeAgo(data.meta.fetchedAt)} ·{" "}
            <Link href="/explorer" className="text-accent hover:underline">
              volver al explorador
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

function IndicatorTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2/50 p-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 font-mono text-base">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

type PredictionApiResponse = { symbol: string; interval: string } & PredictionResult;

const PROB_ROWS = [
  { key: "up", label: "Subida", bar: "bg-up", text: "text-up" },
  { key: "neutral", label: "Neutra", bar: "bg-muted/50", text: "text-muted" },
  { key: "down", label: "Bajada", bar: "bg-down", text: "text-down" },
] as const;

function PredictionPanel({ symbol, interval }: { symbol: string; interval: string }) {
  const { data, loading } = useApi<PredictionApiResponse>(
    `/api/prediction?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`,
    120_000,
  );

  return (
    <Card title="Predicción (modelo ML)">
      {loading && !data ? (
        <Loading label="Consultando el modelo…" />
      ) : data && data.available ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              Horizonte: <span className="font-mono">{data.horizon}</span> velas ·{" "}
              {data.model.name} v{data.model.version}
            </p>
            <Badge tone={data.direction === "up" ? "up" : data.direction === "down" ? "down" : "neutral"}>
              {data.direction === "up" ? "tendencia alcista" : data.direction === "down" ? "tendencia bajista" : "neutral"}
            </Badge>
          </div>
          <ul className="space-y-2">
            {PROB_ROWS.map(({ key, label, bar, text }) => {
              const p = data.probabilities[key];
              const pct = Math.round(p * 1000) / 10;
              return (
                <li key={key} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span>{label}</span>
                    <span className={`font-mono ${text}`}>{pct.toFixed(1)} %</span>
                  </div>
                  <div
                    className="mt-1 h-2 rounded-full bg-surface-2"
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Probabilidad ${label}`}
                  >
                    <div className={`h-2 rounded-full ${bar}`} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted">
            Modelo entrenado offline {timeAgo(data.trainedAt)} ·{" "}
            {data.dataFreshness.freshness === "fresh" ? "datos frescos" : "datos potencialmente rancios"} ·
            última vela cerrada {candleLabel(data.dataFreshness.lastClosedCandleTime)}
          </p>
          <p className="text-[11px] text-muted">{data.validityNote}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Predicción no disponible</p>
          <p className="text-xs text-muted">
            {data && !data.available ? data.message : "No se pudo consultar el modelo en este momento."}
          </p>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted">
        Las probabilidades son estimaciones de un modelo calibrado fuera de muestra, no garantías.
        No son asesoramiento financiero.
      </p>
    </Card>
  );
}
