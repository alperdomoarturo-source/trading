"""
Entrenamiento offline del motor de prediccion ML (Etapa 4).

Uso (Windows, venv ya creado en ml/.venv):

    ml\\.venv\\Scripts\\activate
    python ml/train.py --symbol BTCUSDT --interval 1h --horizon 5 --models all

Que hace:
  1. Descarga velas cerradas de Binance (ml/data.py, paginado, cacheado).
  2. Construye features canonicas (ml/features.py, identicas a las de TS) y
     etiquetas a 3 clases con umbral dependiente de ATR (ml/labels.py).
  3. Division temporal SIN barajar: pool (walk-forward) -> val -> test.
     Walk-forward con 3 splits expandientes: train=prefijo creciente del
     pool, test=el siguiente segmento. El slice val se usa para calibracion
     (out-of-fold dentro de CalibratedClassifierCV); test queda intocable
     hasta la evaluacion final.
  4. Compara 4 candidatos: (0) baseline momentum, (1) LogisticRegression
     estandarizada, (2) RandomForest, (3) HistGradientBoosting.
  5. El modelo de SERVICIO es siempre la LR calibrada con
     CalibratedClassifierCV(method='sigmoid', cv=3), porque es el unico
     scorable en JS sin dependencias. RF/HGB se reportan igualmente; si
     ganan offline se documenta en `notes` del metadata exportado.
  6. Escribe ml/reports/<symbol>-<interval>-<fecha>.json/.md y, si hay
     datos suficientes, data/models/model-<symbol>-<interval>-v1.json con
     validity_status = "valid"|"not_ready".

decision de calibracion (documentada): con ~4-5 mil filas y 3 clases,
isotonic sobreajusta; se usa Platt (sigmoid) con cv=3, que ademas es el
unico metodo cuya parametrizacion es exportable a un scorer JS de 87 floats.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
from pathlib import Path

import numpy as np
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    confusion_matrix,
    log_loss,
    precision_recall_fscore_support,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parent))

import export_model  # noqa: E402
from data import load_or_fetch  # noqa: E402
from features import FEATURE_NAMES, build_dataset  # noqa: E402
from labels import CLASS_NAMES  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = Path(__file__).resolve().parent / "reports"
MODELS_DIR = REPO_ROOT / "data" / "models"

BASELINE = "baseline_momentum"
LR = "logistic_regression"
RF = "random_forest"
HGB = "hist_gradient_boosting"


def make_models() -> dict:
    return {
        LR: Pipeline(
            [("scaler", StandardScaler()), ("clf", LogisticRegression(max_iter=3000))]
        ),
        RF: RandomForestClassifier(
            n_estimators=400, min_samples_leaf=20, n_jobs=-1, random_state=42
        ),
        HGB: HistGradientBoostingClassifier(random_state=42),
    }


def momentum_predict(X: np.ndarray) -> np.ndarray:
    """Baseline: dirección del retorno de 1 vela (feature 0); 0 exacto = NEUTRAL."""
    r = X[:, 0]
    pred = np.full(len(X), 1)
    pred[r > 0] = 2
    pred[r < 0] = 0
    return pred


def one_hot_probs(pred: np.ndarray, n_classes: int = 3) -> np.ndarray:
    probs = np.zeros((len(pred), n_classes))
    probs[np.arange(len(pred)), pred] = 1.0
    return probs


def metrics_block(y_true: np.ndarray, y_pred: np.ndarray, probs: np.ndarray | None):
    labels = [0, 1, 2]
    out: dict = {
        "n": int(len(y_true)),
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "balancedAccuracy": round(float(balanced_accuracy_score(y_true, y_pred)), 4),
        "classDistribution": {
            CLASS_NAMES[k]: int((y_true == k).sum()) for k in labels
        },
        "perClass": {},
        "confusionMatrix": confusion_matrix(y_true, y_pred, labels=labels).tolist(),
    }
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, labels=labels, zero_division=0
    )
    for k, name in enumerate(CLASS_NAMES):
        out["perClass"][name] = {
            "precision": round(float(precision[k]), 4),
            "recall": round(float(recall[k]), 4),
            "f1": round(float(f1[k]), 4),
        }
    if probs is not None:
        present = sorted(set(y_true.tolist()))
        out["logLoss"] = (
            round(float(log_loss(y_true, probs, labels=labels)), 4)
            if len(present) > 1
            else None
        )
        onehot = np.zeros_like(probs)
        onehot[np.arange(len(y_true)), y_true] = 1.0
        out["brierScore"] = round(float(((probs - onehot) ** 2).sum(axis=1).mean() / 3), 4)
    return out


def walk_forward_scores(
    X: np.ndarray, y: np.ndarray, pool_end: int, n_folds: int, seed_models: dict
) -> dict[str, dict]:
    """3+ splits expandientes dentro del pool. Devuelve metricas agregadas."""
    fractions = [0.25, 0.5, 0.75, 1.0]
    folds = []
    for j in range(1, len(fractions)):
        tr_end = int(pool_end * fractions[j - 1])
        te_end = int(pool_end * fractions[j])
        if te_end - tr_end < 40 or tr_end < 200:
            continue
        folds.append((slice(0, tr_end), slice(tr_end, te_end)))
    if len(folds) < 3:
        raise RuntimeError(
            f"Datos insuficientes para {n_folds} splits walk-forward ({len(folds)} validos)"
        )
    results: dict[str, list[dict]] = {BASELINE: []}
    for name in seed_models:
        results[name] = []
    for tr, te in folds:
        X_tr, y_tr, X_te, y_te = X[tr], y[tr], X[te], y[te]
        results[BASELINE].append(
            metrics_block(y_te, momentum_predict(X_te), None)
        )
        for name, model in seed_models.items():
            clone_model = clone(model)
            clone_model.fit(X_tr, y_tr)
            pred = clone_model.predict(X_te)
            results[name].append(metrics_block(y_te, pred, None))
    agg = {}
    for name, ms in results.items():
        agg[name] = {
            "folds": len(ms),
            "meanBalancedAccuracy": round(
                float(np.mean([m["balancedAccuracy"] for m in ms])), 4
            ),
            "meanAccuracy": round(float(np.mean([m["accuracy"] for m in ms])), 4),
            "perFoldBalancedAccuracy": [m["balancedAccuracy"] for m in ms],
            "perFoldN": [m["n"] for m in ms],
        }
    return agg


def main() -> int:
    ap = argparse.ArgumentParser(description="Entrena el modelo de prediccion ML (offline).")
    ap.add_argument("--symbol", default="BTCUSDT")
    ap.add_argument("--interval", default="1h")
    ap.add_argument("--horizon", type=int, default=5)
    ap.add_argument("--models", default="all", choices=["all"])
    ap.add_argument("--candles", type=int, default=5000)
    ap.add_argument("--k", type=float, default=0.5, help="factor de ATR para el umbral")
    ap.add_argument("--min-move", type=float, default=0.15, dest="min_move_pct")
    ap.add_argument("--refresh", action="store_true", help="fuerza descarga de datos")
    args = ap.parse_args()

    print(f"[1/5] Descargando {args.candles} velas {args.symbol} {args.interval}…")
    closed = load_or_fetch(args.symbol, args.interval, args.candles, refresh=args.refresh)
    print(f"      {len(closed)} velas cerradas")
    if len(closed) < 1000:
        print("ERROR: se necesitan >= 1000 velas cerradas para entrenar con garantias.", file=sys.stderr)
        return 2

    print("[2/5] Construyendo features + labels…")
    rows, meta = build_dataset(closed)
    indices = meta["indices"]
    closes = [c["close"] for c in closed]
    X_list: list[list[float]] = []
    y_list: list[int] = []
    times: list[int] = []
    for row, i in zip(rows, indices):
        j = i + args.horizon
        if j >= len(closed):
            continue
        atr_pct = row[FEATURE_NAMES.index("atr_pct")]
        thr = max(args.min_move_pct, args.k * atr_pct) / 100.0
        future = closes[j]
        base = closes[i]
        if future > base * (1.0 + thr):
            y = 2
        elif future < base * (1.0 - thr):
            y = 0
        else:
            y = 1
        X_list.append(row)
        y_list.append(y)
        times.append(closed[i]["time"])
    X = np.asarray(X_list, dtype=float)
    y = np.asarray(y_list, dtype=int)
    n = len(X)
    if n < 800:
        print(f"ERROR: solo {n} filas utiles tras el warmup; hacen falta >= 800.", file=sys.stderr)
        return 2
    print(f"      {n} filas, clases {dict(zip(*[list(x) for x in np.unique(y, return_counts=True)]))}")

    # --- separacion temporal, sin barajar -----------------------------------
    test_n = max(300, int(n * 0.2))
    val_n = max(120, int(n * 0.15))
    pool_end = n - test_n - val_n
    if pool_end < 400:
        print("ERROR: pool de entrenamiento demasiado pequeno.", file=sys.stderr)
        return 2

    print("[3/5] Walk-forward (3 splits expandientes) para seleccion de modelo…")
    models = make_models()
    wf = walk_forward_scores(X, y, pool_end, 3, models)
    best_name = max((k for k in wf if k != BASELINE), key=lambda k: wf[k]["meanBalancedAccuracy"])
    baseline_wf = wf[BASELINE]["meanBalancedAccuracy"]
    print(f"      walk-forward balacc: " + ", ".join(f"{k}={v['meanBalancedAccuracy']}" for k, v in wf.items()))

    # --- ajuste final en pool+val, evaluacion en test -----------------------
    print("[4/5] Ajuste final + calibracion (sigmoid, cv=3) + evaluacion out-of-sample…")
    X_fit, y_fit = X[: n - test_n], y[: n - test_n]
    X_test, y_test = X[n - test_n :], y[n - test_n :]
    final_test = {}
    preds_test: dict[str, np.ndarray] = {BASELINE: momentum_predict(X_test)}
    final_test[BASELINE] = metrics_block(y_test, preds_test[BASELINE], None)

    from sklearn.calibration import CalibratedClassifierCV

    fitted: dict[str, object] = {}
    for name, model in models.items():
        model.fit(X_fit, y_fit)
        fitted[name] = model
        pred = model.predict(X_test)
        preds_test[name] = pred
        try:
            probs = model.predict_proba(X_test)
        except Exception:
            probs = one_hot_probs(pred)
        final_test[name] = metrics_block(y_test, pred, probs)

    base_lr = fitted[LR]
    # sklearn >= 1.4 exige pasar el estimador SIN ajustar: se clona el
    # pipeline (mismos hiperparametros) y CalibratedClassifierCV lo re-ajusta
    # con cv=3 sobre train+val para calibrar out-of-fold.
    from sklearn.base import clone

    calibrated = CalibratedClassifierCV(clone(base_lr), method="sigmoid", cv=3)
    calibrated.fit(X_fit, y_fit)
    cal_probs = calibrated.predict_proba(X_test)
    cal_pred = np.asarray([int(p) for p in cal_probs.argmax(axis=1)])
    final_test["logistic_calibrated"] = metrics_block(y_test, cal_pred, cal_probs)

    baseline_ba = final_test[BASELINE]["balancedAccuracy"]
    serving_ba = final_test["logistic_calibrated"]["balancedAccuracy"]
    # probabilidad media por clase en test (reliabilidad grosera)
    avg_conf = float(np.mean(cal_probs.max(axis=1)))
    validity = "valid" if serving_ba > baseline_ba and final_test["logistic_calibrated"]["n"] >= 300 else "not_ready"

    notes = []
    if best_name != LR:
        notes.append(
            f"El mejor modelo offline por walk-forward fue {best_name} "
            f"(balacc media {wf[best_name]['meanBalancedAccuracy']}). El servicio usa LR calibrada "
            "porque es el unico formato scorable en JavaScript sin dependencias; RF/HGB no son "
            f"exportables a un JSON ligero. Las metricas de {best_name} en el test final quedan en el informe."
        )
    notes.append(
        "Calibracion: Platt (sigmoid) con cv=3 sobre train+val; isotonic descrito en README por tameno de muestra."
    )
    if validity == "not_ready":
        notes.append(
            "ADVERTENCIA: el modelo de servicio NO supera al baseline momentum en el test "
            f"out-of-sample (balacc {serving_ba} vs {baseline_ba}). La plataforma debe mostrar "
            "'Prediccion no disponible'."
        )

    export_model.set_probe_rows([X_test[0].tolist(), X_test[len(X_test) // 2].tolist()])

    date_str = dt.date.today().isoformat()
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report = {
        "symbol": args.symbol.upper(),
        "interval": args.interval,
        "horizon": args.horizon,
        "threshold": {"k": args.k, "minMovePct": args.min_move_pct},
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "data": {
            "candlesClosed": len(closed),
            "usableRows": n,
            "windowFrom": times[0],
            "windowTo": times[-1],
        },
        "splits": {
            "method": "temporal, sin shuffle. pool (walk-forward expandiente x3) -> val (calibracion) -> test (20% final)",
            "poolRows": pool_end,
            "valRows": n - test_n - pool_end,
            "testRows": test_n,
        },
        "walkForward": wf,
        "finalTest": final_test,
        "selectedModel": best_name,
        "servingModel": "logistic_calibrated",
        "meanMaxProb": round(avg_conf, 4),
        "validityStatus": validity,
        "notes": notes,
    }
    report_json = REPORTS_DIR / f"{args.symbol.upper()}-{args.interval}-{date_str}.json"
    report_json.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    report_md = REPORTS_DIR / f"{args.symbol.upper()}-{args.interval}-{date_str}.md"
    report_md.write_text(render_markdown(report), encoding="utf-8")

    out_model = MODELS_DIR / f"model-{args.symbol.upper()}-{args.interval}-v1.json"
    export_model.export_calibrated_lr(
        calibrated,
        out_path=out_model,
        symbol=args.symbol,
        interval=args.interval,
        feature_names=FEATURE_NAMES,
        label_classes=CLASS_NAMES,
        trained_at_ms=int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000),
        horizon=args.horizon,
        threshold={"k": args.k, "minMovePct": args.min_move_pct},
        data_window={
            "candlesClosed": len(closed),
            "nSamples": n,
            "fromMs": times[0],
            "toMs": times[-1],
            "source": "binance",
        },
        metrics={
            "walkForward": wf,
            "finalTest": final_test,
            "selectedModel": best_name,
        },
        validity_status=validity,
        notes=notes,
    )

    print("[5/5] Resumen honesto:")
    print(f"  Reporte: {report_json}")
    print(f"  Modelo:  {out_model}")
    print(f"  Validez: {validity}")
    for name in [BASELINE, LR, RF, HGB, "logistic_calibrated"]:
        m = final_test[name]
        print(
            f"  TEST {name:<22} balacc={m['balancedAccuracy']:.4f} acc={m['accuracy']:.4f}"
        )
    if validity == "not_ready":
        print(
            "\n  *** EL MEJOR MODELO NO SUPERA AL BASELINE OUT-OF-SAMPLE. ***\n"
            "  No se debe confiar en la prediccion: la plataforma mostrara "
            "'Prediccion no disponible'."
        )
    return 0


def render_markdown(r: dict) -> str:
    lines = [
        f"# Reporte ML {r['symbol']} {r['interval']} — horizonte {r['horizon']} velas",
        "",
        f"- Generado: {r['generatedAt']}",
        f"- Velas cerradas usadas: {r['data']['candlesClosed']} · filas utiles: {r['data']['usableRows']}",
        f"- Ventana: {r['data']['windowFrom']} → {r['data']['windowTo']} (epoch ms)",
        f"- Umbrales: k={r['threshold']['k']} · min_move={r['threshold']['minMovePct']} %",
        f"- Division: {r['splits']['method']}",
        f"- Estado de validez: **{r['validityStatus']}**",
        "",
        "## Walk-forward (3 splits expandientes, dentro de pool)",
        "",
        "| modelo | folds | balacc media | acc media |",
        "|---|---|---|---|",
    ]
    for name, wf in r["walkForward"].items():
        lines.append(
            f"| {name} | {wf['folds']} | {wf['meanBalancedAccuracy']} | {wf['meanAccuracy']} |"
        )
    lines += [
        "",
        "## Test final (intocable durante el desarrollo)",
        "",
        "| modelo | n | balacc | accuracy | brier | logloss |",
        "|---|---|---|---|---|---|",
    ]
    for name, m in r["finalTest"].items():
        lines.append(
            f"| {name} | {m['n']} | {m['balancedAccuracy']} | {m['accuracy']} "
            f"| {m.get('brierScore', '—')} | {m.get('logLoss', '—')} |"
        )
    lines += ["", "### Metricas por clase (test)", ""]
    for name, m in r["finalTest"].items():
        lines.append(f"**{name}** — distribucion real: {m['classDistribution']}")
        lines.append("")
        lines.append("| clase | precision | recall | f1 |")
        lines.append("|---|---|---|---|")
        for cls, pm in m["perClass"].items():
            lines.append(f"| {cls} | {pm['precision']} | {pm['recall']} | {pm['f1']} |")
        lines.append("")
        lines.append(f"- Matriz de confusion (filas=real): {m['confusionMatrix']}")
        lines.append("")
    if r["validityStatus"] == "not_ready":
        lines += [
            "## ⚠ ADVERTENCIA",
            "",
            "El modelo de servicio NO supera al baseline momentum fuera de muestra.",
            "La plataforma debe mostrar 'Prediccion no disponible'.",
            "",
        ]
    lines += ["## Notas", ""]
    lines += [f"- {n}" for n in r["notes"]]
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
