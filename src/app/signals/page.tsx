"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Card, EmptyState, ErrorBox, Loading } from "@/components/ui";
import { SignalCard } from "@/components/SignalCard";
import { SIGNAL_LABELS, type SignalKind } from "@/lib/signals/types";
import { useApi } from "@/lib/client/hooks";
import { useConfig } from "@/lib/client/settings";
import type { SignalsResponse } from "@/lib/client/api-types";
import { fmtDateTime, fmtPercent, fmtPrice, timeAgo } from "@/lib/format";

/** Tipos del historial persistido (local: solo consume esta página). */
interface LogOutcome {
  outcome: "up" | "down" | "neutral" | "expired";
  resolvedAt: number;
  returnPct: number | null;
  correct: boolean | null;
}

interface LogSignal {
  id: number;
  symbol: string;
  market: string;
  interval: string;
  candleTime: number;
  priceRef: number;
  kind: SignalKind;
  direction: "long" | "short" | null;
  score: number;
  generatedAt: number;
  validUntil: number;
  outcome: LogOutcome | null;
}

interface SignalLogResponse {
  enabled: boolean;
  signals?: LogSignal[];
  resolved?: number;
  error?: string;
}

interface RecordResponse {
  enabled?: boolean;
  recorded?: number;
  duplicates?: number;
  failed?: number;
  error?: string;
}

const OUTCOME_LABELS: Record<LogOutcome["outcome"], string> = {
  up: "Subió",
  down: "Bajó",
  neutral: "Neutro",
  expired: "Expirada (sin datos)",
};

const LOG_KIND_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "BUY", label: "Compra" },
  { value: "SELL", label: "Venta" },
  { value: "WAIT", label: "Esperar" },
  { value: "NONE", label: "Sin señal" },
] as const;

const selectClass =
  "rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent";

const INTERVAL_OPTIONS = ["15m", "30m", "1h", "4h", "12h", "1d"];
const DIRECTION_FILTERS = [
  { value: "all", label: "Todas" },
  { value: "BUY", label: "Compra" },
  { value: "SELL", label: "Venta" },
  { value: "WAIT", label: "Esperar" },
  { value: "NONE", label: "Sin señal" },
  { value: "INSUFFICIENT_DATA", label: "Datos insuficientes" },
] as const;

