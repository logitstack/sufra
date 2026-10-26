'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { addToNeed, emptyNeed, toBase, type Need } from '@/app/lib/units';
import { loadIngredientUnits } from '@/app/lib/ingredients';

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
 * Generate a shopping list from a plan.
 *
 * Every recipe amount is scaled by (times_per_period * servings_per_time /
 * servings_yield) and converted to the ingredient's base unit (grams or a
 * count), so the same ingredient always becomes ONE line no matter which units
 * the recipes used. Amounts with no known conversion ("1 can" of something
 * with no can size yet) stay on that same line as unresolved parts, and the
 * shopping page asks for the missing size once.
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

  const ingredientIds = items.flatMap(i => i.recipes?.recipe_ingredients.map(ri => ri.ingredient_id) ?? []);
  const units = await loadIngredientUnits(supabase, ingredientIds, user.id);

  // Aggregate by ingredient only.
  const needs = new Map<string, Need>();
  for (const item of items) {
    if (!item.recipes) continue;
    const scaleFactor = (item.times_per_period * item.servings_per_time) / Math.max(1, item.recipes.servings_yield);
    for (const ri of item.recipes.recipe_ingredients ?? []) {
      if (ri.quantity === null) continue;  // "to taste"
      const ing = units.get(ri.ingredient_id);
      if (!ing) continue;
      const need = needs.get(ri.ingredient_id) ?? emptyNeed();
      needs.set(ri.ingredient_id, addToNeed(need, Number(ri.quantity) * scaleFactor, ri.unit, ing));
    }
  }

  // Subtract pantry in base units. A pantry row in a unit we can't convert is
  // left alone; the shopping page shows it as a hint under the item.
  const { data: pantry } = await supabase
    .from('pantry')
    .select('ingredient_id, quantity_on_hand, unit')
    .eq('user_id', user.id);
  const pantryBase = new Map<string, number>();
  for (const p of pantry ?? []) {
    const ing = units.get(p.ingredient_id);
    if (!ing || !needs.has(p.ingredient_id)) continue;
    const base = toBase(Number(p.quantity_on_hand), p.unit, ing);
    if (base != null) pantryBase.set(p.ingredient_id, (pantryBase.get(p.ingredient_id) ?? 0) + base);
  }

  const { data: list, error: listError } = await supabase
    .from('shopping_lists')
    .insert({ user_id: user.id, plan_id: planId })
    .select('id')
    .single();
  if (listError || !list) throw new Error(`Could not create list: ${listError?.message}`);

  const itemRows = [];
  for (const [ingredientId, need] of Array.from(needs.entries())) {
    const ing = units.get(ingredientId)!;
    const net = Math.max(0, need.base - (pantryBase.get(ingredientId) ?? 0));
    if (net <= 1e-9 && need.unresolved.length === 0) continue;  // Pantry covers it
    itemRows.push({
      list_id: list.id,
      ingredient_id: ingredientId,
      quantity_needed: net,
      gross_base: need.base,
      unit: ing.base_unit,
      unresolved: need.unresolved,
      store_section: ing.category
    });
  }

  if (itemRows.length > 0) {
    const { error: itemError } = await supabase.from('shopping_items').insert(itemRows);
    if (itemError) throw new Error(`Could not add items: ${itemError.message}`);
  }

  revalidatePath('/shopping');
  return { id: list.id };
}
