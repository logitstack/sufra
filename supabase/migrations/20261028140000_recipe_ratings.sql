-- =============================================================================
-- RECIPE_RATINGS: recipes the user loves (a heart). Per user, so a recipe
-- shared with you can be loved without touching the owner's copy. The
-- suggestion prompt uses these to match the user's taste.
--
-- Run after 20261028130000_grocery_review.sql. Safe to re-run.
-- =============================================================================

create table if not exists recipe_ratings (
  user_id     uuid not null references auth.users(id) on delete cascade,
  recipe_id   uuid not null references recipes(id) on delete cascade,
  loved       boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (user_id, recipe_id)
);

alter table recipe_ratings enable row level security;

drop policy if exists "recipe_ratings: owner only" on recipe_ratings;
create policy "recipe_ratings: owner only"
  on recipe_ratings for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
