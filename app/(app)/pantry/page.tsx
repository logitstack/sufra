import { createServerSupabase } from '@/app/lib/supabase-server';
import PantryClient from './pantry-client';

export const dynamic = 'force-dynamic';

export type PantryRow = {
  id: string;
  ingredient_id: string;
  canonical_name: string;
  category: string;
  quantity_on_hand: number;
  unit: string | null;
  expiration_date: string | null;
  last_updated: string;
};

export default async function PantryPage() {
  const supabase = createServerSupabase();
  const { data } = await supabase
    .from('pantry')
    .select('id, ingredient_id, quantity_on_hand, unit, expiration_date, last_updated, ingredients(canonical_name, category)')
    .order('last_updated', { ascending: false });

  const rows: PantryRow[] = ((data ?? []) as unknown as Array<{
    id: string;
    ingredient_id: string;
    quantity_on_hand: number;
    unit: string | null;
    expiration_date: string | null;
    last_updated: string;
    ingredients: { canonical_name: string; category: string } | null;
  }>).map(r => ({
    id: r.id,
    ingredient_id: r.ingredient_id,
    canonical_name: r.ingredients?.canonical_name ?? 'unknown',
    category: r.ingredients?.category ?? 'other',
    quantity_on_hand: r.quantity_on_hand,
    unit: r.unit,
    expiration_date: r.expiration_date,
    last_updated: r.last_updated
  }));

  return <PantryClient rows={rows} />;
}
