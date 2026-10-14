/** Validación de parámetros de consulta (límite del sistema: entrada HTTP). */

import { INTERVALS, type Market } from "@/lib/market/types";

export interface ParsedQuery {
  symbol?: string;
  interval?: string;
  limit?: number;
  days?: number;
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

/** Par cripto: solo letras y dígitos, 5-20 caracteres (p. ej. BTCUSDT). */
const CRYPTO_SYMBOL_RE = /^[A-Z0-9]{5,20}$/;
/** Acción de EE. UU.: 1-5 letras y sufijo opcional de 1-2 letras (p. ej. BRK.B). */
const STOCK_SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;

/**
 * Valida y normaliza un símbolo admitido (cripto o acción).
 * Rechaza cualquier otro carácter (intentos de inyección incluidos).
 */
export function parseSymbol(raw: string | null): string {
  if (!raw) throw new BadRequestError("Falta el parámetro symbol");
  const clean = raw.trim().toUpperCase();
  // Evita dobles sufijos tipo "AAPL.US" (el sufijo ".us" lo añade el proveedor).
  if (clean.endsWith(".US")) throw new BadRequestError(`Símbolo inválido: ${raw}`);
  if (CRYPTO_SYMBOL_RE.test(clean) || STOCK_SYMBOL_RE.test(clean)) return clean;
  throw new BadRequestError(`Símbolo inválido: ${raw}`);
}

/** Valida el parámetro ?market= de las rutas; por defecto cripto. */
export function parseMarketParam(raw: string | null): Market {
  if (raw === null || raw === "" || raw === "crypto") return "crypto";
  if (raw === "stocks") return "stocks";
  throw new BadRequestError(`Mercado no soportado: ${raw}`);
}

export function parseInterval(raw: string | null, fallback?: string): string {
  if (!raw && fallback) return fallback;
  if (!raw) throw new BadRequestError("Falta el parámetro interval");
  if (!(INTERVALS as readonly string[]).includes(raw)) {
    throw new BadRequestError(`Intervalo no soportado: ${raw}`);
  }
  return raw;
}

export function parseLimit(raw: string | null, fallback = 500, max = 1000): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 10 || n > max) {
    throw new BadRequestError(`limit debe ser un entero entre 10 y ${max}`);
  }
  return n;
}

export function parseDays(raw: string | null, fallback = 180, max = 730): number {
  if (raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 7 || n > max) {
    throw new BadRequestError(`days debe ser un entero entre 7 y ${max}`);
  }
  return n;
}

export function jsonError(status: number, message: string, details?: unknown): Response {
  return Response.json({ error: message, details }, { status });
}
