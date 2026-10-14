"""
Especificacion canonica de features ML.

Estas funciones son una reimplementacion en Python puro (sin pandas) de los
indicadores de `src/lib/analysis/indicators.ts` y de los patrones de
`src/lib/analysis/patterns.ts`, con las MISMAS formulas y las MISMAS
convenciones de seed, de modo que la fila de features calculada en
entrenamiento (Python) y en inferencia (TypeScript) sea identica.

Convencion de series: `candles` es una lista de dicts con claves
open/high/low/close/volume, ordenadas por tiempo ascendente, SOLO velas
cerradas. La fila de features en el indice i usa exclusivamente datos con
indice <= i (sin lookahead; el etiquetado mira hacia el futuro, nunca el
feature).

DEFINICIONES (ordinales = posicion en FEATURE_NAMES):

 0  ret_1           (close[i]/close[i-1] - 1) * 100
 1  ret_3           (close[i]/close[i-3] - 1) * 100
 2  ret_5           (close[i]/close[i-5] - 1) * 100
 3  ret_10          (close[i]/close[i-10] - 1) * 100
 4  ema20_ratio     (close/ema20 - 1) * 100          (distancePercent TS)
 5  ema20_50_ratio  (ema20/ema50 - 1) * 100
 6  ema50_200_ratio (ema50/ema200 - 1) * 100
 7  rsi_14          RSI Wilder (seed = media de 14 primeras diffs), 100 si avgLoss==0
 8  macd_hist_norm  (histograma MACD / close) * 100. MACD = EMA12-EMA26,
                    senal = EMA9 aplicada desde el primer valor valido del MACD
 9  bb_pctb         (close - lower) / (upper - lower); 0.5 si upper == lower.
                    Bollinger 20 con desviacion TIPICA POBLACIONAL (ddof=0, como TA-Lib/TS)
10  atr_pct        (ATR14 / close) * 100. ATR = Wilder del True Range; TR[0] = high-low
11  adx_14         ADX Wilder (primer ADX = media de los 14 primeros DX validos)
12  plus_di_14     +DI = 100 * Wilder(+DM,14) / Wilder(TR,14)
13  minus_di_14    -DI analogo
14  obv_slope_10   (obv[i] - obv[i-10]) / (10 * media de volumen en [i-9..i]);
                   obv acumula sign(delta close) * volumen desde obv[0]=0
15  rel_vol_20     volume[i] / SMA(volume,20)[i]  (la SMA incluye la vela actual)
16  range_pos_20   (close - min(low, ultimas 20)) / (max(high, ultimas 20) - min);
                   0.5 si el rango es 0
17  body_ratio     |close-open| / (high-low); 0 si high==low  (anatomy TS)
18  up_wick_ratio  (high - max(open,close)) / (high-low); 0 si high==low
19  low_wick_ratio (min(open,close) - low) / (high-low); 0 si high==low
20  pat_bull_engulfing  1 si vela i es Bullish Engulfing (def. exacta de patterns.ts)
21  pat_bear_engulfing  idem Bearish Engulfing
22  pat_hammer          lowerWick >= 2*body y upperWick <= 0.25*range, body>0, range>0
23  pat_doji            body_ratio <= 0.1 y range > 0
24  pat_morning_star    3 velas: baja con cuerpo >= cuerpo medio (ultimas 10),
                        central con cuerpo <= 0.4*medio, alcista cierra por encima
                        de la mitad del cuerpo de la primera
25  pat_evening_star    espejo bajista

EMAs: seed = SMA de los primeros `period` valores (valor valido en indice
period-1), factor k = 2/(period+1).  Wilder: seed = media de los primeros
`period` valores, luego out[i] = (out[i-1]*(p-1)+v[i])/p.  NaN = valor no
definido aun (serie demasiado corta); en entrenamiento esas filas se descartan.

pandas no se usa a proposito: `ewm` de pandas semilla de otra forma y no
reproduce exactamente las formulas TS; el Python puro garantiza la paridad.
"""

