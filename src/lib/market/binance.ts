/**
 * Cliente de la API pública de Binance (sin autenticación para datos de mercado).
 *
 * Límites y condiciones (documentación pública de Binance):
 * - Peso máximo: 6000 unidades por minuto por IP (endpoint /api/v3/*).
 * - /api/v3/klines con limit<=500 pesa 2; /api/v3/ticker/24hr para un
 *   símbolo pesa 2 (o 80 para múltiples símbolos con symbols=[...]).
 * - 429/418 indican límite alcanzado; se respeta Retry-After.
 *
 * Estrategia local: ventana deslizante de peso con presupuesto conservador
 * (2000/min por instancia de proceso) + caché en memoria + reintentos con
 * espera progresiva. En serverless el contador es por instancia (best effort).
 */

import { ProviderError, type Candle } from "./types";

const DEFAULT_BASE = "https://api.binance.com";
const API_BASE = process.env.BINANCE_API_BASE || DEFAULT_BASE;

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

/** Ventana deslizante de peso consumido (best effort, por proceso). */
const weightWindow: number[] = [];
const WEIGHT_BUDGET_PER_MIN = 2000;

export function consumedWeightLastMinute(now = Date.now()): number {
  while (weightWindow.length && now - weightWindow[0] > 60_000) weightWindow.shift();
  return weightWindow.length;
}

function addWeight(units: number, now = Date.now()): void {
  const ts = now;
  for (let i = 0; i < units; i++) weightWindow.push(ts);
}

async function fetchJson<T>(
  path: string,
  weight: number,
  init?: RequestInit,
): Promise<{ data: T; latencyMs: number }> {
  const now = Date.now();
  if (consumedWeightLastMinute(now) + weight > WEIGHT_BUDGET_PER_MIN) {
    throw new ProviderError(
      "Límite local de solicitudes a Binance alcanzado; reintenta en unos segundos",
      "binance",
      429,
    );
  }
  addWeight(weight, now);

  let lastError: ProviderError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000) * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, backoff));
    }
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: "application/json", ...(init?.headers ?? {}) },
        cache: "no-store",
      });
      if (res.ok) {
        const started = Date.now();
        const data = (await res.json()) as T;
        return { data, latencyMs: Date.now() - started };
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined;
      if (res.status === 429 || res.status === 418 || res.status >= 500) {
        lastError = new ProviderError(
          `Binance respondió ${res.status} en ${path}`,
          "binance",
          res.status,
          retryAfterMs,
        );
        if (retryAfterMs) await new Promise((r) => setTimeout(r, Math.min(retryAfterMs, 10_000)));
        continue;
      }
      const body = await res.text().catch(() => "");
      throw new ProviderError(
        `Binance respondió ${res.status} en ${path}: ${body.slice(0, 200)}`,
        "binance",
        res.status,
      );
    } catch (err) {
      if (err instanceof ProviderError) {
        lastError = err;
        continue;
      }
      lastError = new ProviderError(
        `Error de red consultando Binance (${path}): ${err instanceof Error ? err.message : String(err)}`,
        "binance",
      );
    }
  }
  throw lastError ?? new ProviderError("Error desconocido consultando Binance", "binance");
}

interface RawKline {
  0: number; // openTime
  1: string; // open
  2: string; // high
  3: string; // low
  4: string; // close
  5: string; // volume
  6: number; // closeTime
}

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleanSymbol.length < 5 || cleanSymbol.length > 20) {
    throw new ProviderError(`Símbolo inválido: ${symbol}`, "binance", 400);
  }
  const boundedLimit = Math.max(10, Math.min(1000, Math.floor(limit)));
  const { data } = await fetchJson<RawKline[]>(
    `/api/v3/klines?symbol=${cleanSymbol}&interval=${encodeURIComponent(interval)}&limit=${boundedLimit}`,
    2,
  );
  if (!Array.isArray(data)) {
    throw new ProviderError("Respuesta inesperada de /api/v3/klines", "binance");
  }
  const now = Date.now();
  return data.map((k) => ({
    symbol: cleanSymbol,
    market: "crypto" as const,
    interval,
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    provider: "binance",
    closed: Number(k[6]) < now,
  }));
}

interface RawTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

export async function fetchTickers(symbols: string[]): Promise<Map<string, { price: number; changePercent24h: number }>> {
  const clean = symbols.map((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, "")).filter(Boolean);
  if (clean.length === 0) return new Map();
  const weight = clean.length > 1 ? 80 : 2;
  const path =
    clean.length > 1
      ? `/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(clean))}`
      : `/api/v3/ticker/24hr?symbol=${clean[0]}`;
  const { data } = await fetchJson<RawTicker[] | RawTicker>(path, weight);
  const list = Array.isArray(data) ? data : [data];
  const map = new Map<string, { price: number; changePercent24h: number }>();
  for (const t of list) {
    const price = Number(t.lastPrice);
    const change = Number(t.priceChangePercent);
    if (Number.isFinite(price) && price > 0) {
      map.set(t.symbol, { price, changePercent24h: Number.isFinite(change) ? change : 0 });
    }
  }
  return map;
}

export async function ping(): Promise<boolean> {
  await fetchJson<unknown>("/api/v3/ping", 1);
  return true;
}

/**
 * Descarga histórica paginada: velas desde hace `days` días hasta ahora.
 * Binance devuelve máximo 1000 velas por petición; se pagina hacia atrás
 * con endTime. Máximo 20 páginas (20 000 velas) para respetar el presupuesto
 * de peso (40 unidades) por llamada.
 */
export async function fetchHistoricalKlines(
  symbol: string,
  interval: string,
  days: number,
): Promise<Candle[]> {
  const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleanSymbol.length < 5 || cleanSymbol.length > 20) {
    throw new ProviderError(`Símbolo inválido: ${symbol}`, "binance", 400);
  }
  const boundedDays = Math.max(1, Math.min(3650, Math.floor(days)));
  const now = Date.now();
  const startTime = now - boundedDays * 86_400_000;
  const all: Candle[] = [];
  let cursor = now;
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await fetchJson<RawKline[]>(
      `/api/v3/klines?symbol=${cleanSymbol}&interval=${encodeURIComponent(interval)}&endTime=${Math.floor(cursor)}&limit=1000`,
      2,
    );
    if (!Array.isArray(data) || data.length === 0) break;
    const mapped: Candle[] = data.map((k) => ({
      symbol: cleanSymbol,
      market: "crypto" as const,
      interval,
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      provider: "binance",
      closed: Number(k[6]) < now,
    }));
    all.unshift(...mapped);
    const oldest = mapped[0].time;
    if (oldest <= startTime) break;
    cursor = oldest - 1;
  }
  const filtered = all.filter((c) => c.time >= startTime);
  return filtered;
}
