import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/app/lib/supabase-server';
import type { Category } from '@/app/lib/types';
import RecipeForm from '../../recipe-form';

export const dynamic = 'force-dynamic';

export default async function EditRecipePage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: recipe } = await supabase
    .from('recipes')
    .select('*, recipe_ingredients(quantity, unit, prep_note, order_index, display_name, raw_text, ingredients(canonical_name)), recipe_steps(step_number, content)')
    .eq('id', params.id)
    .single();
  if (!recipe || recipe.user_id !== user?.id) notFound();

  const ingredients = ((recipe.recipe_ingredients ?? []) as Array<{
    quantity: number | null;
    unit: string | null;
    prep_note: string | null;
    order_index: number | null;
    display_name: string | null;
    raw_text: string | null;
    ingredients: { canonical_name: string } | null;
  }>).sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  const steps = ((recipe.recipe_steps ?? []) as Array<{ step_number: number; content: string }>)
    .sort((a, b) => a.step_number - b.step_number);

  return (
    <RecipeForm
      recipeId={recipe.id}
      initial={{
        name: recipe.name,
        author: recipe.author,
        author_handle: recipe.author_handle,
        category: recipe.category as Category,
        cuisine: recipe.cuisine,
        servings_yield: recipe.servings_yield,
        total_time_min: recipe.total_time_min,
        source_url: recipe.source_url,
        image_path: recipe.image_path,
        notes: recipe.notes,
        tags: (recipe.tags ?? []) as string[],
        ingredients: ingredients.map(i => ({
          quantity: i.quantity != null ? Number(i.quantity) : null,
          unit: i.unit,
          name: i.display_name ?? i.ingredients?.canonical_name ?? i.raw_text ?? '',
          prep_note: i.prep_note
        })),
        steps: steps.map(s => s.content)
      }}
    />
  );
}