from __future__ import annotations

import math
from typing import Any

NAN = float("nan")

FEATURE_NAMES = [
    "ret_1",
    "ret_3",
    "ret_5",
    "ret_10",
    "ema20_ratio",
    "ema20_50_ratio",
    "ema50_200_ratio",
    "rsi_14",
    "macd_hist_norm",
    "bb_pctb",
    "atr_pct",
    "adx_14",
    "plus_di_14",
    "minus_di_14",
    "obv_slope_10",
    "rel_vol_20",
    "range_pos_20",
    "body_ratio",
    "up_wick_ratio",
    "low_wick_ratio",
    "pat_bull_engulfing",
    "pat_bear_engulfing",
    "pat_hammer",
    "pat_doji",
    "pat_morning_star",
    "pat_evening_star",
]

N_FEATURES = len(FEATURE_NAMES)


def _is_nan(x: float) -> bool:
    return x != x  # noqa: PIE790 - NaN check rapido


# ---------------------------------------------------------------- indicadores


def sma(values: list[float], period: int) -> list[float]:
    out = [NAN] * len(values)
    if period <= 0:
        return out
    acc = 0.0
    for i, v in enumerate(values):
        acc += v
        if i >= period:
            acc -= values[i - period]
        if i >= period - 1:
            out[i] = acc / period
    return out


def ema(values: list[float], period: int) -> list[float]:
    out = [NAN] * len(values)
    if period <= 0 or len(values) < period:
        return out
    k = 2.0 / (period + 1)
    out[period - 1] = sum(values[:period]) / period
    for i in range(period, len(values)):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


def wilder(values: list[float], period: int) -> list[float]:
    out = [NAN] * len(values)
    if len(values) < period:
        return out
    out[period - 1] = sum(values[:period]) / period
    for i in range(period, len(values)):
        out[i] = (out[i - 1] * (period - 1) + values[i]) / period
    return out


def rsi(closes: list[float], period: int = 14) -> list[float]:
    out = [NAN] * len(closes)
    if len(closes) <= period:
        return out
    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_gain = wilder(gains, period)
    avg_loss = wilder(losses, period)
    for i in range(len(avg_gain)):
        if _is_nan(avg_gain[i]):
            continue
        idx = i + 1
        if avg_loss[i] == 0:
            out[idx] = 100.0
        else:
            rs = avg_gain[i] / avg_loss[i]
            out[idx] = 100.0 - 100.0 / (1.0 + rs)
    return out


def macd(closes: list[float], fast: int = 12, slow: int = 26, signal_period: int = 9):
    ema_fast = ema(closes, fast)
    ema_slow = ema(closes, slow)
    line = [
        NAN if (_is_nan(f) or _is_nan(s)) else f - s
        for f, s in zip(ema_fast, ema_slow)
    ]
    first_valid = next((i for i, v in enumerate(line) if not _is_nan(v)), -1)
    sig = [NAN] * len(closes)
    if first_valid >= 0:
        ema_signal = ema(line[first_valid:], signal_period)
        for i, v in enumerate(ema_signal):
            if not _is_nan(v):
                sig[first_valid + i] = v
    hist = [
        NAN if (_is_nan(m) or _is_nan(s)) else m - s for m, s in zip(line, sig)
    ]
    return line, sig, hist


def stdev(values: list[float], period: int) -> list[float]:
    out = [NAN] * len(values)
    if period <= 1:
        return out
    means = sma(values, period)
    for i in range(period - 1, len(values)):
        acc = 0.0
        m = means[i]
        for j in range(i - period + 1, i + 1):
            acc += (values[j] - m) ** 2
        out[i] = math.sqrt(acc / period)
    return out


