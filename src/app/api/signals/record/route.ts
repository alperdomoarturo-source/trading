/**
 * POST /api/signals/record — registra las señales actuales en Supabase.
 *
 * DISEÑO "recompute-not-trust" (documentado a propósito):
 * el cuerpo SOLO puede contener { symbols?, interval? }. Cualquier score,
 * kind o precio enviado por el cliente se rechaza en la validación. El
 * servidor re-evalúa cada símbolo con el motor oficial (evaluateCurrentSignal
 * + DEFAULT_CONFIG) y registra ESO. Así es imposible inyectar señales
 * fabricadas en el historial, y el registro es exactamente reproducible.
 *
 * Seguridad/costes ($0): límite en memoria de 10 peticiones/min por IP y
 * tope de 10 símbolos por petición (cada uno consulta el proveedor de
 * mercado). Sin credenciales de Supabase: 503 { enabled: false } y la app
 * sigue funcionando sin persistencia.
 */

import { getCandles } from "@/lib/market";
import { evaluateCurrentSignal } from "@/lib/signals/engine";
import { DEFAULT_CONFIG } from "@/lib/config/defaults";
import { BadRequestError, jsonError } from "@/lib/validation";
import { recordSignal } from "@/lib/db/signals-repo";
import { isPersistenceEnabled } from "@/lib/db/status";
import { parseRecordRequest } from "@/lib/db/record-request";
import { clientIp, createRateLimiter } from "@/lib/db/rate-limit";

const limiter = createRateLimiter(10);

export async function POST(request: Request): Promise<Response> {
  if (!isPersistenceEnabled()) {
    return Response.json(
      { enabled: false, error: "Persistencia no configurada: define las variables de Supabase (ver supabase/README.md)." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!limiter.allow(clientIp(request))) {
    return jsonError(429, "Demasiadas peticiones de registro: máximo 10 por minuto.");
  }

  try {
    const body: unknown = await request.json().catch(() => null);
    const { symbols, interval } = parseRecordRequest(body);

    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const series = await getCandles(symbol, interval, 500);
        const signal = evaluateCurrentSignal(series.candles, DEFAULT_CONFIG.signals, {
          symbol,
          market: "crypto",
          interval,
          freshness: series.meta.freshness,
        });
        return recordSignal(signal);
      }),
    );

    let recorded = 0;
    let duplicates = 0;
    let failed = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.inserted) recorded++;
        else if (r.value.skipped === "duplicate") duplicates++;
        else failed++;
      } else {
        failed++;
      }
    }

    return Response.json(
      { enabled: true, interval, requested: symbols.length, recorded, duplicates, failed },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(500, "No se pudieron registrar las señales", err instanceof Error ? err.message : String(err));
  }
}
