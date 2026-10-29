/**
 * Pantry writes. Server only.
 *
 * Pantry rows written by the app store the ingredient's base unit: unit 'g'
 * for weighed ingredients, unit null (a plain count) for counted ones. Older
 * rows in other units still read fine through toBase().
 */

import type { createServerSupabase } from './supabase-server';
import { toBase, type IngredientUnits, type PantryStatus } from './units';

type Supabase = ReturnType<typeof createServerSupabase>;

export function pantryUnit(ing: IngredientUnits): string | null {
  return ing.base_unit === 'g' ? 'g' : null;
}

/**
 * Add (or with a negative amount, remove) `deltaBase` base units of an
 * ingredient. Floors at zero. If the existing row's unit can't be converted,
 * removals are skipped and additions rewrite the row in base units starting
 * from this amount.
 *
 * Status-tracked ingredients ignore amounts: removals do nothing and any
 * addition (a purchase) sets the row to 'have'.
 *
 * With `purchased`, the row records today as its purchase date, unless it
 * still had stock, in which case the older date stands (oldest stock is what
 * "use it up" cares about).
 */
export async function adjustPantry(
  supabase: Supabase,
  userId: string,
  ing: IngredientUnits,
  deltaBase: number,
  { purchased = false }: { purchased?: boolean } = {}
): Promise<void> {
  if (ing.tracking_mode === 'status') {
    if (deltaBase > 0) await setPantryStatus(supabase, userId, ing, 'have', { purchased });
    return;
  }

  const { data: existing } = await supabase
    .from('pantry')
    .select('id, quantity_on_hand, unit, purchased_at')
    .eq('user_id', userId)
    .eq('ingredient_id', ing.id)
    .maybeSingle();

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  if (existing) {
    const converted = toBase(Number(existing.quantity_on_hand), existing.unit, ing);
    if (converted == null && deltaBase < 0) return;  // can't subtract from an unknown unit
    const have = converted ?? 0;
    const purchased_at = purchased && (have <= 0 || !existing.purchased_at) ? today : existing.purchased_at;
    await supabase
      .from('pantry')
      .update({ quantity_on_hand: Math.max(0, have + deltaBase), unit: pantryUnit(ing), last_updated: now, purchased_at })
      .eq('id', existing.id);
  } else if (deltaBase > 0) {
    await supabase.from('pantry').insert({
      user_id: userId,
      ingredient_id: ing.id,
      quantity_on_hand: deltaBase,
      unit: pantryUnit(ing),
      last_updated: now,
      purchased_at: purchased ? today : null
    });
  }
}

/**
 * Set a status-tracked ingredient to have / low / out, creating the pantry row
 * if needed. With `purchased`, today becomes its purchase date.
 */
export async function setPantryStatus(
  supabase: Supabase,
  userId: string,
  ing: IngredientUnits,
  status: PantryStatus,
  { purchased = false }: { purchased?: boolean } = {}
): Promise<void> {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    user_id: userId,
    ingredient_id: ing.id,
    status,
    last_updated: now
  };
  if (purchased) row.purchased_at = now.slice(0, 10);

  const { data: existing } = await supabase
    .from('pantry')
    .select('id')
    .eq('user_id', userId)
    .eq('ingredient_id', ing.id)
    .maybeSingle();

  const { error } = existing
    ? await supabase.from('pantry').update(row).eq('id', existing.id)
    : await supabase.from('pantry').insert({ ...row, quantity_on_hand: 0, unit: pantryUnit(ing) });
  if (error) throw new Error(`Could not update ${ing.name}: ${error.message}`);
}