def bollinger(closes: list[float], period: int = 20, mult: float = 2.0):
    middle = sma(closes, period)
    sd = stdev(closes, period)
    upper = [NAN if _is_nan(m) else m + mult * s for m, s in zip(middle, sd)]
    lower = [NAN if _is_nan(m) else m - mult * s for m, s in zip(middle, sd)]
    return upper, middle, lower


def true_range(candles: list[dict]) -> list[float]:
    out = []
    for i, c in enumerate(candles):
        if i == 0:
            out.append(c["high"] - c["low"])
        else:
            pc = candles[i - 1]["close"]
            out.append(
                max(c["high"] - c["low"], abs(c["high"] - pc), abs(c["low"] - pc))
            )
    return out


def atr(candles: list[dict], period: int = 14) -> list[float]:
    return wilder(true_range(candles), period)


def adx(candles: list[dict], period: int = 14):
    n = len(candles)
    out_adx = [NAN] * n
    plus_di = [NAN] * n
    minus_di = [NAN] * n
    if n < 2 * period + 1:
        return out_adx, plus_di, minus_di

    plus_dm = [0.0]
    minus_dm = [0.0]
    for i in range(1, n):
        up = candles[i]["high"] - candles[i - 1]["high"]
        down = candles[i - 1]["low"] - candles[i]["low"]
        plus_dm.append(up if (up > down and up > 0) else 0.0)
        minus_dm.append(down if (down > up and down > 0) else 0.0)

    tr = true_range(candles)
    sm_tr = wilder(tr, period)
    sm_plus = wilder(plus_dm, period)
    sm_minus = wilder(minus_dm, period)

    dx = [NAN] * n
    for i in range(n):
        if _is_nan(sm_tr[i]) or sm_tr[i] == 0:
            continue
        pdi = 100.0 * sm_plus[i] / sm_tr[i]
        mdi = 100.0 * sm_minus[i] / sm_tr[i]
        plus_di[i] = pdi
        minus_di[i] = mdi
        s = pdi + mdi
        dx[i] = 0.0 if s == 0 else 100.0 * abs(pdi - mdi) / s

    first_dx = next((i for i, v in enumerate(dx) if not _is_nan(v)), -1)
    if first_dx < 0:
        return out_adx, plus_di, minus_di
    acc = 0.0
    count = 0
    adx_value = None
    for i in range(first_dx, n):
        if _is_nan(dx[i]):
            continue
        if adx_value is None:
            if count < period:
                acc += dx[i]
                count += 1
                if count == period:
                    adx_value = acc / period
                    out_adx[i] = adx_value
        else:
            adx_value = (adx_value * (period - 1) + dx[i]) / period
            out_adx[i] = adx_value
    return out_adx, plus_di, minus_di


def obv(candles: list[dict]) -> list[float]:
    out = [0.0] * len(candles)
    for i in range(1, len(candles)):
        d = candles[i]["close"] - candles[i - 1]["close"]
        direction = (d > 0) - (d < 0)
        out[i] = out[i - 1] + direction * candles[i]["volume"]
    return out


def pct_return(closes: list[float], n: int) -> list[float]:
    return [
        NAN if (i < n or closes[i - n] == 0) else (closes[i] / closes[i - n] - 1) * 100
        for i in range(len(closes))
    ]


def relative_volume(volumes: list[float], period: int = 20) -> list[float]:
    avg = sma(volumes, period)
    return [
        NAN if (_is_nan(a) or a == 0) else v / a for v, a in zip(volumes, avg)
    ]


def range_position(candles: list[dict], period: int = 20) -> list[float]:
    out = []
    for i, c in enumerate(candles):
        if i < period - 1:
            out.append(NAN)
            continue
        hi = max(x["high"] for x in candles[i - period + 1 : i + 1])
        lo = min(x["low"] for x in candles[i - period + 1 : i + 1])
        out.append(0.5 if hi == lo else (c["close"] - lo) / (hi - lo))
    return out


# ------------------------------------------------------------------ patrones


