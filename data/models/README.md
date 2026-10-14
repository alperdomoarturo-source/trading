# data/models/ — Modelos ML servibles por la app

Contiene los JSON ligeros exportados por el entrenamiento **offline**
(`ml/export_model.py`). La app Next (también en Vercel Hobby) **solo sirve
inferencia** con estos archivos: no entrena ni necesita Python/scikit-learn.

## Regenerar un modelo (PC del usuario, Windows)

```powershell
cd trading
ml\.venv\Scripts\activate        # cmd; PowerShell: ml\.venv\Scripts\Activate.ps1
python ml/train.py --symbol BTCUSDT --interval 1h --horizon 5 --models all
```

El comando vuelve a escribir `model-<SYMBOL>-<interval>-v1.json` aquí y un
informe en `ml/reports/`. Requiere salida a Internet a
`https://api.binance.com` (API pública, sin clave).

## Contrato del archivo

- `schema: "ml-model-v2"` — lo consume `src/lib/ml/inference.ts`.
- `scorer.type: "platt-decision-ensemble"` — LR multiclase con calibración de
  Platt por clase aplicada sobre la `decision_function` (logitos), normalizada
  por pliegue y promediada entre los pliegues de la validación cruzada de
  `CalibratedClassifierCV` (cv=3); reproduce exactamente `predict_proba` de
  sklearn (verificado numéricamente al exportar, tolerancia 1e-6).
- `validityStatus`: `"valid"` solo si el modelo superó al baseline
  out-of-sample. Con `"not_ready"` la API responde
  `available: false` y la UI muestra **“Predicción no disponible”**.
- `minCandles`: velas cerradas necesarias para puntuar (350).

Nunca edite estos JSON a mano: si cambian las características o las
etiquetas, hay que reentrenar y reexportar.
