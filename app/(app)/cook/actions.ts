'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { claudeJson } from '@/app/lib/anthropic';
import { resolveIngredient } from '@/app/lib/ingredients';
import { RecipeSchema, toExtractedRecipe, type ExtractedRecipe } from '@/app/lib/recipe-extractor';
import { cookingDisplay, toBase } from '@/app/lib/units';
import { loadCookData, loadStaples } from './data';

async function requireUser(supabase: ReturnType<typeof createServerSupabase>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user;
}

/**
 * Put a near-miss recipe's missing ingredients on the open grocery list
 * (the newest list not marked complete), or a new list if none is open.
 * Items already on that list get the extra amount added to the same line.
 */
export async function addMissingToList(recipeId: string): Promise<{ listId: string; added: number }> {
  const supabase = createServerSupabase();
  const user = await requireUser(supabase);

  const { coverage, units } = await loadCookData(supabase, user.id, recipeId);
  const missing = coverage[0]?.missing ?? [];
  if (missing.length === 0) throw new Error('Nothing is missing for this recipe');

  const { data: open } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('user_id', user.id)
    .not('finalized_at', 'is', null)
    .is('completed_at', null)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let listId = open?.id as string | undefined;
  if (!listId) {
    const { data: created, error } = await supabase
      .from('shopping_lists')
      .insert({ user_id: user.id, plan_id: null, finalized_at: new Date().toISOString() })
      .select('id')
      .single();
    if (error || !created) throw new Error(`Could not create list: ${error?.message}`);
    listId = created.id as string;
  }

  const { data: existing } = await supabase
    .from('shopping_items')
    .select('id, ingredient_id, quantity_needed, gross_base, unit, unresolved, selected')
    .eq('list_id', listId)
    .eq('checked', false);

  for (const m of missing) {
    const ing = units.get(m.ingredient_id)!;
    const row = (existing ?? []).find(e => e.ingredient_id === m.ingredient_id);
    if (row) {
      const current = toBase(Number(row.quantity_needed), row.unit, ing) ?? 0;
      await supabase.from('shopping_items').update({
        selected: true,
        quantity_needed: current + m.need.base,
        gross_base: (row.gross_base != null ? Number(row.gross_base) : current) + m.need.base,
        unit: ing.base_unit,
        unresolved: [...((row.unresolved ?? []) as unknown[]), ...m.need.unresolved]
      }).eq('id', row.id);
    } else {
      const { error } = await supabase.from('shopping_items').insert({
        list_id: listId,
        ingredient_id: m.ingredient_id,
        quantity_needed: m.need.base,
        gross_base: m.need.base,
        unit: ing.base_unit,
        unresolved: m.need.unresolved,
        store_section: ing.category
      });
      if (error) throw new Error(`Could not add ${ing.name}: ${error.message}`);
    }
  }

  revalidatePath('/shopping');
  revalidatePath(`/shopping/${listId}`);
  return { listId, added: missing.length };
}

// =============================================================================
// STAPLES
// =============================================================================

async function saveStaples(supabase: ReturnType<typeof createServerSupabase>, userId: string, ids: string[]) {
  const { error } = await supabase.from('user_staples').upsert({
    user_id: userId,
    ingredient_ids: Array.from(new Set(ids)),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
  revalidatePath('/cook');
}

export async function addStaple(name: string) {
  const supabase = createServerSupabase();
  const user = await requireUser(supabase);
  if (!name.trim()) throw new Error('Enter an ingredient');
  const id = await resolveIngredient(supabase, name);
  const current = await loadStaples(supabase, user.id);
  await saveStaples(supabase, user.id, [...current.map(s => s.id), id]);
}

export async function removeStaple(ingredientId: string) {
  const supabase = createServerSupabase();
  const user = await requireUser(supabase);
  const current = await loadStaples(supabase, user.id);
  await saveStaples(supabase, user.id, current.map(s => s.id).filter(id => id !== ingredientId));
}

// =============================================================================
// CLAUDE SUGGESTIONS
// =============================================================================

const SuggestionsSchema = z.object({
  suggestions: z.array(z.object({
    why: z.string().describe('One short sentence on why this fits what is on hand'),
    missing: z.array(z.string()).describe('Ingredients the cook would still need to buy, if any'),
    recipe: RecipeSchema
  }))
});

export type Suggestion = {
  why: string;
  missing: string[];
  recipe: ExtractedRecipe;
};

const SUGGEST_SYSTEM = `You suggest home-cooking dishes for Sufra, a kitchen app, based on what is in the cook's pantry right now.

Suggest 4 dishes that are not already in their recipe library. Favor dishes that use what is on hand, especially the items held longest, and that need nothing or very little from the store. Respect the cuisines they already cook when it helps, and include at least one quick weeknight option.

Each suggestion carries a complete, cookable recipe: real quantities and units, clear numbered steps, a sensible servings_yield. Use author "Claude" and source_url null. Write plainly. Do not use em dashes.`;

/** Ask Claude for dishes outside the library based on current pantry contents. */
export async function suggestDishes(): Promise<Suggestion[]> {
  const supabase = createServerSupabase();
  const user = await requireUser(supabase);

  const { coverage, units, staples, pantry } = await loadCookData(supabase, user.id);
  const stocked = pantry
    .filter(p => p.quantity_on_hand > 0)
    .map(p => {
      const ing = units.get(p.ingredient_id);
      if (!ing) return null;
      const base = toBase(p.quantity_on_hand, p.unit, ing);
      const amount = base != null ? cookingDisplay(base, ing).text : `${p.quantity_on_hand} ${p.unit ?? ''}`.trim();
      return { name: ing.name, amount, since: p.since };
    })
    .filter((p): p is { name: string; amount: string; since: string | null } => p !== null)
    .sort((a, b) => (a.since ?? '9999').localeCompare(b.since ?? '9999'));

  if (stocked.length === 0) throw new Error('Add a few things to your pantry first');

  const cuisines = Array.from(new Set(coverage.map(c => c.recipe.cuisine))).slice(0, 10);
  const prompt = [
    'Pantry (oldest first):',
    ...stocked.map(p => `- ${p.name}: ${p.amount}${p.since ? ` (since ${p.since})` : ''}`),
    '',
    `Always on hand: ${staples.map(s => s.name).join(', ') || 'none listed'}`,
    `Cuisines they cook: ${cuisines.join(', ') || 'unknown'}`,
    `Already in their library (do not suggest): ${coverage.map(c => c.recipe.name).join('; ') || 'nothing yet'}`
  ].join('\n');

  const reply = await claudeJson({ system: SUGGEST_SYSTEM, content: prompt, schema: SuggestionsSchema });
  return reply.suggestions.map(s => ({ why: s.why, missing: s.missing, recipe: toExtractedRecipe(s.recipe, null) }));
}