export default function SignalsCenterPage() {
  const { config, hydrated } = useConfig();
  const [interval, setInterval] = useState<string | null>(null);
  const [direction, setDirection] = useState<(typeof DIRECTION_FILTERS)[number]["value"]>("all");
  const effectiveInterval = interval ?? config.defaultInterval;

  // --- Estado del historial persistido (Etapa 7) ---
  const [logMarket, setLogMarket] = useState("crypto");
  const [logKind, setLogKind] = useState<(typeof LOG_KIND_FILTERS)[number]["value"]>("all");
  const [logInterval, setLogInterval] = useState("all");
  const [logSymbolInput, setLogSymbolInput] = useState("");
  const [logSymbol, setLogSymbol] = useState("");
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordFeedback, setRecordFeedback] = useState<string | null>(null);

  const url = useMemo(() => {
    if (!hydrated) return null;
    const p = new URLSearchParams({
      interval: effectiveInterval,
      symbols: config.watchlist.join(","),
    });
    return `/api/signals?${p.toString()}`;
  }, [hydrated, effectiveInterval, config.watchlist]);

  const { data, loading, error, fetchedAt, refresh } = useApi<SignalsResponse>(url, 90_000);
  const signals = (data?.signals ?? []).filter(
    (s) => direction === "all" || s.signal.kind === (direction as SignalKind),
  );

  const logUrl = useMemo(() => {
    if (!hydrated) return null;
    const p = new URLSearchParams({ market: logMarket, limit: "50" });
    if (logKind !== "all") p.set("direction", logKind);
    if (logInterval !== "all") p.set("interval", logInterval);
    if (logSymbol) p.set("symbol", logSymbol);
    return `/api/signals/log?${p.toString()}`;
  }, [hydrated, logMarket, logKind, logInterval, logSymbol]);

  const {
    data: logData,
    error: logError,
    refresh: refreshLog,
  } = useApi<SignalLogResponse>(logUrl);

  /**
   * Registra las señales actuales de la vigilancia. El servidor re-evalúa con
   * su propio motor (el cliente no envía scores); aquí solo pedimos el
   * registro y mostramos feedback honesto.
   */
  async function handleRecord() {
    setRecordBusy(true);
    setRecordFeedback(null);
    try {
      const res = await fetch("/api/signals/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: effectiveInterval, symbols: config.watchlist.slice(0, 10) }),
      });
      const body = (await res.json()) as RecordResponse;
      if (res.status === 503 && body.enabled === false) {
        setRecordFeedback(
          "La persistencia no está activa (falta configuración de Supabase). El resto de la app sigue funcionando sin ella.",
        );
      } else if (res.status === 429) {
        setRecordFeedback(`Límite alcanzado: ${body.error ?? "intenta de nuevo en un minuto"}.`);
      } else if (!res.ok) {
        setRecordFeedback(`No se pudo registrar: ${body.error ?? res.statusText}.`);
      } else {
        setRecordFeedback(
          `Registro completo: ${body.recorded ?? 0} nuevas, ${body.duplicates ?? 0} ya existían` +
            `${body.failed ? `, ${body.failed} con error de datos` : ""}. Los resultados aparecen cuando vence el horizonte.`,
        );
        void refreshLog();
      }
    } catch {
      setRecordFeedback("Error de red al registrar señales. Revisa la conexión e intenta de nuevo.");
    } finally {
      setRecordBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Centro de señales</h1>
          <p className="text-sm text-muted">
            Señales explicables sobre velas cerradas · horizonte{" "}
            {hydrated ? config.signals.horizonCandles : "…"} velas
          </p>
        </div>
        <div className="text-xs text-muted">
          {data ? `Generadas ${timeAgo(data.generatedAt)}` : ""}
          <button
            onClick={() => void refresh()}
            className="ml-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-1 hover:border-accent"
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
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value as typeof direction)}
          aria-label="Filtrar por dirección"
          className="ml-auto rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-sm outline-none focus:border-accent"
        >
          {DIRECTION_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {loading && !data && <Loading label="Evaluando señales de la vigilancia…" />}
      {error && !data && <ErrorBox title="No se pudieron generar señales" message={error} />}

      {data && signals.length === 0 && (
        <EmptyState
          message={`Ninguna señal con estado ${SIGNAL_LABELS[direction as SignalKind] ?? direction} en este momento.`}
        />
      )}

      <div className="grid gap-3 xl:grid-cols-2">
        {signals.map((s) => (
          <SignalCard key={s.symbol} signal={s.signal} />
        ))}
      </div>

      <Card
        title="Historial de señales (persistido)"
        actions={
          <button
            onClick={() => void handleRecord()}
            disabled={recordBusy || !hydrated}
            className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1 text-sm text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {recordBusy ? "Registrando…" : "Registrar señales ahora"}
          </button>
        }
      >
        {recordFeedback && <p className="mb-3 text-sm text-muted">{recordFeedback}</p>}

        {logError && !logData && (
          <ErrorBox title="No se pudo leer el historial" message={logError} />
        )}

        {logData && logData.enabled === false && (
          <div className="rounded-lg border border-accent/40 bg-accent/10 p-4 text-sm">
            <div className="font-semibold text-accent">Persistencia no configurada (opcional)</div>
            <p className="mt-1 text-muted">
              El historial en base de datos requiere un proyecto Supabase gratuito con las
              migraciones aplicadas y las variables de entorno definidas; ver las instrucciones en{" "}
              <span className="font-mono text-foreground">supabase/README.md</span>. Sin él, todo lo
              demás sigue funcionando exactamente igual: las señales en vivo no dependen de la
              persistencia.
            </p>
          </div>
        )}

        {logData && logData.enabled === true && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={logMarket}
                onChange={(e) => setLogMarket(e.target.value)}
                aria-label="Filtrar historial por mercado"
                className={selectClass}
              >
                <option value="crypto">Cripto</option>
                <option value="stocks">Acciones</option>
              </select>
              <select
                value={logKind}
                onChange={(e) => setLogKind(e.target.value as typeof logKind)}
                aria-label="Filtrar historial por dirección"
                className={selectClass}
              >
                {LOG_KIND_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
              <select
                value={logInterval}
                onChange={(e) => setLogInterval(e.target.value)}
                aria-label="Filtrar historial por temporalidad"
                className={selectClass}
              >
                <option value="all">Todas las temporalidades</option>
                {INTERVAL_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  setLogSymbol(logSymbolInput.trim().toUpperCase());
                }}
                className="ml-auto flex items-center gap-2"
              >
                <input
                  value={logSymbolInput}
                  onChange={(e) => setLogSymbolInput(e.target.value)}
                  placeholder="Símbolo (p. ej. BTCUSDT)"
                  aria-label="Filtrar historial por símbolo"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-sm outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  className="rounded-md border border-border-subtle bg-surface-2 px-2 py-1.5 text-sm hover:border-accent"
                >
                  Buscar
                </button>
              </form>
            </div>

            {(logData.signals ?? []).length === 0 ? (
              <EmptyState message="Aún no hay señales registradas. Usa «Registrar señales ahora» para guardar las actuales." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-muted">
                    <tr className="border-b border-border-subtle">
                      <th className="py-2 pr-3 font-medium">Fecha</th>
                      <th className="py-2 pr-3 font-medium">Activo</th>
                      <th className="py-2 pr-3 font-medium">Temp.</th>
                      <th className="py-2 pr-3 font-medium">Dirección</th>
                      <th className="py-2 pr-3 font-medium">Score</th>
                      <th className="py-2 pr-3 font-medium">Precio ref</th>
                      <th className="py-2 font-medium">Resultado tras horizonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(logData.signals ?? []).map((s) => (
                      <tr key={s.id} className="border-b border-border-subtle/50">
                        <td className="py-2 pr-3 whitespace-nowrap text-muted">{fmtDateTime(s.generatedAt)}</td>
                        <td className="py-2 pr-3 font-mono">{s.symbol}</td>
                        <td className="py-2 pr-3">{s.interval}</td>
                        <td className="py-2 pr-3">
                          <Badge
                            tone={s.kind === "BUY" ? "up" : s.kind === "SELL" ? "down" : s.kind === "WAIT" ? "warning" : "neutral"}
                          >
                            {SIGNAL_LABELS[s.kind]}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 font-mono">{s.score}</td>
                        <td className="py-2 pr-3 font-mono">{fmtPrice(s.priceRef)}</td>
                        <td className="py-2 whitespace-nowrap">
                          {s.outcome ? (
                            <span className="inline-flex items-center gap-2">
                              <Badge
                                tone={
                                  s.outcome.outcome === "up"
                                    ? "up"
                                    : s.outcome.outcome === "down"
                                      ? "down"
                                      : s.outcome.outcome === "neutral"
                                        ? "warning"
                                        : "neutral"
                                }
                              >
                                {OUTCOME_LABELS[s.outcome.outcome]}
                              </Badge>
                              <span className="font-mono text-xs">{fmtPercent(s.outcome.returnPct)}</span>
                              {s.outcome.correct !== null && (
                                <span className={s.outcome.correct ? "text-up" : "text-down"}>
                                  {s.outcome.correct ? "✔ asertiva" : "✘ falló"}
                                </span>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">
                              pendiente · vence {fmtDateTime(s.validUntil)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-muted">
              Señales inmutables y resultados escritos solo tras vencer el horizonte; nunca se
              recalculan históricamente. Las señales pendientes se resuelven de forma oportunista
              al leer este historial (en el plan gratuito no hay jobs en segundo plano garantizados).
            </p>
          </div>
        )}
      </Card>

      <Card title="Cómo leer estas señales">
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
          <li>
            <strong>COMPRA/VENTA SIMULADA</strong>: confluencia de condiciones por encima
            del umbral configurado (puntuación ≥ {hydrated ? config.signals.minScore : "…"} y
            ADX ≥ {hydrated ? config.signals.minAdx : "…"}).
          </li>
          <li>
            <strong>ESPERAR</strong>: hay indicios pero sin ventaja suficiente; la
            abstención es una decisión válida del sistema.
          </li>
          <li>
            <strong>SIN SEÑAL</strong>: sin confluencia o datos rancios que impiden
            confirmar.
          </li>
          <li>
            <strong>DATOS INSUFICIENTES</strong>: el historial no alcanza para EMA200
            (~220 velas).
          </li>
          <li>
            Umbral y ADX son configurables en{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Configuración
            </Link>
            .
          </li>
        </ul>
      </Card>
    </div>
  );
}
