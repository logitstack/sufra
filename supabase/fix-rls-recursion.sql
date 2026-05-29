-- =============================================================================
-- FIX: "infinite recursion detected in policy for relation recipes"
--
-- Cause: the `recipes` policy "recipient read-only via share" reads from
-- recipe_shares, and the `recipe_shares` policy "owner manages" reads from
-- recipes. Each read re-triggers the other table's RLS, looping forever.
--
-- Fix: do the cross-table lookups inside SECURITY DEFINER functions, which run
-- as the table owner and therefore bypass RLS, breaking the cycle.
--
-- Safe to run against an existing database. Run in the Supabase SQL Editor.
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

grant execute on function public.user_owns_recipe(uuid)      to authenticated;
grant execute on function public.recipe_shared_with_me(uuid) to authenticated;

-- Recreate the two cyclic policies to call the helper functions ---------------

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
