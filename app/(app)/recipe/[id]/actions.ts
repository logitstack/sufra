'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

export async function shareRecipe(recipeId: string, recipientEmail: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Verify ownership
  const { data: recipe } = await supabase
    .from('recipes')
    .select('id, user_id')
    .eq('id', recipeId)
    .single();
  if (!recipe || recipe.user_id !== user.id) {
    throw new Error('You can only share your own recipes');
  }

  // Look up recipient by email. Note: this requires a public.profiles or
  // service-role lookup in production. For Phase 1, we use the auth admin RPC.
  const { data: recipient, error: lookupError } = await supabase
    .rpc('get_user_id_by_email', { email_input: recipientEmail.trim().toLowerCase() });

  if (lookupError || !recipient) {
    throw new Error(`No Sufra user found with email "${recipientEmail}". Ask them to sign up first.`);
  }

  if (recipient === user.id) {
    throw new Error("You can't share a recipe with yourself");
  }

  // Create the share (uniqueness constraint prevents duplicates)
  const { error } = await supabase
    .from('recipe_shares')
    .insert({
      recipe_id: recipeId,
      shared_with: recipient,
      shared_by: user.id
    });

  if (error && !error.message.includes('duplicate')) {
    throw new Error(`Failed to share: ${error.message}`);
  }

  revalidatePath(`/recipe/${recipeId}`);
  return { ok: true };
}

export async function unshareRecipe(recipeId: string, recipientId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('recipe_shares')
    .delete()
    .eq('recipe_id', recipeId)
    .eq('shared_with', recipientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/recipe/${recipeId}`);
}

export async function deleteRecipe(recipeId: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('recipes')
    .delete()
    .eq('id', recipeId)
    .eq('user_id', user.id);

  if (error) throw new Error(`Failed to delete: ${error.message}`);

  revalidatePath('/library');
  redirect('/library');
}

export async function forkRecipe(recipeId: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Fetch the original (RLS lets us see it if shared with us)
  const { data: original } = await supabase
    .from('recipes')
    .select('*, recipe_ingredients(*), recipe_steps(*)')
    .eq('id', recipeId)
    .single();

  if (!original) throw new Error('Recipe not found');

  // Insert the fork under the current user
  const { data: copy, error } = await supabase
    .from('recipes')
    .insert({
      user_id: user.id,
      name: original.name,
      author: original.author,
      author_handle: original.author_handle,
      category: original.category,
      cuisine: original.cuisine,
      servings_yield: original.servings_yield,
      total_time_min: original.total_time_min,
      source_url: original.source_url,
      image_path: original.image_path,
      notes: original.notes,
      tags: original.tags
    })
    .select('id')
    .single();

  if (error || !copy) throw new Error(`Fork failed: ${error?.message}`);

  // Copy ingredients
  if (original.recipe_ingredients?.length) {
    const ingRows = original.recipe_ingredients.map((ri: any) => ({
      recipe_id: copy.id,
      ingredient_id: ri.ingredient_id,
      display_name: ri.display_name,
      quantity: ri.quantity,
      unit: ri.unit,
      prep_note: ri.prep_note,
      order_index: ri.order_index,
      raw_text: ri.raw_text
    }));
    await supabase.from('recipe_ingredients').insert(ingRows);
  }

  // Copy steps
  if (original.recipe_steps?.length) {
    const stepRows = original.recipe_steps.map((s: any) => ({
      recipe_id: copy.id,
      step_number: s.step_number,
      content: s.content
    }));
    await supabase.from('recipe_steps').insert(stepRows);
  }

  revalidatePath('/library');
  redirect(`/recipe/${copy.id}`);
}

export async function signOut() {
  const supabase = createServerSupabase();
  await supabase.auth.signOut();
  redirect('/login');
}

/** Love (heart) a recipe or take the heart back. Works on shared recipes too. */
export async function setLoved(recipeId: string, loved: boolean) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = loved
    ? await supabase.from('recipe_ratings').upsert(
        { user_id: user.id, recipe_id: recipeId, loved: true, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,recipe_id' }
      )
    : await supabase.from('recipe_ratings').delete().eq('user_id', user.id).eq('recipe_id', recipeId);
  if (error) throw new Error(error.message);

  revalidatePath('/library');
  revalidatePath(`/recipe/${recipeId}`);
}
