"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/market/types";
import type { DetectedPattern } from "@/lib/analysis/patterns";
import type { Level } from "@/lib/analysis/levels";
import type { Projection } from "@/lib/simulation/projection";
import { fmtPrice } from "@/lib/format";

export interface ChartOverlays {
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
}

export interface ChartMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}

export interface CandleChartProps {
  candles: Candle[];
  overlays: ChartOverlays | null;
  showOverlays: { ema: boolean; bb: boolean; volume: boolean };
  levels?: { supports: Level[]; resistances: Level[] } | null;
  patterns?: DetectedPattern[] | null;
  markers?: ChartMarker[] | null;
  formingLabel?: string | null;
  /** Cono de escenario hipotético (simulación basada en la predicción ML). */
  projection?: Projection | null;
  height?: number;
}

function toLineData(times: number[], values: (number | null)[]): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    out.push({ time: (times[i] / 1000) as UTCTimestamp, value: v });
  }
  return out;
}

interface LegendInfo {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export function CandleChart({
  candles,
  overlays,
  showOverlays,
  levels,
  patterns,
  markers,
  formingLabel,
  projection,
  height = 460,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const emaSeriesRef = useRef<Record<string, ISeriesApi<"Line"> | null>>({});
  const priceLinesRef = useRef<unknown[]>([]);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const [legend, setLegend] = useState<LegendInfo | null>(null);

  // Creación única del gráfico.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: "#0b0e11" },
        textColor: "#8b96a5",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1a2029" },
        horzLines: { color: "#1a2029" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#4da3ff", labelBackgroundColor: "#1a2029" },
        horzLine: { color: "#4da3ff", labelBackgroundColor: "#1a2029" },
      },
      rightPriceScale: { borderColor: "#232b36" },
      timeScale: { borderColor: "#232b36", timeVisible: true, secondsVisible: false },
      localization: { locale: "es-CO" },
    });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      borderVisible: false,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      color: "#26a69a50",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData.has(candleSeries)) {
        setLegend(null);
        return;
      }
      const bar = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
      const vol = param.seriesData.get(volumeSeries) as HistogramData<Time> | undefined;
      if (!bar) {
        setLegend(null);
        return;
      }
      setLegend({
        time: Number(param.time) * 1000,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: vol?.value ?? 0,
        closed: true,
      });
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resize = () => {
      chart.applyOptions({ width: container.clientWidth });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    return () => {
      observer.disconnect();
      markersRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      emaSeriesRef.current = {};
      priceLinesRef.current = [];
    };
  }, [height]);

  // Datos de velas y volumen: se actualiza sin recrear el gráfico.
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || candles.length === 0) return;
    candleSeries.setData(
      candles.map((c) => ({
        time: (c.time / 1000) as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volumeSeries.setData(
      candles.map((c) => ({
        time: (c.time / 1000) as UTCTimestamp,
        value: c.volume,
        color: c.close >= c.open ? "#26a69a66" : "#ef535066",
      })),
    );
    volumeSeries.applyOptions({ visible: showOverlays.volume });
    if (!legend) {
      const last = candles[candles.length - 1];
      setLegend({
        time: last.time,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume,
        closed: last.closed,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, showOverlays.volume]);

  // Superposiciones (EMAs y Bandas de Bollinger).
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !overlays || candles.length === 0) return;
    const times = candles.map((c) => c.time);

    const ensureLine = (key: string, color: string, width: 1 | 2, dashed = false) => {
      if (!emaSeriesRef.current[key]) {
        emaSeriesRef.current[key] = chart.addSeries(LineSeries, {
          color,
          lineWidth: width,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      return emaSeriesRef.current[key]!;
    };

    const ema20 = ensureLine("ema20", "#f0b90b", 1);
    const ema50 = ensureLine("ema50", "#4da3ff", 2);
    const ema200 = ensureLine("ema200", "#8b96a5", 2);
    const bbUpper = ensureLine("bbUpper", "#7c8da6", 1, true);
    const bbLower = ensureLine("bbLower", "#7c8da6", 1, true);

    ema20.setData(toLineData(times, overlays.ema20));
    ema50.setData(toLineData(times, overlays.ema50));
    ema200.setData(toLineData(times, overlays.ema200));
    bbUpper.setData(toLineData(times, overlays.bbUpper));
    bbLower.setData(toLineData(times, overlays.bbLower));

    ema20.applyOptions({ visible: showOverlays.ema });
    ema50.applyOptions({ visible: showOverlays.ema });
    ema200.applyOptions({ visible: showOverlays.ema });
    bbUpper.applyOptions({ visible: showOverlays.bb });
    bbLower.applyOptions({ visible: showOverlays.bb });
  }, [overlays, candles, showOverlays.ema, showOverlays.bb]);

  // Líneas de soporte y resistencia.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) {
      series.removePriceLine(line as never);
    }
    priceLinesRef.current = [];
    if (!levels) return;
    const all: Level[] = [
      ...levels.supports.map((l) => ({ ...l })),
      ...levels.resistances.map((l) => ({ ...l })),
    ];
    for (const level of all.slice(0, 10)) {
      const line = series.createPriceLine({
        price: level.price,
        color: level.type === "support" ? "#26a69a" : "#ef5350",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${level.type === "support" ? "S" : "R"}·${level.touches}`,
      });
      priceLinesRef.current.push(line);
    }
  }, [levels]);

  // Marcadores de patrones y señales.
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    const out: SeriesMarker<Time>[] = [];
    if (patterns) {
      for (const p of patterns) {
        const candle = candles[p.index];
        if (!candle) continue;
        out.push({
          time: (candle.time / 1000) as UTCTimestamp,
          position: p.direction === "bullish" ? "belowBar" : "aboveBar",
          color: p.direction === "bullish" ? "#26a69a" : p.direction === "bearish" ? "#ef5350" : "#8b96a5",
          shape: p.direction === "bullish" ? "arrowUp" : p.direction === "bearish" ? "arrowDown" : "circle",
          text: p.name,
          size: 1,
        });
      }
    }
    if (markers) {
      for (const m of markers) {
        out.push({
          time: (m.time / 1000) as UTCTimestamp,
          position: m.position,
          color: m.color,
          shape: m.shape,
          text: m.text,
          size: 2,
        });
      }
    }
    if (out.length > 60) out.length = 60;
    if (!markersRef.current) {
      markersRef.current = createSeriesMarkers(series, out);
    } else {
      markersRef.current.setMarkers(out);
    }
  }, [patterns, markers, candles]);

  // Cono de proyección hipotético (punteado): trayectoria central + bandas ATR.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const keys = ["projMid", "projUpper", "projLower"] as const;
    const ensure = (key: (typeof keys)[number], color: string) => {
      if (!emaSeriesRef.current[key]) {
        emaSeriesRef.current[key] = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        });
      }
      return emaSeriesRef.current[key]!;
    };
    if (!projection || projection.points.length < 2) {
      for (const key of keys) {
        const s = emaSeriesRef.current[key];
        if (s) {
          s.setData([]);
          s.applyOptions({ visible: false });
        }
      }
      return;
    }
    const proj = projection;
    const midColor =
      proj.scenario === "up" ? "#26a69a" : proj.scenario === "down" ? "#ef5350" : "#f0b90b";
    const mid = ensure("projMid", midColor);
    const upper = ensure("projUpper", "#7c8da6");
    const lower = ensure("projLower", "#7c8da6");
    const toData = (pick: (p: (typeof proj.points)[number]) => number): LineData<Time>[] =>
      proj.points.map((p) => ({ time: (p.time / 1000) as UTCTimestamp, value: pick(p) }));
    mid.setData(toData((p) => p.mid));
    upper.setData(toData((p) => p.upper));
    lower.setData(toData((p) => p.lower));
    mid.applyOptions({ visible: true });
    upper.applyOptions({ visible: true });
    lower.applyOptions({ visible: true });
  }, [projection]);

  const legendCandle = legend;
  const isUp = legendCandle ? legendCandle.close >= legendCandle.open : true;

  return (
    <div className="relative">
      <div
        ref={containerRef}
        role="img"
        aria-label="Gráfico de velas japonesas con volumen e indicadores"
        className="w-full rounded-lg border border-border-subtle bg-surface"
      />
      {legendCandle && (
        <div className="pointer-events-none absolute top-2 left-2 z-10 rounded bg-surface-2/90 px-3 py-1.5 font-mono text-[11px] leading-relaxed text-muted">
          <div className="text-foreground">
            {new Date(legendCandle.time).toLocaleString("es-CO", {
              dateStyle: "short",
              timeStyle: "short",
            })}{" "}
            {legendCandle.closed ? "" : "(en formación)"}
          </div>
          <div>
            <span className={isUp ? "text-up" : "text-down"}>
              O {fmtPrice(legendCandle.open)} · A {fmtPrice(legendCandle.high)} · B{" "}
              {fmtPrice(legendCandle.low)} · C {fmtPrice(legendCandle.close)}
            </span>
          </div>
          <div>Vol {legendCandle.volume.toLocaleString("es-CO")}</div>
        </div>
      )}
      <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1 font-mono text-[10px] text-muted">
        {showOverlays.ema && (
          <span className="rounded bg-surface-2/90 px-2 py-0.5">
            <span className="text-[#f0b90b]">EMA20</span>{" "}
            <span className="text-[#4da3ff]">EMA50</span>{" "}
            <span className="text-[#8b96a5]">EMA200</span>
          </span>
        )}
        {showOverlays.bb && (
          <span className="rounded bg-surface-2/90 px-2 py-0.5 text-[#7c8da6]">
            Bollinger 20·2σ
          </span>
        )}
        {projection && projection.points.length >= 2 && (
          <span className="rounded bg-surface-2/90 px-2 py-0.5">
            <span className={projection.scenario === "up" ? "text-up" : projection.scenario === "down" ? "text-down" : "text-warning"}>
              Proyección ML
            </span>{" "}
            · escenario hipotético
          </span>
        )}
        {formingLabel && (
          <span className="rounded bg-warning/20 px-2 py-0.5 text-warning">
            {formingLabel}
          </span>
        )}
      </div>
    </div>
  );
}
