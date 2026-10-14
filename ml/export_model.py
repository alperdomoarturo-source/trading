"""
Exportacion del modelo calibrado a un JSON que el scorer de JavaScript puede
evaluar sin dependencias (Etapa 4 -> inferencia en src/lib/ml/inference.ts).

Unico formato de scoring soportado en JS: "platt-decision-ensemble", replica
fiel de CalibratedClassifierCV(LogisticRegression multiclase, method="sigmoid",
cv=N) en scikit-learn >= 1.6, que por pliegue (fold) hace:

  1. el clasificador base multiclase expone decision_function (prioridad sobre
     predict_proba en _get_response_values): z_k = w_k·x + b_k, con los
     coeficientes del pipeline StandardScaler+LR ya plegados sobre features
     crudas,
  2. una calibracion sigmoid (Platt) por clase: s_k = expit(-(A_k * z_k + B_k))
     (sklearn aplica el signo negativo en _SigmoidCalibration.predict),
  3. normalizacion: prob_k = s_k / sum(s),
y `predict_proba` promedia los pliegues.

El plegado del scaler por clase: w_raw[k] = w_scaled[k] / sigma;
b_raw[k] = intercept[k] - sum(w_scaled[k] * mean / sigma).

`export_calibrated_lr` verifica numeramente que la formula exportada
reproduce `predict_proba` de sklearn (max diff < 1e-6) y falla de forma
ruidosa si no, para no exportar nunca un scorer desalineado.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

VALIDATION_TOL = 1e-6


def _sigmoid(x: float) -> float:
    if x >= 0:
        z = math.exp(-x)
        return 1.0 / (1.0 + z)
    z = math.exp(x)
    return z / (1.0 + z)


def _platt(a: float, b: float, t: float) -> float:
    """_SigmoidCalibration.predict de sklearn: expit(-(a*t + b))."""
    return _sigmoid(-(a * t + b))


def _extract_sigmoid_params(calibrator: Any, depth: int = 0) -> tuple[float, float]:
    """(A, B) de un calibrador sigmoid de sklearn, con fallbacks de version.

    sklearn <= 1.6 expone propiedades .a/.b en _SigmoidCalibration;
    sklearn 1.9 expone los parámetros ajustados como .a_/.b_ directamente
    en el objeto (lista `calibrators` del pliegue, sin sufijo _)."""
    if depth > 4:
        raise RuntimeError("Demasiado anidamiento al extraer (A, B) del calibrador")

    def _scalar(x: Any) -> float:
        try:
            return float(x)
        except TypeError:
            seq = list(x)
            if len(seq) == 1:
                return float(seq[0])
            raise

    for pair in (("a", "b"), ("a_", "b_")):
        a = getattr(calibrator, pair[0], None)
        b = getattr(calibrator, pair[1], None)
        if a is not None and b is not None:
            return _scalar(a), _scalar(b)
    inner = getattr(calibrator, "calibrated_classifiers_", None)
    if inner:
        return _extract_sigmoid_params(inner[0].calibrators_[0], depth + 1)
    lr = getattr(calibrator, "lr", None)
    if lr is not None and hasattr(lr, "coef_"):
        return float(lr.coef_[0][0]), float(lr.intercept_[0])
    raise RuntimeError(
        "No se pudo extraer (A, B) del calibrador sigmoid de esta version de sklearn"
    )


def _fold_pipeline(pipeline: Any) -> tuple[list[list[float]], list[float]]:
    """Pliega StandardScaler + LogisticRegression multiclase en coeficientes crudos."""
    steps = dict(getattr(pipeline, "steps", []))
    scaler = steps.get("scaler")
    clf = steps.get("clf")
    if scaler is None or clf is None:
        raise RuntimeError("Se esperaba un pipeline con pasos 'scaler' y 'clf'")
    coef = clf.coef_
    if coef.ndim != 2 or coef.shape[0] < 2:
        raise RuntimeError("Se esperaba una LogisticRegression multiclase en coef_")
    mean = scaler.mean_
    scale = scaler.scale_
    weights: list[list[float]] = []
    intercepts: list[float] = []
    for k in range(coef.shape[0]):
        row = coef[k]
        weights.append([float(c / s) for c, s in zip(row, scale)])
        intercepts.append(
            float(clf.intercept_[k]) - float(sum(c * m / s for c, m, s in zip(row, mean, scale)))
        )
    return weights, intercepts


def score_from_exported(params: dict, x: list[float]) -> list[float]:
    """Reimplementacion exacta del scorer exportado (igual que inference.ts)."""
    scorer = params["scorer"]
    classes = scorer["classes"]
    n = len(classes)
    avg = [0.0] * n
    folds = scorer["folds"]
    for fold in folds:
        z = [
            fold["intercepts"][k] + sum(w * v for w, v in zip(fold["weights"][k], x))
            for k in range(n)
        ]
        scores = [_platt(fold["sigmoidA"][k], fold["sigmoidB"][k], z[k]) for k in range(n)]
        total = sum(scores)
        if total == 0:
            fold_probs = [1.0 / n] * n
        else:
            fold_probs = [s / total for s in scores]
        for k in range(n):
            avg[k] += fold_probs[k]
    return [a / len(folds) for a in avg]


def export_calibrated_lr(
    calibrated: Any,
    *,
    out_path: Path,
    symbol: str,
    interval: str,
    feature_names: list[str],
    label_classes: list[str],
    trained_at_ms: int,
    horizon: int,
    threshold: dict,
    data_window: dict,
    metrics: dict,
    validity_status: str,
    min_candles: int = 350,
    notes: list[str] | None = None,
) -> dict:
    fold_entries = getattr(calibrated, "calibrated_classifiers_", None)
    if not fold_entries:
        raise RuntimeError("El objeto calibrado no tiene calibrated_classifiers_ (pliegues)")
    class_map = {"0": "DOWN", "1": "NEUTRAL", "2": "UP"}
    classes = [class_map[str(int(c))] for c in calibrated.classes_]
    if classes != label_classes:
        raise RuntimeError(
            f"Orden de clases inesperado: {classes} != {label_classes}"
        )
    folds: list[dict] = []
    for cc in fold_entries:
        base = getattr(cc, "estimator", None)
        if base is None:
            raise RuntimeError("Pliegue sin estimador base ajustado")
        weights, intercepts = _fold_pipeline(base)
        if len(weights) != len(classes):
            raise RuntimeError("El pliegue no tiene una fila de coeficientes por clase")
        calibrators = getattr(cc, "calibrators_", None) or getattr(cc, "calibrators", None)
        if calibrators is None or len(calibrators) != len(classes):
            raise RuntimeError(
                "Pliegue sin calibradores por clase (estructura inesperada de sklearn)"
            )
        a_params: list[float] = []
        b_params: list[float] = []
        for calibrator in calibrators:
            a, bb = _extract_sigmoid_params(calibrator)
            a_params.append(a)
            b_params.append(bb)
        folds.append(
            {
                "weights": weights,
                "intercepts": intercepts,
                "sigmoidA": a_params,
                "sigmoidB": b_params,
            }
        )

    payload = {
        "schema": "ml-model-v2",
        "name": "logistic-calibrated",
        "version": 1,
        "symbol": symbol.upper(),
        "interval": interval,
        "trainedAt": trained_at_ms,
        "horizon": horizon,
        "labelClasses": classes,
        "featureNames": feature_names,
        "minCandles": min_candles,
        "scorer": {
            "type": "platt-decision-ensemble",
            "classes": classes,
            "folds": folds,
        },
        "threshold": threshold,
        "dataWindow": data_window,
        "metrics": metrics,
        "validityStatus": validity_status,
        "notes": notes or [],
    }

    # Verificacion numerica: el scorer exportado debe igualar a sklearn.
    import numpy as np

    if not _PROBE_ROWS:
        raise RuntimeError("Llama a set_probe_rows() con filas reales antes de exportar")
    probe = np.asarray(_PROBE_ROWS, dtype=float)
    ref = calibrated.predict_proba(probe)
    for row_idx, x in enumerate(_PROBE_ROWS):
        js = score_from_exported(payload, x)
        err = max(abs(p - r) for p, r in zip(js, ref[row_idx]))
        if err > VALIDATION_TOL:
            raise RuntimeError(
                f"Scorer exportado no reproduce predict_proba (err={err:.2e})"
            )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


# Filas de prueba para la verificacion (longitud = n_features; se rellenan
# desde train.py con filas reales antes de exportar).
_PROBE_ROWS: list[list[float]] = []


def set_probe_rows(rows: list[list[float]]) -> None:
    global _PROBE_ROWS
    _PROBE_ROWS = rows
