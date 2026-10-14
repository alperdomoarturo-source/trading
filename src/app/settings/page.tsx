"use client";

import { useEffect, useState } from "react";
import { Badge, Card } from "@/components/ui";
import {
  currentPermission,
  enableNotifications,
  notificationsSupported,
  type PermissionState,
} from "@/lib/client/notifications";
import { useConfig } from "@/lib/client/settings";
import { CRYPTO_ASSETS } from "@/lib/market/symbols";
import { DEFAULT_CONFIG } from "@/lib/config/defaults";

const INTERVAL_OPTIONS = ["15m", "30m", "1h", "4h", "12h", "1d"];

export default function SettingsPage() {
  const { config, update, reset, hydrated } = useConfig();
  const [saved, setSaved] = useState(false);

  if (!hydrated) {
    return <p className="text-muted">Cargando configuración…</p>;
  }

  const flash = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const toggleWatchlist = (symbol: string) => {
    const has = config.watchlist.includes(symbol);
    const next = has
      ? config.watchlist.filter((s) => s !== symbol)
      : [...config.watchlist, symbol];
    update({ watchlist: next });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Configuración</h1>
          <p className="text-sm text-muted">
            Se guarda en este navegador (localStorage). El motor del servidor recibe
            estos valores en cada consulta.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && <Badge tone="up">Guardado</Badge>}
          <button
            onClick={() => {
              reset();
              flash();
            }}
            className="rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-sm hover:border-warning"
          >
            Restaurar valores por defecto
          </button>
        </div>
      </div>

      <Card title="Activos vigilados">
        <div className="flex flex-wrap gap-2">
          {CRYPTO_ASSETS.map((a) => {
            const active = config.watchlist.includes(a.symbol);
            return (
              <button
                key={a.symbol}
                onClick={() => toggleWatchlist(a.symbol)}
                aria-pressed={active}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  active
                    ? "bg-accent/20 text-accent border border-accent/50"
                    : "bg-surface-2 text-muted border border-border-subtle hover:text-foreground"
                }`}
              >
                {a.symbol}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-muted">
          El panel y el centro de señales consultan estos activos (máx. 10).
        </p>
      </Card>

      <NotificationsCard />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Señales">
          <div className="space-y-3">
            <Row label="Temporalidad por defecto">
              <select
                value={config.defaultInterval}
                onChange={(e) => {
                  update({ defaultInterval: e.target.value });
                  flash();
                }}
                className="input"
              >
                {INTERVAL_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </Row>
            <Row label={`Umbral mínimo de señal (${config.signals.minScore})`}>
              <input
                type="range"
                min={10}
                max={95}
                value={config.signals.minScore}
                onChange={(e) => update({ signals: { ...config.signals, minScore: Number(e.target.value) } })}
                onMouseUp={flash}
                onTouchEnd={flash}
                className="w-full"
              />
            </Row>
            <Row label={`ADX mínimo (${config.signals.minAdx})`}>
              <input
                type="range"
                min={0}
                max={60}
                value={config.signals.minAdx}
                onChange={(e) => update({ signals: { ...config.signals, minAdx: Number(e.target.value) } })}
                onMouseUp={flash}
                onTouchEnd={flash}
                className="w-full"
              />
            </Row>
            <Row label={`Horizonte de predicción (${config.signals.horizonCandles} velas)`}>
              <input
                type="range"
                min={1}
                max={50}
                value={config.signals.horizonCandles}
                onChange={(e) => update({ signals: { ...config.signals, horizonCandles: Number(e.target.value) } })}
                onMouseUp={flash}
                onTouchEnd={flash}
                className="w-full"
              />
            </Row>
            <Row label={`Volumen relativo mínimo (${config.signals.minRelativeVolume}x)`}>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={config.signals.minRelativeVolume}
                onChange={(e) => {
                  update({ signals: { ...config.signals, minRelativeVolume: Number(e.target.value) } });
                  flash();
                }}
                className="input"
              />
            </Row>
          </div>
        </Card>

        <Card title="Costes estimados">
          <div className="space-y-3">
            <Row label="Comisión por lado (%)">
              <input
                type="number"
                min={0}
                max={2}
                step={0.01}
                value={config.costs.commissionPercent}
                onChange={(e) => {
                  update({ costs: { ...config.costs, commissionPercent: Number(e.target.value) } });
                  flash();
                }}
                className="input"
              />
            </Row>
            <Row label="Spread + slippage por lado (%)">
              <input
                type="number"
                min={0}
                max={2}
                step={0.01}
                value={config.costs.slippagePercent}
                onChange={(e) => {
                  update({ costs: { ...config.costs, slippagePercent: Number(e.target.value) } });
                  flash();
                }}
                className="input"
              />
            </Row>
            <p className="text-xs text-muted">
              Estimaciones tuyas, no las comisiones reales de ningún intermediario. Se
              usan en backtesting y paper trading.
            </p>
          </div>
        </Card>

        <Card title="Paper trading">
          <div className="space-y-3">
            <Row label="Capital inicial ficticio">
              <input
                type="number"
                min={100}
                step={100}
                value={config.paper.initialCapital}
                onChange={(e) => {
                  update({ paper: { ...config.paper, initialCapital: Number(e.target.value) } });
                  flash();
                }}
                className="input"
              />
            </Row>
          </div>
        </Card>

        <Card title="Backtesting">
          <div className="space-y-3">
            <Row label="Capital inicial ficticio">
              <input
                type="number"
                min={100}
                step={100}
                value={config.backtest.initialCapital}
                onChange={(e) => {
                  update({ backtest: { ...config.backtest, initialCapital: Number(e.target.value) } });
                  flash();
                }}
                className="input"
              />
            </Row>
            <Row label="Stop-loss (× ATR)">
              <input
                type="number"
                min={0.5}
                max={10}
                step={0.5}
                value={config.backtest.stopLossAtr}
                onChange={(e) => {
                  update({ backtest: { ...config.backtest, stopLossAtr: Number(e.target.value) } });
                  flash();
                }}
                className="input"
              />
            </Row>
            <Row label="Take-profit (× ATR)">
              <input
                type="number"
                min={0.5}
                max={20}
                step={0.5}
                value={config.backtest.takeProfitAtr}
                onChange={(e) => {
                  update({ backtest: { ...config.backtest, takeProfitAtr: Number(e.target.value) } });
                  flash();
                }}
                className="input"
              />
            </Row>
            <Row label={`Días de historia por defecto (${config.signals.backtestDays})`}>
              <input
                type="range"
                min={7}
                max={730}
                value={config.signals.backtestDays}
                onChange={(e) => update({ signals: { ...config.signals, backtestDays: Number(e.target.value) } })}
                onMouseUp={flash}
                onTouchEnd={flash}
                className="w-full"
              />
            </Row>
          </div>
        </Card>
      </div>

      <Card title="Valores por defecto de referencia">
        <ul className="text-xs text-muted space-y-1 font-mono">
          <li>minScore: {DEFAULT_CONFIG.signals.minScore}</li>
          <li>minAdx: {DEFAULT_CONFIG.signals.minAdx}</li>
          <li>horizonte: {DEFAULT_CONFIG.signals.horizonCandles} velas</li>
          <li>comisión: {DEFAULT_CONFIG.costs.commissionPercent} %/lado</li>
          <li>slippage: {DEFAULT_CONFIG.costs.slippagePercent} %/lado</li>
        </ul>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function NotificationsCard() {
  const [perm, setPerm] = useState<PermissionState | null>(null);

  useEffect(() => {
    setPerm(currentPermission());
  }, []);

  return (
    <Card title="Alertas del navegador">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          tone={
            perm === "granted" ? "up" : perm === "denied" ? "down" : "neutral"
          }
        >
          {perm === null
            ? "Comprobando…"
            : perm === "unsupported"
              ? "No compatible"
              : perm === "granted"
                ? "Autorizadas"
                : perm === "denied"
                  ? "Bloqueadas"
                  : "Sin autorización"}
        </Badge>
        {perm !== "granted" && perm !== "unsupported" && perm !== null && (
          <button
            onClick={async () => setPerm(await enableNotifications())}
            className="rounded-md border border-accent/50 bg-accent/10 px-4 py-2 text-sm font-semibold text-accent hover:bg-accent/20"
          >
            Activar notificaciones
          </button>
        )}
        {perm === "denied" && (
          <span className="text-xs text-muted">
            El navegador bloqueó el permiso; habilítalo desde los ajustes del sitio.
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-muted">
        Solo se notifican señales COMPRA/VENTA confirmadas sobre velas cerradas, una vez
        por vela, y únicamente mientras la aplicación está abierta: los planes
        gratuitos no ofrecen procesos permanentes de envío.
      </p>
      {!notificationsSupported() && (
        <p className="mt-1 text-xs text-warning">
          Este navegador no expone la API de notificaciones.
        </p>
      )}
    </Card>
  );
}
