'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { resolveIngredients } from '@/app/lib/ingredients';
import { photoFromSource, saveRemoteImage } from '@/app/lib/recipe-photo';
import type { Category } from '@/app/lib/types';

export type IngredientInput = {
  quantity: number | null;
  unit: string | null;
  name: string;
  prep_note: string | null;
};

export type CreateRecipeInput = {
  name: string;
  author: string;
  author_handle: string | null;
  category: Category;
  cuisine: string;
  servings_yield: number;
  total_time_min: number | null;
  source_url: string | null;
  /** An uploaded photo's public URL, or the recipe's current photo when editing. */
  image_path: string | null;
  /** A photo found on the source link, to copy into storage when no photo was uploaded. */
  remote_image_url?: string | null;
  notes: string | null;
  tags: string[];
  ingredients: IngredientInput[];
  steps: string[];
};

type Supabase = ReturnType<typeof createServerSupabase>;

/**
 * The photo to store: an uploaded one, else the link's photo the form showed,
 * else whatever photo the source link has. Remote photos are copied into
 * Supabase Storage. Null when there's none.
 */
async function resolvePhoto(supabase: Supabase, userId: string, input: CreateRecipeInput): Promise<string | null> {
  if (input.image_path) return input.image_path;
  if (input.remote_image_url) {
    const saved = await saveRemoteImage(supabase, userId, input.remote_image_url);
    if (saved) return saved;
  }
  return photoFromSource(supabase, userId, input.source_url?.trim() || null);
}

function recipeRow(input: CreateRecipeInput) {
  return {
    name: input.name.trim(),
    author: input.author.trim() || 'Personal',
    author_handle: input.author_handle?.trim() || null,
    category: input.category,
    cuisine: input.cuisine.trim() || 'Other',
    servings_yield: input.servings_yield,
    total_time_min: input.total_time_min,
    source_url: input.source_url?.trim() || null,
    notes: input.notes?.trim() || null,
    tags: input.tags
  };
}

/**
 * Insert ingredients (matched to canonical entries) and steps. display_name
 * keeps the name as written so the recipe reads exactly as entered.
 */
async function insertLines(supabase: Supabase, recipeId: string, input: CreateRecipeInput) {
  const named = input.ingredients.filter(ing => ing.name.trim());
  if (named.length > 0) {
    const ids = await resolveIngredients(supabase, named.map(ing => ing.name));
    const ingredientRows = named.map((ing, idx) => ({
      recipe_id: recipeId,
      ingredient_id: ids.get(ing.name.trim().toLowerCase().replace(/\s+/g, ' '))!,
      display_name: ing.name.trim(),
      quantity: ing.quantity,
      unit: ing.unit,
      prep_note: ing.prep_note,
      order_index: idx,
      raw_text: `${ing.quantity ?? ''} ${ing.unit ?? ''} ${ing.name}`.trim()
    }));
    const { error: ingError } = await supabase.from('recipe_ingredients').insert(ingredientRows);
    if (ingError) throw new Error(`Failed to add ingredients: ${ingError.message}`);
  }

  const steps = input.steps.map(s => s.trim()).filter(Boolean);
  if (steps.length > 0) {
    const stepRows = steps.map((content, i) => ({ recipe_id: recipeId, step_number: i + 1, content }));
    const { error: stepError } = await supabase.from('recipe_steps').insert(stepRows);
    if (stepError) throw new Error(`Failed to add steps: ${stepError.message}`);
  }
}

export async function createRecipe(input: CreateRecipeInput): Promise<{ id: string }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (!input.name.trim()) throw new Error('Recipe name is required');

  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert({ ...recipeRow(input), user_id: user.id, image_path: await resolvePhoto(supabase, user.id, input) })
    .select('id')
    .single();
  if (recipeError || !recipe) throw new Error(`Failed to create recipe: ${recipeError?.message}`);

  await insertLines(supabase, recipe.id, input);

  revalidatePath('/library');
  return { id: recipe.id };
}

/**
 * Save edits to a recipe. Ingredient lines and steps are replaced and
 * re-matched to canonical ingredients. Meal plans point at the recipe by id,
 * so they use the updated version from here on.
 */
export async function updateRecipe(recipeId: string, input: CreateRecipeInput): Promise<{ id: string }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (!input.name.trim()) throw new Error('Recipe name is required');

  const { data: existing } = await supabase.from('recipes').select('user_id').eq('id', recipeId).single();
  if (!existing || existing.user_id !== user.id) throw new Error('You can only edit your own recipes');

  const { error } = await supabase
    .from('recipes')
    .update({
      ...recipeRow(input),
      image_path: await resolvePhoto(supabase, user.id, input),
      updated_at: new Date().toISOString()
    })
    .eq('id', recipeId);
  if (error) throw new Error(`Failed to save recipe: ${error.message}`);

  // Match ingredients before removing the old lines. New names are saved as
  // aliases, so the insert below resolves them without another Claude call.
  await resolveIngredients(supabase, input.ingredients.filter(i => i.name.trim()).map(i => i.name));

  const [{ error: ingError }, { error: stepError }] = await Promise.all([
    supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId),
    supabase.from('recipe_steps').delete().eq('recipe_id', recipeId)
  ]);
  if (ingError || stepError) throw new Error(`Failed to save recipe: ${(ingError ?? stepError)!.message}`);

  await insertLines(supabase, recipeId, input);

  revalidatePath('/library');
  revalidatePath(`/recipe/${recipeId}`);
  return { id: recipeId };
}
