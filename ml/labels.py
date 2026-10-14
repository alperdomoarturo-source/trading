"""
Etiquetado a 3 clases para el motor de prediccion (Etapa 4).

Metodo (documentado tambien en ml/README.md):

  Para la fila de features correspondiente a la vela cerrada i, se mira el
  cierre futuro en i + h (h = horizonte, por defecto 5 velas):

    thr_pct = max(min_move_pct, k * atr_pct[i])     (porcentaje del precio)
    UP      si  close[i+h] >  close[i] * (1 + thr_pct/100)
    DOWN    si  close[i+h] <  close[i] * (1 - thr_pct/100)
    NEUTRAL en cualquier otro caso

  atr_pct[i] es el ATR14 como porcentaje del cierre en i (feature 10), de
  modo que el umbral escala con la volatilidad local: en regimen de baja
  volatilidad se usa el suelo min_move_pct (0.15 % por defecto) y los
  movimientos diminutos se etiquetan NEUTRAL en lugar de inflar las clases
  direccionales. Con k = 0.5, en volatilidad alta el umbral exige que el
  movimiento sea al menos medio ATR para contar como direccional.

  El umbral se fija con la volatilidad de la vela i (pasada), no con la del
  futuro: no hay informacion posterior en la etiqueta que filtre a las
  features (las features de la fila i solo usan velas <= i).

  Las h ultimas velas no pueden etiquetarse (falta futuro) y se descartan.
"""

from __future__ import annotations

CLASS_DOWN = 0
CLASS_NEUTRAL = 1
CLASS_UP = 2

CLASS_NAMES = ["DOWN", "NEUTRAL", "UP"]


def label_threshold_pct(atr_pct_value: float, k: float, min_move_pct: float) -> float:
    return max(min_move_pct, k * atr_pct_value)


def label_at(
    closes: list[float],
    i: int,
    atr_pct_row: list[float],
    horizon: int,
    k: float = 0.5,
    min_move_pct: float = 0.15,
) -> int | None:
    """Etiqueta de la vela i o None si no hay cierre futuro/ATR valido."""
    j = i + horizon
    if j >= len(closes):
        return None
    atr_pct = atr_pct_row[i]
    if atr_pct != atr_pct:  # NaN
        return None
    thr = label_threshold_pct(atr_pct, k, min_move_pct) / 100.0
    base = closes[i]
    future = closes[j]
    if future > base * (1.0 + thr):
        return CLASS_UP
    if future < base * (1.0 - thr):
        return CLASS_DOWN
    return CLASS_NEUTRAL
