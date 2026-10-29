import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { loadIngredientUnits } from '@/app/lib/ingredients';
import { lineAmount, type ShoppingSection } from '@/app/lib/shopping';
import { cookingDisplay, pantryStatusOf, STATUS_LABEL, toBase, type UnresolvedPart } from '@/app/lib/units';
import type { Substitute } from '@/app/lib/substitutes';
import ReviewClient, { type ReviewItem } from './review-client';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: list } = await supabase
    .from('shopping_lists')
    .select(`
      id, finalized_at,
      shopping_items ( id, ingredient_id, quantity_needed, unit, unresolved, section, selected, suggestions, substitute_ingredient_id ),
      meal_plans ( name )
    `)
    .eq('id', params.id)
    .single();
  if (!list) notFound();
  if (list.finalized_at) redirect(`/shopping/${list.id}`);

  const rows = (list.shopping_items ?? []) as unknown as Array<{
    id: string;
    ingredient_id: string;
    quantity_needed: number;
    unit: string | null;
    unresolved: UnresolvedPart[] | null;
    section: ShoppingSection;
    selected: boolean;
    suggestions: Substitute[] | null;
    substitute_ingredient_id: string | null;
  }>;

  const { data: pantryRows } = await supabase
    .from('pantry')
    .select('ingredient_id, quantity_on_hand, unit, status')
    .eq('user_id', user.id)
    .in('ingredient_id', rows.map(r => r.ingredient_id));
  const pantry = new Map((pantryRows ?? []).map(p => [p.ingredient_id as string, p]));
  const units = await loadIngredientUnits(supabase, rows.map(r => r.ingredient_id), user.id);

  const items: ReviewItem[] = rows.flatMap(r => {
    const ing = units.get(r.ingredient_id);
    if (!ing) return [];
    const p = pantry.get(r.ingredient_id);

    // What's on hand, for context under the line.
    let haveText: string | null = null;
    if (ing.tracking_mode === 'status') {
      haveText = STATUS_LABEL[pantryStatusOf(p)];
    } else if (p && Number(p.quantity_on_hand) > 0) {
      const base = toBase(Number(p.quantity_on_hand), p.unit, ing);
      if (base != null) haveText = `You have ${cookingDisplay(base, ing).text}`;
    }

    return [{
      id: r.id,
      name: ing.name,
      section: r.section,
      selected: r.selected,
      qtyText: r.section === 'have' ? '' : lineAmount(r, ing).text,
      haveText,
      suggestions: r.suggestions ?? [],
      substitute: r.substitute_ingredient_id
    }];
  }).sort((a, b) => a.name.localeCompare(b.name));

  const plan = list.meal_plans as unknown as { name: string | null } | null;

  return (
    <main className="max-w-3xl mx-auto px-5 sm:px-8 pb-32">
      <div className="pt-6 pb-4">
        <Link href="/shopping" className="inline-flex items-center gap-1.5 text-xs tracking-wide text-beige-700 hover:text-maroon-900 transition">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
          Shopping
        </Link>
      </div>

      <div className="mb-8">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Review list</p>
        <h1 className="font-display text-4xl sm:text-5xl text-maroon-900 leading-[0.95] mb-2">
          {plan?.name ?? 'Grocery list'}
        </h1>
        <p className="text-sm text-beige-700">Check what to buy, pick anything from your pantry to use instead, then tap OK.</p>
      </div>

      <ReviewClient listId={list.id} items={items} />
    </main>
  );
}
