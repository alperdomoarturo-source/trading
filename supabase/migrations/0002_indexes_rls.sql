-- =============================================================================
-- 0002_indexes_rls.sql — Índices de consultas frecuentes, triggers de
-- inmutabilidad y Row Level Security (políticas comentadas en español).
-- =============================================================================
-- Postura de RLS en v1 (SIN auth, modo público/demo):
--   * Habilitado en TODAS las tablas. Sin política = sin acceso.
--   * `service_role` bypasea RLS (así escribe el servidor de la app), pero NO
--     bypasea los triggers: la inmutabilidad se aplica también al servidor.
--   * Un visitante anónimo NUNCA puede escribir señales ni modelos: no hay
--     políticas INSERT/UPDATE/DELETE para `anon` en esas tablas.
--   * tablas privadas (watchlists, user_settings, paper_*) solo existen para
--     usuarios autenticados; `anon` no tiene ninguna política, por lo que
--     escribir o leer ahí es imposible hoy y quedará acotado al dueño cuando
--     exista auth.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Índices para las consultas frecuentes
-- ---------------------------------------------------------------------------

-- Historial: últimas señales por símbolo+temporalidad (filtro típico del log).
create index if not exists signals_symbol_interval_candle_idx
  on public.signals (symbol, "interval", candle_time desc);

-- Listados generales ordenados por fecha de generación (desc).
create index if not exists signals_generated_at_idx
  on public.signals (generated_at desc);

-- Resolución de resultados: señales cuyo horizonte venció y aún no tienen
-- outcome. El join con signal_outcomes usa su UNIQUE (signal_id) como índice.
create index if not exists signals_valid_until_idx
  on public.signals (valid_until);

-- Filtro por estado visible (BUY/SELL destacan sobre el resto de señales).
create index if not exists signals_kind_idx
  on public.signals (kind);

create index if not exists watchlists_user_idx
  on public.watchlists (user_id);

create index if not exists watchlist_assets_watchlist_idx
  on public.watchlist_assets (watchlist_id);

create index if not exists paper_positions_portfolio_idx
  on public.paper_positions (portfolio_id, status);

create index if not exists paper_trades_portfolio_time_idx
  on public.paper_trades (portfolio_id, executed_at desc);

create index if not exists backtest_runs_user_idx
  on public.backtest_runs (user_id, started_at desc);

create index if not exists model_evaluations_version_idx
  on public.model_evaluations (model_version_id, evaluated_at desc);

create index if not exists error_logs_created_idx
  on public.error_logs (created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Inmutabilidad (REGLA DURA, también para service_role)
-- ---------------------------------------------------------------------------
-- Prohibimos UPDATE (reescribir el pasado falsearía cualquier estadística).
-- DELETE se deja técnicamente posible SOLO para limpieza de retención/borrado
-- de cuenta ejecutada por service_role (p. ej. cascade de profiles); el
-- repositorio Jamás expone delete (ver tests/persistence.test.ts).
create or replace function public.forbid_signals_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Las señales son inmutables: prohibido UPDATE (Historial no reescribible)'
    using hint = 'Registra una nueva señal; los resultados van en signal_outcomes.';
end;
$$;

create trigger signals_immutable
  before update on public.signals
  for each row execute function public.forbid_signals_mutation();

-- signal_outcomes: append/update-once. Una vez resuelto el horizonte, el
-- resultado es un hecho histórico; re-resolverlo abriría la puerta a
-- "mejorar" retroactivamente la tasa de aciertos.
create or replace function public.forbid_outcome_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Los outcomes son append-only: prohibido UPDATE (se escribe una sola vez tras vencer el horizonte)'
    using hint = 'El repositorio usa upsert(on conflict do nothing); jamás actualiza un outcome existente.';
end;
$$;

create trigger signal_outcomes_immutable
  before update on public.signal_outcomes
  for each row execute function public.forbid_outcome_mutation();

-- paper_trades: libro de operaciones auditable (sin UPDATE; DELETE solo por
-- limpieza de retención vía service_role).
create trigger paper_trades_immutable
  before update on public.paper_trades
  for each row execute function public.forbid_signals_mutation();

-- ---------------------------------------------------------------------------
-- 3) Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.watchlists          enable row level security;
alter table public.watchlist_assets    enable row level security;
alter table public.user_settings       enable row level security;
alter table public.paper_portfolios    enable row level security;
alter table public.paper_positions     enable row level security;
alter table public.paper_trades        enable row level security;
alter table public.backtest_runs       enable row level security;
alter table public.backtest_trades     enable row level security;
alter table public.model_versions      enable row level security;
alter table public.model_evaluations   enable row level security;
alter table public.signals             enable row level security;
alter table public.signal_outcomes     enable row level security;
alter table public.market_data_metadata enable row level security;
alter table public.error_logs          enable row level security;

