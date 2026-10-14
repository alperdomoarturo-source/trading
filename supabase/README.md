# Supabase (Etapa 7) — persistencia OPCIONAL de señales

**La app funciona al 100 % sin Supabase.** Configurarlo solo desbloquea el
historial persistido de señales y sus resultados (`/signals` → "Historial de
señales (persistido)"). Objetivo $0: Vercel Hobby + Supabase Free.

## 1. Crear el proyecto gratuito

1. Entra en <https://supabase.com> y crea un proyecto con el plan **Free**
   (región más cercana; elige una contraseña fuerte para la base de datos).
2. En **Project Settings → API** copia: `Project URL`, `anon public` y
   `service_role` (esta última SOLO para el servidor).

## 2. Aplicar las migraciones

Opción A — CLI de Supabase (recomendada):

```bash
npm i -g supabase          # o usa npx/npm install -D supabase
supabase login
supabase link --project-ref TU_PROJECT_REF
supabase db push           # aplica supabase/migrations/0001 y 0002 en orden
```

Opción B — SQL Editor del dashboard: pega `0001_init.sql`, ejecuta; luego
`0002_indexes_rls.sql`, ejecuta. El orden importa (0002 depende de las tablas
de 0001).

## 3. Variables de entorno

Copie el bloque de `.env.example` (sección Supabase) a `.env.local` en local y
al **Environment Variables** del proyecto en Vercel:

| Variable | Dónde | Para qué |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | navegador y servidor | lectura pública del historial vía RLS |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | navegador y servidor | idem; NO puede escribir señales (sin políticas para `anon`) |
| `SUPABASE_URL` | SOLO servidor | ruta admin de escritura |
| `SUPABASE_SERVICE_ROLE_KEY` | SOLO servidor | bypasea RLS para registrar señales y escribir outcomes |

⚠️ `SUPABASE_SERVICE_ROLE_KEY` sin el valor correcto hace que las rutas de
escritura fallen limpiamente (`503 { enabled: false }`); jamás la expongas con
prefijo `NEXT_PUBLIC_` ni la uses en un Client Component (el módulo
`src/lib/db/client.ts` lanza un error en runtime si se ejecuta en el
navegador).

## 4. Qué se desbloquea

- `POST /api/signals/record`: re-evalúa la vigilancia con el motor oficial y
  guarda las señales (nunca acepta señales del cliente).
- `GET /api/signals/log`: historial con filtros (mercado, símbolo,
  temporalidad, estado) y outcomes joined.
- `POST /api/signals/resolve`: escribe los resultados de señales cuyo horizonte
  venció.
- Secciones y tablas preparadas (esquema completo según §14) para auth,
  watchlists compartidas, settings sincronizados, paper trading, backtests
  guardados, catálogo de modelos y metadata de ingesta — RLS ya las protege
  aunque hoy no tengan UI.

## 5. Límites del plan gratuito (honestidad, no promesas falsas)

- **Base de datos:** 500 MB de almacenamiento total y ~2 GB de egreso de datos
  al mes. El historial de señales crece lento (una fila por vela cerrada por
  símbolo), pero no es ilimitado: revisa el tamaño periódicamente.
- **No hay jobs en segundo plano garantizados:** Vercel Hobby permite como
  mucho 4 cron jobs con frecuencia diaria y las Functions tienen timeout;
  Supabase Free no expone cron ilimitado para esta app. Por eso los outcomes
  se resuelven **a demanda** (al abrir el historial o pulsando el botón), no
  de forma continua. Es un diseño deliberado: si nadie abre la app, los
  resultados se resuelven a su próxima visita. Nunca se escribe un resultado
  antes de que el horizonte venza.
- **Proyecto pausado:** Supabase pausa proyectos Free sin actividad tras ~1
  semana; el proyecto se reanuda al retomar la actividad, pero no lo asumas
  siempre caliente.
- **Auth:** v1 arranca SIN autenticación (modo público/demo descrito en las
  migraciones); las tablas privadas quedan inaccesibles hasta que implementes
  Supabase Auth.
- **Rate limits:** el limitador de `/record` y `/resolve` es en memoria por
  instancia (defensa barata, no global).

## 6. Verificación rápida (sin UI)

Tras configurar y ejecutar `next dev` localmente:

1. `POST http://localhost:3000/api/signals/record` con body `{"interval":"1h"}`
   → `{"enabled":true,"recorded":N,"duplicates":M,...}`.
2. Repite el mismo POST en la misma hora → casi todo `duplicates` (upsert
   idempotente).
3. En la tabla `signals` de Supabase verás una fila por vela/intervalo;
   `signal_outcomes` solo tendrá filas tras vencer `valid_until`.
4. Intenta `UPDATE signals ...` → la base la rechaza (trigger de inmutabilidad).

**Estado de verificación:** estas rutas están probadas con mocks (sin red) en
`tests/persistence.test.ts`; el extremo a extremo real contra Supabase queda
pendiente hasta que el usuario aporte credenciales propias.
