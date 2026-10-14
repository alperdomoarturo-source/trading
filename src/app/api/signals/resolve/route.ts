/**
 * POST /api/signals/resolve — resuelve resultados (outcomes) de señales cuyo
 * horizonte ya venció.
 *
 * HONESTIDAD SOBRE TRABAJOS EN SEGUNDO PLANO: en el plan gratuito de Vercel no
 * existe garantía de cron ilimitado ni de jobs continuos (las Functions tienen
 * timeout y Hobby limita los cron jobs). Por eso el resolve NO depende de un
 * scheduler: se dispara a demanda desde aquí (botón de la UI o integración
 * externa) y también de forma oportunista, con presupuesto limitado, en el GET
 * de /api/signals/log. Cada llamada es idempotente: las señales ya resueltas
 * se ignoran (append/update-once en signal_outcomes).
 *
 * Regla dura: solo se escriben outcomes cuando now >= valid_until (horizonte
 * completamente vencido); nunca se adivina antes.
 */

import { resolveDueOutcomes } from "@/lib/db/signals-repo";
import { isPersistenceEnabled } from "@/lib/db/status";
import { jsonError } from "@/lib/validation";
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
    return jsonError(429, "Demasiadas peticiones de resolución: máximo 10 por minuto.");
  }

  try {
    const summary = await resolveDueOutcomes(Date.now());
    if (!summary.enabled) {
      return Response.json(
        { enabled: false, error: "El cliente de Supabase no está disponible." },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json({ ...summary }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(500, "No se pudieron resolver los outcomes", err instanceof Error ? err.message : String(err));
  }
}
