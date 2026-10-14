/**
 * Repositorio de señales sobre Supabase (PostgREST).
 *
 * Reglas duras (coherentes con supabase/migrations/0002):
 *  - signals son INMUTABLES: este módulo solo expite INSERT/upsert-do-nothing;
 *    no existe ninguna función para actualizar o borrar una señal existente
 *    (cambiar el price_ref histórico falsearía las estadísticas de aciertos).
 *  - signal_outcomes es append/update-once: se escribe UNA sola fila por señal
 *    y SOLO después de que el horizonte (valid_until) haya vencido por
 *    completo. Antes de eso el resultado no existe: negarse a adivinar.
 *
 * Todos los métodos degradan a `null`/resultado "disabled" si Supabase no
 * está configurado, para que las rutas puedan responder { enabled: false }.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCandles } from "@/lib/market";
import { INTERVAL_MS } from "@/lib/market/types";
import type { Freshness } from "@/lib/market/types";
import type { Signal, SignalKind } from "@/lib/signals/types";
import { getSupabaseAdmin } from "./client";

/** Columnas objetivo del dedup (índice UNIQUE signals_dedup_uniq, 0001). */
const SIGNALS_CONFLICT_COLUMNS = "symbol,interval,candle_time,dedup_user";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export type OutcomeKind = "up" | "down" | "neutral" | "expired";

export interface SignalLogOutcome {
  outcome: OutcomeKind;
  resolvedAt: number;
  returnPct: number | null;
  /** null para señales no direccionales (WAIT/NONE/...): no se puntúa el silencio. */
  correct: boolean | null;
}

export interface SignalLogEntry {
  id: number;
  symbol: string;
  market: "crypto" | "stocks";
  interval: string;
  candleTime: number;
  validUntil: number;
  priceRef: number;
  kind: SignalKind;
  direction: "long" | "short" | null;
  score: number;
  bullScore: number;
  bearScore: number;
  freshness: Freshness;
  modelVersion: string | null;
  generatedAt: number;
  outcome: SignalLogOutcome | null;
}

export interface SignalRecordResult {
  inserted: boolean;
  skipped: "duplicate" | "disabled" | "error" | null;
  error: string | null;
}

export interface SignalLogFilter {
  market?: string;
  symbol?: string;
  interval?: string;
  /** kind exacto de señal (BUY/SELL/WAIT/NONE/...), no la columna direction. */
  direction?: string;
  limit?: number;
  offset?: number;
}

export interface ResolveSummary {
  enabled: boolean;
  considered: number;
  resolved: number;
  expired: number;
  pendingData: number;
  alreadyResolved: number;
  error: string | null;
}

/** Resultado de upsert/insert/select estilo PostgREST (suficiente para el repo). */
export interface DbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
  count?: number | null;
}

/**
 * Superconjunto structural del constructor de consultas usado aquí.
 * `update`/`delete` a propósito NO están: el repositorio no puede mutar
 * filas existentes (inmutabilidad garantizada también en el código TS).
 */
export interface RepoBuilder {
  select(columns?: string): RepoBuilder;
  eq(column: string, value: unknown): RepoBuilder;
  lte(column: string, value: unknown): RepoBuilder;
  in(column: string, values: readonly unknown[]): RepoBuilder;
  isNull(column: string): RepoBuilder;
  order(column: string, options?: { ascending?: boolean }): RepoBuilder;
  range(from: number, to: number): RepoBuilder;
  limit(count: number): RepoBuilder;
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): RepoBuilder;
  insert(values: Record<string, unknown> | Record<string, unknown>[], options?: { count?: "exact" }): RepoBuilder;
  then(
    onfulfilled?: ((value: DbResult) => unknown) | null,
    onrejected?: ((reason: unknown) => unknown) | null,
  ): PromiseLike<unknown>;
}

export interface RepoClient {
  from(table: string): RepoBuilder;
}

type ClientOption = { client?: RepoClient | SupabaseClient | null };

/** null si no hay cliente inyectado y Supabase no está configurado. */
function resolveClient(opts: ClientOption): RepoClient | null {
  if (opts.client !== undefined && opts.client !== null) return opts.client as RepoClient;
  if (opts.client === null) return null;
  return getSupabaseAdmin() as unknown as RepoClient | null;
}

// ---------------------------------------------------------------------------
// Filas <-> dominio
// ---------------------------------------------------------------------------

