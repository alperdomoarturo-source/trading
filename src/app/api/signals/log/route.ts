/**
 * GET /api/signals/log — historial persistido de señales + outcomes.
 *
 * Filtros opcionales: market, symbol, interval, direction (kind exacto:
 * BUY/SELL/WAIT/NONE/INSUFFICIENT_DATA/DATA_ERROR), limit (10..200), offset.
 *
 * Sin credenciales de Supabase responde { enabled: false, signals: [] } con
 * 200: el usuario ve una tarjeta explicativa y el resto de la app sigue
 * funcionando igual (localStorage + señales sin estado).
 *
 * Resolución oportunista: cada petición intenta resolver hasta 5 señales cuyo
 * horizonte venció (sin falsas promesas de background jobs: en Vercel Hobby
 * no hay cron ilimitado; véase /api/signals/resolve y supabase/README.md).
 */

import { getRecentSignals, resolveDueOutcomes } from "@/lib/db/signals-repo";
import { isPersistenceEnabled } from "@/lib/db/status";
import { BadRequestError, jsonError, parseInterval, parseLimit, parseSymbol } from "@/lib/validation";
import { SIGNAL_LABELS, type SignalKind } from "@/lib/signals/types";

const KINDS = Object.keys(SIGNAL_LABELS) as SignalKind[];

const RESOLVE_BUDGET_PER_REQUEST = 5;

export async function GET(request: Request): Promise<Response> {
  try {
    if (!isPersistenceEnabled()) {
      return Response.json(
        { enabled: false, signals: [] },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }

    const url = new URL(request.url);

    const market = url.searchParams.get("market");
    if (market !== null && market !== "" && market !== "crypto" && market !== "stocks") {
      throw new BadRequestError("market debe ser crypto o stocks");
    }

    const symbolRaw = url.searchParams.get("symbol");
    const symbol = symbolRaw && symbolRaw !== "" ? parseSymbol(symbolRaw) : undefined;

    const intervalRaw = url.searchParams.get("interval");
    const interval = intervalRaw && intervalRaw !== "" ? parseInterval(intervalRaw) : undefined;

    const directionRaw = url.searchParams.get("direction");
    let direction: string | undefined;
    if (directionRaw !== null && directionRaw !== "") {
      if (!(KINDS as string[]).includes(directionRaw)) {
        throw new BadRequestError(`direction inválida: ${directionRaw}`);
      }
      direction = directionRaw;
    }

    const limit = parseLimit(url.searchParams.get("limit"), 50, 200);

    const offsetRaw = url.searchParams.get("offset");
    let offset = 0;
    if (offsetRaw !== null && offsetRaw !== "") {
      const n = Number(offsetRaw);
      if (!Number.isInteger(n) || n < 0 || n > 10_000) {
        throw new BadRequestError("offset debe ser un entero entre 0 y 10000");
      }
      offset = n;
    }

    // Resolución oportunista con presupuesto pequeño: si falla, el historial
    // existente sigue siendo legible.
    let resolved = 0;
    try {
      const summary = await resolveDueOutcomes(Date.now(), { limit: RESOLVE_BUDGET_PER_REQUEST });
      resolved = summary.resolved + summary.expired;
    } catch {
      // Silencioso a propósito: si no se puede resolver hoy, el historial
      // existente sigue siendo válido y legible.
    }

    const signals = await getRecentSignals({
      market: market || undefined,
      symbol,
      interval,
      direction,
      limit,
      offset,
    });

    return Response.json(
      { enabled: true, signals, resolved },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof BadRequestError) return jsonError(400, err.message);
    return jsonError(500, "No se pudo leer el historial", err instanceof Error ? err.message : String(err));
  }
}
