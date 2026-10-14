"use client";

/**
 * Alertas del navegador (opc-in, §15 del prompt maestro).
 * Solo notifica señales BUY/SELL confirmadas, una vez por
 * (symbol, intervalo, vela, tipo). No promete alertas permanentes:
 * el navegador solo notifica mientras la aplicación está abierta.
 */

const SEEN_KEY = "trading-notified-signals-v1";
const SEEN_CAP = 500;

export type PermissionState = NotificationPermission | "unsupported";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function currentPermission(): PermissionState {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission;
}

/** Pide permiso al usuario; devuelve el estado resultante. */
export async function enableNotifications(): Promise<PermissionState> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      // el navegador pudo rechazar el diálogo; mantener estado actual
    }
  }
  return Notification.permission;
}

interface NotifiableSignal {
  symbol: string;
  interval: string;
  candleTime: number;
  kind: string;
  direction: string | null;
  score: number;
  priceRef: number;
}

function loadSeen(): string[] {
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function markSeen(key: string): void {
  try {
    const seen = loadSeen();
    if (seen.includes(key)) return;
    seen.push(key);
    window.sessionStorage.setItem(
      SEEN_KEY,
      JSON.stringify(seen.slice(-SEEN_CAP)),
    );
  } catch {
    // sin sessionStorage
  }
}

/** Notifica una señal nueva si el usuario autorizó las alertas. */
export function notifySignal(sig: NotifiableSignal): void {
  if (!notificationsSupported() || Notification.permission !== "granted") return;
  if (sig.kind !== "BUY" && sig.kind !== "SELL") return;
  const key = `${sig.symbol}:${sig.interval}:${sig.candleTime}:${sig.kind}`;
  if (loadSeen().includes(key)) return;
  markSeen(key);
  const label = sig.kind === "BUY" ? "COMPRA SIMULADA" : "VENTA SIMULADA";
  try {
    new Notification(`${label} · ${sig.symbol}`, {
      body: `Temporalidad ${sig.interval} · puntuación ${sig.score} · referencia ${sig.priceRef}`,
      tag: key,
    });
  } catch {
    // algunos navegadores solo permiten ServiceWorkerRegistration.showNotification
  }
}
