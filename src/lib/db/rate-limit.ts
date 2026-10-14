/**
 * Limitador de peticiones en memoria (ventana deslizante de 60 s por clave).
 *
 * Honestidad serverless: en Vercel cada instancia/function puede tener su
 * propio mapa, así que esto es una defensa barata contra abuso accidental,
 * no un contador global garantizado. Suficiente para $0/uso personal.
 */

export interface RateLimiter {
  /** true si la petición puede procesarse; false si excede el cupo. */
  allow(key: string, nowMs?: number): boolean;
}

export function createRateLimiter(maxPerMinute: number): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, nowMs: number = Date.now()): boolean {
      const windowStart = nowMs - 60_000;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);
      if (recent.length >= maxPerMinute) {
        hits.set(key, recent);
        return false;
      }
      recent.push(nowMs);
      hits.set(key, recent);
      return true;
    },
  };
}

/** IP del cliente según Vercel/Proxy (x-forwarded-for); fallback local. */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "local";
}
