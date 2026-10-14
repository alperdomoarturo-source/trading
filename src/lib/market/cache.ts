/**
 * Caché en memoria para respuestas de proveedores.
 *
 * En Vercel Hobby cada instancia de función tiene su propia memoria:
 * la caché reduce llamadas por instancia pero no es una caché global.
 * El TTL se elige conservador para respetar los límites de Binance.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 200;

export function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  if (process.env.CACHE_DISABLED === "true") return;
  if (store.size >= MAX_ENTRIES) {
    // Elimina la entrada más antigua (Map conserva orden de inserción).
    const oldest = store.keys().next().value;
    if (oldest !== undefined) store.delete(oldest);
  }
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/**
 * Obtiene un valor de la caché o lo calcula. Las llamadas concurrentes con
 * la misma clave comparten una única promesa (previene solicitudes duplicadas).
 */
export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const p = (async () => {
    try {
      const value = await compute();
      cacheSet(key, value, ttlMs);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