def _anatomy(c: dict):
    rng = c["high"] - c["low"]
    body = abs(c["close"] - c["open"])
    upper = c["high"] - max(c["open"], c["close"])
    lower = min(c["open"], c["close"]) - c["low"]
    body_ratio = body / rng if rng > 0 else 0.0
    return body, upper, lower, rng, body_ratio


def _is_bullish(c: dict) -> bool:
    return c["close"] > c["open"]


def _is_bearish(c: dict) -> bool:
    return c["close"] < c["open"]


def _avg_body(candles: list[dict], index: int) -> float:
    """Cuerpo medio de las ultimas 10 velas (igual que patterns.ts)."""
    frm = max(0, index - 9)
    bodies = [_anatomy(candles[i])[0] for i in range(frm, index + 1)]
    return sum(bodies) / len(bodies) if bodies else 0.0


def pattern_flags(candles: list[dict], i: int) -> dict[str, int]:
    """Flags binarios subconjunto de patterns.ts; criterios geometricos exactos."""
    flags = {
        "pat_bull_engulfing": 0,
        "pat_bear_engulfing": 0,
        "pat_hammer": 0,
        "pat_doji": 0,
        "pat_morning_star": 0,
        "pat_evening_star": 0,
    }
    cur = candles[i]
    body, upper, lower, rng, body_ratio = _anatomy(cur)

    if rng > 0 and body_ratio <= 0.1:
        flags["pat_doji"] = 1
    if rng > 0 and body > 0 and lower >= 2 * body and upper <= rng * 0.25:
        flags["pat_hammer"] = 1
    if i >= 1:
        prev = candles[i - 1]
        if _is_bearish(prev) and _is_bullish(cur):
            if cur["close"] > prev["open"] and cur["open"] < prev["close"]:
                flags["pat_bull_engulfing"] = 1
        if _is_bullish(prev) and _is_bearish(cur):
            if cur["close"] < prev["open"] and cur["open"] > prev["close"]:
                flags["pat_bear_engulfing"] = 1
    if i >= 2:
        c1, c2, c3 = candles[i - 2], candles[i - 1], candles[i]
        ab = _avg_body(candles, i)
        if ab > 0:
            b1 = _anatomy(c1)[0]
            b2 = _anatomy(c2)[0]
            if (
                _is_bearish(c1)
                and b1 >= ab
                and b2 <= ab * 0.4
                and _is_bullish(c3)
                and c3["close"] > c1["close"] + (c1["open"] - c1["close"]) / 2
            ):
                flags["pat_morning_star"] = 1
            if (
                _is_bullish(c1)
                and b1 >= ab
                and b2 <= ab * 0.4
                and _is_bearish(c3)
                and c3["close"] < c1["close"] - (c1["close"] - c1["open"]) / 2
            ):
                flags["pat_evening_star"] = 1
    return flags


# ------------------------------------------------------------------- matriz


def feature_row(candles: list[dict], i: int, cache: dict) -> list[float]:
    """Fila de features en el indice i. `cache` reutiliza las series crudas
    (se calculan una vez por serie): cache['series'] con las listas ya listas."""
    s = cache.setdefault("series", _indicator_series(candles))
    c = candles[i]
    close = c["close"]

    def get(name: str) -> float:
        return s[name][i]

    row = [
        get("ret_1"),
        get("ret_3"),
        get("ret_5"),
        get("ret_10"),
        get("ema20_ratio"),
        get("ema20_50_ratio"),
        get("ema50_200_ratio"),
        get("rsi_14"),
        get("macd_hist_norm"),
        get("bb_pctb"),
        get("atr_pct"),
        get("adx_14"),
        get("plus_di_14"),
        get("minus_di_14"),
        get("obv_slope_10"),
        get("rel_vol_20"),
        get("range_pos_20"),
        get("body_ratio"),
        get("up_wick_ratio"),
        get("low_wick_ratio"),
    ]
    flags = pattern_flags(candles, i)
    row.extend(
        float(flags[name])
        for name in [
            "pat_bull_engulfing",
            "pat_bear_engulfing",
            "pat_hammer",
            "pat_doji",
            "pat_morning_star",
            "pat_evening_star",
        ]
    )
    return row


