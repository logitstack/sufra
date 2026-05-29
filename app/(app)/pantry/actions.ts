'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { normalizeWithDensity, scale, subtract } from '@/app/lib/units';

/**
 * Add or update a pantry item by ingredient name.
 * Looks up canonical ingredient (find or create), then upserts the pantry row.
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

  // Find or create canonical ingredient
  const normalized = input.ingredient_name.trim().toLowerCase();
  let ingredientId: string;

  const { data: existing } = await supabase
    .from('ingredients')
    .select('id')
    .ilike('canonical_name', normalized)
    .maybeSingle();

  if (existing?.id) {
    ingredientId = existing.id;
  } else {
    const { data: created, error } = await supabase
      .from('ingredients')
      .insert({ canonical_name: normalized, category: 'other' })
      .select('id')
      .single();
    if (error || !created) throw new Error(`Could not add ingredient: ${error?.message}`);
    ingredientId = created.id;
  }

  // Upsert pantry row
  const { error: upsertError } = await supabase
    .from('pantry')
    .upsert({
      user_id: user.id,
      ingredient_id: ingredientId,
      quantity_on_hand: input.quantity,
      unit: input.unit,
      expiration_date: input.expiration_date,
      last_updated: new Date().toISOString()
    }, { onConflict: 'user_id,ingredient_id' });

  if (upsertError) throw new Error(`Could not update pantry: ${upsertError.message}`);
  revalidatePath('/pantry');
}

export async function updatePantryItem(pantryId: string, quantity: number, expiration: string | null) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('pantry')
    .update({
      quantity_on_hand: Math.max(0, quantity),
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
 * Mark a recipe as cooked. Deducts each ingredient from pantry,
 * scaled by (servings_made / recipe.servings_yield).
 */
export async function cookRecipe(recipeId: string, servingsMade: number) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: recipe } = await supabase
    .from('recipes')
    .select('servings_yield, recipe_ingredients(quantity, unit, ingredient_id, ingredients(density_g_per_ml))')
    .eq('id', recipeId)
    .single();

  if (!recipe) throw new Error('Recipe not found');

  const scaleFactor = servingsMade / Math.max(1, recipe.servings_yield);

  for (const ri of ((recipe.recipe_ingredients ?? []) as unknown) as Array<{
    quantity: number | null;
    unit: string | null;
    ingredient_id: string;
    ingredients: { density_g_per_ml: number | null } | null;
  }>) {
    if (ri.quantity === null) continue;

    const { data: pantryRow } = await supabase
      .from('pantry')
      .select('id, quantity_on_hand, unit')
      .eq('user_id', user.id)
      .eq('ingredient_id', ri.ingredient_id)
      .maybeSingle();

    if (!pantryRow) continue;  // Skip if not in pantry

    // Normalize both (density lets tsp-in-recipe meet grams-in-pantry) and subtract
    const density = ri.ingredients?.density_g_per_ml ?? null;
    const used = scale(normalizeWithDensity(ri.quantity, ri.unit, density), scaleFactor);
    const have = normalizeWithDensity(pantryRow.quantity_on_hand, pantryRow.unit, density);

    if (used.type !== have.type) continue;  // Skip incompatible units

    // Convert back to pantry's unit and update
    const remaining = subtract(have, used);
    const remainingInOriginal = remaining.value === 0
      ? 0
      : (pantryRow.quantity_on_hand * remaining.value) / Math.max(have.value, 0.0001);

    await supabase
      .from('pantry')
      .update({
        quantity_on_hand: remainingInOriginal,
        last_updated: new Date().toISOString()
      })
      .eq('id', pantryRow.id);
  }

  revalidatePath('/pantry');
  revalidatePath(`/recipe/${recipeId}`);
}
