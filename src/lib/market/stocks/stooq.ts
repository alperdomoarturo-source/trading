/**
 * Cliente de Stooq (https://stooq.com) para acciones estadounidenses
 * mediante sus endpoints CSV públicos y gratuitos (sin API key).
 *
 * Limitaciones documentadas del proveedor:
 * - Datos diferidos de cierre de sesión (EOD): NUNCA deben presentarse como
 *   tiempo real en la UI. Las velas diarias/semanales solo se publican una vez
 *   cerrada la sesión, por eso todas llevan closed=true.
 * - Solo intervalos "1d" (i=d) y "1w" (i=w). No hay intradía.
 * - Endpoint gratuito con límites de solicitudes por IP; se reintentan 429/5xx
 *   con espera progresiva y se respeta Retry-After cuando existe.
 * - El volumen puede venir vacío o en 0 en algunas sesiones (se conserva 0).
 * - Los huecos entre velas son normales (fines de semana y festivos); no se
 *   aplican detecciones de huecos pensadas para cripto 24/7.
 */

import { ProviderError, type Candle, type CandleSeries } from "../types";
import { isValidCandle, buildSeries } from "../normalize";
import type { MarketProvider } from "../index";
import { toStooqTicker } from "./symbols";

const CSV_BASE = "https://stooq.com/q/d/l/";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

/** Símbolos de acciones: 1-5 letras y sufijo opcional de 1-2 letras (BRK.B). */
const STOCK_SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

export function cleanStockSymbol(raw: string): string {
  const clean = raw.trim().toUpperCase();
  if (!STOCK_SYMBOL_RE.test(clean)) {
    throw new ProviderError(`Símbolo de acción inválido: ${raw}`, "stooq", 400);
  }
  return clean;
}

/** Convierte el intervalo de la app al parámetro `i` de Stooq; solo 1d y 1w. */
export function toStooqInterval(interval: string): "d" | "w" {
  if (interval === "1d") return "d";
  if (interval === "1w") return "w";
  throw new ProviderError("intervalo no disponible para acciones; use 1d o 1w", "stooq", 400);
}

function yyyymmdd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Parsea el CSV de Stooq (Date,Open,High,Low,Close,Volume) en velas.
 * - La fecha se normaliza a 00:00 UTC del día de la sesión.
 * - Se descartan filas con OHLC incoherente (isValidCandle).
 * - Volumen vacío o no numérico se conserva como 0.
 * - closed=true: Stooq solo publica sesiones cerradas.
 */
export function parseStooqCsv(csv: string, symbol: string, interval: string): Candle[] {
  // Sin BOM y sin filas vacías.
  const text = csv.replace(/^\uFEFF/, "");
  if (/no data/i.test(text)) {
    throw new ProviderError(`Stooq no tiene datos para el símbolo ${symbol}`, "stooq", 404);
  }
  if (/exceeded the daily hits limit/i.test(text)) {
    throw new ProviderError("Stooq alcanzó su límite diario de solicitudes; reintenta más tarde", "stooq", 429);
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const candles: Candle[] = [];
  for (const line of lines) {
    if (/^date[,;]/i.test(line)) continue; // cabecera
    const cells = line.split(",");
    if (cells.length < 5) continue;
    const time = Date.parse(`${cells[0]}T00:00:00Z`);
    const candle: Candle = {
      symbol,
      market: "stocks",
      interval,
      time,
      open: Number(cells[1]),
      high: Number(cells[2]),
      low: Number(cells[3]),
      close: Number(cells[4]),
      volume: Number(cells[5]) || 0,
      provider: "stooq",
      closed: true,
    };
    if (isValidCandle(candle)) candles.push(candle);
  }
  // Orden cronológico ascendente y deduplicado por fecha (conserva la última).
  const byTime = new Map<number, Candle>();
  for (const c of candles) byTime.set(c.time, c);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Descarga un CSV con timeout y reintentos (backoff progresivo en 429/5xx
 * y errores de red). Retry-After se respeta cuando el servidor lo envía.
 */
async function fetchCsv(query: string): Promise<string> {
  let lastError: ProviderError | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000) * (0.8 + Math.random() * 0.4);
      await new Promise((r) => setTimeout(r, backoff));
    }
    try {
      const res = await fetch(`${CSV_BASE}${query}`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { Accept: "text/csv, text/plain" },
        cache: "no-store",
      });
      if (res.ok) {
        return await res.text();
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : undefined;
      if (res.status === 429 || res.status >= 500) {
        lastError = new ProviderError(
          `Stooq respondió ${res.status}; puede ser un límite de uso del endpoint gratuito`,
          "stooq",
          res.status,
          retryAfterMs,
        );
        if (retryAfterMs) await new Promise((r) => setTimeout(r, Math.min(retryAfterMs, 10_000)));
        continue;
      }
      throw new ProviderError(`Stooq respondió ${res.status} para ${query}`, "stooq", res.status);
    } catch (err) {
      if (err instanceof ProviderError) {
        if (err.statusCode) throw err; // 4xx con código: no reintentar
        lastError = err;
        continue;
      }
      lastError = new ProviderError(
        `Error de red consultando Stooq (${query}): ${err instanceof Error ? err.message : String(err)}`,
        "stooq",
      );
    }
  }
  throw lastError ?? new ProviderError("Error desconocido consultando Stooq", "stooq");
}

