import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { shoppingDisplay, type NormalizedQuantity } from '@/app/lib/units';
import ShoppingClient from './shopping-client';

export const dynamic = 'force-dynamic';

const SECTION_ORDER = ['produce', 'protein', 'dairy', 'grain', 'spice', 'pantry', 'condiment', 'other'];
const SECTION_LABELS: Record<string, string> = {
  produce: 'Produce',
  protein: 'Protein',
  dairy: 'Dairy',
  grain: 'Grains',
  spice: 'Spices',
  pantry: 'Pantry',
  condiment: 'Condiments',
  other: 'Other'
};

export default async function ShoppingDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabase();

  const { data: list } = await supabase
    .from('shopping_lists')
    .select(`
      id, generated_at, completed_at, plan_id,
      shopping_items (
        id, quantity_needed, unit, checked, store_section,
        ingredients ( canonical_name, category, density_g_per_ml )
      ),
      meal_plans ( name, start_date, end_date )
    `)
    .eq('id', params.id)
    .single();

  if (!list) notFound();

  type Item = {
    id: string;
    name: string;
    qtyText: string;      // "194 g" — read display
    qtyValue: number;     // 194 — pre-fills the edit input
    qtyUnit: string;      // "g" / "lb" / "ml" / count unit
    basePerUnit: number;  // editedValue * basePerUnit -> stored base quantity
    section: string;
    checked: boolean;
  };

  const items: Item[] = (((list.shopping_items ?? []) as unknown) as Array<{
    id: string;
    quantity_needed: number;
    unit: string;
    checked: boolean;
    store_section: string;
    ingredients: { canonical_name: string; category: string; density_g_per_ml: number | null } | null;
  }>).map(si => {
    const density = si.ingredients?.density_g_per_ml ?? null;
    const category = si.ingredients?.category ?? 'other';
    const name = si.ingredients?.canonical_name ?? 'unknown';
    const normalized: NormalizedQuantity = {
      type: si.unit === 'ml' ? 'volume' : si.unit === 'g' ? 'weight' : 'count',
      value: si.quantity_needed,
      originalUnit: si.unit || null
    };
    const disp = shoppingDisplay(normalized, category, name, density);
    return {
      id: si.id,
      name,
      qtyText: disp.text,
      qtyValue: disp.value,
      qtyUnit: disp.unit,
      basePerUnit: disp.basePerUnit,
      section: si.store_section || category,
      checked: si.checked
    };
  });

  // Group by section
  const sectionMap = new Map<string, Item[]>();
  for (const item of items) {
    const list = sectionMap.get(item.section) ?? [];
    list.push(item);
    sectionMap.set(item.section, list);
  }
  const sections = SECTION_ORDER
    .filter(s => sectionMap.has(s))
    .map(s => ({ key: s, label: SECTION_LABELS[s] ?? s, items: sectionMap.get(s)!.sort((a, b) => a.name.localeCompare(b.name)) }));

  // Catch any unmapped sections
  for (const [key, items] of Array.from(sectionMap.entries())) {
    if (!SECTION_ORDER.includes(key)) {
      sections.push({ key, label: SECTION_LABELS[key] ?? key, items });
    }
  }

  const plan = (list.meal_plans as unknown) as { name: string | null; start_date: string; end_date: string } | null;
  const totalCount = items.length;
  const checkedCount = items.filter(i => i.checked).length;

  return (
    <main className="max-w-3xl mx-auto px-5 sm:px-8 pb-32">
      <div className="pt-6 pb-4">
        <Link href="/shopping" className="inline-flex items-center gap-1.5 text-xs tracking-wide text-beige-700 hover:text-maroon-900 transition">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
          Shopping
        </Link>
      </div>

      <div className="mb-8">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Shopping list</p>
        <h1 className="font-display text-4xl sm:text-5xl text-maroon-900 leading-[0.95] mb-2">
          {plan?.name ?? (plan ? formatRange(plan.start_date, plan.end_date) : 'List')}
        </h1>
        <p className="text-sm text-beige-700">
          <span className="tnum">{checkedCount}/{totalCount}</span> checked off
        </p>
      </div>

      {totalCount === 0 ? (
        <div className="text-center py-12 border border-dashed border-beige-200 rounded-sm">
          <p className="font-display text-2xl text-maroon-900 mb-2">Pantry covers everything.</p>
          <p className="text-beige-700 text-sm">Nothing to buy for this plan.</p>
        </div>
      ) : (
        <ShoppingClient listId={list.id} sections={sections} isComplete={!!list.completed_at} />
      )}
    </main>
  );
}

function formatRange(start: string, end: string): string {
  const s = new Date(start), e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}
