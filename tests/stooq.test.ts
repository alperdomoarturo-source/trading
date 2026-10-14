import { describe, expect, it } from "vitest";
import {
  cleanStockSymbol,
  parseStooqCsv,
  toStooqInterval,
  stooqProvider,
} from "@/lib/market/stocks/stooq";
import { toStooqTicker, STOCK_ASSETS } from "@/lib/market/stocks/symbols";
import { ProviderError } from "@/lib/market/types";

/** Cabecera + 3 sesiones cerradas (viernes-lunes-martes de octubre 2026). */
const CSV_OK = [
  "Date,Open,High,Low,Close,Volume",
  "2026-10-16,250.10,252.30,249.00,251.50,45000000",
  "2026-10-19,251.00,253.00,250.50,252.80,41000000",
  "2026-10-20,252.80,254.00,251.20,253.90,39000000",
  "",
].join("\n");

describe("parseStooqCsv", () => {
  it("parsea OHLCV diario con fecha a 00:00 UTC y closed=true", () => {
    const candles = parseStooqCsv(CSV_OK, "AAPL", "1d");
    expect(candles).toHaveLength(3);
    const first = candles[0];
    expect(first.time).toBe(Date.UTC(2026, 9, 16));
    expect(first.open).toBeCloseTo(250.1);
    expect(first.high).toBeCloseTo(252.3);
    expect(first.low).toBeCloseTo(249.0);
    expect(first.close).toBeCloseTo(251.5);
    expect(first.volume).toBeCloseTo(45_000_000);
    expect(first.symbol).toBe("AAPL");
    expect(first.market).toBe("stocks");
    expect(first.provider).toBe("stooq");
    expect(first.interval).toBe("1d");
    // Todas cerradas: Stooq solo publica sesiones completadas.
    for (const c of candles) expect(c.closed).toBe(true);
  });

  it("ordena cronológicamente aunque el CSV venga invertido", () => {
    const inverted = CSV_OK.split("\n").slice(0, 4).reverse().join("\n");
    const candles = parseStooqCsv(inverted, "AAPL", "1d");
    expect(candles.map((c) => c.time)).toEqual([
      Date.UTC(2026, 9, 16),
      Date.UTC(2026, 9, 19),
      Date.UTC(2026, 9, 20),
    ]);
  });

  it("descarta filas con OHLC incoherente pero conserva las válidas", () => {
    const csv = [
      "Date,Open,High,Low,Close,Volume",
      "2026-10-16,250.10,249.00,252.30,251.50,45000000", // high < low
      "2026-10-19,-1.00,253.00,250.50,252.80,41000000", // precio negativo
      "2026-10-20,252.80,254.00,251.20,253.90,39000000", // válida
    ].join("\n");
    const candles = parseStooqCsv(csv, "AAPL", "1d");
    expect(candles).toHaveLength(1);
    expect(candles[0].time).toBe(Date.UTC(2026, 9, 20));
  });

  it("conserva volumen 0 o vacío como 0 (no invalida la vela)", () => {
    const csv = [
      "Date,Open,High,Low,Close,Volume",
      "2026-10-16,250.10,252.30,249.00,251.50,0",
      "2026-10-19,251.00,253.00,250.50,252.80,",
    ].join("\n");
    const candles = parseStooqCsv(csv, "SPY", "1d");
    expect(candles).toHaveLength(2);
    expect(candles[0].volume).toBe(0);
    expect(candles[1].volume).toBe(0);
  });

  it("lanza error legible cuando Stooq responde 'No data'", () => {
    expect(() => parseStooqCsv("No data\n", "FAKESYM", "1d")).toThrow(ProviderError);
    expect(() => parseStooqCsv("No data\n", "FAKESYM", "1d")).toThrow(/no tiene datos/);
  });

  it("detecta el límite diario de solicitudes del endpoint gratuito", () => {
    try {
      parseStooqCsv("Exceeded the daily hits limit\n", "AAPL", "1d");
      expect.unreachable("debía lanzar ProviderError");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderError);
      expect((err as ProviderError).statusCode).toBe(429);
    }
  });

  it("tolera BOM al inicio del CSV", () => {
    const csv = "\uFEFFDate,Open,High,Low,Close,Volume\n2026-10-16,1,2,0.5,1.5,10\n";
    expect(parseStooqCsv(csv, "AAPL", "1d")).toHaveLength(1);
  });
});

describe("mapeo de símbolos a Stooq", () => {
  it("ticker = minúsculas + '.us'", () => {
    expect(toStooqTicker("AAPL")).toBe("aapl.us");
    expect(toStooqTicker("aapl")).toBe("aapl.us");
    expect(toStooqTicker("BRK.B")).toBe("brk.b.us");
  });

  it("la lista inicial cubre los 10 activos solicitados", () => {
    expect(STOCK_ASSETS.map((a) => a.symbol)).toEqual([
      "AAPL",
      "MSFT",
      "NVDA",
      "GOOGL",
      "AMZN",
      "META",
      "TSLA",
      "JPM",
      "XOM",
      "SPY",
    ]);
  });

  it("cleanStockSymbol acepta tickers válidos y rechaza entrada maliciosa", () => {
    expect(cleanStockSymbol("aapl")).toBe("AAPL");
    expect(cleanStockSymbol("BRK.B")).toBe("BRK.B");
    expect(() => cleanStockSymbol("AAPL;DROP")).toThrow(ProviderError);
    expect(() => cleanStockSymbol("../../etc/passwd")).toThrow(ProviderError);
    expect(() => cleanStockSymbol("ABCDEF")).toThrow(ProviderError); // 6 letras
    expect(() => cleanStockSymbol("")).toThrow(ProviderError);
  });
});

describe("intervalos de acciones", () => {
  it("solo soporta 1d y 1w", () => {
    expect(toStooqInterval("1d")).toBe("d");
    expect(toStooqInterval("1w")).toBe("w");
  });

  it("rechaza otros intervalos con mensaje en español", () => {
    expect(() => toStooqInterval("1h")).toThrow(/intervalo no disponible para acciones; use 1d o 1w/);
    expect(() => toStooqInterval("5m")).toThrow(ProviderError);
  });

  it("getCandles rechaza el intervalo antes de tocar la red", async () => {
    await expect(stooqProvider.getCandles("AAPL", "1h", 100)).rejects.toThrow(
      /intervalo no disponible para acciones/,
    );
  });
});

describe("getTickers derivado de velas diarias", () => {
  it("calcula precio y variación con las dos últimas sesiones (sin red)", () => {
    // Validación aritmética del mismo cálculo que usa getTickers.
    const rows = parseStooqCsv(CSV_OK, "AAPL", "1d");
    const last = rows[rows.length - 1];
    const prev = rows[rows.length - 2];
    expect(last.close).toBeCloseTo(253.9);
    expect(((last.close - prev.close) / prev.close) * 100).toBeCloseTo(0.43513, 4);
  });
});
