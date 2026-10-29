'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { loadIngredientUnits } from '@/app/lib/ingredients';
import { adjustPantry, setPantryStatus } from '@/app/lib/pantry';
import { conversionFromAnswer, purchaseDisplay, sizeLabel, toBase, type UnresolvedPart } from '@/app/lib/units';

export type Bought = {
  /** How many packages. 0 means "check off, add nothing". */
  packages: number;
  /** Size of one package; null for a plain count. */
  size_quantity: number | null;
  size_unit: string;
};

/**
 * Toggle an item's checked state. When checking ON, add what was bought to the
 * pantry. That can differ from what the list needed: buy a 1 kg bag when the
 * recipes need 15 g and the pantry gets 1 kg.
 *
 * If the shopper's package size differs from the usual one (or there was
 * none), it becomes the usual size for next time. Without `bought`, the whole
 * packages the list showed are assumed. Status-tracked items are simply set
 * to "have it".
 */
export async function toggleShoppingItem(itemId: string, checked: boolean, bought?: Bought) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: item } = await supabase
    .from('shopping_items')
    .select('ingredient_id, quantity_needed, unit, list_id')
    .eq('id', itemId)
    .single();
  if (!item) throw new Error('Item not found');

  const ing = checked ? (await loadIngredientUnits(supabase, [item.ingredient_id], user.id)).get(item.ingredient_id) : undefined;

  let amount = 0;
  if (ing?.tracking_mode === 'status') {
    // No amount to track: buying it just means "have it".
    await setPantryStatus(supabase, user.id, ing, 'have', { purchased: true });
  } else if (ing && bought && bought.packages > 0) {
    const perPackage = bought.size_quantity != null ? toBase(bought.size_quantity, bought.size_unit, ing) : toBase(1, '', ing);
    if (perPackage == null) {
      throw new Error(ing.base_unit === 'count'
        ? `Enter how many ${ing.name} are in each package`
        : `Enter the size by weight (g, oz, lb, kg) for ${ing.name}`);
    }
    amount = Math.max(0, bought.packages) * perPackage;

    const changed = !ing.purchase || Math.abs(ing.purchase.size - perPackage) > perPackage * 0.001;
    if (bought.size_quantity != null && changed) {
      await supabase.from('user_purchase_sizes').upsert({
        user_id: user.id,
        ingredient_id: ing.id,
        unit: ing.purchase?.unit ?? 'package',
        size: perPackage,
        label: sizeLabel(bought.size_quantity, bought.size_unit),
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,ingredient_id' });
    }
  } else if (ing && !bought) {
    const needed = toBase(Number(item.quantity_needed), item.unit, ing) ?? 0;
    amount = needed > 0 ? purchaseDisplay(needed, ing).purchaseBase : 0;
  }

  const { error } = await supabase.from('shopping_items').update({ checked }).eq('id', itemId);
  if (error) throw new Error(error.message);

  if (ing && ing.tracking_mode !== 'status' && amount > 0) {
    await adjustPantry(supabase, user.id, ing, amount, { purchased: true });
  }

  revalidatePath(`/shopping/${item.list_id}`);
  revalidatePath('/pantry');
}

/**
 * Answer a missing-size question for one unresolved part of a shopping item
 * ("How much sweetened condensed milk is in 1 can?"). Saves the conversion for
 * this user so it is never asked again, then folds that part into the item's
 * base amount and re-subtracts the pantry.
 */
export async function resolveShoppingUnit(itemId: string, unit: string, answerQty: number, answerUnit: string) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: item } = await supabase
    .from('shopping_items')
    .select('ingredient_id, quantity_needed, gross_base, unit, unresolved, list_id')
    .eq('id', itemId)
    .single();
  if (!item) throw new Error('Item not found');

  const ing = (await loadIngredientUnits(supabase, [item.ingredient_id], user.id)).get(item.ingredient_id);
  if (!ing) throw new Error('Ingredient not found');

  const conversion = conversionFromAnswer(unit, answerQty, answerUnit, ing);
  if (!conversion) throw new Error('Enter a size greater than zero');

  // Replace any earlier answer for this unit. (The unique index is partial, so
  // upsert can't target it.)
  await supabase.from('ingredient_conversions').delete()
    .eq('user_id', user.id).eq('ingredient_id', ing.id).eq('unit', conversion.unit);
  const { error: convError } = await supabase.from('ingredient_conversions').insert(
    { user_id: user.id, ingredient_id: ing.id, unit: conversion.unit, base_per_unit: conversion.base_per_unit }
  );
  if (convError) throw new Error(convError.message);
  ing.conversions[conversion.unit] = conversion.base_per_unit;

  // Re-split the parts with the new conversion; some may still be unknown.
  let gross = item.gross_base != null ? Number(item.gross_base) : toBase(Number(item.quantity_needed), item.unit, ing) ?? 0;
  const stillUnresolved: UnresolvedPart[] = [];
  for (const part of (item.unresolved ?? []) as UnresolvedPart[]) {
    const base = toBase(part.quantity, part.unit, ing);
    if (base != null) gross += base;
    else stillUnresolved.push(part);
  }

  const { data: pantryRow } = await supabase
    .from('pantry')
    .select('quantity_on_hand, unit')
    .eq('user_id', user.id)
    .eq('ingredient_id', ing.id)
    .maybeSingle();
  const have = pantryRow ? toBase(Number(pantryRow.quantity_on_hand), pantryRow.unit, ing) ?? 0 : 0;

  const { error } = await supabase
    .from('shopping_items')
    .update({
      quantity_needed: Math.max(0, gross - have),
      gross_base: gross,
      unit: ing.base_unit,
      unresolved: stillUnresolved
    })
    .eq('id', itemId);
  if (error) throw new Error(error.message);

  revalidatePath(`/shopping/${item.list_id}`);
}

