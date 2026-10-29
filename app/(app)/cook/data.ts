import type { createServerSupabase } from '@/app/lib/supabase-server';
import { loadIngredientUnits } from '@/app/lib/ingredients';
import { computeCoverage, type Coverage, type CoveragePantryRow, type CoverageRecipe } from '@/app/lib/coverage';
import type { IngredientUnits } from '@/app/lib/units';

type Supabase = ReturnType<typeof createServerSupabase>;

/** Used until the user edits their staples. */
export const DEFAULT_STAPLES = ['salt', 'water', 'vegetable oil', 'olive oil'];

/** The user's staple ingredient ids, falling back to the defaults. */
export async function loadStaples(supabase: Supabase, userId: string): Promise<Array<{ id: string; name: string }>> {
  const { data: row } = await supabase.from('user_staples').select('ingredient_ids').eq('user_id', userId).maybeSingle();
  const query = supabase.from('ingredients').select('id, canonical_name');
  const { data } = row
    ? await query.in('id', row.ingredient_ids ?? [])
    : await query.in('canonical_name', DEFAULT_STAPLES);
  return (data ?? [])
    .map(i => ({ id: i.id as string, name: i.canonical_name as string }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type CookData = {
  coverage: Coverage[];
  units: Map<string, IngredientUnits>;
  staples: Array<{ id: string; name: string }>;
  pantry: CoveragePantryRow[];
};

/** Everything "What can I make" needs, for every recipe the user can see. */
export async function loadCookData(supabase: Supabase, userId: string, recipeId?: string): Promise<CookData> {
  let recipeQuery = supabase
    .from('recipes')
    .select('id, name, cuisine, recipe_ingredients(ingredient_id, quantity, unit)')
    .order('name');
  if (recipeId) recipeQuery = recipeQuery.eq('id', recipeId);

  const [{ data: recipeRows }, { data: pantryRows }, staples] = await Promise.all([
    recipeQuery,
    supabase.from('pantry').select('ingredient_id, quantity_on_hand, unit, status, purchased_at, last_updated').eq('user_id', userId),
    loadStaples(supabase, userId)
  ]);

  const recipes = (recipeRows ?? []) as unknown as Array<CoverageRecipe & { recipe_ingredients: CoverageRecipe['ingredients'] }>;
  const normalized: CoverageRecipe[] = recipes.map(r => ({
    id: r.id, name: r.name, cuisine: r.cuisine, ingredients: r.recipe_ingredients ?? []
  }));

  const pantry: CoveragePantryRow[] = (pantryRows ?? []).map(p => ({
    ingredient_id: p.ingredient_id,
    quantity_on_hand: Number(p.quantity_on_hand),
    unit: p.unit,
    status: p.status,
    // Rows added before purchase dates existed fall back to their last update.
    since: p.purchased_at ?? (p.last_updated ? String(p.last_updated).slice(0, 10) : null)
  }));

  const units = await loadIngredientUnits(
    supabase,
    [...normalized.flatMap(r => r.ingredients.map(i => i.ingredient_id)), ...pantry.map(p => p.ingredient_id)],
    userId
  );

  const coverage = computeCoverage(normalized, pantry, units, new Set(staples.map(s => s.id)));
  return { coverage, units, staples, pantry };
}
