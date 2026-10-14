# ml/ — Motor de entrenamiento ML (Etapa 4)

Paquete de **entrenamiento offline**. Se ejecuta en el PC del usuario;
**Vercel Hobby no entrena**: la función serverless solo sirve inferencia
cargando el JSON ligero de `data/models/` (sin scikit-learn, sin Python).

## Requisitos (Python 3.14 verificado en Windows)

```powershell
cd ml
py -3.14 -m venv .venv          # ya creado en esta máquina
.venv\Scripts\activate
pip install -r requirements.txt
```

Notas del entorno (resolvidas en esta máquina, ver `requirements.txt`):

- scikit-learn 1.9.1 funciona en Python 3.14.
- La build 1.18.x de scipy trae DLLs sin firmar que **Windows Smart App
  Control bloquea** (`ImportError: una directiva de Control de aplicaciones
  bloqueó este archivo`). Se fija `scipy==1.17.*`, que importa correctamente.
- **pandas no se usa a propósito**: las características se calculan en
  Python puro replicando exactamente las fórmulas de
  `src/lib/analysis/indicators.ts` (semillas SMA de EMA/Wilder, desviación
  poblacional de Bollinger, etc.), que `pandas.ewm` no reproduce. La paridad
  Python↔TS está verificada por tests (`tests/ml.test.ts` + verificación
  cruzada de la misma fila de características a 1e-9).

## Entrenar y exportar

```powershell
python ml/train.py --symbol BTCUSDT --interval 1h --horizon 5 --models all
```

Opciones: `--candles 5000` (velas cerradas a descargar), `--k 0.5`,
`--min-move 0.15`, `--refresh` (ignora la caché de `ml/data/`).

Genera:

- `ml/reports/<SYMBOL>-<interval>-<fecha>.json` y `.md` — métricas completas.
- `data/models/model-<SYMBOL>-<interval>-v1.json` — modelo servible por JS.

## Metodología

### Características (`ml/features.py`)

26 características por vela **cerrada**, usando solo información con índice
≤ i (sin lookahead, misma convención que los indicadores TS). Todas las
definiciones están documentadas en la cabecera de `ml/features.py`;
`src/lib/ml/features.ts` construye el vector idéntico reutilizando
`computeIndicators` y `detectPatternsAt`. El orden es contractual
(`FEATURE_NAMES` en Python ↔ `ML_FEATURE_NAMES` en TS).

### Etiquetas (`ml/labels.py`)

3 clases sobre el horizonte `h` (por defecto 5 velas):

```
thr_pct = max(min_move_pct, k · ATR%[i])        (k=0.5, min_move=0.15 %)
UP      si close[i+h] > close[i] · (1 + thr_pct/100)
DOWN    si close[i+h] < close[i] · (1 − thr_pct/100)
NEUTRAL en otro caso
```

El umbral escala con la volatilidad local: movimientos mínimos se convierten
en NEUTRAL en vez de inflar las clases direccionales. El umbral se fija con
el ATR de la vela `i` (pasado), nunca con el futuro.

### Validación (walk-forward, sin barajar)

División temporal estricta: `pool → val → test` (test = últimos ~20 %,
intocable). Dentro del pool, **3 splits expandientes**: se entrena con un
prefijo y se evalúa en el siguiente segmento; así se simula el despliegue
real. La selección de modelo se hace por precisión balanceada media en los
folds.

### Modelos comparados

| # | modelo | JS-scorable |
|---|---|---|
| 0 | baseline momentum (signo del retorno de 1 vela) | sí |
| 1 | LogisticRegression multinomial pipeline estandarizado | sí |
| 2 | RandomForestClassifier | no |
| 3 | HistGradientBoostingClassifier | no |

### Calibración

`CalibratedClassifierCV(método sigmoid/Platt, cv=3)` sobre train+val. Con
~4–5 mil filas y 3 clases, isotonic sobreajusta y además no es exportable a
un scorer JS compacto; Platt añade solo (A, B) por clase. sklearn implementa
el multiclase sigmoid como one-vs-rest, así que el scorer exportado es:
LR binaria OvR por clase (scaler plegado en los coeficientes) → Platt
`sigmoid(A·p + B)` → normalizar. `ml/export_model.py` **verifica
numéricamente** que la fórmula exportada reproduce `predict_proba` de
sklearn (tol 1e-6) antes de escribir el JSON.

### Criterio de validez honesto

`validity_status = "valid"` **solo si** el modelo de servicio (LR calibrada)
supera al baseline momentum en el test final. Si no, se exporta
`"not_ready"` y la plataforma muestra **“Predicción no disponible”** —
nunca se publican probabilidades de un modelo que no beats la nada.

### Modelo de servicio cuando gana un modelo de árboles

El servicio usa **siempre** la LR calibrada (única exportable a JSON sin
dependencias en el cliente/servidor). Si RF/HGB gana offline, sus métricas
figuran en el informe y en `metadata.notes` queda constancia explícita de
qué modelo ganó y de que se sirve LR por portabilidad.

## Estructura

```
ml/
  data.py          # descarga/paginación Binance + caché ml/data/
  features.py      # spec canónica de características (espejo de TS)
  labels.py        # etiquetado 3 clases dependiente de ATR
  train.py         # CLI: walk-forward, métricas, informe, exportación
  export_model.py  # scorer JSON servible en JS + verificación numérica
  reports/         # informes .json/.md por ejecución
  data/            # caché de velas crudas (JSON)
```
