import { Badge } from "@/components/ui";
import { SIGNAL_LABELS, type Signal } from "@/lib/signals/types";
import type { Verdict } from "@/lib/signals/verdict";
import { describeTrendWindow, type TrendDurationEstimate } from "@/lib/simulation/duration";
import { fmtDateTime, fmtPercent, fmtPrice, timeAgo } from "@/lib/format";

const TONES: Record<Signal["kind"], "up" | "down" | "warning" | "accent" | "neutral"> = {
  BUY: "up",
  SELL: "down",
  WAIT: "warning",
  NONE: "neutral",
  INSUFFICIENT_DATA: "neutral",
  DATA_ERROR: "warning",
};

export function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded bg-surface-2" aria-hidden>
      <div
        className="h-full rounded bg-accent"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function SignalCard({
  signal,
  compact = false,
  verdict,
  trendWindow,
}: {
  signal: Signal;
  compact?: boolean;
  verdict?: Verdict;
  trendWindow?: TrendDurationEstimate | null;
}) {
  const tone = TONES[signal.kind];
  return (
    <div className="rounded-lg border border-border-subtle bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{SIGNAL_LABELS[signal.kind]}</Badge>
          <span className="font-mono font-semibold">{signal.symbol}</span>
          <span className="text-xs text-muted">{signal.interval}</span>
        </div>
        <div className="text-xs text-muted">
          {fmtDateTime(signal.candleTime)} · {timeAgo(signal.candleTime)}
        </div>
      </div>

      {verdict && (
        <div className="mt-3 rounded-md border border-border-subtle bg-surface-2/40 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={verdict.tone === "up" ? "up" : verdict.tone === "down" ? "down" : "neutral"}>
              {verdict.label}
            </Badge>
            {trendWindow && (
              <span className="text-[11px] text-muted">
                {describeTrendWindow(trendWindow, signal.interval)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">{verdict.detail}</p>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <div className="text-xs text-muted">Precio de referencia</div>
          <div className="font-mono">{fmtPrice(signal.priceRef)}</div>
        </div>
        <div>
          <div className="text-xs text-muted">Puntuación</div>
          <div className="font-mono">
            {fmtPrice(signal.score)} / 100
          </div>
          <div className="mt-1">
            <ScoreBar score={signal.score} />
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Alcista / Bajista</div>
          <div className="font-mono">
            <span className="text-up">{signal.bullScore}</span>
            {" / "}
            <span className="text-down">{signal.bearScore}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted">Horizonte</div>
          <div className="font-mono">{signal.horizonCandles} velas</div>
        </div>
      </div>

      {!compact && (
        <>
          <div className="mt-3 border-t border-border-subtle pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted">
              Motivos principales
            </div>
            <ul className="mt-1.5 space-y-1 text-sm">
              {signal.reasons.slice(0, 5).map((r, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="font-mono text-xs text-muted">+{r.weight}</span>
                  <span>{r.text}</span>
                </li>
              ))}
              {signal.reasons.length === 0 && (
                <li className="text-muted">Sin condiciones destacables.</li>
              )}
            </ul>
          </div>

          {signal.indicators && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge>RSI {signal.indicators.rsi.toFixed(1)}</Badge>
              <Badge>ADX {signal.indicators.adx.toFixed(1)}</Badge>
              <Badge>ATR {signal.indicators.atrPct.toFixed(2)}%</Badge>
              <Badge>Vol rel {signal.indicators.relativeVolume.toFixed(2)}x</Badge>
              <Badge tone={signal.indicators.trend === "up" ? "up" : signal.indicators.trend === "down" ? "down" : "neutral"}>
                Tendencia: {signal.indicators.trend === "up" ? "alcista" : signal.indicators.trend === "down" ? "bajista" : "rango"}
              </Badge>
            </div>
          )}

          {signal.levels?.nearestSupport !== undefined && (
            <div className="mt-2 text-xs text-muted">
              Soporte cercano:{" "}
              <span className="font-mono text-up">{fmtPrice(signal.levels.nearestSupport)}</span>
              {signal.levels.nearestResistance !== undefined && (
                <>
                  {" · "}Resistencia cercana:{" "}
                  <span className="font-mono text-down">{fmtPrice(signal.levels.nearestResistance)}</span>
                </>
              )}
            </div>
          )}

          {signal.warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {signal.warnings.map((w, idx) => (
                <p key={idx} className="text-xs text-warning">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}

          <p className="mt-3 text-[11px] text-muted">
            Reglas explicables sobre la vela cerrada más reciente; el veredicto de arriba suma
            además el sesgo del modelo ML cuando hay un modelo validado para este par. Ninguna
            de las dos cosas es una garantía: rentabilidad pasada no asegura resultados futuros.
          </p>
        </>
      )}
    </div>
  );
}

export function SignalKindBadge({ kind }: { kind: Signal["kind"] }) {
  return <Badge tone={TONES[kind]}>{SIGNAL_LABELS[kind]}</Badge>;
}

export function ChangePercent({ value }: { value: number | undefined | null }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className="text-muted">—</span>;
  return (
    <span className={value >= 0 ? "text-up" : "text-down"}>{fmtPercent(value)}</span>
  );
}
