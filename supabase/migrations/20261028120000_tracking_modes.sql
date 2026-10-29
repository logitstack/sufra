-- =============================================================================
-- PANTRY TRACKING MODES
--
-- measured: the pantry holds an amount and "I cooked this" deducts from it.
-- status:   the pantry only records have / low / out. Cooking never deducts.
--
-- The effective mode for an ingredient is, first match wins:
--   1. the user's own choice (user_ingredient_modes)
--   2. a per-ingredient override (ingredients.tracking_mode)
--   3. the category default (ingredient_category_modes)
-- so new spices and sauces start as status tracked without anyone setting it.
--
-- Run after 20261026130000_receipts_and_staples.sql. Safe to re-run.
-- =============================================================================

create table if not exists ingredient_category_modes (
  category        ingredient_category primary key,
  tracking_mode   text not null check (tracking_mode in ('measured', 'status'))
);

alter table ingredient_category_modes enable row level security;

drop policy if exists "category modes: readable" on ingredient_category_modes;
create policy "category modes: readable"
  on ingredient_category_modes for select
  to authenticated
  using (true);

insert into ingredient_category_modes (category, tracking_mode) values
  ('spice',     'status'),
  ('condiment', 'status'),
  ('produce',   'measured'),
  ('dairy',     'measured'),
  ('grain',     'measured'),
  ('protein',   'measured'),
  ('pantry',    'measured'),
  ('other',     'measured')
on conflict (category) do nothing;

-- Null means "use the category default".
alter table ingredients add column if not exists tracking_mode text;

do $$ begin
  alter table ingredients add constraint ingredients_tracking_mode_check check (tracking_mode in ('measured', 'status'));
exception when duplicate_object then null; end $$;

-- Staples outside the spice and condiment categories that are tracked by status.
update ingredients set tracking_mode = 'status'
where tracking_mode is null
  and lower(canonical_name) in (
    'salt', 'kosher salt', 'olive oil', 'vegetable oil', 'canola oil', 'sesame oil', 'ghee',
    'milk', 'eggs', 'tomato sauce'
  );

create table if not exists user_ingredient_modes (
  user_id         uuid not null references auth.users(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id) on delete cascade,
  tracking_mode   text not null check (tracking_mode in ('measured', 'status')),
  updated_at      timestamptz not null default now(),
  primary key (user_id, ingredient_id)
);

alter table user_ingredient_modes enable row level security;

drop policy if exists "ingredient modes: owner only" on user_ingredient_modes;
create policy "ingredient modes: owner only"
  on user_ingredient_modes for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- PANTRY.STATUS for status-tracked rows. Null on a status-tracked row means it
-- predates this migration: an amount above zero reads as 'have', else 'out'.
-- -----------------------------------------------------------------------------

alter table pantry add column if not exists status text;

do $$ begin
  alter table pantry add constraint pantry_status_check check (status in ('have', 'low', 'out'));
exception when duplicate_object then null; end $$;
