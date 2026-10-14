"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CONFIG, type PlatformConfig } from "@/lib/config/defaults";

const KEY = "trading-platform-config-v1";

export function loadConfig(): PlatformConfig {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<PlatformConfig>;
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

function mergeConfig(base: PlatformConfig, patch: Partial<PlatformConfig>): PlatformConfig {
  return {
    ...base,
    ...patch,
    signals: { ...base.signals, ...(patch.signals ?? {}) },
    costs: { ...base.costs, ...(patch.costs ?? {}) },
    paper: { ...base.paper, ...(patch.paper ?? {}) },
    backtest: { ...base.backtest, ...(patch.backtest ?? {}) },
    watchlist: Array.isArray(patch.watchlist) ? patch.watchlist : base.watchlist,
    defaultInterval: patch.defaultInterval ?? base.defaultInterval,
    candleLimit: patch.candleLimit ?? base.candleLimit,
  };
}

export function saveConfig(cfg: PlatformConfig): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    // localStorage no disponible (modo privado): la app funciona con valores por defecto
  }
}

export function useConfig() {
  const [config, setConfig] = useState<PlatformConfig>(DEFAULT_CONFIG);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setConfig(loadConfig());
    setHydrated(true);
  }, []);

  const update = useCallback((patch: Partial<PlatformConfig>) => {
    setConfig((prev) => {
      const next = mergeConfig(prev, patch);
      saveConfig(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    saveConfig(DEFAULT_CONFIG);
    setConfig(DEFAULT_CONFIG);
  }, []);

  return { config, update, reset, hydrated };
}