export type ReviewChoice = {
  itemId: string;
  selected: boolean;
  substitute_ingredient_id: string | null;
};

/**
 * Finish the review screen: keep the selected items on the list, and record
 * picked substitutes on the plan so "I cooked this" deducts from them.
 * Every "you may have something similar" item needs either a check or a
 * substitute; the names of any that have neither come back unresolved.
 */
export async function finalizeShoppingList(listId: string, choices: ReviewChoice[]): Promise<{ ok: true } | { ok: false; unresolved: string[] }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: list } = await supabase
    .from('shopping_lists')
    .select('id, plan_id, shopping_items ( id, ingredient_id, section, suggestions, ingredients ( canonical_name ) )')
    .eq('id', listId)
    .single();
  if (!list) throw new Error('List not found');

  const items = (list.shopping_items ?? []) as unknown as Array<{
    id: string;
    ingredient_id: string;
    section: string;
    suggestions: Array<{ ingredient_id: string }>;
    ingredients: { canonical_name: string } | null;
  }>;
  const choiceById = new Map(choices.map(c => [c.itemId, c]));

  const unresolved = items
    .filter(i => i.section === 'similar')
    .filter(i => {
      const c = choiceById.get(i.id);
      return !c || (!c.selected && !c.substitute_ingredient_id);
    })
    .map(i => i.ingredients?.canonical_name ?? 'an item');
  if (unresolved.length > 0) return { ok: false, unresolved };

  for (const item of items) {
    const c = choiceById.get(item.id);
    if (!c) continue;
    // Only a suggested pantry item can be picked as a substitute.
    const substitute = c.substitute_ingredient_id && item.suggestions.some(s => s.ingredient_id === c.substitute_ingredient_id)
      ? c.substitute_ingredient_id
      : null;
    const { error } = await supabase
      .from('shopping_items')
      .update({ selected: c.selected, substitute_ingredient_id: substitute })
      .eq('id', item.id);
    if (error) throw new Error(error.message);

    if (list.plan_id) {
      if (substitute) {
        await supabase.from('plan_substitutions').upsert(
          { plan_id: list.plan_id, ingredient_id: item.ingredient_id, substitute_ingredient_id: substitute },
          { onConflict: 'plan_id,ingredient_id' }
        );
      } else {
        await supabase.from('plan_substitutions').delete().eq('plan_id', list.plan_id).eq('ingredient_id', item.ingredient_id);
      }
    }
  }

  const { error } = await supabase.from('shopping_lists').update({ finalized_at: new Date().toISOString() }).eq('id', listId);
  if (error) throw new Error(error.message);

  revalidatePath('/shopping');
  revalidatePath(`/shopping/${listId}`);
  return { ok: true };
}

export async function completeShoppingList(listId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase
    .from('shopping_lists')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', listId);
  if (error) throw new Error(error.message);
  revalidatePath('/shopping');
}

export async function deleteShoppingList(listId: string) {
  const supabase = createServerSupabase();
  const { error } = await supabase.from('shopping_lists').delete().eq('id', listId);
  if (error) throw new Error(error.message);
  revalidatePath('/shopping');
}
