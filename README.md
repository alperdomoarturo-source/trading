# Plataforma de señales de trading con IA (simulación)

Plataforma web de análisis y señales de trading con datos reales de mercado, patrones
de velas japonesas, indicadores técnicos, predicción probabilística con machine
learning, backtesting y paper trading. **Solo análisis y simulación: no ejecuta
operaciones reales ni se conecta a corretajes.**

Presupuesto de infraestructura: **0 COP/mes** (Vercel Hobby + Supabase Free + APIs
públicas de datos).

## Stack

| Pieza | Tecnología | Notas |
|---|---|---|
| Web | Next.js 16 (App Router) + TypeScript estricto + Tailwind 4 | Tema oscuro tipo terminal |
| Gráficos | TradingView Lightweight Charts v5 | Licencia Apache 2.0 (ver atribución en el gráfico) |
| Datos cripto | API pública de Binance (REST) | Sin clave; límites gestionados con caché y reintentos |
| Datos acciones EE. UU. | Stooq (CSV gratuito) | **Datos retrasados EOD**, solo 1d/1w; límites por IP |
| Base de datos | Supabase PostgreSQL + RLS (opcional) | La app funciona al 100 % sin configurarlo |
| Indicadores/patrones | Implementación propia en TS (`src/lib/analysis/`) | Validada con pruebas unitarias; sin dependencias nativas |
| ML | Python + scikit-learn (entrenamiento **local**, `ml/`) | Inferencia ligera en JS servida por Vercel |
| Pruebas | Vitest | `npm test` |

## Estructura

```
src/app/            UI (dashboard, explorer, análisis, señales, backtest, paper, ajustes) + rutas /api/*
src/lib/market/     Capa de proveedores (Binance, Stooq), normalización, caché, frescura
src/lib/analysis/   Indicadores, patrones de velas, soportes/resistencias
src/lib/signals/    Motor de señales por confluencia de reglas explicables
src/lib/ml/         Inferencia JS del modelo ML (features + scorer)
src/lib/backtest/   Motor de backtesting cronológico sin look-ahead
src/lib/db/         Persistencia opcional en Supabase (señales, resultados)
ml/                 Entrenamiento offline en Python (features, labels, walk-forward, export)
supabase/migrations/ Esquema SQL versionado con RLS e índices
data/models/        Modelos entrenados exportados a JSON (los sirve la app)
tests/              Pruebas unitarias (indicadores, patrones, señales, backtest, ML, persistencia)
```

## Puesta en marcha

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 109+ pruebas, sin red
npx tsc --noEmit
npm run build
```

No se necesita ninguna credencial para usar la plataforma en modo local/análisis:
los datos vienen de Binance/Stooq públicos y ajustes/cartera paper se guardan en
localStorage.

## Motor ML (Etapa 4) — entrenamiento local obligatorio

Vercel Hobby **no puede entrenar** (funciones serverless sin procesos permanentes ni
Python pesado). El entrenamiento se ejecuta en tu PC y la app solo hace inferencia:

```powershell
# 1. Entorno (primera vez)
cd ml
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt

# 2. Entrenar (descarga velas reales, walk-forward, calibración, export)
.venv\Scripts\python.exe train.py --symbol BTCUSDT --interval 1h --horizon 5
```

Resultados: informes honestos en `ml/reports/` y el modelo calibrado en
`data/models/model-<symbol>-<interval>-v*.json`. Si el modelo no supera a la
referencia fuera de muestra, se marca `validity_status: not_ready` y la interfaz
muestra **«Predicción no disponible»** — nunca se inventan probabilidades.

## Supabase (opcional, habilita historial y multi-dispositivo)

1. Crear proyecto gratuito en https://supabase.com.
2. Ejecutar `supabase/migrations/*.sql` (CLI `db push` o SQL editor). Ver `supabase/README.md`.
3. Variables de entorno (solo servidor): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`;
   públicas: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Copia
   `.env.example` → `.env.local`. **Nunca** expongas la `service_role` al navegador.

Habilita: registro de señales con resultados posteriores (`/signals` → historial),
siempre con degradación elegante si no está configurado.

## Límites reales del plan gratuito (léelos)

- **Vercel Hobby**: funciones con timeout ~60 s; sin cron ilimitado; sin procesos
  permanentes. Las «resoluciones» de resultados de señales se hacen de forma
  oportunista al consultar el historial, no en segundo plano continuo.
- **Supabase Free**: proyecto pausable tras inactividad, límites de filas/banda ancha.
- **Binance API pública**: ventanas de velas limitadas (1000/consulta, paginado),
  rate limits por IP; geo-bloqueos posibles → la UI muestra el error y sigue con lo demás.
- **Stooq**: cotizaciones **retrasadas de cierre (EOD)**, sin intradía fiable, límite
  diario de peticiones por IP. Nunca se muestran como tiempo real.
- **Notificaciones de navegador**: solo llegan con la pestaña abierta y permiso concedido.
- **Curva de capital paper**: se muestrea cada ~30 s mientras la página está abierta
  (localStorage); la historia continua dependería de Supabase.

## Reglas anti-engaño del sistema

- Señales confirmadas solo con **velas cerradas**; la vela en formación se marca provisional.
- Sin datos futuros en features ni etiquetas (probado en `tests/ml.test.ts`, `tests/backtest.test.ts`).
- Datos rancios bloquean señales; frescura visible en cada panel.
- Nada de porcentajes fabricados: sin modelo entrenado → «Predicción no disponible».
- Backtests y métricas separan entrenamiento/validación/prueba; un resultado positivo
  no se presenta como garantía de rentabilidad futura.

## Mantenimiento

- Reentrenar modelos periódicamente (los informes guardan métricas por periodo).
- `npm test` antes de cada despliegue; `npm run build` para verificar producción.
- Nuevos activos: `src/lib/market/symbols.ts` (cripto) o `src/lib/market/stocks/symbols.ts`.
- Proveedores intercambiables: implementa `MarketProvider` y regístralo en `src/lib/market/index.ts`.

> **Aviso**: herramienta de análisis educativo. Nada de esto es consejo de inversión;
> el rendimiento pasado (o simulado) no garantiza resultados futuros.
