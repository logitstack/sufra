-- =============================================================================
-- SUFRA — run this once in the Supabase SQL Editor.
-- Part A: fix the recipes <-> recipe_shares RLS recursion (recipe saving).
-- Part B: backfill ingredient densities (volume <-> weight conversion).
-- Safe and idempotent — re-running does no harm.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PART A — break the policy recursion via SECURITY DEFINER helper functions
-- ---------------------------------------------------------------------------

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

grant execute on function public.user_owns_recipe(uuid)      to authenticated;
grant execute on function public.recipe_shared_with_me(uuid) to authenticated;

drop policy if exists "recipes: recipient read-only via share" on recipes;
create policy "recipes: recipient read-only via share"
  on recipes for select
  to authenticated
  using ( public.recipe_shared_with_me(id) );

drop policy if exists "shares: owner manages" on recipe_shares;
create policy "shares: owner manages"
  on recipe_shares for all
  to authenticated
  using ( public.user_owns_recipe(recipe_id) )
  with check ( shared_by = auth.uid() and public.user_owns_recipe(recipe_id) );

-- ---------------------------------------------------------------------------
-- PART B — backfill density_g_per_ml on existing ingredient rows (fills only
-- where it's currently NULL, so manual values are preserved). This covers
-- rows the recipe/pantry importer created ad-hoc without a density.
-- ---------------------------------------------------------------------------

update ingredients i
set density_g_per_ml = d.density
from (values
  ('salt',              1.20),
  ('black pepper',      0.50),
  ('cumin',             0.45),
  ('coriander',         0.40),
  ('turmeric',          0.50),
  ('garam masala',      0.40),
  ('red chili powder',  0.50),
  ('paprika',           0.45),
  ('cinnamon',          0.50),
  ('cardamom',          0.45),
  ('za''atar',          0.35),
  ('sumac',             0.40),
  ('olive oil',         0.92),
  ('vegetable oil',     0.92),
  ('all-purpose flour', 0.55),
  ('butter',            0.91),
  ('milk',              1.03),
  ('sugar',             0.85),
  ('brown sugar',       0.85),
  ('baking powder',     0.90),
  ('baking soda',       2.20),
  ('tahini',            1.10)
) as d(name, density)
where lower(i.canonical_name) = d.name
  and i.density_g_per_ml is null;
