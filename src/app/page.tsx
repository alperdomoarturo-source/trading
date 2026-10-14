"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { Badge, Card, EmptyState, ErrorBox, Loading, Stat } from "@/components/ui";
import { SignalCard } from "@/components/SignalCard";
import { useApi } from "@/lib/client/hooks";
import { notifySignal } from "@/lib/client/notifications";
import { useConfig } from "@/lib/client/settings";
import type { MarketsResponse, SignalsResponse } from "@/lib/client/api-types";
import { describeTrendWindow } from "@/lib/simulation/duration";
import { fmtPrice, timeAgo } from "@/lib/format";

export default function DashboardPage() {
  const { config, hydrated } = useConfig();

  const signalsUrl = useMemo(() => {
    if (!hydrated) return null;
    const p = new URLSearchParams({
      interval: config.defaultInterval,
      symbols: config.watchlist.join(","),
    });
    return `/api/signals?${p.toString()}`;
  }, [hydrated, config]);

  const markets = useApi<MarketsResponse>("/api/markets", 60_000);
  const signals = useApi<SignalsResponse>(signalsUrl, 90_000);

  const assets = markets.data?.assets ?? [];
  const bySymbol = new Map(assets.map((a) => [a.symbol, a]));
  const watchAssets = hydrated
    ? config.watchlist.map((s) => bySymbol.get(s) ?? { symbol: s, market: "crypto" as const, name: s })
    : [];

  const sigList = signals.data?.signals ?? [];
  const interesting = sigList.filter((s) => s.signal.kind === "BUY" || s.signal.kind === "SELL");

  // Alertas del navegador: solo si el usuario las autorizó en Configuración.
  // notifySignal deduplica por (símbolo, intervalo, vela, tipo).
  useEffect(() => {
    for (const s of signals.data?.signals ?? []) notifySignal(s.signal);
  }, [signals.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Panel principal</h1>
          <p className="text-sm text-muted">
            Análisis y simulación · sin operaciones con dinero real
          </p>
        </div>
        <div className="text-xs text-muted">
          Última actualización: {timeAgo(markets.fetchedAt ?? signals.fetchedAt)}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Fuente de datos (Binance)"
          value={markets.loading && !markets.data ? "…" : markets.data ? (markets.data.providerStatus === "ok" ? "Operativa" : "Con errores") : "Sin datos"}
          tone={markets.data?.providerStatus === "ok" ? "up" : markets.data ? "down" : undefined}
          hint="API pública · límites respetados con caché"
        />
        <Stat
          label="Motor de señales"
          value={signals.data ? "Activo (reglas v1)" : signals.error ? "Error" : "…"}
          tone={signals.error ? "down" : undefined}
          hint="Probabilidades ML: Etapa 4"
        />
        <Stat
          label="Activos vigilados"
          value={hydrated ? config.watchlist.length : "…"}
          hint={`Temporalidad ${hydrated ? config.defaultInterval : "…"}`}
        />
        <Stat
          label="Señales operables ahora"
          value={interesting.length}
          tone={interesting.length > 0 ? "up" : undefined}
          hint="COMPRA/VENTA simulada sobre velas cerradas"
        />
      </div>

      {markets.error && (
        <ErrorBox
          title="La fuente de datos cripto no responde"
          message={`${markets.error} — las señales de cripto pueden estar degradadas. Los demás paneles siguen disponibles.`}
        />
      )}

      <Card
        title="Activos vigilados"
        actions={
          <Link href="/explorer" className="text-sm text-accent hover:underline">
            Explorar activos →
          </Link>
        }
      >
        {markets.loading && !markets.data ? (
          <Loading label="Consultando precios…" />
        ) : watchAssets.length === 0 ? (
          <EmptyState message="Sin activos en la vigilancia. Añádelos desde el explorador o la configuración." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {watchAssets.map((a) => {
              const sig = sigList.find((s) => s.symbol === a.symbol);
              return (
                <Link
                  key={a.symbol}
                  href={`/analysis/${a.symbol}`}
                  className="rounded-lg border border-border-subtle bg-surface-2/40 p-3 transition-colors hover:border-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{a.name ?? a.symbol}</span>
                    {sig && (
                      <Badge
                        tone={
                          sig.verdict.tone === "up" ? "up" : sig.verdict.tone === "down" ? "down" : "neutral"
                        }
                      >
                        {sig.verdict.label}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 font-mono text-lg">{fmtPrice(a.price)}</div>
                  <div
                    className={`text-sm ${
                      (a.changePercent24h ?? 0) >= 0 ? "text-up" : "text-down"
                    }`}
                  >
                    {a.changePercent24h !== undefined
                      ? `${a.changePercent24h >= 0 ? "+" : ""}${a.changePercent24h.toFixed(2)} % (24 h)`
                      : "sin variación"}
                  </div>
                  {sig && (
                    <div className="mt-1 text-[11px] leading-snug text-muted">
                      {sig.trendWindow
                        ? describeTrendWindow(sig.trendWindow, signals.data?.interval ?? "")
                        : sig.verdict.detail}
                    </div>
                  )}
                  <div className="mt-1 text-[11px] text-muted font-mono">{a.symbol}</div>
                </Link>
              );
            })}
          </div>
        )}
      </Card>

      <Card
        title={`Últimas señales (${hydrated ? config.defaultInterval : "…"})`}
        actions={
          <Link href="/signals" className="text-sm text-accent hover:underline">
            Centro de señales →
          </Link>
        }
      >
        {signals.loading && !signals.data ? (
          <Loading label="Evaluando señales…" />
        ) : signals.error ? (
          <ErrorBox title="No se pudieron generar señales" message={signals.error} />
        ) : sigList.length === 0 ? (
          <EmptyState message="Sin señales que mostrar." />
        ) : (
          <div className="space-y-3">
            {sigList.slice(0, 4).map((s) => (
              <SignalCard
                key={s.symbol}
                signal={s.signal}
                verdict={s.verdict}
                trendWindow={s.trendWindow}
                compact
              />
            ))}
          </div>
        )}
      </Card>

      <Card title="Avisos del sistema">
        <ul className="space-y-1.5 text-sm text-muted">
          <li>
            La plataforma está en modo simulación: no se conecta a corretajes ni envía
            órdenes reales.
          </li>
          <li>
            El mercado de acciones EE. UU. (proveedor Stooq) está disponible con datos
            retrasados de cierre (EOD): nunca se presentan como tiempo real.
          </li>
          <li>
            Las probabilidades del modelo ML aparecen en la página de análisis cuando hay
            un modelo entrenado en <code>data/models</code>; sin modelo se muestra
            «Predicción no disponible». Entrenamiento: <code>python ml/train.py</code> (local).
          </li>
          <li>
            Puedes activar alertas del navegador para nuevas señales en Configuración;
            solo se notifican mientras esta aplicación está abierta.
          </li>
          {markets.data?.providerStatus === "error" && (
            <li className="text-warning">
              ⚠ Fuente cripto degradada: {markets.data.error}
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}
