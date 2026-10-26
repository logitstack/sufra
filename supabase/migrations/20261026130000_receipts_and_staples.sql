-- =============================================================================
-- PHASE 2: receipt scanning. PHASE 3: what can I make (staples).
-- Run after 20261026120000_units_and_purchase_sizes.sql. Safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRODUCT_ALIASES: receipt text -> ingredient + package size, learned from the
-- lines a user confirms. "MORTON SALT" -> salt, 737 g. Per user, since stores
-- abbreviate differently and people buy different sizes.
-- -----------------------------------------------------------------------------

create table if not exists product_aliases (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  receipt_text    text not null,   -- normalized: uppercase, single spaces, no prices
  ingredient_id   uuid not null references ingredients(id) on delete cascade,
  package_size    numeric,         -- base amount (g or count) per package; null = sold by weight
  package_unit    text,            -- 'bag', 'can'
  package_label   text,            -- '26 oz'
  updated_at      timestamptz not null default now(),
  unique (user_id, receipt_text)
);

create index if not exists pa_user_idx on product_aliases (user_id);

alter table product_aliases enable row level security;

drop policy if exists "product_aliases: owner only" on product_aliases;
create policy "product_aliases: owner only"
  on product_aliases for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- USER_STAPLES: ingredients treated as always on hand (salt, water, oil) so
-- they never block a "can make now" match. No row means the defaults.
-- -----------------------------------------------------------------------------

create table if not exists user_staples (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  ingredient_ids  uuid[] not null default '{}',
  updated_at      timestamptz not null default now()
);

alter table user_staples enable row level security;

drop policy if exists "user_staples: owner only" on user_staples;
create policy "user_staples: owner only"
  on user_staples for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Shopping lists made outside a plan (near-miss "add to list") have no plan.
-- plan_id is already nullable; nothing to change there.
