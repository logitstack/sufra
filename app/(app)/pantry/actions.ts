'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { loadIngredientUnits, resolveIngredient } from '@/app/lib/ingredients';
import { adjustPantry, pantryUnit, setPantryStatus } from '@/app/lib/pantry';
import { pantryStatusOf, toBase, type PantryStatus, type TrackingMode } from '@/app/lib/units';

/**
 * Turn an entered amount into what the pantry row stores: base units when the
 * unit converts, otherwise the amount as entered (it still shows, and starts
 * counting in the math once a conversion is known).
 */
function stored(quantity: number, unit: string | null, ing: Parameters<typeof toBase>[2]) {
  const base = toBase(quantity, unit, ing);
  return base != null
    ? { quantity_on_hand: base, unit: pantryUnit(ing) }
    : { quantity_on_hand: quantity, unit };
}

/**
 * Add or update a pantry item by ingredient name.
 * Resolves the canonical ingredient (aliases, then Claude), then upserts the pantry row.
 */
export async function addPantryItem(input: {
  ingredient_name: string;
  quantity: number;
  unit: string | null;
  expiration_date: string | null;
}) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (!input.ingredient_name.trim()) throw new Error('Ingredient name is required');

  const ingredientId = await resolveIngredient(supabase, input.ingredient_name);
  const ing = (await loadIngredientUnits(supabase, [ingredientId], user.id)).get(ingredientId);
  if (!ing) throw new Error('Could not load ingredient');

  // Spices, sauces and other status-tracked items only need "have it".
  if (ing.tracking_mode === 'status') {
    await setPantryStatus(supabase, user.id, ing, 'have', { purchased: true });
    if (input.expiration_date) {
      await supabase.from('pantry').update({ expiration_date: input.expiration_date })
        .eq('user_id', user.id).eq('ingredient_id', ingredientId);
    }
    revalidatePath('/pantry');
    return;
  }
  if (input.quantity <= 0) throw new Error('Quantity must be positive');

  const { error: upsertError } = await supabase
    .from('pantry')
    .upsert({
      user_id: user.id,
      ingredient_id: ingredientId,
      ...stored(input.quantity, input.unit, ing),
      expiration_date: input.expiration_date,
      purchased_at: new Date().toISOString().slice(0, 10),
      last_updated: new Date().toISOString()
    }, { onConflict: 'user_id,ingredient_id' });

  if (upsertError) throw new Error(`Could not update pantry: ${upsertError.message}`);
  revalidatePath('/pantry');
}

/** Set a pantry row's amount. `unit` is the unit the amount was entered in. */
export async function updatePantryItem(pantryId: string, quantity: number, unit: string | null, expiration: string | null) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: row } = await supabase.from('pantry').select('ingredient_id').eq('id', pantryId).single();
  if (!row) throw new Error('Pantry item not found');
  const ing = (await loadIngredientUnits(supabase, [row.ingredient_id], user.id)).get(row.ingredient_id);
  if (!ing) throw new Error('Could not load ingredient');

  const { error } = await supabase
    .from('pantry')
    .update({
      ...stored(Math.max(0, quantity), unit, ing),
      expiration_date: expiration,
      last_updated: new Date().toISOString()
    })
    .eq('id', pantryId);
  if (error) throw new Error(error.message);
  revalidatePath('/pantry');
}

export async function deletePantryItem(pantryId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from('pantry').delete().eq('id', pantryId);
  if (error) throw new Error(error.message);
  revalidatePath('/pantry');
}

/** Set a status-tracked pantry item to have / low / out. */
export async function setPantryItemStatus(ingredientId: string, status: PantryStatus) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  const ing = (await loadIngredientUnits(supabase, [ingredientId], user.id)).get(ingredientId);
  if (!ing) throw new Error('Could not load ingredient');
  await setPantryStatus(supabase, user.id, ing, status, { purchased: status === 'have' });
  revalidatePath('/pantry');
}

/**
 * Switch an ingredient between measured and status tracking for this user.
 * Going to status keeps whether any was on hand; going to measured keeps the
 * last amount (often zero, so the pantry asks for one).
 */
