'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addToNeed, emptyNeed, pantryStatusOf, toBase, type Need } from '@/app/lib/units';
import { loadIngredientUnits } from '@/app/lib/ingredients';
import { suggestSubstitutes, type Substitute } from '@/app/lib/substitutes';
import type { ShoppingSection } from '@/app/lib/shopping';

export type PlanItemInput = {
  recipe_id: string;
  times_per_period: number;
  servings_per_time: number;
};

export type CreatePlanInput = {
  name: string;
  start_date: string;
  end_date: string;
  notes: string | null;
  items: PlanItemInput[];
};

export async function createPlan(input: CreatePlanInput): Promise<{ id: string }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (!input.start_date || !input.end_date) throw new Error('Start and end dates are required');
  if (input.end_date < input.start_date) throw new Error('End date must be after start date');
  if (input.items.length === 0) throw new Error('Add at least one recipe to the plan');

  const { data: plan, error } = await supabase
    .from('meal_plans')
    .insert({
      user_id: user.id,
      name: input.name.trim() || null,
      start_date: input.start_date,
      end_date: input.end_date,
      notes: input.notes?.trim() || null
    })
    .select('id')
    .single();
  if (error || !plan) throw new Error(`Failed to create plan: ${error?.message}`);

  const itemRows = input.items.map(i => ({
    plan_id: plan.id,
    recipe_id: i.recipe_id,
    times_per_period: i.times_per_period,
    servings_per_time: i.servings_per_time
  }));

  const { error: itemError } = await supabase.from('plan_items').insert(itemRows);
  if (itemError) throw new Error(`Failed to add plan items: ${itemError.message}`);

  revalidatePath('/plan');
  return { id: plan.id };
}

export async function deletePlan(planId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from('meal_plans').delete().eq('id', planId);
  if (error) throw new Error(error.message);
  revalidatePath('/plan');
  redirect('/plan');
}

/**
 * Generate a draft shopping list from a plan, for the review screen.
 *
 * Every recipe amount is scaled by (times_per_period * servings_per_time /
 * servings_yield) and converted to the ingredient's base unit (grams or a
 * count), so the same ingredient always becomes ONE line no matter which units
 * the recipes used. Amounts with no known conversion ("1 can" of something
 * with no can size yet) stay on that same line as unresolved parts, and the
 * shopping page asks for the missing size once.
 *
 * Each line lands in one review section:
 *   buy:     not in the pantry, or the pantry has less than needed (selected)
 *   similar: not in the pantry, but something in it could stand in
 *   low:     status-tracked items running low or out, needed or not
 *   have:    fully covered by the pantry
 * A needed status-tracked item that is out goes to buy instead of low.
 */