def _indicator_series(candles: list[dict]) -> dict[str, list[float]]:
    closes = [c["close"] for c in candles]
    volumes = [c["volume"] for c in candles]
    ema20 = ema(closes, 20)
    ema50 = ema(closes, 50)
    ema200 = ema(closes, 200)
    _, _, hist = macd(closes)
    upper, _, lower = bollinger(closes, 20, 2.0)
    atr14 = atr(candles, 14)
    adx_line, plus_di, minus_di = adx(candles, 14)
    obv_line = obv(candles)

    ret10 = pct_return(closes, 10)
    obv_slope = [NAN] * len(candles)
    for i in range(10, len(candles)):
        window = volumes[i - 9 : i + 1]
        avg_vol = sum(window) / len(window)
        if avg_vol > 0:
            obv_slope[i] = (obv_line[i] - obv_line[i - 10]) / (10 * avg_vol)

    bb_pctb = [NAN] * len(candles)
    for i in range(len(candles)):
        if _is_nan(upper[i]) or _is_nan(lower[i]):
            continue
        width = upper[i] - lower[i]
        bb_pctb[i] = 0.5 if width == 0 else (closes[i] - lower[i]) / width

    anatomy_rows = []
    for c in candles:
        body, upper_w, lower_w, rng, body_ratio = _anatomy(c)
        anatomy_rows.append(
            (
                body_ratio,
                0.0 if rng <= 0 else upper_w / rng,
                0.0 if rng <= 0 else lower_w / rng,
            )
        )

    return {
        "ret_1": pct_return(closes, 1),
        "ret_3": pct_return(closes, 3),
        "ret_5": pct_return(closes, 5),
        "ret_10": ret10,
        "ema20_ratio": [
            NAN if (_is_nan(m) or m == 0) else (c / m - 1) * 100
            for c, m in zip(closes, ema20)
        ],
        "ema20_50_ratio": [
            NAN if (_is_nan(a) or _is_nan(b) or b == 0) else (a / b - 1) * 100
            for a, b in zip(ema20, ema50)
        ],
        "ema50_200_ratio": [
            NAN if (_is_nan(a) or _is_nan(b) or b == 0) else (a / b - 1) * 100
            for a, b in zip(ema50, ema200)
        ],
        "rsi_14": rsi(closes, 14),
        "macd_hist_norm": [
            NAN if (_is_nan(h) or c == 0) else (h / c) * 100
            for h, c in zip(hist, closes)
        ],
        "bb_pctb": bb_pctb,
        "atr_pct": [
            NAN if (_is_nan(a) or c == 0) else (a / c) * 100
            for a, c in zip(atr14, closes)
        ],
        "adx_14": adx_line,
        "plus_di_14": plus_di,
        "minus_di_14": minus_di,
        "obv_slope_10": obv_slope,
        "rel_vol_20": relative_volume(volumes, 20),
        "range_pos_20": range_position(candles, 20),
        "body_ratio": [r[0] for r in anatomy_rows],
        "up_wick_ratio": [r[1] for r in anatomy_rows],
        "low_wick_ratio": [r[2] for r in anatomy_rows],
    }


def build_dataset(
    candles: list[dict],
) -> tuple[list[list[float]], dict[str, Any]]:
    """Matriz de features para todas las filas completas (sin labels).
    Devuelve (X, meta) donde meta['indices'] mapea fila -> indice en candles."""
    cache: dict = {}
    rows: list[list[float]] = []
    indices: list[int] = []
    for i in range(len(candles)):
        row = feature_row(candles, i, cache)
        if all(not _is_nan(v) for v in row):
            rows.append(row)
            indices.append(i)
    return rows, {"indices": indices}
