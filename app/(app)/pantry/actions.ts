'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { loadIngredientUnits, resolveIngredient } from '@/app/lib/ingredients';
import { adjustPantry, pantryUnit } from '@/app/lib/pantry';
import { toBase } from '@/app/lib/units';

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
  if (input.quantity <= 0) throw new Error('Quantity must be positive');

  const ingredientId = await resolveIngredient(supabase, input.ingredient_name);
  const ing = (await loadIngredientUnits(supabase, [ingredientId], user.id)).get(ingredientId);
  if (!ing) throw new Error('Could not load ingredient');

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

/**
 * Mark a recipe as cooked. Deducts each ingredient from the pantry in base
 * units, scaled by (servings_made / recipe.servings_yield). Amounts with no
 * known conversion are skipped rather than guessed.
 */
export async function cookRecipe(recipeId: string, servingsMade: number) {
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
  const units = await loadIngredientUnits(supabase, ris.map(r => r.ingredient_id), user.id);
  const scaleFactor = servingsMade / Math.max(1, recipe.servings_yield);

  // Sum per ingredient first so a recipe listing salt twice deducts once.
  const used = new Map<string, number>();
  for (const ri of ris) {
    if (ri.quantity === null) continue;
    const ing = units.get(ri.ingredient_id);
    const base = ing ? toBase(Number(ri.quantity) * scaleFactor, ri.unit, ing) : null;
    if (base != null) used.set(ri.ingredient_id, (used.get(ri.ingredient_id) ?? 0) + base);
  }

  for (const [ingredientId, base] of Array.from(used.entries())) {
    await adjustPantry(supabase, user.id, units.get(ingredientId)!, -base);
  }

  revalidatePath('/pantry');
  revalidatePath(`/recipe/${recipeId}`);
}
