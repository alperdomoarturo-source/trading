/**
 * Validación estricta del cuerpo de POST /api/signals/record.
 *
 * Enfoque "zod a mano" (cero dependencias nuevas): objeto plano, solo claves
 * conocidas, tipos exactos, límites duros. El cliente NO puede enviar señales
 * ni scores: solo pide "registra las señales ACTUALES de estos símbolos" y el
 * servidor las re-evalúa (ver la ruta).
 */

import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import { isValidInterval } from "@/lib/market";
import { BadRequestError, parseInterval, parseSymbol } from "@/lib/validation";

export const MAX_RECORD_SYMBOLS = 10;

const ALLOWED_KEYS = new Set(["symbols", "interval"]);

export interface RecordRequest {
  symbols: string[];
  interval: string;
}

export function parseRecordRequest(raw: unknown): RecordRequest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestError("El cuerpo debe ser un objeto JSON con claves opcionales: symbols, interval");
  }
  const obj = raw as Record<string, unknown>;

  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new BadRequestError(`Campo no permitido en el cuerpo: ${key}. El servidor re-evalúa las señales; no se aceptan señales del cliente.`);
    }
  }

  let interval: string;
  if (obj.interval === undefined || obj.interval === null) {
    interval = DEFAULT_CONFIG.defaultInterval;
  } else if (typeof obj.interval === "string") {
    interval = parseInterval(obj.interval);
    if (!isValidInterval(interval)) throw new BadRequestError(`Intervalo no soportado: ${interval}`);
  } else {
    throw new BadRequestError("interval debe ser una cadena");
  }

  let symbols: string[];
  if (obj.symbols === undefined || obj.symbols === null) {
    symbols = DEFAULT_CONFIG.watchlist.slice(0, MAX_RECORD_SYMBOLS);
  } else if (Array.isArray(obj.symbols)) {
    if (obj.symbols.length === 0 || obj.symbols.length > MAX_RECORD_SYMBOLS) {
      throw new BadRequestError(`symbols debe tener entre 1 y ${MAX_RECORD_SYMBOLS} elementos`);
    }
    if (obj.symbols.some((s) => typeof s !== "string")) {
      throw new BadRequestError("cada símbolo debe ser una cadena");
    }
    symbols = (obj.symbols as string[]).map(parseSymbol);
  } else {
    throw new BadRequestError("symbols debe ser un array de cadenas");
  }

  return { symbols: [...new Set(symbols)], interval };
}
