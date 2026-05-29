'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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
  image_path: string | null;
  notes: string | null;
  tags: string[];
  ingredients: IngredientInput[];
  steps: string[];
};

/**
 * Find or create a canonical ingredient. Phase 1: simple case-insensitive match.
 * Phase 2 will route this through Haiku 4.5 for proper normalization across aliases.
 */
async function findOrCreateIngredient(
  supabase: ReturnType<typeof createServerSupabase>,
  rawName: string
): Promise<string> {
  const normalized = rawName.trim().toLowerCase();

  // Try alias match first
  const { data: alias } = await supabase
    .from('ingredient_aliases')
    .select('ingredient_id')
    .ilike('alias', normalized)
    .maybeSingle();
  if (alias?.ingredient_id) return alias.ingredient_id;

  // Try canonical_name match
  const { data: existing } = await supabase
    .from('ingredients')
    .select('id')
    .ilike('canonical_name', normalized)
    .maybeSingle();
  if (existing?.id) return existing.id;

  // Create new
  const { data: created, error } = await supabase
    .from('ingredients')
    .insert({ canonical_name: normalized, category: 'other' })
    .select('id')
    .single();
  if (error || !created) throw new Error(`Failed to create ingredient: ${error?.message}`);
  return created.id;
}

export async function createRecipe(input: CreateRecipeInput): Promise<{ id: string }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (!input.name.trim()) throw new Error('Recipe name is required');

  // Insert the recipe row
  const { data: recipe, error: recipeError } = await supabase
    .from('recipes')
    .insert({
      user_id: user.id,
      name: input.name.trim(),
      author: input.author.trim() || 'Personal',
      author_handle: input.author_handle?.trim() || null,
      category: input.category,
      cuisine: input.cuisine.trim() || 'Other',
      servings_yield: input.servings_yield,
      total_time_min: input.total_time_min,
      source_url: input.source_url?.trim() || null,
      image_path: input.image_path,
      notes: input.notes?.trim() || null,
      tags: input.tags
    })
    .select('id')
    .single();
  if (recipeError || !recipe) throw new Error(`Failed to create recipe: ${recipeError?.message}`);

  // Insert ingredients (find or create canonical entries)
  if (input.ingredients.length > 0) {
    const ingredientRows = await Promise.all(
      input.ingredients.map(async (ing, idx) => {
        const ingredientId = await findOrCreateIngredient(supabase, ing.name);
        return {
          recipe_id: recipe.id,
          ingredient_id: ingredientId,
          quantity: ing.quantity,
          unit: ing.unit,
          prep_note: ing.prep_note,
          order_index: idx,
          raw_text: `${ing.quantity ?? ''} ${ing.unit ?? ''} ${ing.name}`.trim()
        };
      })
    );
    const { error: ingError } = await supabase.from('recipe_ingredients').insert(ingredientRows);
    if (ingError) throw new Error(`Failed to add ingredients: ${ingError.message}`);
  }

  // Insert steps
  if (input.steps.length > 0) {
    const stepRows = input.steps.map((content, i) => ({
      recipe_id: recipe.id,
      step_number: i + 1,
      content: content.trim()
    }));
    const { error: stepError } = await supabase.from('recipe_steps').insert(stepRows);
    if (stepError) throw new Error(`Failed to add steps: ${stepError.message}`);
  }

  revalidatePath('/library');
  return { id: recipe.id };
}
