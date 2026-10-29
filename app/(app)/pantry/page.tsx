import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { loadIngredientUnits } from '@/app/lib/ingredients';
import { cookingDisplay, formatAmount, pantryStatusOf, toBase, type PantryStatus, type TrackingMode } from '@/app/lib/units';
import PantryClient from './pantry-client';

export const dynamic = 'force-dynamic';

export type PantryRow = {
  id: string;
  ingredient_id: string;
  canonical_name: string;
  category: string;
  /** Cooking-unit display, e.g. "2 tbsp", "3 cloves", "450 g". */
  amountText: string;
  /** Pre-fills the edit input, in `editUnit`. */
  editValue: number;
  editUnit: string;
  isEmpty: boolean;
  mode: TrackingMode;
  /** For status-tracked rows. */
  status: PantryStatus;
  expiration_date: string | null;
  last_updated: string;
};

export default async function PantryPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data } = await supabase
    .from('pantry')
    .select('id, ingredient_id, quantity_on_hand, unit, status, expiration_date, last_updated, ingredients(canonical_name, category)')
    .eq('user_id', user.id)
    .order('last_updated', { ascending: false });

  const raw = (data ?? []) as unknown as Array<{
    id: string;
    ingredient_id: string;
    quantity_on_hand: number;
    unit: string | null;
    status: string | null;
    expiration_date: string | null;
    last_updated: string;
    ingredients: { canonical_name: string; category: string } | null;
  }>;
  const units = await loadIngredientUnits(supabase, raw.map(r => r.ingredient_id), user.id);

  const rows: PantryRow[] = raw.map(r => {
    const ing = units.get(r.ingredient_id);
    const qty = Number(r.quantity_on_hand);
    const base = ing ? toBase(qty, r.unit, ing) : null;
    // Rows in a unit we can't convert show exactly as entered.
    const disp = base != null && ing
      ? cookingDisplay(base, ing)
      : { text: formatAmount(qty, r.unit ?? ''), value: qty, unit: r.unit ?? '' };
    return {
      id: r.id,
      ingredient_id: r.ingredient_id,
      canonical_name: r.ingredients?.canonical_name ?? 'unknown',
      category: r.ingredients?.category ?? 'other',
      amountText: disp.text,
      editValue: disp.value,
      editUnit: disp.unit,
      mode: ing?.tracking_mode ?? 'measured',
      status: pantryStatusOf(r),
      isEmpty: ing?.tracking_mode === 'status' ? pantryStatusOf(r) === 'out' : qty <= 0,
      expiration_date: r.expiration_date,
      last_updated: r.last_updated
    };
  });

  return <PantryClient rows={rows} />;
}
