/**
 * Estado de la persistencia (Etapa 7).
 *
 * Toda la app debe funcionar SIN Supabase: si faltan las variables de
 * entorno, `isPersistenceEnabled()` devuelve false y las rutas de
 * persistencia responden `{ enabled: false }` en lugar de fallar.
 *
 * MODOS (en orden de preferencia):
 *  1. "service": SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (solo servidor;
 *     bypasea RLS; permite escribir señales y resolver outcomes).
 *  2. "anon": NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY
 *     (lectura pública conforme a RLS; sin políticas de escritura, el
 *     navegador no puede insertar señales).
 */

export type EnvSource = Record<string, string | undefined>;

export type PersistenceMode = "service" | "anon" | "none";

export interface PersistenceConfig {
  enabled: boolean;
  mode: PersistenceMode;
  url: string | null;
  key: string | null;
}

function trimmed(value: string | undefined): string | null {
  const v = value?.trim();
  return v && v.length > 0 ? v : null;
}

export function persistenceConfig(env: EnvSource = process.env): PersistenceConfig {
  const serviceUrl = trimmed(env.SUPABASE_URL);
  const serviceKey = trimmed(env.SUPABASE_SERVICE_ROLE_KEY);
  if (serviceUrl && serviceKey) {
    return { enabled: true, mode: "service", url: serviceUrl, key: serviceKey };
  }
  const anonUrl = trimmed(env.NEXT_PUBLIC_SUPABASE_URL);
  const anonKey = trimmed(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (anonUrl && anonKey) {
    return { enabled: true, mode: "anon", url: anonUrl, key: anonKey };
  }
  return { enabled: false, mode: "none", url: null, key: null };
}

/** true solo si hay par URL+clave suficiente para crear un cliente. */
export function isPersistenceEnabled(env: EnvSource = process.env): boolean {
  return persistenceConfig(env).enabled;
}
