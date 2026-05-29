'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { revalidatePath } from 'next/cache';
import { normalizeWithDensity, fromBase } from '@/app/lib/units';

/**
 * Toggle an item's checked state. When checking ON, add it to the pantry.
 *
 * `overrideBaseQty` (in the item's stored base unit — grams / ml / count) is
 * supplied when the shopper edited the amount at checkoff; it replaces the
 * listed quantity both on the item and in what's added to the pantry.
 */
export async function toggleShoppingItem(
  itemId: string,
  checked: boolean,
  overrideBaseQty?: number
) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data: item } = await supabase
    .from('shopping_items')
    .select('ingredient_id, quantity_needed, unit, list_id, ingredients(density_g_per_ml)')
    .eq('id', itemId)
    .single();

  if (!item) throw new Error('Item not found');

  const density =
    ((item.ingredients as unknown) as { density_g_per_ml: number | null } | null)?.density_g_per_ml ?? null;
  const baseQty = overrideBaseQty != null && overrideBaseQty >= 0 ? overrideBaseQty : item.quantity_needed;

  // Persist checked state; if the amount was edited at checkoff, store it too.
  const updates: Record<string, unknown> = { checked };
  if (overrideBaseQty != null) updates.quantity_needed = baseQty;
  const { error } = await supabase.from('shopping_items').update(updates).eq('id', itemId);
  if (error) throw new Error(error.message);

  // If checking, add the (possibly edited) amount to the pantry, converting
  // into whatever unit the pantry row already uses.
  if (checked) {
    const incoming = normalizeWithDensity(baseQty, item.unit, density);
    const { data: existing } = await supabase
      .from('pantry')
      .select('id, quantity_on_hand, unit')
      .eq('user_id', user.id)
      .eq('ingredient_id', item.ingredient_id)
      .maybeSingle();

    if (existing) {
      const have = normalizeWithDensity(existing.quantity_on_hand, existing.unit, density);
      const newQty = have.type === incoming.type
        ? fromBase(have.value + incoming.value, existing.unit, density)
        : existing.quantity_on_hand + baseQty;  // incompatible units — best effort
      await supabase
        .from('pantry')
        .update({ quantity_on_hand: newQty, last_updated: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('pantry').insert({
        user_id: user.id,
        ingredient_id: item.ingredient_id,
        quantity_on_hand: baseQty,
        unit: item.unit,
        last_updated: new Date().toISOString()
      });
    }
  }

  revalidatePath(`/shopping/${item.list_id}`);
  revalidatePath('/pantry');
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
