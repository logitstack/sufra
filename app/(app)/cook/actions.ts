'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { claudeJson, WEB_SEARCH_TOOL } from '@/app/lib/anthropic';
import { resolveIngredient } from '@/app/lib/ingredients';
import { RecipeSchema, toExtractedRecipe, type ExtractedRecipe } from '@/app/lib/recipe-extractor';
import { cookingDisplay, pantryStatusOf, toBase } from '@/app/lib/units';
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
    why: z.string().describe('Two or three sentences on why this dish works and why it fits the request'),
    tips: z.array(z.string()).describe('Practical tips: make-ahead options, what to watch for, how to tell it is done'),
    source_url: z.string().nullable().describe('URL of the published recipe this is based on, or null'),
    missing: z.array(z.string()).describe('Ingredients the cook would need to buy, if any'),
    recipe: RecipeSchema
  }))
});

export type Suggestion = {
  why: string;
  tips: string[];
  source_url: string | null;
  missing: string[];
  recipe: ExtractedRecipe;
};

export type PantryMode = 'stick' | 'few' | 'ignore';

export type SuggestInput = {
  /** What the cook asked for: "a dessert for a family gathering". */
  request: string;
  /** Quick-pick chips: dessert, breakfast, soup... */
  kinds: string[];
  servings: number | null;
  maxMinutes: number | null;
  pantryMode: PantryMode;
  /** Follow-ups in order: "less sweet", "no oven". */
  refinements: string[];
  /** Dishes already shown, so "more" brings new ones. */
  shown: Array<{ name: string; why: string }>;
};

const SUGGEST_SYSTEM = `You are a skilled home cook helping a friend decide what to make, inside Sufra, a kitchen app. Recommend dishes the way you would in conversation: dishes you would actually stand behind, explained plainly.

Every suggestion must be halal:
- No pork or pork products (bacon, ham, lard, pancetta, prosciutto, pork gelatin, pork-based stock).
- No alcohol in any form, even when it cooks off: no wine, beer, spirits, mirin, sake, cooking wine or sherry, and no alcohol-based extracts such as standard vanilla extract. Use alcohol-free vanilla, vanilla bean, or vanilla powder instead.
- No gelatin unless it is labeled halal or plant-based (agar). Say which.
- Meat and chicken are assumed to be bought halal; do not mention it unless relevant.

Use web search to find well-tested published recipes from reliable cooks and sites, and base suggestions on them when they fit. When a suggestion is based on a published recipe, set source_url to that page and adapt it to the rules above. Otherwise set source_url null.

For each suggestion:
- why: a short note on why the dish works and why it fits what they asked for.
- recipe: a complete, cookable recipe with exact quantities and units (use tsp, tbsp, cup, g, kg, oz, lb, ml, l, can, clove, bunch and so on, or null for a plain count), clear steps in order, a sensible servings_yield and total time. Use author "Claude" unless it closely follows a published author's recipe, then credit them. Put the source link in recipe.source_url too.
- tips: two to four practical tips such as make-ahead and storage, what to watch for, or substitutions.
- missing: what they would need to buy, based on their pantry. Empty if nothing.

Return exactly 3 suggestions, none already in their library or already shown. Match their taste using the cuisines they cook and the recipes they love, without copying those recipes. Write plainly and do not use em dashes.`;

/**
 * Ask Claude for three dishes outside the library, shaped by the cook's
 * request, their library, the recipes they love, and (depending on
 * pantryMode) what's on hand. Each call is self-contained: refinements and
 * the dishes already shown travel with the request, so "more" and follow-ups
 * build on the conversation without replaying it.
 */