interface SignalRow {
  id: number;
  symbol: string;
  market: "crypto" | "stocks";
  interval: string;
  candle_time: string;
  price_ref: number | string;
  kind: SignalKind;
  direction: "long" | "short" | null;
  score: number;
  bull_score: number;
  bear_score: number;
  freshness: Freshness;
  model_version: string | null;
  generated_at: string;
  horizon_candles: number;
  valid_until: string;
  user_id: string | null;
  indicators?: Record<string, unknown> | null;
  signal_outcomes?: {
    outcome: OutcomeKind;
    resolved_at: string;
    return_pct: number | string | null;
    correct: boolean | null;
  } | null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function epoch(value: string | number): number {
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function num(value: number | string | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function signalToRow(signal: Signal, userId: string | null = null): Record<string, unknown> {
  return {
    symbol: signal.symbol.toUpperCase(),
    market: signal.market,
    interval: signal.interval,
    candle_time: iso(signal.candleTime),
    price_ref: signal.priceRef,
    kind: signal.kind,
    direction: signal.direction,
    score: signal.score,
    bull_score: signal.bullScore,
    bear_score: signal.bearScore,
    reasons: signal.reasons,
    indicators: signal.indicators ?? null,
    levels: signal.levels ?? null,
    patterns: signal.patterns ?? null,
    freshness: signal.freshness,
    model_version: null,
    generated_at: iso(signal.generatedAt),
    horizon_candles: signal.horizonCandles,
    valid_until: iso(signal.validUntil),
    user_id: userId,
  };
}

function rowToLogEntry(row: SignalRow): SignalLogEntry {
  const outcome = row.signal_outcomes ?? null;
  return {
    id: row.id,
    symbol: row.symbol,
    market: row.market,
    interval: row.interval,
    candleTime: epoch(row.candle_time),
    validUntil: epoch(row.valid_until),
    priceRef: num(row.price_ref),
    kind: row.kind,
    direction: row.direction,
    score: row.score,
    bullScore: row.bull_score,
    bearScore: row.bear_score,
    freshness: row.freshness,
    modelVersion: row.model_version,
    generatedAt: epoch(row.generated_at),
    outcome: outcome
      ? {
          outcome: outcome.outcome,
          resolvedAt: epoch(outcome.resolved_at),
          returnPct: outcome.return_pct === null || outcome.return_pct === undefined ? null : num(outcome.return_pct),
          correct: outcome.correct,
        }
      : null,
  };
}

const LOG_SELECT =
  "id, symbol, market, interval, candle_time, price_ref, kind, direction, score, bull_score, bear_score, freshness, model_version, generated_at, horizon_candles, valid_until, user_id, indicators, signal_outcomes(outcome, resolved_at, return_pct, correct)";

// ---------------------------------------------------------------------------
// recordSignal: upsert idempotente (ON CONFLICT DO NOTHING)
// ---------------------------------------------------------------------------

/**
 * Registra una señal sin duplicados. Llamadas repetidas con la misma
 * (symbol, interval, candle_time, coalesce(user_id, nil)) no crean filas:
 * `inserted:false, skipped:"duplicate"`.
 *
 * IMPORTANTE: solo debe recibirla señales producidas por el SERVIDOR (ver
 * /api/signals/record, que re-evalúa antes de registrar). No exponer scores
 * del cliente.
 */
export async function recordSignal(
  signal: Signal,
  opts: ClientOption & { userId?: string | null } = {},
): Promise<SignalRecordResult> {
  const client = resolveClient(opts);
  if (!client) return { inserted: false, skipped: "disabled", error: null };

  const row = signalToRow(signal, opts.userId ?? null);
  const { data, error } = await client
    .from("signals")
    .upsert(row, { onConflict: SIGNALS_CONFLICT_COLUMNS, ignoreDuplicates: true })
    .select("id");

  if (error) {
    return { inserted: false, skipped: "error", error: error.message };
  }
  const inserted = Array.isArray(data) && data.length > 0;
  return { inserted, skipped: inserted ? null : "duplicate", error: null };
}

// ---------------------------------------------------------------------------
// getRecentSignals
// ---------------------------------------------------------------------------

export async function getRecentSignals(
  filter: SignalLogFilter,
  opts: ClientOption = {},
): Promise<SignalLogEntry[]> {
  const client = resolveClient(opts);
  if (!client) throw new Error("Persistencia no configurada (Supabase ausente)");

  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);

  let query = client.from("signals").select(LOG_SELECT);
  if (filter.market) query = query.eq("market", filter.market);
  if (filter.symbol) query = query.eq("symbol", filter.symbol.toUpperCase());
  if (filter.interval) query = query.eq("interval", filter.interval);
  if (filter.direction) query = query.eq("kind", filter.direction);
  query = query.order("generated_at", { ascending: false }).range(offset, offset + limit - 1);

  const { data, error } = await query;
  if (error) throw new Error(`No se pudo leer el historial: ${error.message}`);
  return ((data ?? []) as unknown as SignalRow[]).map(rowToLogEntry);
}

// ---------------------------------------------------------------------------
// classifyOutcome: matemática del resultado (pura, sin red)
// ---------------------------------------------------------------------------

export interface OutcomeInput {
  kind: SignalKind;
  priceRef: number;
  /** Cierre de la vela que remata el horizonte (null si aún no existe). */
  priceEnd: number | null;
  /** Apertura de la última vela cerrada disponible (para expiración). */
  lastClosedTime: number | null;
  /** ATR% de la señal (noise baseline); null asume 0.5%. */
  atrPct: number | null;
  horizonCandles: number;
  intervalMs: number;
  candleTime: number;
  validUntil: number;
  now: number;
}

export type OutcomeDecision =
  /** Horizonte NO vencido: prohibido escribir el resultado (regla dura). */
  | { status: "pending" }
  /** Horizonte vencido pero los datos aún no cubren la vela final: reintentar. */
  | { status: "retry" }
  | {
      status: "resolved";
      outcome: OutcomeKind;
      returnPct: number | null;
      correct: boolean | null;
    };

/**
 * Umbral de ruido: k*ATR con k = sqrt(horizonte). Justificación: si el ATR
 * por vela es ~a% y las velas se comportan como un paseo, la desviación del
 * cierre tras H velas escala con a*sqrt(H). Movimientos por debajo del umbral
 * son "neutral" (el motor no afirmó con fuerza, ni el mercado se movió de más).
 * Piso 0.1% (ruido mínimo) y techo 15% (señales con ATR desproporcionado).
 */
export function outcomeThresholdPct(atrPct: number | null, horizonCandles: number): number {
  const a = atrPct !== null && Number.isFinite(atrPct) && atrPct > 0 ? atrPct : 0.5;
  return Math.min(15, Math.max(0.1, a * Math.sqrt(Math.max(1, horizonCandles))));
}

export function classifyOutcome(input: OutcomeInput): OutcomeDecision {
  const {
    priceRef, priceEnd, lastClosedTime, atrPct, horizonCandles,
    intervalMs, candleTime, validUntil, now, kind,
  } = input;

  // REGLA DURA: el outcome se escribe SOLO tras vencer el horizonte completo.
  if (now < validUntil) return { status: "pending" };

  const expectedEnd = candleTime + intervalMs * horizonCandles;
  const haveHorizonCandle = priceEnd !== null && lastClosedTime !== null && lastClosedTime >= expectedEnd;

  /** BUY/SELL afirman dirección: expired sin datos cuenta como fallo. WAIT/NONE no afirman nada: null. */
  const claimsDirection = kind === "BUY" || kind === "SELL";

  if (haveHorizonCandle && priceEnd !== null) {
    if (priceRef <= 0) {
      return { status: "resolved", outcome: "expired", returnPct: null, correct: claimsDirection ? false : null };
    }
    const returnPct = ((priceEnd - priceRef) / priceRef) * 100;
    const threshold = outcomeThresholdPct(atrPct, horizonCandles);
    const outcome: OutcomeKind =
      Math.abs(returnPct) <= threshold ? "neutral" : returnPct > 0 ? "up" : "down";
    // correct: verificación de la AFIRMACIÓN del motor (solo BUY/SELL).
    // WAIT/NONE/... afirman ausencia, no dirección: correct = null honesto.
    let correct: boolean | null = null;
    if (kind === "BUY") correct = outcome === "up";
    else if (kind === "SELL") correct = outcome === "down";
    return { status: "resolved", outcome, returnPct, correct };
  }

  // Expiración: el horizonte venció y, tras un periodo de gracia amplio
  // (2 horizontes + 1 día), la vela del horizonte sigue sin aparecer en el
  // proveedor (símbolo retirado / hueco de datos). Antes de eso: reintentar.
  const graceMs = 2 * horizonCandles * intervalMs + 86_400_000;
  if (now >= validUntil + graceMs) {
    return { status: "resolved", outcome: "expired", returnPct: null, correct: claimsDirection ? false : null };
  }
  return { status: "retry" };
}

// ---------------------------------------------------------------------------
// resolveDueOutcomes
// ---------------------------------------------------------------------------

interface FetchCandlesFn {
  (symbol: string, interval: string, limit: number): Promise<{ candles: { time: number; close: number; closed: boolean }[] }>;
}

/**
 * Resuelve resultados de señales cuyo horizonte venció, sin outcome aún.
 *
 * DISEÑO HONESTO: en Vercel Hobby no prometemos cron ilimitado ni jobs en
 * segundo plano continuos; esta función se dispara a demanda (POST
 * /api/signals/resolve y, con presupuesto limitado, el GET del historial).
 * Solo escribe outcomes cuando now >= valid_until (regla dura) y usa upsert
 * on-conflict-do-nothing para respetar el append/update-once.
 */
export async function resolveDueOutcomes(
  now: number,
  opts: ClientOption & { getCandlesImpl?: FetchCandlesFn; limit?: number } = {},
): Promise<ResolveSummary> {
  const empty: ResolveSummary = {
    enabled: false, considered: 0, resolved: 0, expired: 0,
    pendingData: 0, alreadyResolved: 0, error: null,
  };
  const client = resolveClient(opts);
  if (!client) return empty;

  const fetchCandles: FetchCandlesFn = opts.getCandlesImpl ?? (getCandles as unknown as FetchCandlesFn);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);

  const { data, error } = await client
    .from("signals")
    .select("id, symbol, market, interval, candle_time, price_ref, kind, direction, horizon_candles, valid_until, indicators, signal_outcomes(signal_id, outcome)")
    .lte("valid_until", new Date(now).toISOString())
    .order("valid_until", { ascending: true })
    .limit(limit);

  if (error) {
    return { ...empty, enabled: true, error: error.message };
  }

  const rows = (data ?? []) as unknown as SignalRow[];
  const summary: ResolveSummary = {
    enabled: true, considered: rows.length, resolved: 0, expired: 0,
    pendingData: 0, alreadyResolved: 0, error: null,
  };

  for (const row of rows) {
    // Append/update-once: si ya tiene outcome, jamás se re-toca.
    if (row.signal_outcomes) {
      summary.alreadyResolved++;
      continue;
    }
    const intervalMs = INTERVAL_MS[row.interval] ?? 3_600_000;
    const horizon = row.horizon_candles;
    const candleTime = epoch(row.candle_time);
    const validUntil = epoch(row.valid_until);

    let priceEnd: number | null = null;
    let lastClosedTime: number | null = null;
    try {
      const series = await fetchCandles(row.symbol, row.interval, Math.max(30, horizon + 10));
      const closed = series.candles.filter((c) => c.closed);
      if (closed.length > 0) {
        lastClosedTime = closed[closed.length - 1].time;
        const horizonCandle = closed.find((c) => c.time >= candleTime + intervalMs * horizon);
        if (horizonCandle) priceEnd = horizonCandle.close;
      }
    } catch {
      // Sin datos del proveedor: no se inventa nada; se reintenta otro día.
      summary.pendingData++;
      continue;
    }

    const atrPctRaw = row.indicators?.atrPct;
    const atrPct = typeof atrPctRaw === "number" && Number.isFinite(atrPctRaw) ? atrPctRaw : null;

    const decision = classifyOutcome({
      kind: row.kind,
      priceRef: num(row.price_ref),
      priceEnd,
      lastClosedTime,
      atrPct,
      horizonCandles: horizon,
      intervalMs,
      candleTime,
      validUntil,
      now,
    });

    if (decision.status !== "resolved") {
      // pending / retry: horizonte no vencido o datos aún sin cubrir: reintentar.
      summary.pendingData++;
      continue;
    }

    const outcomeRow = {
      signal_id: row.id,
      resolved_at: new Date(now).toISOString(),
      outcome: decision.outcome,
      return_pct: decision.returnPct,
      correct: decision.correct,
    };
    const { error: upsertError } = await client
      .from("signal_outcomes")
      .upsert(outcomeRow, { onConflict: "signal_id", ignoreDuplicates: true });

    if (upsertError) {
      summary.error = `No se pudo guardar un outcome: ${upsertError.message}`;
      continue;
    }
    if (decision.outcome === "expired") summary.expired++;
    else summary.resolved++;
  }

  return summary;
}

/** UUID nil usado como clave de dedup para señales anónimas (documentado en 0001). */
export const DEDUP_NIL_UUID = NIL_UUID;
