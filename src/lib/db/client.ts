/**
 * Cliente Supabase SOLO PARA EL SERVIDOR.
 *
 * NUNCA importar este módulo desde un Client Component ("use client"): el
 * guard runtime de abajo lo impide con un error claro. La clave
 * SUPABASE_SERVICE_ROLE_KEY solo puede leerse del entorno del servidor
 * (sin prefijo NEXT_PUBLIC_); exponerla al navegador entregaría un pase
 * que bypasea RLS.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { persistenceConfig, type EnvSource } from "./status";

let cachedClient: SupabaseClient | null = null;
let cachedCacheKey: string | null = null;

export function getSupabaseAdmin(env: EnvSource = process.env): SupabaseClient | null {
  // Guard: en el navegador este módulo no debe ejecutarse jamás.
  if (typeof window !== "undefined") {
    throw new Error(
      "getSupabaseAdmin() es de solo servidor. No importes src/lib/db/client desde un Client Component.",
    );
  }
  const cfg = persistenceConfig(env);
  if (!cfg.enabled || !cfg.url || !cfg.key) return null;

  const cacheKey = `${cfg.mode}:${cfg.url}`;
  if (cachedClient && cachedCacheKey === cacheKey) return cachedClient;

  cachedClient = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedCacheKey = cacheKey;
  return cachedClient;
}

/** Solo para pruebas: descarta el cliente cacheado. */
export function resetSupabaseClientCache(): void {
  cachedClient = null;
  cachedCacheKey = null;
}
