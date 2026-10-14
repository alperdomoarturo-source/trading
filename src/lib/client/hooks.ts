"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  fetchedAt: number | null;
}

/**
 * Hook de obtención de datos con reintentos suaves y refresco manual.
 * SinSWR intencionalmente: cero dependencias extra.
 */
export function useApi<T>(url: string | null, pollMs?: number) {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: true,
    error: null,
    fetchedAt: null,
  });
  const urlRef = useRef(url);
  urlRef.current = url;

  const load = useCallback(async () => {
    const u = urlRef.current;
    if (!u) {
      setState({ data: null, loading: false, error: null, fetchedAt: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: s.data ? s.error : null }));
    try {
      const res = await fetch(u, { headers: { Accept: "application/json" } });
      const body = (await res.json()) as T & { error?: string; details?: string };
      if (!res.ok) {
        setState({
          data: null,
          loading: false,
          error: `${body.error ?? res.statusText}${body.details ? `: ${body.details}` : ""}`,
          fetchedAt: Date.now(),
        });
        return;
      }
      setState({ data: body, loading: false, error: null, fetchedAt: Date.now() });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err instanceof Error ? err.message : "Error de red",
        fetchedAt: Date.now(),
      }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, url]);

  useEffect(() => {
    if (!pollMs || !url) return;
    const id = setInterval(() => void load(), pollMs);
    return () => clearInterval(id);
  }, [pollMs, url, load]);

  return { ...state, refresh: load };
}