export async function generateShoppingList(planId: string): Promise<{ id: string }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: planItems, error: piError } = await supabase
    .from('plan_items')
    .select(`
      times_per_period,
      servings_per_time,
      recipes (
        servings_yield,
        recipe_ingredients ( quantity, unit, ingredient_id )
      )
    `)
    .eq('plan_id', planId);
  if (piError) throw new Error(`Could not load plan: ${piError.message}`);
  if (!planItems || planItems.length === 0) throw new Error('Plan has no items');

  const items = (planItems as unknown) as Array<{
    times_per_period: number;
    servings_per_time: number;
    recipes: {
      servings_yield: number;
      recipe_ingredients: Array<{ quantity: number | null; unit: string | null; ingredient_id: string }>;
    } | null;
  }>;

  const { data: pantryRows } = await supabase
    .from('pantry')
    .select('ingredient_id, quantity_on_hand, unit, status')
    .eq('user_id', user.id);
  const pantry = new Map((pantryRows ?? []).map(p => [p.ingredient_id as string, p]));

  const ingredientIds = items.flatMap(i => i.recipes?.recipe_ingredients.map(ri => ri.ingredient_id) ?? []);
  const units = await loadIngredientUnits(supabase, [...ingredientIds, ...Array.from(pantry.keys())], user.id);

  // Aggregate by ingredient only. "To taste" lines still put the ingredient on
  // the list, with no amount.
  const needs = new Map<string, Need>();
  for (const item of items) {
    if (!item.recipes) continue;
    const scaleFactor = (item.times_per_period * item.servings_per_time) / Math.max(1, item.recipes.servings_yield);
    for (const ri of item.recipes.recipe_ingredients ?? []) {
      const ing = units.get(ri.ingredient_id);
      if (!ing) continue;
      const need = needs.get(ri.ingredient_id) ?? emptyNeed();
      needs.set(ri.ingredient_id, ri.quantity === null ? need : addToNeed(need, Number(ri.quantity) * scaleFactor, ri.unit, ing));
    }
  }

  type Row = {
    ingredient_id: string;
    section: ShoppingSection;
    selected: boolean;
    quantity_needed: number;
    gross_base: number;
    unresolved: Need['unresolved'];
    suggestions: Substitute[];
  };
  const rows: Row[] = [];
  const noneOnHand = new Map<string, string>();

  for (const [ingredientId, need] of Array.from(needs.entries())) {
    const ing = units.get(ingredientId)!;
    const row = pantry.get(ingredientId);
    const base = { ingredient_id: ingredientId, gross_base: need.base, unresolved: need.unresolved, suggestions: [] };

    if (ing.tracking_mode === 'status') {
      const status = pantryStatusOf(row);
      const section = status === 'out' ? 'buy' : status === 'low' ? 'low' : 'have';
      rows.push({ ...base, section, selected: section === 'buy', quantity_needed: 0, unresolved: [] });
      continue;
    }

    const qty = row ? Number(row.quantity_on_hand) : 0;
    // A pantry row in a unit we can't convert isn't subtracted; the item stays
    // on the list at its full amount.
    const have = row ? toBase(qty, row.unit, ing) ?? 0 : 0;
    const net = Math.max(0, need.base - have);
    const toTasteOnly = need.base === 0 && need.unresolved.length === 0;

    if (qty > 0 && (toTasteOnly || (net <= 1e-9 && need.unresolved.length === 0))) {
      rows.push({ ...base, section: 'have', selected: false, quantity_needed: 0 });
      continue;
    }
    if (qty <= 0) noneOnHand.set(ingredientId, ing.name);
    rows.push({ ...base, section: 'buy', selected: true, quantity_needed: net });
  }

  // Status-tracked staples running low or out, even when no recipe needs them.
  for (const [ingredientId, row] of Array.from(pantry.entries())) {
    const ing = units.get(ingredientId);
    if (!ing || ing.tracking_mode !== 'status' || needs.has(ingredientId)) continue;
    if (pantryStatusOf(row) === 'have') continue;
    rows.push({
      ingredient_id: ingredientId, section: 'low', selected: false,
      quantity_needed: 0, gross_base: 0, unresolved: [], suggestions: []
    });
  }

  // One Claude call: what in the pantry could stand in for things with none on hand.
  const available = new Map<string, string>();
  for (const [ingredientId, row] of Array.from(pantry.entries())) {
    const ing = units.get(ingredientId);
    if (!ing || noneOnHand.has(ingredientId)) continue;
    const onHand = ing.tracking_mode === 'status' ? pantryStatusOf(row) !== 'out' : Number(row.quantity_on_hand) > 0;
    if (onHand) available.set(ingredientId, ing.name);
  }
  const substitutes = await suggestSubstitutes(noneOnHand, available);
  for (const row of rows) {
    const subs = substitutes.get(row.ingredient_id);
    if (row.section === 'buy' && subs) {
      row.section = 'similar';
      row.selected = false;
      row.suggestions = subs;
    }
  }

  // A regenerated list replaces any earlier draft for this plan.
  await supabase.from('shopping_lists').delete().eq('plan_id', planId).is('finalized_at', null);

  const { data: list, error: listError } = await supabase
    .from('shopping_lists')
    .insert({ user_id: user.id, plan_id: planId, finalized_at: null })
    .select('id')
    .single();
  if (listError || !list) throw new Error(`Could not create list: ${listError?.message}`);

  if (rows.length > 0) {
    const { error: itemError } = await supabase.from('shopping_items').insert(rows.map(r => {
      const ing = units.get(r.ingredient_id)!;
      return { ...r, list_id: list.id, unit: ing.base_unit, store_section: ing.category };
    }));
    if (itemError) throw new Error(`Could not add items: ${itemError.message}`);
  }

  revalidatePath('/shopping');
  return { id: list.id };
}
