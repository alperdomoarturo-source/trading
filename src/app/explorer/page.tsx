"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, EmptyState, ErrorBox, Loading } from "@/components/ui";
import { useApi } from "@/lib/client/hooks";
import type { MarketsResponse } from "@/lib/client/api-types";
import { fmtPrice, timeAgo } from "@/lib/format";

const FAV_KEY = "trading-favorites-v1";

type MarketChoice = "crypto" | "stocks";

function loadFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(FAV_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export default function ExplorerPage() {
  const [market, setMarket] = useState<MarketChoice>("crypto");
  // Cripto: refresco cada 1 min; acciones EOD: cada 5 min (respeta el límite
  // de uso del endpoint gratuito de Stooq y no cambia entre sesiones).
  const { data, loading, error, fetchedAt, refresh } = useApi<MarketsResponse>(
    `/api/markets?market=${market}`,
    market === "crypto" ? 60_000 : 300_000,
  );
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  const toggleFavorite = (symbol: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      try {
        window.localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      } catch {
        // sin localStorage: favoritos solo en memoria
      }
      return next;
    });
  };

  const assets = useMemo(() => {
    // Solo mostramos datos del mercado seleccionado: evita parpadeos con la
    // respuesta anterior mientras se carga el otro mercado.
    const list = data && data.market === market ? data.assets : [];
    const q = search.trim().toUpperCase();
    return list.filter((a) => {
      if (q && !a.symbol.includes(q) && !(a.name ?? "").toUpperCase().includes(q)) return false;
      return true;
    });
  }, [data, search, market]);

  const favsFirst = useMemo(() => {
    return [...assets].sort((a, b) => {
      const fa = favorites.has(a.symbol) ? 0 : 1;
      const fb = favorites.has(b.symbol) ? 0 : 1;
      return fa - fb;
    });
  }, [assets, favorites]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold tracking-tight">Explorador de activos</h1>
        <div className="text-xs text-muted">
          {data && data.market === market
            ? `${data.providerStatus === "ok" ? "Fuente operativa" : "Fuente con errores"} · ${timeAgo(fetchedAt)}`
            : ""}
          <button
            onClick={() => void refresh()}
            className="ml-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-1 hover:border-accent"
          >
            Actualizar
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por símbolo o nombre…"
          aria-label="Buscar activo"
          className="flex-1 min-w-48 rounded-md border border-border-subtle bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="flex gap-1" role="group" aria-label="Seleccionar mercado">
          {(
            [
              ["crypto", "Cripto"],
              ["stocks", "Acciones EE. UU."],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMarket(value)}
              aria-pressed={market === value}
              className={`rounded-md px-3 py-2 text-sm ${
                market === value
                  ? "bg-accent/20 text-accent border border-accent/50"
                  : "bg-surface-2 text-muted border border-border-subtle hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <Loading label="Consultando mercados…" />}
      {error && !data && <ErrorBox title="No se pudo cargar la lista de activos" message={error} />}

      {/* Fallo del proveedor de este mercado: se avisa pero la lista base
          sigue visible y el otro mercado no se ve afectado (degradación
          independiente por mercado). */}
      {data?.providerStatus === "error" && data.market === market && (
        <ErrorBox
          title={`El proveedor ${data.provider} reportó un error`}
          message={`${data.error ?? "Motivo desconocido"} — los precios pueden estar ausentes o desactualizados.`}
        />
      )}

      {market === "stocks" && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          Acciones con datos diferidos: Stooq es un proveedor gratuito que publica
          cotizaciones de cierre de sesión (EOD) con límites de uso por IP. No son
          precios en tiempo real ni deben usarse para decisiones en vivo. Intervalos
          disponibles: 1d y 1w.
        </div>
      )}

      <Card>
        {favsFirst.length === 0 && !loading ? (
          <EmptyState message="Ningún activo coincide con la búsqueda." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-terminal w-full text-sm">
              <thead>
                <tr>
                  <th />
                  <th>Activo</th>
                  <th>Símbolo</th>
                  <th>Mercado</th>
                  <th className="text-right">Precio</th>
                  <th className="text-right">
                    {market === "stocks" ? "Variación última sesión" : "Variación 24 h"}
                  </th>
                  <th>Frescura</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {favsFirst.map((a) => (
                  <tr key={a.symbol} className="hover:bg-surface-2/40">
                    <td>
                      <button
                        onClick={() => toggleFavorite(a.symbol)}
                        aria-label={favorites.has(a.symbol) ? "Quitar de favoritos" : "Añadir a favoritos"}
                        className={`text-lg leading-none ${favorites.has(a.symbol) ? "text-warning" : "text-muted hover:text-warning"}`}
                      >
                        {favorites.has(a.symbol) ? "★" : "☆"}
                      </button>
                    </td>
                    <td>{a.name ?? a.symbol}</td>
                    <td className="font-mono">{a.symbol}</td>
                    <td>
                      <div className="flex gap-1">
                        <Badge>{a.market === "crypto" ? "Cripto" : "Acciones"}</Badge>
                        {a.market === "stocks" && <Badge tone="warning">retrasado (EOD)</Badge>}
                      </div>
                    </td>
                    <td className="text-right font-mono">{fmtPrice(a.price)}</td>
                    <td
                      className={`text-right font-mono ${
                        (a.changePercent24h ?? 0) >= 0 ? "text-up" : "text-down"
                      }`}
                    >
                      {a.changePercent24h !== undefined
                        ? `${a.changePercent24h >= 0 ? "+" : ""}${a.changePercent24h.toFixed(2)} %`
                        : "—"}
                    </td>
                    <td className="text-xs text-muted">
                      {a.price !== undefined ? timeAgo(fetchedAt ?? 0) : "sin datos"}
                    </td>
                    <td>
                      <Link
                        href={`/analysis/${a.symbol}`}
                        className="text-accent hover:underline"
                      >
                        Analizar →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">
        {market === "crypto"
          ? "Precios de la API pública de Binance (24 h según ticker). Cripto opera 24/7; la frescura indica cuándo se consultaron, no retraso del exchange."
          : "Precios de cierre de sesión (EOD) de Stooq, proveedor gratuito con datos diferidos y límites de uso; la frescura indica la última sesión publicada, no un precio en vivo."}
      </p>
    </div>
  );
}
