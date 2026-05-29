-- =============================================================================
-- SUFRA SCHEMA
-- Multi-device recipe library, meal planner, pantry, and shopping system.
-- All tables are user-scoped via RLS. Sharing is read-only by design.
-- =============================================================================

-- Extensions ------------------------------------------------------------------
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================

do $$ begin
  create type recipe_category as enum (
    'meat', 'vegetarian', 'baked_goods', 'desserts', 'drinks'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type ingredient_category as enum (
    'spice', 'produce', 'dairy', 'grain', 'protein', 'pantry', 'condiment', 'other'
  );
exception when duplicate_object then null; end $$;

-- =============================================================================
-- INGREDIENTS (canonical, shared across users)
-- Normalization layer so "EVOO" and "extra virgin olive oil" resolve to one row.
-- =============================================================================

create table if not exists ingredients (
  id                uuid primary key default uuid_generate_v4(),
  canonical_name    text unique not null,
  category          ingredient_category not null default 'other',
  default_unit      text,
  shelf_life_days   integer,
  density_g_per_ml  numeric,  -- for unit conversion (volume <-> weight)
  created_at        timestamptz not null default now()
);

create index if not exists ingredients_name_idx on ingredients (lower(canonical_name));
create index if not exists ingredients_category_idx on ingredients (category);

-- Aliases so "EVOO", "olive oil", "extra-virgin olive oil" all map back.
create table if not exists ingredient_aliases (
  id              uuid primary key default uuid_generate_v4(),
  ingredient_id   uuid not null references ingredients(id) on delete cascade,
  alias           text not null,
  created_at      timestamptz not null default now(),
  unique (lower(alias))
);

-- =============================================================================
-- RECIPES
-- =============================================================================

create table if not exists recipes (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  name              text not null,
  author            text not null default 'Personal',
  author_handle     text,
  category          recipe_category not null,
  cuisine           text not null,
  servings_yield    integer not null default 4 check (servings_yield > 0),
  total_time_min    integer check (total_time_min >= 0),
  source_url        text,
  image_path        text,
  notes             text,
  tags              jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists recipes_user_idx     on recipes (user_id);
create index if not exists recipes_category_idx on recipes (user_id, category);
create index if not exists recipes_cuisine_idx  on recipes (user_id, cuisine);
create index if not exists recipes_author_idx   on recipes (user_id, author);

-- Recipe ingredients (the join with canonical ingredients)
create table if not exists recipe_ingredients (
  id              uuid primary key default uuid_generate_v4(),
  recipe_id       uuid not null references recipes(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id),
  quantity        numeric,
  unit            text,
  prep_note       text,
  order_index     integer not null default 0,
  raw_text        text  -- the original "1/2 cup chopped onion" string for display fallback
);

create index if not exists ri_recipe_idx     on recipe_ingredients (recipe_id);
create index if not exists ri_ingredient_idx on recipe_ingredients (ingredient_id);

-- Recipe steps, kept as a separate table so reordering is cheap
create table if not exists recipe_steps (
  id              uuid primary key default uuid_generate_v4(),
  recipe_id       uuid not null references recipes(id) on delete cascade,
  step_number     integer not null,
  content         text not null,
  unique (recipe_id, step_number)
);

create index if not exists rs_recipe_idx on recipe_steps (recipe_id);

-- =============================================================================
-- SHARING (read-only)
-- A row in recipe_shares grants viewing rights to another user.
-- Recipients can never edit. To customize, they "Save a copy" which forks.
-- =============================================================================

create table if not exists recipe_shares (
  id              uuid primary key default uuid_generate_v4(),
  recipe_id       uuid not null references recipes(id) on delete cascade,
  shared_with     uuid not null references auth.users(id) on delete cascade,
  shared_by       uuid not null references auth.users(id) on delete cascade,
  shared_at       timestamptz not null default now(),
  unique (recipe_id, shared_with)
);

create index if not exists rsh_recipient_idx on recipe_shares (shared_with);
create index if not exists rsh_recipe_idx    on recipe_shares (recipe_id);

-- =============================================================================
-- PANTRY (what you have at home)
-- =============================================================================

create table if not exists pantry (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  ingredient_id     uuid not null references ingredients(id),
  quantity_on_hand  numeric not null default 0,
  unit              text,
  expiration_date   date,
  last_updated      timestamptz not null default now(),
  unique (user_id, ingredient_id)
);

create index if not exists pantry_user_idx on pantry (user_id);

-- =============================================================================
-- MEAL PLANS
-- A plan is a date window with a list of recipes and their frequency.
-- =============================================================================

create table if not exists meal_plans (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text,
  start_date      date not null,
  end_date        date not null,
  notes           text,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists mp_user_idx on meal_plans (user_id);

create table if not exists plan_items (
  id                  uuid primary key default uuid_generate_v4(),
  plan_id             uuid not null references meal_plans(id) on delete cascade,
  recipe_id           uuid not null references recipes(id),
  times_per_period    integer not null default 1 check (times_per_period > 0),
  servings_per_time   integer not null default 4 check (servings_per_time > 0)
);

create index if not exists pi_plan_idx on plan_items (plan_id);

-- =============================================================================
-- SHOPPING LISTS (generated from a plan, minus pantry)
-- =============================================================================

create table if not exists shopping_lists (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  plan_id         uuid references meal_plans(id) on delete set null,
  generated_at    timestamptz not null default now(),
  completed_at    timestamptz
);

create table if not exists shopping_items (
  id              uuid primary key default uuid_generate_v4(),
  list_id         uuid not null references shopping_lists(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id),
  quantity_needed numeric not null,
  unit            text,
  checked         boolean not null default false,
  store_section   text  -- "produce", "dairy", etc. for in-store grouping
);

create index if not exists si_list_idx on shopping_items (list_id);

-- =============================================================================
-- PRICE HISTORY (built up from receipt scans over time)
-- =============================================================================

create table if not exists price_history (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  ingredient_id   uuid not null references ingredients(id),
  store_name      text not null,
  price           numeric not null check (price >= 0),
  unit            text not null,
  quantity        numeric not null default 1,
  purchased_on    date not null default current_date,
  receipt_image   text,
  created_at      timestamptz not null default now()
);

create index if not exists ph_user_idx       on price_history (user_id);
create index if not exists ph_ingredient_idx on price_history (user_id, ingredient_id);
create index if not exists ph_store_idx      on price_history (user_id, store_name);

-- =============================================================================
-- UPDATED_AT TRIGGER
-- =============================================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists recipes_updated_at on recipes;
create trigger recipes_updated_at
  before update on recipes
  for each row execute function set_updated_at();

-- =============================================================================
-- RLS HELPER FUNCTIONS
-- recipes and recipe_shares reference each other in their policies. Querying
-- one table from the other's policy would re-trigger that table's RLS and
-- recurse forever ("infinite recursion detected in policy"). These SECURITY
-- DEFINER functions run as the owner, so the lookups bypass RLS and break the
-- cycle. `set search_path` is required for SECURITY DEFINER safety.
-- =============================================================================

create or replace function public.user_owns_recipe(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.recipes r
    where r.id = rid and r.user_id = auth.uid()
  );
$$;

create or replace function public.recipe_shared_with_me(rid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.recipe_shares s
    where s.recipe_id = rid and s.shared_with = auth.uid()
  );
$$;

grant execute on function public.user_owns_recipe(uuid)     to authenticated;
grant execute on function public.recipe_shared_with_me(uuid) to authenticated;

-- =============================================================================
-- ROW LEVEL SECURITY
-- Recipes are private by default. Shares grant read-only access.
-- =============================================================================

alter table recipes              enable row level security;
alter table recipe_ingredients   enable row level security;
alter table recipe_steps         enable row level security;
alter table recipe_shares        enable row level security;
alter table pantry               enable row level security;
alter table meal_plans           enable row level security;
alter table plan_items           enable row level security;
alter table shopping_lists       enable row level security;
alter table shopping_items       enable row level security;
alter table price_history        enable row level security;

-- Ingredients table is public-read (canonical reference data), no RLS toggle needed
-- but we lock down writes to authenticated users.
alter table ingredients          enable row level security;
alter table ingredient_aliases   enable row level security;

create policy "ingredients readable by all authenticated"
  on ingredients for select
  to authenticated
  using (true);

create policy "ingredients insertable by authenticated"
  on ingredients for insert
  to authenticated
  with check (true);

create policy "aliases readable by all authenticated"
  on ingredient_aliases for select
  to authenticated
  using (true);

create policy "aliases insertable by authenticated"
  on ingredient_aliases for insert
  to authenticated
  with check (true);

-- RECIPES ---------------------------------------------------------------------
-- Owner can do everything. Recipients of a share can only SELECT.

create policy "recipes: owner full access"
  on recipes for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "recipes: recipient read-only via share"
  on recipes for select
  to authenticated
  using ( public.recipe_shared_with_me(id) );

-- RECIPE_INGREDIENTS ----------------------------------------------------------

create policy "ri: owner full access"
  on recipe_ingredients for all
  to authenticated
  using (
    exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid())
  )
  with check (
    exists (select 1 from recipes r where r.id = recipe_ingredients.recipe_id and r.user_id = auth.uid())
  );

create policy "ri: recipient read via share"
  on recipe_ingredients for select
  to authenticated
  using (
    exists (
      select 1 from recipe_shares s
      where s.recipe_id = recipe_ingredients.recipe_id
        and s.shared_with = auth.uid()
    )
  );

-- RECIPE_STEPS ----------------------------------------------------------------

create policy "rs: owner full access"
  on recipe_steps for all
  to authenticated
  using (
    exists (select 1 from recipes r where r.id = recipe_steps.recipe_id and r.user_id = auth.uid())
  )
  with check (
    exists (select 1 from recipes r where r.id = recipe_steps.recipe_id and r.user_id = auth.uid())
  );

create policy "rs: recipient read via share"
  on recipe_steps for select
  to authenticated
  using (
    exists (
      select 1 from recipe_shares s
      where s.recipe_id = recipe_steps.recipe_id
        and s.shared_with = auth.uid()
    )
  );

-- RECIPE_SHARES ---------------------------------------------------------------
-- Owner can create/delete shares on their own recipes.
-- Recipient can see shares directed at them (so the UI can list "Shared with me").

create policy "shares: owner manages"
  on recipe_shares for all
  to authenticated
  using ( public.user_owns_recipe(recipe_id) )
  with check ( shared_by = auth.uid() and public.user_owns_recipe(recipe_id) );

create policy "shares: recipient can see own"
  on recipe_shares for select
  to authenticated
  using (shared_with = auth.uid());

-- PANTRY, MEAL_PLANS, PLAN_ITEMS, SHOPPING_*, PRICE_HISTORY -------------------
-- All user-scoped, no sharing.

create policy "pantry: owner only"
  on pantry for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "meal_plans: owner only"
  on meal_plans for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "plan_items: owner only"
  on plan_items for all
  to authenticated
  using (
    exists (select 1 from meal_plans m where m.id = plan_items.plan_id and m.user_id = auth.uid())
  )
  with check (
    exists (select 1 from meal_plans m where m.id = plan_items.plan_id and m.user_id = auth.uid())
  );

create policy "shopping_lists: owner only"
  on shopping_lists for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "shopping_items: owner only"
  on shopping_items for all
  to authenticated
  using (
    exists (select 1 from shopping_lists l where l.id = shopping_items.list_id and l.user_id = auth.uid())
  )
  with check (
    exists (select 1 from shopping_lists l where l.id = shopping_items.list_id and l.user_id = auth.uid())
  );

create policy "price_history: owner only"
  on price_history for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- STORAGE BUCKET (run separately via Supabase dashboard or storage API)
-- =============================================================================
-- 1. Create a public bucket called "recipe-images"
-- 2. Policy: authenticated users can upload to their own user_id/ prefix
-- 3. Policy: anyone (or authenticated) can read images by public URL
--
-- This SQL block is reference only. Storage policies are set in Supabase UI:
--
--   bucket: recipe-images
--   path pattern: {user_id}/{recipe_id}.{ext}
--   read: public
--   write: auth.uid()::text = (storage.foldername(name))[1]
-- =============================================================================