/** Últimas `limit` velas cerradas de un símbolo (1d o 1w). */
export async function fetchStooqCandles(
  symbol: string,
  interval: string,
  limit: number,
): Promise<Candle[]> {
  const clean = cleanStockSymbol(symbol);
  const stooqInterval = toStooqInterval(interval);
  const boundedLimit = Math.max(10, Math.min(1000, Math.floor(limit)));
  // Ventana aproximada en días de calendario para reducir el tamaño descarga
  // (incluye fines de semana y festivos con margen).
  const daysPerBar = stooqInterval === "d" ? 1.5 : 10.5;
  const from = Date.now() - (boundedLimit * daysPerBar + 45) * 86_400_000;
  const csv = await fetchCsv(
    `?s=${encodeURIComponent(toStooqTicker(clean))}&i=${stooqInterval}&d1=${yyyymmdd(from)}&d2=${yyyymmdd(Date.now())}`,
  );
  return parseStooqCsv(csv, clean, stooqInterval === "d" ? "1d" : "1w").slice(-boundedLimit);
}

export const stooqProvider: MarketProvider = {
  id: "stooq",
  market: "stocks",
  async getCandles(symbol: string, interval: string, limit: number): Promise<CandleSeries> {
    const fetchedAt = Date.now();
    const candles = await fetchStooqCandles(symbol, interval, limit);
    const warnings: string[] = [];
    if (candles.length === 0) {
      warnings.push("Stooq no devolvió velas válidas para este símbolo e intervalo");
    }
    return buildSeries(candles, { provider: "stooq", fetchedAt, warnings });
  },
  /**
   * Stooq no tiene endpoint de tickers: se deriva el último cierre y la
   * variación de las dos últimas velas diarias por símbolo (consultadas en
   * serie, para no agotar el límite gratuito por IP).
   */
  async getTickers(symbols: string[]): Promise<Map<string, { price: number; changePercent24h: number }>> {
    const map = new Map<string, { price: number; changePercent24h: number }>();
    let lastError: ProviderError | undefined;
    for (const raw of symbols) {
      try {
        const clean = cleanStockSymbol(raw);
        const from = Date.now() - 21 * 86_400_000;
        const csv = await fetchCsv(
          `?s=${encodeURIComponent(toStooqTicker(clean))}&i=d&d1=${yyyymmdd(from)}&d2=${yyyymmdd(Date.now())}`,
        );
        const rows = parseStooqCsv(csv, clean, "1d");
        const last = rows[rows.length - 1];
        const prev = rows[rows.length - 2];
        if (last && prev && prev.close > 0) {
          map.set(clean, {
            price: last.close,
            changePercent24h: ((last.close - prev.close) / prev.close) * 100,
          });
        }
      } catch (err) {
        if (err instanceof ProviderError) lastError = err;
      }
    }
    if (map.size === 0 && lastError) throw lastError;
    return map;
  },
  /** Comprobación de disponibilidad con una descarga mínima (una sesión de SPX). */
  async ping(): Promise<boolean> {
    const from = Date.now() - 10 * 86_400_000;
    const csv = await fetchCsv(`?s=spx.us&i=d&d1=${yyyymmdd(from)}&d2=${yyyymmdd(Date.now())}`);
    if (!/^date/i.test(csv.trim())) {
      throw new ProviderError("Stooq no devolvió el formato CSV esperado en la prueba de disponibilidad", "stooq");
    }
    return true;
  },
};
