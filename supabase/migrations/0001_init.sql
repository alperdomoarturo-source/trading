-- =============================================================================
-- 0001_init.sql — Esquema base de la plataforma de señales (Etapa 7)
-- =============================================================================
-- Objetivo: $0 (Supabase Free + Vercel Hobby). Todo es OPCIONAL: la app
-- funciona sin Supabase (localStorage + señales sin estado). Si no hay
-- credenciales, las rutas de persistencia responden { enabled: false }.
--
-- MODO PÚBLICO / DEMO SIN AUTENTICACIÓN (v1):
--   * La app NO usa Supabase Auth todavía. Las tablas con datos privados
--     (watchlists, user_settings, paper_*) exigen auth.uid() vía RLS, por lo
--     que un visitante anónimo no puede leerlas ni escribirlas.
--   * El historial de señales (signals / signal_outcomes) se publica en modo
--     demo: solo lectura para `anon`; la escritura ocurre exclusivamente desde
--     el servidor (rol service_role, que bypasea RLS pero NO bypasea los
--     triggers de inmutabilidad).
--   * profiles referencia a auth.users: en v1 queda vacía. Al activar auth,
--     se crea una fila profile por usuario (trigger de la plataforma o
--     servicio); las claves user_id ya apuntan a ella.
--
-- REGLA DURÁ ENCODADA AQUÍ Y EN EL CÓDIGO DEL SERVIDOR:
--   * signals son INMUTABLES tras el insert (no ediciones retroactivas).
--   * signal_outcomes se escribe SOLO cuando el horizonte venció por completo
--     (valid_until superado) y es append/update-once: una fila por señal.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles — perfil por usuario autenticado. En v1 (sin auth) está vacía;
-- el modo demo no la necesita. FK a auth.users activa cuando haya registro.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  display_name text
);
comment on table public.profiles is
  'Perfiles de usuario. v1 arranca SIN auth: la tabla está vacía y el modo demo es público. Al activar Supabase Auth, cada auth.users tiene su profile.';

-- ---------------------------------------------------------------------------
-- watchlists — listas de vigilancia por usuario (RLS: solo el dueño).
-- ---------------------------------------------------------------------------
create table if not exists public.watchlists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);
comment on table public.watchlists is
  'Listas de vigilancia privadas del usuario autenticado. Anónimo no puede leer ni escribir (RLS).';

create table if not exists public.watchlist_assets (
  id           bigserial primary key,
  watchlist_id uuid not null references public.watchlists (id) on delete cascade,
  symbol       text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  market       text not null check (market in ('crypto', 'stocks')),
  position     integer not null default 0 check (position >= 0),
  added_at     timestamptz not null default now(),
  unique (watchlist_id, symbol)
);

