"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CandleChart } from "@/components/CandleChart";
import { SignalCard } from "@/components/SignalCard";
import { Badge, Card, EmptyState, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/client/hooks";
import { useConfig } from "@/lib/client/settings";
import type { AnalysisResponse, TickerResponse } from "@/lib/client/api-types";
import { INTERVAL_MS } from "@/lib/market/types";
import { buildProjection } from "@/lib/simulation/projection";
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

  const predictionUrl = `/api/prediction?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(effectiveInterval)}`;
  const prediction = useApi<PredictionApiResponse>(predictionUrl, 120_000);
  const predResult = prediction.data && prediction.data.available ? prediction.data : null;

  const live = useApi<TickerResponse>(`/api/ticker?symbol=${encodeURIComponent(symbol)}`, 20_000);

  const projection = useMemo(() => {
    if (!data || !data.candles.length) return null;
    const lastClosed = data.signal.candleTime
      ? { time: data.signal.candleTime, close: data.signal.priceRef }
      : null;
    const atrPct = data.snapshot?.atrPct ?? null;
    if (!lastClosed || !predResult) return null;
    return buildProjection({
      lastClosedTime: lastClosed.time,
      close: lastClosed.close,
      atrPct,
      intervalMs: INTERVAL_MS[data.interval] ?? 3_600_000,
      probabilities: predResult.probabilities,
      horizon: predResult.horizon,
    });
  }, [data, predResult]);

  const asset = CRYPTO_ASSETS.find((a) => a.symbol === symbol);
  const change = data ? data.candles.length > 0 ? ((data.candles[data.candles.length - 1].close / data.candles[Math.max(0, data.candles.length - 25)].close) - 1) * 100 : null : null;
  const recentPatterns = (data?.patterns ?? []).slice().reverse().slice(0, 12);

  /**
   * Precio visible: última operación del ticker (20 s de caché), no la última
   * vela cerrada; en 1h la vela cerrada sólo cambia cada hora y parece congelada.
   */
  const livePrice = live.data?.price ?? data?.forming?.close ?? data?.snapshot?.close ?? null;
  const liveChange = live.data?.changePercent24h ?? change;
  const closedAt = data && data.signal.candleTime ? candleLabel(data.signal.candleTime) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            {asset?.name ?? symbol}{" "}
            <span className="font-mono text-muted">{symbol}</span>
          </h1>
          {data && data.snapshot && (
            <div className="mt-1">
              <p className="font-mono text-2xl">
                {fmtPrice(livePrice)}{" "}
                <span className={liveChange !== null && liveChange >= 0 ? "text-up" : "text-down"}>
                  {fmtPercent(liveChange)}
                </span>
                <span className="ml-2 text-xs text-muted">
                  {live.data ? "variación 24 h" : "últimas ~24 velas"}
                </span>
              </p>
              <p className="text-xs text-muted">
                {live.data
                  ? `última operación ${timeAgo(live.data.fetchedAt)}`
                  : live.error
                    ? "precio en vivo no disponible"
                    : "consultando precio en vivo…"}
                {closedAt ? ` · vela ${data.interval} cerrada ${fmtPrice(data.snapshot.close)} (${closedAt}), que es la que usa el motor` : ""}
              </p>
            </div>
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
            onClick={() => {
              void refresh();
              void live.refresh();
            }}
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
          <ActionPlanCard
            signal={data}
            prediction={predResult}
            predictionMessage={
              prediction.data && !prediction.data.available ? prediction.data.message : null
            }
            projection={projection}
          />

          <CandleChart
            candles={data.candles}
            overlays={data.overlays}
            showOverlays={show}
            levels={data.levels}
            patterns={data.patterns.filter((p) => p.index >= data.candles.length - 120)}
            formingLabel={
              data.forming ? "Última vela en formación (provisional)" : null
            }
            projection={projection}
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

              <PredictionPanel data={prediction.data} loading={prediction.loading} />
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

type AvailablePrediction = Extract<PredictionResult, { available: true }>;

interface ActionPlan {
  tone: "up" | "down" | "neutral";
  title: string;
  note: string;
  reasons: string[];
}

function planFor(
  data: AnalysisResponse,
  pred: AvailablePrediction | null,
  mlMessage: string | null,
): ActionPlan {
  const sig = data.signal;
  const ruleReasons = sig.reasons.slice(0, 3).map((r) => `${r.text} (+${r.weight})`);
  if (sig.kind === "BUY") {
    return {
      tone: "up",
      title: "SEÑAL: COMPRAR (simulada)",
      note: `Motor de reglas · score ${sig.score} · vigente hasta ${candleLabel(sig.validUntil)}.`,
      reasons: ruleReasons,
    };
  }
  if (sig.kind === "SELL") {
    return {
      tone: "down",
      title: "SEÑAL: VENDER (simulada)",
      note: `Motor de reglas · score ${sig.score} · vigente hasta ${candleLabel(sig.validUntil)}.`,
      reasons: ruleReasons,
    };
  }
  if (pred) {
    const { up, down } = pred.probabilities;
    const diff = up - down;
    const edge = Math.abs(diff);
    const pts = (x: number) => Math.round(x * 100);
    const baseReasons = ruleReasons.length
      ? ruleReasons
      : [`Reglas sin dirección dominante (bull ${sig.bullScore} / bear ${sig.bearScore})`];
    if (edge >= 0.08) {
      return {
        tone: diff > 0 ? "up" : "down",
        title: diff > 0 ? "COMPRA OBSERVACIONAL — vigilar, no operar" : "VENTA OBSERVACIONAL — vigilar, no operar",
        note: `Solo el modelo ML inclina a ${diff > 0 ? "subida" : "bajada"} (P↑ ${pts(up)}% vs P↓ ${pts(down)}%, margen ${pts(edge)} pts). El motor de reglas NO confirma: sin confluencia de tendencia/volumen esto no es una señal operativa.`,
        reasons: baseReasons,
      };
    }
    if (edge >= 0.01) {
      return {
        tone: diff > 0 ? "up" : "down",
        title: diff > 0 ? "TENDENCIA LEVE A COMPRAR (solo observación)" : "TENDENCIA LEVE A VENDER (solo observación)",
        note: `El ML favorece levemente ${diff > 0 ? "la subida" : "la bajada"} (P↑ ${pts(up)}% vs P↓ ${pts(down)}%: solo ${pts(edge)} pts de margen). Con un modelo cuya precisión fuera de muestra es ~0.38, este margen es ruido plausible: NO es señal de compra/venta, solo la estimación direccional actual.`,
        reasons: baseReasons,
      };
    }
    return {
      tone: "neutral",
      title: "ESPERAR",
      note: `El ML está prácticamente empatado (P↑ ${pts(up)}% vs P↓ ${pts(down)}%) y las reglas no confirman dirección. En empate técnico la decisión honesta es no tener sesgo.`,
      reasons: baseReasons,
    };
  }
  const why = sig.kind === "WAIT"
    ? "Hay condiciones parciales pero la puntuación aún no supera el umbral."
    : sig.kind === "INSUFFICIENT_DATA"
      ? "Faltan velas cerradas para evaluar (se necesitan 220+)."
      : sig.kind === "DATA_ERROR"
        ? "No se pudieron obtener datos del proveedor."
        : "Ninguna dirección supera los umbrales de confluencia del motor.";
  return {
    tone: "neutral",
    title: mlMessage ? "ESPERAR — sin modelo ML para este par" : "ESPERAR",
    note: `${why} ${mlMessage ?? "Sin predicción ML disponible para afinar el sesgo."}`,
    reasons: ruleReasons,
  };
}

function ActionPlanCard({
  signal: data,
  prediction,
  predictionMessage,
  projection,
}: {
  signal: AnalysisResponse;
  prediction: AvailablePrediction | null;
  predictionMessage: string | null;
  projection: ReturnType<typeof buildProjection>;
}) {
  const plan = planFor(data, prediction, predictionMessage);
  const toneClass =
    plan.tone === "up" ? "border-up/50 text-up" : plan.tone === "down" ? "border-down/50 text-down" : "border-border-subtle text-foreground";
  return (
    <Card title="Plan de acción (motor de reglas + modelo ML)">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-lg border px-4 py-2 text-lg font-bold tracking-wide ${toneClass}`}>
          {plan.title}
        </span>
        {projection && (
          <Badge tone={projection.scenario === "up" ? "up" : projection.scenario === "down" ? "down" : "neutral"}>
            Escenario {projection.scenario === "up" ? "alcista" : projection.scenario === "down" ? "bajista" : "lateral"}{" "}
            {fmtNum(projection.expectedMovePercent, 2)} % en {projection.horizon} velas
          </Badge>
        )}
      </div>
      <p className="mt-2 text-sm">{plan.note}</p>
      {plan.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
          {plan.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      {projection && (
        <p className="mt-3 text-[11px] text-muted">
          En el gráfico, las líneas punteadas muestran un cono hipotético: trayectoria central = deriva de
          {` ${(projection.edge * 100).toFixed(0)} pts de margen del modelo × ATR `}
          ({fmtNum(data.snapshot?.atrPct ?? 0, 2)} % por vela); bandas = ±ATR·√k. Movimiento esperado{" "}
          {fmtNum(projection.expectedMovePercent, 2)} % y banda ±{fmtNum(projection.bandPercentAtHorizon, 2)} % al final
          del horizonte. Es un escenario ilustrativo calibrado con volatilidad observada, NO un precio previsto ni una garantía.
        </p>
      )}
    </Card>
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

function PredictionPanel({
  data,
  loading,
}: {
  data: PredictionApiResponse | null;
  loading: boolean;
}) {
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