export async function suggestDishes(input: SuggestInput): Promise<Suggestion[]> {
  const supabase = createServerSupabase();
  const user = await requireUser(supabase);

  const [{ coverage, units, staples, pantry }, { data: loved }] = await Promise.all([
    loadCookData(supabase, user.id),
    supabase.from('recipe_ratings').select('recipes(name)').eq('user_id', user.id).eq('loved', true)
  ]);

  const stocked = pantry
    .map(p => {
      const ing = units.get(p.ingredient_id);
      if (!ing) return null;
      let amount: string | null;
      if (ing.tracking_mode === 'status') {
        const status = pantryStatusOf(p);
        if (status === 'out') return null;
        amount = status === 'low' ? 'running low' : 'have it';
      } else {
        if (p.quantity_on_hand <= 0) return null;
        const base = toBase(p.quantity_on_hand, p.unit, ing);
        amount = base != null ? cookingDisplay(base, ing).text : `${p.quantity_on_hand} ${p.unit ?? ''}`.trim();
      }
      return { name: ing.name, amount, since: p.since };
    })
    .filter((p): p is { name: string; amount: string; since: string | null } => p !== null)
    .sort((a, b) => (a.since ?? '9999').localeCompare(b.since ?? '9999'));

  // Cuisines they cook most, from the library.
  const cuisineCounts = new Map<string, number>();
  for (const c of coverage) cuisineCounts.set(c.recipe.cuisine, (cuisineCounts.get(c.recipe.cuisine) ?? 0) + 1);
  const cuisines = Array.from(cuisineCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c} (${n})`);
  const lovedNames = ((loved ?? []) as unknown as Array<{ recipes: { name: string } | null }>)
    .map(r => r.recipes?.name).filter(Boolean);

  const pantryRule = {
    stick: 'Use only what is in their pantry plus the always-available staples. missing must be empty.',
    few: 'Lean on their pantry, especially the items held longest. Needing two or three things from the store is fine.',
    ignore: 'Ignore the pantry; suggest whatever fits best. List everything they would need to buy in missing only if you can tell from the pantry below.'
  }[input.pantryMode];

  const ask = input.request.trim() || (input.kinds.length ? '' : 'Something good to cook this week.');
  const lines = [
    `What they want: ${[ask, input.kinds.length ? `Kind: ${input.kinds.join(', ')}` : ''].filter(Boolean).join('. ')}`,
    input.servings ? `Servings: ${input.servings}` : '',
    input.maxMinutes ? `Total time: ${input.maxMinutes} minutes or less` : '',
    `Pantry: ${pantryRule}`,
    ...input.refinements.map((r, i) => `Follow-up ${i + 1}: ${r}`),
    '',
    'Pantry (oldest first):',
    ...(stocked.length ? stocked.map(p => `- ${p.name}: ${p.amount}${p.since ? ` (since ${p.since})` : ''}`) : ['- nothing recorded']),
    `Always available: water, ${staples.map(s => s.name).join(', ') || 'nothing else listed'}`,
    '',
    `Cuisines they cook most: ${cuisines.join(', ') || 'unknown'}`,
    `Recipes they love: ${lovedNames.join('; ') || 'none rated yet'}`,
    `Already in their library (do not suggest): ${coverage.map(c => c.recipe.name).join('; ') || 'nothing yet'}`,
    input.shown.length
      ? `Already shown (do not repeat; ${input.refinements.length ? 'revise in the direction of the latest follow-up' : 'suggest different dishes'}):\n${input.shown.map(s => `- ${s.name}: ${s.why}`).join('\n')}`
      : ''
  ];

  const reply = await claudeJson({
    system: SUGGEST_SYSTEM,
    content: lines.filter(l => l !== '').join('\n'),
    schema: SuggestionsSchema,
    effort: 'medium',
    tools: [WEB_SEARCH_TOOL]
  });

  return reply.suggestions.slice(0, 3).map(s => {
    const source = s.source_url ?? s.recipe.source_url ?? null;
    const recipe = toExtractedRecipe({ ...s.recipe, source_url: source }, source);
    // Keep the tips with the saved recipe.
    const tips = s.tips.map(t => `- ${t}`).join('\n');
    recipe.notes = [recipe.notes, tips].filter(Boolean).join('\n\n') || null;
    return { why: s.why, tips: s.tips, source_url: source, missing: s.missing, recipe };
  });
}