-- ---------------------------------------------------------------------------
-- user_settings — configuración del usuario (hoy vive en localStorage; esta
-- tabla permite sincronizarla cuando exista auth).
-- ---------------------------------------------------------------------------
create table if not exists public.user_settings (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  settings   jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- paper trading — TODO requiere auth (owner = auth.uid()); es imposible
-- escribir posiciones simuladas de forma anónima.
-- ---------------------------------------------------------------------------
create table if not exists public.paper_portfolios (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  base_currency   text not null default 'USDT' check (char_length(base_currency) <= 10),
  initial_capital numeric(20,8) not null check (initial_capital >= 0),
  created_at      timestamptz not null default now()
);

create table if not exists public.paper_positions (
  id              bigserial primary key,
  portfolio_id    uuid not null references public.paper_portfolios (id) on delete cascade,
  symbol          text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  market          text not null check (market in ('crypto', 'stocks')),
  direction       text not null check (direction in ('long', 'short')),
  quantity        numeric(20,8) not null check (quantity > 0),
  avg_entry_price numeric(20,8) not null check (avg_entry_price >= 0),
  status          text not null default 'open' check (status in ('open', 'closed')),
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz
);
comment on table public.paper_positions is
  'Posiciones abiertas/cerradas del portafolio simulado. Pertenencia solo vía portfolio_id -> paper_portfolios.user_id.';

-- Historial de ejecución_append-only_: cada operación ejecutada es un hecho
-- histórico (se audita en 0002 con un trigger que prohíbe UPDATE).
create table if not exists public.paper_trades (
  id           bigserial primary key,
  portfolio_id uuid not null references public.paper_portfolios (id) on delete cascade,
  symbol       text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  market       text not null check (market in ('crypto', 'stocks')),
  direction    text not null check (direction in ('long', 'short')),
  quantity     numeric(20,8) not null check (quantity > 0),
  price        numeric(20,8) not null check (price >= 0),
  fee          numeric(20,8) not null default 0 check (fee >= 0),
  pnl          numeric(20,8),
  executed_at  timestamptz not null default now(),
  note         text
);
comment on table public.paper_trades is
  'Libro de operaciones simuladas. Append-only: un UPDATE aquí falsearía la auditoría del paper trading.';

-- ---------------------------------------------------------------------------
-- backtests — en v1 el backtest es sin estado (lo calcula /api/backtest).
-- Estas tablas permiten guardar corridas cuando la app tenga auth.
-- ---------------------------------------------------------------------------
create table if not exists public.backtest_runs (
  id          bigserial primary key,
  user_id     uuid references public.profiles (id) on delete cascade,
  symbol      text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  market      text not null check (market in ('crypto', 'stocks')),
  interval    text not null check ("interval" ~ '^[0-9]+[mhdw]$'),
  params      jsonb not null check (jsonb_typeof(params) = 'object'),
  metrics     jsonb check (metrics is null or jsonb_typeof(metrics) = 'object'),
  status      text not null default 'done' check (status in ('queued', 'running', 'done', 'error')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists public.backtest_trades (
  id          bigserial primary key,
  run_id      bigint not null references public.backtest_runs (id) on delete cascade,
  idx         integer not null check (idx >= 0),
  direction   text not null check (direction in ('long', 'short')),
  entry_time  timestamptz not null,
  exit_time   timestamptz not null,
  entry_price numeric(20,8) not null check (entry_price >= 0),
  exit_price  numeric(20,8) not null check (exit_price >= 0),
  quantity    numeric(20,8) not null check (quantity > 0),
  gross_pnl   numeric(20,8),
  net_pnl     numeric(20,8),
  fee         numeric(20,8) not null default 0 check (fee >= 0),
  exit_reason text,
  unique (run_id, idx)
);

-- ---------------------------------------------------------------------------
-- modelos — transparencia: qué versión del motor/ML generó cada señal.
-- ---------------------------------------------------------------------------
create table if not exists public.model_versions (
  id        bigserial primary key,
  name      text not null check (char_length(name) between 1 and 80),
  version   text not null check (char_length(version) between 1 and 40),
  family    text,
  trained_at timestamptz,
  metrics   jsonb check (metrics is null or jsonb_typeof(metrics) = 'object'),
  params    jsonb check (params is null or jsonb_typeof(params) = 'object'),
  is_active boolean not null default false,
  unique (name, version)
);
comment on table public.model_versions is
  'Catálogo público de versiones de modelo. Escritura solo por service_role (pipeline de entrenamiento controlado).';

create table if not exists public.model_evaluations (
  id               bigserial primary key,
  model_version_id bigint not null references public.model_versions (id) on delete cascade,
  run_id           bigint references public.backtest_runs (id) on delete set null,
  evaluated_at     timestamptz not null default now(),
  window_start     timestamptz,
  window_end       timestamptz,
  sample_count     integer check (sample_count is null or sample_count >= 0),
  metrics          jsonb not null check (jsonb_typeof(metrics) = 'object'),
  notes            text,
  check (window_start is null or window_end is null or window_end > window_start)
);

-- ---------------------------------------------------------------------------
-- signals — historial inmutable de señales emitidas por el motor.
--
-- Deduplicación correcta con user_id nullable: un índice UNIQUE normal sobre
-- (symbol, interval, candle_time, user_id) NO deduplica filas anónimas
-- (NULL != NULL en Postgres). Solución: columna generada ALMACENADA
-- dedup_user = coalesce(user_id, UUID nil) + UNIQUE (symbol, interval,
-- candle_time, dedup_user). Es un constraint de columna normal, así que
-- PostgREST puede usarla como objetivo de `upsert(onConflict)` desde el
-- servidor. Alternativa descartada: dos índices parciales (no son
-- compatibles con el on_conflict de PostgREST).
-- ---------------------------------------------------------------------------
create table if not exists public.signals (
  id              bigserial primary key,
  symbol          text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  market          text not null check (market in ('crypto', 'stocks')),
  "interval"      text not null check ("interval" ~ '^[0-9]+[mhdw]$'),
  candle_time     timestamptz not null,
  price_ref       numeric(20,8) not null check (price_ref >= 0),
  kind            text not null check (kind in ('BUY', 'SELL', 'WAIT', 'NONE', 'INSUFFICIENT_DATA', 'DATA_ERROR')),
  direction       text check (direction is null or direction in ('long', 'short')),
  score           integer not null check (score between 0 and 100),
  bull_score      integer not null default 0 check (bull_score >= 0),
  bear_score      integer not null default 0 check (bear_score >= 0),
  reasons         jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  indicators      jsonb check (indicators is null or jsonb_typeof(indicators) = 'object'),
  levels          jsonb check (levels is null or jsonb_typeof(levels) = 'object'),
  patterns        jsonb check (patterns is null or jsonb_typeof(patterns) = 'array'),
  freshness       text not null default 'unknown' check (freshness in ('fresh', 'stale', 'unknown')),
  model_version   text,
  generated_at    timestamptz not null default now(),
  -- Horizonte necesario para resolver resultados (señal cuya valid_until venció).
  horizon_candles integer not null default 5 check (horizon_candles between 1 and 200),
  valid_until     timestamptz not null,
  user_id         uuid references public.profiles (id) on delete cascade,
  dedup_user      uuid generated always as (
                    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid)
                  ) stored,
  constraint signals_valid_window_ok check (valid_until > candle_time)
);
comment on table public.signals is
  'Historial inmutable de señales generadas por el servidor. Un INSERT por (symbol, interval, candle_time, dedup_user). Prohibido UPDATE (trigger en 0002).';

create unique index if not exists signals_dedup_uniq
  on public.signals (symbol, "interval", candle_time, dedup_user);

-- ---------------------------------------------------------------------------
-- signal_outcomes — resultado REAL tras el horizonte. Regla dura:
--   * se escribe SOLO cuando now >= valid_until (horizonte vencido por
--     completo); nunca antes (eso sería adivinar).
--   * UN fila por señal (signal_id UNIQUE): apilable/actualizable una sola
--     vez; tras resolverse, no se re-toca (trigger en 0002 prohíbe UPDATE).
--   * correct: afirmación verificable solo para BUY/SELL (true si el precio
--     se movió a favor más allá del umbral de ruido k*ATR); NULL para
--     WAIT/NONE/etc. porque el motor no afirmó dirección (no se puntúa el
--     silencio para inflar estadísticas).
-- ---------------------------------------------------------------------------
create table if not exists public.signal_outcomes (
  id          bigserial primary key,
  signal_id   bigint not null unique references public.signals (id) on delete cascade,
  resolved_at timestamptz not null default now(),
  outcome     text not null check (outcome in ('up', 'down', 'neutral', 'expired')),
  return_pct  numeric(12,6),
  correct     boolean
);
comment on table public.signal_outcomes is
  'Resultado observado tras vencer el horizonte de cada señal. Append/update-once; nunca se recalcula un outcome ya resuelto.';

-- ---------------------------------------------------------------------------
-- market_data_metadata — estado de la ingesta por símbolo+temporalidad
-- (último cierre procesado, frescura, avisos). Público en modo demo.
-- ---------------------------------------------------------------------------
create table if not exists public.market_data_metadata (
  id                     bigserial primary key,
  symbol                 text not null check (symbol ~ '^[A-Z0-9._-]{1,20}$'),
  market                 text not null check (market in ('crypto', 'stocks')),
  "interval"             text not null check ("interval" ~ '^[0-9]+[mhdw]$'),
  provider               text not null,
  last_fetch             timestamptz not null default now(),
  last_closed_candle_time timestamptz,
  freshness              text not null default 'unknown' check (freshness in ('fresh', 'stale', 'unknown')),
  warnings               jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  unique (symbol, "interval")
);

-- ---------------------------------------------------------------------------
-- error_logs — diagnóstico del servidor. Sin políticas de lectura para nada
-- interno (solo service_role); nunca exponer al navegador.
-- ---------------------------------------------------------------------------
create table if not exists public.error_logs (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  route      text not null,
  method     text,
  status     integer,
  message    text not null,
  stack      text,
  context    jsonb check (context is null or jsonb_typeof(context) = 'object'),
  user_id    uuid references public.profiles (id) on delete set null
);
