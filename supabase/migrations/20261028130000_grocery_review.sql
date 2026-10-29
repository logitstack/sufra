-- =============================================================================
-- GROCERY LIST REVIEW
--
-- Generating a list now makes a draft (finalized_at null) that opens on a
-- review screen with four sections. Tapping OK finalizes it, and the shopping
-- list shows only the items left selected.
--
-- Run after 20261028120000_tracking_modes.sql. Safe to re-run.
-- =============================================================================

-- Lists made before the review screen existed are already final: the column
-- is added with a default that fills existing rows, then the default is
-- dropped so new lists start as drafts. Re-running skips the add.
alter table shopping_lists add column if not exists finalized_at timestamptz default now();
alter table shopping_lists alter column finalized_at drop default;

-- section:    buy | similar | low | have (review screen grouping)
-- selected:   on the final list (the review screen's checkbox; separate from
--             `checked`, which means bought)
-- suggestions: pantry items that could stand in, [{ingredient_id, name, note}]
-- substitute_ingredient_id: the pantry item the user picked instead
alter table shopping_items add column if not exists section text not null default 'buy';
alter table shopping_items add column if not exists selected boolean not null default true;
alter table shopping_items add column if not exists suggestions jsonb not null default '[]'::jsonb;
alter table shopping_items add column if not exists substitute_ingredient_id uuid references ingredients(id) on delete set null;

do $$ begin
  alter table shopping_items add constraint shopping_items_section_check check (section in ('buy', 'similar', 'low', 'have'));
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- PLAN_SUBSTITUTIONS: "for this plan, use red onion instead of shallots", so
-- "I cooked this" deducts from the substitute.
-- -----------------------------------------------------------------------------

create table if not exists plan_substitutions (
  plan_id                   uuid not null references meal_plans(id) on delete cascade,
  ingredient_id             uuid not null references ingredients(id) on delete cascade,
  substitute_ingredient_id  uuid not null references ingredients(id) on delete cascade,
  created_at                timestamptz not null default now(),
  primary key (plan_id, ingredient_id)
);

alter table plan_substitutions enable row level security;

drop policy if exists "plan_substitutions: plan owner" on plan_substitutions;
create policy "plan_substitutions: plan owner"
  on plan_substitutions for all
  to authenticated
  using (exists (select 1 from meal_plans p where p.id = plan_substitutions.plan_id and p.user_id = auth.uid()))
  with check (exists (select 1 from meal_plans p where p.id = plan_substitutions.plan_id and p.user_id = auth.uid()));
