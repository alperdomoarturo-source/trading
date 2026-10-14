/**
 * Pruebas de persistencia (Etapa 7) SIN red ni Supabase: cliente falso
 * inyectado, módulos "@/lib/db/client" y "@/lib/market" mockeados.
 * Cubren: modo deshabilitado, upsert idempotente anti-duplicados,
 * inmutabilidad de señales, matemática de outcomes y rutas de API.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "@/lib/signals/types";

const INTERVALS_LIST = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w"];

const state = vi.hoisted(() => ({
  /** Cliente Supabase falso (o null = no configurado) para las rutas. */
  adminClient: null as unknown,
  /** Serie devuelta por "@/lib/market".getCandles en las rutas. */
  fetchCandles: async () => ({
    candles: [],
    meta: { freshness: "fresh", provider: "test", fetchedAt: 0, warnings: [] },
  }),
}));

vi.mock("@/lib/db/client", () => ({
  getSupabaseAdmin: () => state.adminClient,
  resetSupabaseClientCache: () => undefined,
}));

vi.mock("@/lib/market", () => ({
  getCandles: () => state.fetchCandles(),
  isValidInterval: (i: string) => INTERVALS_LIST.includes(i),
}));

import * as repo from "@/lib/db/signals-repo";
import {
  classifyOutcome,
  getRecentSignals,
  recordSignal,
  resolveDueOutcomes,
  outcomeThresholdPct,
  type RepoBuilder,
  type RepoClient,
} from "@/lib/db/signals-repo";
import { persistenceConfig } from "@/lib/db/status";
import { parseRecordRequest } from "@/lib/db/record-request";
import { BadRequestError } from "@/lib/validation";

// ---------------------------------------------------------------------------
// Cliente falso estilo PostgREST (singleton thenable, como el real)
// ---------------------------------------------------------------------------

interface FakeCall {
  table: string;
  op: "select" | "upsert" | "insert";
  selectCols?: string;
  values?: unknown;
  opts?: unknown;
  filters: Array<[string, string, unknown]>;
  order?: { column: string; ascending?: boolean };
  range?: [number, number];
  limitCount?: number;
}

interface FakeResult {
  data: unknown;
  error: { message: string } | null;
}

type Responder = (call: FakeCall) => FakeResult;

function createFakeSupabase(responder: Responder) {
  const calls: FakeCall[] = [];
  const client: RepoClient & { calls: FakeCall[] } = {
    calls,
    from(table: string): RepoBuilder {
      const call: FakeCall = { table, op: "select", filters: [] };
      calls.push(call);
      const builder: RepoBuilder & { update(): never; delete(): never } = {
        select(cols?: string) {
          call.selectCols = cols;
          return builder;
        },
        eq(col: string, val: unknown) {
          call.filters.push(["eq", col, val]);
          return builder;
        },
        lte(col: string, val: unknown) {
          call.filters.push(["lte", col, val]);
          return builder;
        },
        in(col: string, vals: readonly unknown[]) {
          call.filters.push(["in", col, vals]);
          return builder;
        },
        isNull(col: string) {
          call.filters.push(["is", col, null]);
          return builder;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          call.order = { column: col, ascending: opts?.ascending };
          return builder;
        },
        range(a: number, b: number) {
          call.range = [a, b];
          return builder;
        },
        limit(n: number) {
          call.limitCount = n;
          return builder;
        },
        upsert(values: unknown, opts?: unknown) {
          call.op = "upsert";
          call.values = values;
          call.opts = opts;
          return builder;
        },
        insert(values: unknown) {
          call.op = "insert";
          call.values = values;
          return builder;
        },
        // Inmutabilidad: si el repositorio intentara mutar filas, el test estalla.
        update(): never {
          throw new Error("INTENTO PROHIBIDO: actualizar una señal existente");
        },
        delete(): never {
          throw new Error("INTENTO PROHIBIDO: borrar señales");
        },
        then(
          onfulfilled?: ((value: FakeResult) => unknown) | null,
          onrejected?: ((reason: unknown) => unknown) | null,
        ) {
          return Promise.resolve(responder(call)).then(onfulfilled, onrejected);
        },
      };
      return builder;
    },
  };
  return client;
}

const defaultResponder: Responder = (call) => {
  if (call.op === "upsert" || call.op === "insert") return { data: [{ id: 1 }], error: null };
  return { data: [], error: null };
};

