import type { ReactNode } from "react";

export function Card({
  title,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-lg border border-border-subtle bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {actions}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "up" | "down" | "warning" | "accent" | "neutral";
  children: ReactNode;
}) {
  const tones: Record<string, string> = {
    up: "bg-up/15 text-up border-up/40",
    down: "bg-down/15 text-down border-down/40",
    warning: "bg-warning/15 text-warning border-warning/40",
    accent: "bg-accent/15 text-accent border-accent/40",
    neutral: "bg-surface-2 text-muted border-border-subtle",
  };
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "up" | "down" | "warning";
  hint?: string;
}) {
  const color =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${color}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function Loading({ label = "Cargando datos…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-lg border border-border-subtle bg-surface p-8 text-muted">
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent"
        aria-hidden
      />
      <span role="status">{label}</span>
    </div>
  );
}

export function ErrorBox({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-down/40 bg-down/10 p-4" role="alert">
      <div className="font-semibold text-down">{title}</div>
      <div className="mt-1 text-sm text-muted">{message}</div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border-subtle p-8 text-center text-muted">
      {message}
    </div>
  );
}
