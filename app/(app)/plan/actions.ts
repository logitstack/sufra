'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeWithDensity, subtract, add, type NormalizedQuantity } from '@/app/lib/units';

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
 * For each plan_item: pull recipe_ingredients, scale by (times_per_period * servings_per_time / recipe.servings_yield).
 * Aggregate by ingredient_id, then subtract pantry quantities.
 */
export async function generateShoppingList(planId: string): Promise<{ id: string }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  // Fetch plan items with recipes and ingredients
  const { data: planItems, error: piError } = await supabase
    .from('plan_items')
    .select(`
      times_per_period,
      servings_per_time,
      recipes (
        id,
        servings_yield,
        recipe_ingredients (
          quantity,
          unit,
          ingredient_id,
          ingredients ( canonical_name, category, density_g_per_ml )
        )
      )
    `)
    .eq('plan_id', planId);
  if (piError) throw new Error(`Could not load plan: ${piError.message}`);
  if (!planItems || planItems.length === 0) throw new Error('Plan has no items');

  // Aggregate
  type AggKey = string;
  const aggregate = new Map<AggKey, {
    ingredientId: string;
    canonical: string;
    category: string;
    density: number | null;
    byType: Map<string, NormalizedQuantity>;  // type -> normalized
  }>();

  for (const item of (planItems as unknown) as Array<{
    times_per_period: number;
    servings_per_time: number;
    recipes: {
      id: string;
      servings_yield: number;
      recipe_ingredients: Array<{
        quantity: number | null;
        unit: string | null;
        ingredient_id: string;
        ingredients: { canonical_name: string; category: string; density_g_per_ml: number | null };
      }>;
    } | null;
  }>) {
    if (!item.recipes) continue;
    const recipe = item.recipes;
    const scaleFactor = (item.times_per_period * item.servings_per_time) / Math.max(1, recipe.servings_yield);

    for (const ri of recipe.recipe_ingredients ?? []) {
      if (ri.quantity === null) continue;
      const density = ri.ingredients?.density_g_per_ml ?? null;
      const scaled = ri.quantity * scaleFactor;
      const norm = normalizeWithDensity(scaled, ri.unit, density);
      const key = ri.ingredient_id;

      let entry = aggregate.get(key);
      if (!entry) {
        entry = {
          ingredientId: ri.ingredient_id,
          canonical: ri.ingredients?.canonical_name ?? 'unknown',
          category: ri.ingredients?.category ?? 'other',
          density,
          byType: new Map()
        };
        aggregate.set(key, entry);
      }
      const existing = entry.byType.get(norm.type);
      entry.byType.set(norm.type, existing ? add(existing, norm) : norm);
    }
  }

  // Subtract pantry
  const { data: pantry } = await supabase
    .from('pantry')
    .select('ingredient_id, quantity_on_hand, unit')
    .eq('user_id', user.id);

  for (const p of pantry ?? []) {
    const entry = aggregate.get(p.ingredient_id);
    if (!entry) continue;
    const have = normalizeWithDensity(p.quantity_on_hand, p.unit, entry.density);
    const needed = entry.byType.get(have.type);
    if (needed) {
      entry.byType.set(have.type, subtract(needed, have));
    }
  }

  // Create shopping list
  const { data: list, error: listError } = await supabase
    .from('shopping_lists')
    .insert({ user_id: user.id, plan_id: planId })
    .select('id')
    .single();
  if (listError || !list) throw new Error(`Could not create list: ${listError?.message}`);

  // Insert items
  const itemRows: Array<{
    list_id: string;
    ingredient_id: string;
    quantity_needed: number;
    unit: string;
    store_section: string;
  }> = [];
  for (const entry of Array.from(aggregate.values())) {
    for (const [type, q] of Array.from(entry.byType.entries())) {
      if (q.value <= 0) continue;  // Pantry covers it
      itemRows.push({
        list_id: list.id,
        ingredient_id: entry.ingredientId,
        quantity_needed: q.value,
        unit: type === 'volume' ? 'ml' : type === 'weight' ? 'g' : (q.originalUnit || ''),
        store_section: entry.category
      });
    }
  }

  if (itemRows.length > 0) {
    const { error: itemError } = await supabase.from('shopping_items').insert(itemRows);
    if (itemError) throw new Error(`Could not add items: ${itemError.message}`);
  }

  revalidatePath('/shopping');
  return { id: list.id };
}