// ---------------------------------------------------------------------------
// Fixuras de dominio
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

function mkSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    kind: "BUY",
    direction: "long",
    symbol: "BTCUSDT",
    market: "crypto",
    interval: "1h",
    generatedAt: T0 + 6 * HOUR,
    candleTime: T0,
    priceRef: 100,
    horizonCandles: 5,
    score: 40,
    bullScore: 45,
    bearScore: 5,
    reasons: [{ text: "Tendencia alcista sostenida", weight: 18 }],
    indicators: {
      adx: 28,
      plusDi: 25,
      minusDi: 12,
      rsi: 55,
      atrPct: 0.4,
      relativeVolume: 1.4,
      ema20: 99,
      ema50: 97,
      ema200: 90,
      macdHistogram: 0.3,
      trend: "up",
      rangePosition: 0.6,
    },
    freshness: "fresh",
    warnings: [],
    validUntil: T0 + 6 * HOUR,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Entorno: garantizar "sin Supabase" por defecto y activable por prueba
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  state.adminClient = null;
  state.fetchCandles = async () => ({
    candles: [],
    meta: { freshness: "fresh", provider: "test", fetchedAt: 0, warnings: [] },
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function enablePersistence(): void {
  process.env.SUPABASE_URL = "https://falso.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "clave-service-role-de-prueba";
}

let ipCounter = 0;
function uniqueIp(): string {
  ipCounter += 1;
  return `10.9.${ipCounter % 256}.${Math.floor(ipCounter / 256)}:54321`;
}

// ---------------------------------------------------------------------------

describe("status de persistencia", () => {
  it("deshabilitado sin variables de entorno", () => {
    expect(persistenceConfig({})).toEqual({ enabled: false, mode: "none", url: null, key: null });
  });

  it("prefiere la ruta admin (URL+service role sin NEXT_PUBLIC_)", () => {
    const cfg = persistenceConfig({
      SUPABASE_URL: "https://a.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "svc",
      NEXT_PUBLIC_SUPABASE_URL: "https://b.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    });
    expect(cfg.mode).toBe("service");
    expect(cfg.url).toBe("https://a.supabase.co");
  });

  it("cae a modo anon solo con NEXT_PUBLIC_*", () => {
    const cfg = persistenceConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://b.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" });
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("anon");
  });
});

describe("signals-repo: registro idempotente e inmutable", () => {
  it("sin cliente no explota: resultado disabled", async () => {
    const result = await recordSignal(mkSignal(), { client: null });
    expect(result).toEqual({ inserted: false, skipped: "disabled", error: null });
  });

  it("upsert on-conflict do-nothing con la clave de dedup correcta", async () => {
    const fake = createFakeSupabase(defaultResponder);
    const result = await recordSignal(mkSignal(), { client: fake });
    expect(result.inserted).toBe(true);

    const call = fake.calls.find((c) => c.table === "signals" && c.op === "upsert");
    expect(call).toBeDefined();
    expect(call!.opts).toEqual({
      onConflict: "symbol,interval,candle_time,dedup_user",
      ignoreDuplicates: true,
    });
    const row = call!.values as Record<string, unknown>;
    expect(row.symbol).toBe("BTCUSDT");
    expect(row.user_id).toBeNull();
    expect(row.candle_time).toBe(new Date(T0).toISOString());
    expect(row.valid_until).toBe(new Date(T0 + 6 * HOUR).toISOString());
  });

  it("segunda vez con la misma vela: duplicado, no inserción nueva", async () => {
    let first = true;
    const fake = createFakeSupabase((call) => {
      if (call.op === "upsert") {
        const data = first ? [{ id: 7 }] : [];
        first = false;
        return { data, error: null };
      }
      return { data: [], error: null };
    });
    const r1 = await recordSignal(mkSignal(), { client: fake });
    const r2 = await recordSignal(mkSignal({ priceRef: 999 }), { client: fake });
    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(false);
    expect(r2.skipped).toBe("duplicate");
    // El precio nuevo NO pudo sobrescribir nada: solo se usó upsert-do-nothing.
    expect(fake.calls.filter((c) => c.op === "upsert")).toHaveLength(2);
  });

  it("el repositorio NO exporta ninguna API de update/delete sobre señales", () => {
    const mutators = Object.keys(repo).filter((name) => /^(update|delete|edit|patch|remove|set)/i.test(name));
    expect(mutators).toEqual([]);
  });

  it("intentar mutar filas mediante el cliente falla (inmutabilidad en tiempo de ejecución)", async () => {
    const fake = createFakeSupabase(defaultResponder);
    const raw = fake.from("signals") as unknown as { update: (v: unknown) => never; delete: () => never };
    expect(() => raw.update({ price_ref: 1 })).toThrowError();
    expect(() => raw.delete()).toThrowError();
  });

  it("getRecentSignals aplica filtros, orden y paginación", async () => {
    const fake = createFakeSupabase((call) => {
      if (call.op === "select") {
        return {
          data: [
            {
              id: 1,
              symbol: "BTCUSDT",
              market: "crypto",
              interval: "1h",
              candle_time: new Date(T0).toISOString(),
              price_ref: "100.5",
              kind: "BUY",
              direction: "long",
              score: 40,
              bull_score: 45,
              bear_score: 5,
              freshness: "fresh",
              model_version: null,
              generated_at: new Date(T0 + HOUR).toISOString(),
              horizon_candles: 5,
              valid_until: new Date(T0 + 6 * HOUR).toISOString(),
              user_id: null,
              signal_outcomes: {
                outcome: "up",
                resolved_at: new Date(T0 + 7 * HOUR).toISOString(),
                return_pct: "2.1",
                correct: true,
              },
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    const rows = await getRecentSignals(
      { market: "crypto", symbol: "btcusdt", interval: "1h", direction: "BUY", limit: 25, offset: 5 },
      { client: fake },
    );
    const call = fake.calls.find((c) => c.table === "signals" && c.op === "select");
    expect(call!.filters).toEqual([
      ["eq", "market", "crypto"],
      ["eq", "symbol", "BTCUSDT"],
      ["eq", "interval", "1h"],
      ["eq", "kind", "BUY"],
    ]);
    expect(call!.order).toEqual({ column: "generated_at", ascending: false });
    expect(call!.range).toEqual([5, 29]);
    expect(rows).toHaveLength(1);
    expect(rows[0].priceRef).toBe(100.5);
    expect(rows[0].outcome?.outcome).toBe("up");
    expect(rows[0].outcome?.returnPct).toBe(2.1);
    expect(rows[0].candleTime).toBe(T0);
  });

  it("sin cliente configurada getRecentSignals lanza (la ruta responde enabled:false antes)", async () => {
    await expect(getRecentSignals({}, { client: null })).rejects.toThrow();
  });
});

describe("classifyOutcome: matemática del resultado tras el horizonte", () => {
  const base = {
    kind: "BUY" as const,
    priceRef: 100,
    priceEnd: 102,
    lastClosedTime: T0 + 5 * HOUR,
    atrPct: 0.4,
    horizonCandles: 5,
    intervalMs: HOUR,
    candleTime: T0,
    validUntil: T0 + 6 * HOUR,
  };

  it("pendiente mientras el horizonte no venció (regla dura: no adivinar)", () => {
    const d = classifyOutcome({ ...base, now: base.validUntil - 60_000 });
    expect(d).toEqual({ status: "pending" });
  });

  it("up cuando el retorno supera el umbral k*ATR*sqrt(H)", () => {
    const threshold = outcomeThresholdPct(0.4, 5); // 0.4*sqrt(5) ≈ 0.894%
    expect(threshold).toBeGreaterThan(0.8);
    expect(threshold).toBeLessThan(1);
    const d = classifyOutcome({ ...base, now: base.validUntil + 60_000 });
    expect(d.status).toBe("resolved");
    if (d.status === "resolved") {
      expect(d.outcome).toBe("up");
      expect(d.returnPct).toBeCloseTo(2, 5);
      expect(d.correct).toBe(true); // BUY afirmó largo y el precio subió
    }
  });

  it("neutral dentro del ruido de ATR: no cuenta como acierto", () => {
    const d = classifyOutcome({ ...base, priceEnd: 100.5, now: base.validUntil + 60_000 });
    if (d.status !== "resolved") throw new Error("debería estar resuelto");
    expect(d.outcome).toBe("neutral");
    expect(d.correct).toBe(false);
  });

  it("down: SELL acierta cuando el precio cae", () => {
    const d = classifyOutcome({ ...base, kind: "SELL", priceEnd: 96, now: base.validUntil + 60_000 });
    if (d.status !== "resolved") throw new Error("debería estar resuelto");
    expect(d.outcome).toBe("down");
    expect(d.correct).toBe(true);
  });

  it("WAIT no afirma dirección: correct null (no inflar estadísticas)", () => {
    const d = classifyOutcome({ ...base, kind: "WAIT", priceEnd: 102, now: base.validUntil + 60_000 });
    if (d.status !== "resolved") throw new Error("debería estar resuelto");
    expect(d.outcome).toBe("up");
    expect(d.correct).toBeNull();
  });

  it("retry si el horizonte venció pero los datos aún no lo cubren", () => {
    const d = classifyOutcome({ ...base, priceEnd: null, lastClosedTime: T0 + 3 * HOUR, now: base.validUntil + HOUR });
    expect(d).toEqual({ status: "retry" });
  });

  it("expired tras la ventana de gracia si la vela nunca aparece", () => {
    const graceEnd = base.validUntil + 2 * 5 * HOUR + 86_400_000;
    const d = classifyOutcome({ ...base, priceEnd: null, lastClosedTime: T0 + 3 * HOUR, now: graceEnd + HOUR });
    if (d.status !== "resolved") throw new Error("debería resolver");
    expect(d.outcome).toBe("expired");
    expect(d.returnPct).toBeNull();
    expect(d.correct).toBe(false);
  });

  it("umbral con piso 0.1% y techo 15%", () => {
    expect(outcomeThresholdPct(0.01, 1)).toBe(0.1);
    expect(outcomeThresholdPct(50, 5)).toBe(15);
    expect(outcomeThresholdPct(null, 5)).toBeCloseTo(0.5 * Math.sqrt(5), 5);
  });
});

describe("resolveDueOutcomes: append/update-once tras vencer el horizonte", () => {
  interface PendingRow {
    id: number;
    symbol: string;
    market: string;
    interval: string;
    candle_time: string;
    price_ref: number;
    kind: string;
    direction: string | null;
    horizon_candles: number;
    valid_until: string;
    indicators: { atrPct: number } | null;
    signal_outcomes: { signal_id: number; outcome: string } | null;
  }

  function mkRow(overrides: Partial<PendingRow>): PendingRow {
    return {
      id: 1,
      symbol: "BTCUSDT",
      market: "crypto",
      interval: "1h",
      candle_time: new Date(T0).toISOString(),
      price_ref: 100,
      kind: "BUY",
      direction: "long",
      horizon_candles: 5,
      valid_until: new Date(T0 + 6 * HOUR).toISOString(),
      indicators: { atrPct: 0.4 },
      signal_outcomes: null,
      ...overrides,
    };
  }

  it("sin cliente: resultado deshabilitado, cero escritura", async () => {
    const summary = await resolveDueOutcomes(T0 + 10 * HOUR, { client: null });
    expect(summary.enabled).toBe(false);
    expect(summary.resolved).toBe(0);
  });

  it("resuelve solo señales vencidas sin outcome; respeta existentes", async () => {
    const rows = [
      mkRow({ id: 101 }), // vencida, sin outcome, con vela de horizonte -> resuelve
      mkRow({ id: 102, signal_outcomes: { signal_id: 102, outcome: "up" } }), // ya resuelta -> intocable
      mkRow({ id: 103, valid_until: new Date(T0 + 100 * HOUR).toISOString() }), // horizonte no vencido -> pendiente
    ];
    const fake = createFakeSupabase((call) => {
      if (call.table === "signals" && call.op === "select") return { data: rows, error: null };
      return { data: [{ id: 9 }], error: null };
    });
    const getCandlesImpl = async () => ({
      candles: [
        { time: T0 + 4 * HOUR, close: 101, closed: true },
        { time: T0 + 5 * HOUR, close: 102, closed: true }, // vela del horizonte: +2% > umbral 0.894%
      ],
    });
    const now = T0 + 10 * HOUR;
    const summary = await resolveDueOutcomes(now, { client: fake, getCandlesImpl });

    expect(summary).toMatchObject({ enabled: true, considered: 3, resolved: 1, alreadyResolved: 1, pendingData: 1, error: null });

    const outcomeUpsert = fake.calls.find((c) => c.table === "signal_outcomes" && c.op === "upsert");
    expect(outcomeUpsert).toBeDefined();
    expect(outcomeUpsert!.opts).toEqual({ onConflict: "signal_id", ignoreDuplicates: true });
    const written = outcomeUpsert!.values as Record<string, unknown>;
    expect(written.signal_id).toBe(101);
    expect(written.outcome).toBe("up");
    expect(written.return_pct).toBeCloseTo(2, 5);
    expect(written.correct).toBe(true);
    // Solo UNA escritura (la señal 101): las demás intocadas.
    expect(fake.calls.filter((c) => c.table === "signal_outcomes")).toHaveLength(1);
    // Ninguna llamada de select usó update/delete (el fake lanza si ocurriera).
    expect(fake.calls.every((c) => c.op === "select" || c.op === "upsert")).toBe(true);
  });

  it("la consulta pide señales con valid_until <= now ordenadas por vencimiento", async () => {
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    await resolveDueOutcomes(T0, { client: fake });
    const call = fake.calls.find((c) => c.table === "signals");
    expect(call!.filters).toEqual([["lte", "valid_until", new Date(T0).toISOString()]]);
    expect(call!.order).toEqual({ column: "valid_until", ascending: true });
    expect(call!.limitCount).toBe(20);
  });

  it("fallo del proveedor de datos: no se inventa outcome (pendingData)", async () => {
    const rows = [mkRow({ id: 201 })];
    const fake = createFakeSupabase((call) => {
      if (call.table === "signals") return { data: rows, error: null };
      return { data: [{ id: 1 }], error: null };
    });
    const getCandlesImpl = async () => {
      throw new Error("proveedor caído");
    };
    const summary = await resolveDueOutcomes(T0 + 10 * HOUR, { client: fake, getCandlesImpl });
    expect(summary.pendingData).toBe(1);
    expect(summary.resolved).toBe(0);
    expect(fake.calls.some((c) => c.table === "signal_outcomes")).toBe(false);
  });
});

describe("validación estricta del cuerpo de /api/signals/record", () => {
  it("acepta body vacío con defaults", () => {
    const parsed = parseRecordRequest({});
    expect(parsed.interval).toBe("1h");
    expect(parsed.symbols.length).toBeGreaterThan(0);
  });

  it("acepta symbols+interval explícitos y dedupea", () => {
    const parsed = parseRecordRequest({ symbols: ["btcusdt", "BTCUSDT"], interval: "4h" });
    expect(parsed.symbols).toEqual(["BTCUSDT"]);
    expect(parsed.interval).toBe("4h");
  });

  it("rechaza señales enviadas por el cliente (recompute-not-trust)", () => {
    expect(() => parseRecordRequest({ score: 100 })).toThrow(BadRequestError);
    expect(() => parseRecordRequest({ kind: "BUY", symbols: ["BTCUSDT"] })).toThrow(BadRequestError);
  });

  it("rechaza tipos/longitudes inválidas", () => {
    expect(() => parseRecordRequest("cadena")).toThrow(BadRequestError);
    expect(() => parseRecordRequest([1, 2])).toThrow(BadRequestError);
    expect(() => parseRecordRequest({ interval: 42 })).toThrow(BadRequestError);
    expect(() => parseRecordRequest({ interval: "7s" })).toThrow(BadRequestError);
    expect(() => parseRecordRequest({ symbols: "BTCUSDT" })).toThrow(BadRequestError);
    expect(() => parseRecordRequest({ symbols: [] })).toThrow(BadRequestError);
    expect(() =>
      parseRecordRequest({ symbols: Array.from({ length: 11 }, (_, i) => `SYM${i}USDT`) }),
    ).toThrow(BadRequestError);
    expect(() => parseRecordRequest({ symbols: ["BTCUSDT"], interval: "1h" , unknown_flag: true })).toThrow(BadRequestError);
  });
});

// ---------------------------------------------------------------------------
// Rutas de API con Request mocked
// ---------------------------------------------------------------------------

import { POST as recordPOST } from "@/app/api/signals/record/route";
import { GET as logGET } from "@/app/api/signals/log/route";
import { POST as resolvePOST } from "@/app/api/signals/resolve/route";

function mkPost(body: unknown, ip: string): Request {
  return new Request("http://localhost:3000/api/signals/record", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function mkGet(query: string, path = "http://localhost:3000/api/signals/log"): Request {
  return new Request(`${path}?${query}`, { method: "GET", headers: { "x-forwarded-for": uniqueIp() } });
}

describe("rutas de API en modo deshabilitado (sin credenciales)", () => {
  it("POST /api/signals/record -> 503 { enabled: false }", async () => {
    const res = await recordPOST(mkPost({}, uniqueIp()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });

  it("GET /api/signals/log -> 200 { enabled: false, signals: [] }", async () => {
    const res = await logGET(mkGet("market=crypto"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enabled: false, signals: [] });
  });

  it("POST /api/signals/resolve -> 503 { enabled: false }", async () => {
    const res = await resolvePOST(mkPost({}, uniqueIp()));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });
});

describe("rutas de API habilitadas con cliente falso", () => {
  it("POST record reevalúa y registra; body con score del cliente se rechaza (400)", async () => {
    enablePersistence();
    const fake = createFakeSupabase(defaultResponder);
    state.adminClient = fake;

    const ok = await recordPOST(mkPost({ interval: "1h", symbols: ["BTCUSDT"] }, uniqueIp()));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body).toMatchObject({ enabled: true, recorded: 1, duplicates: 0 });
    const upsertCall = fake.calls.find((c) => c.table === "signals" && c.op === "upsert");
    expect(upsertCall).toBeDefined();

    const rejected = await recordPOST(mkPost({ score: 999 }, uniqueIp()));
    expect(rejected.status).toBe(400);
  });

  it("POST record JSON inválido -> 400", async () => {
    enablePersistence();
    state.adminClient = createFakeSupabase(defaultResponder);
    const res = await recordPOST(mkPost("esto-no-es-json", uniqueIp()));
    expect(res.status).toBe(400);
  });

  it("POST record aplica límite en memoria de 10/min por IP", async () => {
    enablePersistence();
    state.adminClient = createFakeSupabase(defaultResponder);
    const ip = uniqueIp();
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await recordPOST(mkPost({ symbols: ["ETHUSDT"] }, ip));
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it("GET log habilitado devuelve señales con outcomes joined", async () => {
    enablePersistence();
    const fake = createFakeSupabase((call) => {
      if (call.table === "signals" && call.op === "select") {
        if (call.order?.column === "valid_until") return { data: [], error: null }; // resolve oportunista
        return {
          data: [
            {
              id: 1,
              symbol: "BTCUSDT",
              market: "crypto",
              interval: "1h",
              candle_time: new Date(T0).toISOString(),
              price_ref: 100,
              kind: "BUY",
              direction: "long",
              score: 40,
              bull_score: 45,
              bear_score: 5,
              freshness: "fresh",
              model_version: null,
              generated_at: new Date(T0).toISOString(),
              horizon_candles: 5,
              valid_until: new Date(T0 + 6 * HOUR).toISOString(),
              user_id: null,
              indicators: null,
              signal_outcomes: {
                outcome: "down",
                resolved_at: new Date(T0 + 7 * HOUR).toISOString(),
                return_pct: -3.5,
                correct: false,
              },
            },
          ],
          error: null,
        };
      }
      return { data: [], error: null };
    });
    state.adminClient = fake;

    const res = await logGET(mkGet("market=crypto&symbol=BTCUSDT&interval=1h&direction=BUY&limit=50"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.signals).toHaveLength(1);
    expect(body.signals[0].outcome).toMatchObject({ outcome: "down", returnPct: -3.5, correct: false });
  });

  it("GET log valida filtros: market y direction inválidos -> 400", async () => {
    enablePersistence();
    state.adminClient = createFakeSupabase(defaultResponder);
    expect((await logGET(mkGet("market=forex"))).status).toBe(400);
    expect((await logGET(mkGet("direction=TESLA"))).status).toBe(400);
  });

  it("POST resolve habilitado delega en el repositorio", async () => {
    enablePersistence();
    const fake = createFakeSupabase(() => ({ data: [], error: null }));
    state.adminClient = fake;
    const res = await resolvePOST(
      new Request("http://localhost:3000/api/signals/resolve", {
        method: "POST",
        headers: { "x-forwarded-for": uniqueIp() },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ enabled: true, considered: 0, resolved: 0 });
  });
});