export async function setTrackingMode(ingredientId: string, mode: TrackingMode) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase.from('user_ingredient_modes').upsert({
    user_id: user.id,
    ingredient_id: ingredientId,
    tracking_mode: mode,
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id,ingredient_id' });
  if (error) throw new Error(error.message);

  if (mode === 'status') {
    const { data: row } = await supabase
      .from('pantry')
      .select('id, status, quantity_on_hand')
      .eq('user_id', user.id)
      .eq('ingredient_id', ingredientId)
      .maybeSingle();
    if (row && !row.status) {
      await supabase.from('pantry').update({ status: pantryStatusOf(row) }).eq('id', row.id);
    }
  }
  revalidatePath('/pantry');
}

export type CookedStatusItem = { ingredient_id: string; name: string; status: PantryStatus };

/**
 * Mark a recipe as cooked. Deducts each measured ingredient from the pantry in
 * base units, scaled by (servings_made / recipe.servings_yield). Amounts with
 * no known conversion are skipped rather than guessed. Status-tracked
 * ingredients are returned for quick "running low" / "out" updates.
 */
export async function cookRecipe(recipeId: string, servingsMade: number): Promise<{ statusItems: CookedStatusItem[] }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: recipe } = await supabase
    .from('recipes')
    .select('servings_yield, recipe_ingredients(quantity, unit, ingredient_id)')
    .eq('id', recipeId)
    .single();
  if (!recipe) throw new Error('Recipe not found');

  const ris = ((recipe.recipe_ingredients ?? []) as unknown) as Array<{
    quantity: number | null;
    unit: string | null;
    ingredient_id: string;
  }>;
  // Substitutes picked on the grocery review for the plan running today
  // (red onion instead of shallots) are what actually got used.
  const substitutes = await currentSubstitutes(supabase, user.id, recipeId);
  const usedId = (id: string) => substitutes.get(id) ?? id;

  const units = await loadIngredientUnits(supabase, ris.flatMap(r => [r.ingredient_id, usedId(r.ingredient_id)]), user.id);
  const scaleFactor = servingsMade / Math.max(1, recipe.servings_yield);

  // Sum per ingredient first so a recipe listing salt twice deducts once.
  const used = new Map<string, number>();
  for (const ri of ris) {
    if (ri.quantity === null) continue;
    const id = usedId(ri.ingredient_id);
    const ing = units.get(id);
    const base = ing ? toBase(Number(ri.quantity) * scaleFactor, ri.unit, ing) : null;
    if (base != null) used.set(id, (used.get(id) ?? 0) + base);
  }

  for (const [ingredientId, base] of Array.from(used.entries())) {
    await adjustPantry(supabase, user.id, units.get(ingredientId)!, -base);
  }

  // Status-tracked items aren't deducted. Hand them back so the cook can mark
  // any that ran low.
  const statusIds = Array.from(new Set(ris.map(r => usedId(r.ingredient_id))))
    .filter(id => units.get(id)?.tracking_mode === 'status');
  const { data: statusRows } = statusIds.length
    ? await supabase.from('pantry').select('ingredient_id, status, quantity_on_hand').eq('user_id', user.id).in('ingredient_id', statusIds)
    : { data: [] };
  const statusById = new Map((statusRows ?? []).map(r => [r.ingredient_id as string, r]));
  const statusItems = statusIds
    .map(id => ({ ingredient_id: id, name: units.get(id)!.name, status: pantryStatusOf(statusById.get(id)) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  revalidatePath('/pantry');
  revalidatePath(`/recipe/${recipeId}`);
  return { statusItems };
}

/**
 * Substitutes (ingredient -> substitute) recorded for this recipe's current
 * meal plan: the most recent plan whose dates include today and that has the
 * recipe in it.
 */
async function currentSubstitutes(
  supabase: ReturnType<typeof createServerSupabase>,
  userId: string,
  recipeId: string
): Promise<Map<string, string>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: plans } = await supabase
    .from('meal_plans')
    .select('id, plan_items!inner(recipe_id)')
    .eq('user_id', userId)
    .eq('plan_items.recipe_id', recipeId)
    .lte('start_date', today)
    .gte('end_date', today)
    .order('created_at', { ascending: false })
    .limit(1);
  const planId = plans?.[0]?.id;
  if (!planId) return new Map();

  const { data: subs } = await supabase
    .from('plan_substitutions')
    .select('ingredient_id, substitute_ingredient_id')
    .eq('plan_id', planId);
  return new Map((subs ?? []).map(s => [s.ingredient_id as string, s.substitute_ingredient_id as string]));
}