-- --- profiles: lectura pública en modo demo; escritura solo del dueño ------
-- Política: cualquiera (anon incluido) puede ver seudónimos/perfiles; nadie
-- más que el propio usuario autenticado puede crear o editar el suyo.
create policy profiles_read on public.profiles
  for select to anon, authenticated using (true);

create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (auth.uid() = id);

create policy profiles_update_self on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- --- watchlists: 100% privadas del dueño ------------------------------------
-- Política: solo el usuario autenticado dueño (user_id = auth.uid()) lee y
-- escribe. `anon` sin políticas => imposible leer o escribir watchlists.
create policy watchlists_owner_all on public.watchlists
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --- watchlist_assets: pertenencia heredada de la watchlist -----------------
create policy watchlist_assets_owner_all on public.watchlist_assets
  for all to authenticated
  using (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_assets.watchlist_id and w.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.watchlists w
      where w.id = watchlist_assets.watchlist_id and w.user_id = auth.uid()
    )
  );

-- --- user_settings: solo el dueño -------------------------------------------
create policy user_settings_owner_all on public.user_settings
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- --- paper_*: requieren auth (owner = auth.uid()); anónimo no puede escribir -
create policy paper_portfolios_owner_all on public.paper_portfolios
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy paper_positions_owner_all on public.paper_positions
  for all to authenticated
  using (
    exists (
      select 1 from public.paper_portfolios p
      where p.id = paper_positions.portfolio_id and p.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.paper_portfolios p
      where p.id = paper_positions.portfolio_id and p.user_id = auth.uid()
    )
  );

create policy paper_trades_owner_select on public.paper_trades
  for select to authenticated
  using (
    exists (
      select 1 from public.paper_portfolios p
      where p.id = paper_trades.portfolio_id and p.user_id = auth.uid()
    )
  );

-- Política de escritura: solo insertar operaciones nuevas (append-only);
-- UPDATE/DELETE no tienen política => prohibidos incluso al dueño vía API.
create policy paper_trades_owner_insert on public.paper_trades
  for insert to authenticated
  with check (
    exists (
      select 1 from public.paper_portfolios p
      where p.id = paper_trades.portfolio_id and p.user_id = auth.uid()
    )
  );

-- --- backtest_runs: lectura pública (transparencia demo); escritura dueño ---
create policy backtest_runs_read on public.backtest_runs
  for select to anon, authenticated using (true);

create policy backtest_runs_owner_insert on public.backtest_runs
  for insert to authenticated with check (user_id = auth.uid());

create policy backtest_runs_owner_update on public.backtest_runs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy backtest_trades_read on public.backtest_trades
  for select to anon, authenticated using (true);

-- --- model_versions / model_evaluations: catálogo público, solo lectura -----
-- Política: `anon` y usuarios pueden LEER qué modelos existen y su evaluación
-- (transparencia); NO existe política de escritura: registrar modelos es
-- exclusivo del servidor (service_role) en un pipeline controlado.
create policy model_versions_read on public.model_versions
  for select to anon, authenticated using (true);

create policy model_evaluations_read on public.model_evaluations
  for select to anon, authenticated using (true);

-- --- signals / signal_outcomes: el historial demo es de solo lectura --------
-- Política: cualquiera puede LEER el historial (modo público/demo). La
-- escritura (registrar señales, resolver outcomes) ocurre SOLO desde el
-- servidor con service_role: no hay políticas INSERT/UPDATE/DELETE para
-- anon/authenticated. Un cliente del navegador no puede fabricar señales.
create policy signals_read on public.signals
  for select to anon, authenticated using (true);

create policy signal_outcomes_read on public.signal_outcomes
  for select to anon, authenticated using (true);

-- --- market_data_metadata: estado de ingesta, solo lectura pública ----------
create policy market_data_metadata_read on public.market_data_metadata
  for select to anon, authenticated using (true);

-- --- error_logs: SIN ninguna política -> inaccesible para anon/authenticated;
-- solo service_role (servidor) escribe y lee. Nunca exponer al navegador.
