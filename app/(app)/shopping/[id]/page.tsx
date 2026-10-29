import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createServerSupabase } from '@/app/lib/supabase-server';
import {
  commonSizes, conversionQuestion, formatAmount, purchaseDisplay, sizeForEdit,
  type IngredientUnits, type UnresolvedPart
} from '@/app/lib/units';
import { loadIngredientUnits } from '@/app/lib/ingredients';
import { lineAmount } from '@/app/lib/shopping';
import ShoppingClient, { type BuyPrefill, type ShoppingItem } from './shopping-client';

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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: list } = await supabase
    .from('shopping_lists')
    .select(`
      id, generated_at, completed_at, finalized_at, plan_id,
      shopping_items (
        id, ingredient_id, quantity_needed, unit, unresolved, checked, selected, store_section
      ),
      meal_plans ( name, start_date, end_date )
    `)
    .eq('id', params.id)
    .single();

  if (!list) notFound();
  if (!list.finalized_at) redirect(`/shopping/${list.id}/review`);

  const listItems = ((list.shopping_items ?? []) as unknown as Array<{
    id: string;
    ingredient_id: string;
    quantity_needed: number;
    unit: string | null;
    unresolved: UnresolvedPart[] | null;
    checked: boolean;
    selected: boolean;
    store_section: string | null;
  }>).filter(i => i.selected);

  const units = await loadIngredientUnits(supabase, listItems.map(i => i.ingredient_id), user.id);

  type Item = ShoppingItem & { section: string };

  const items: Item[] = listItems.flatMap(si => {
    const ing = units.get(si.ingredient_id);
    if (!ing) return [];
    const amount = lineAmount(si, ing);

    return [{
      id: si.id,
      name: ing.name,
      qtyText: amount.text,
      statusTracked: ing.tracking_mode === 'status',
      buy: buyPrefill(amount.base, ing),
      section: si.store_section || ing.category,
      checked: si.checked,
      questions: amount.unresolved.map(part => ({
        unit: part.unit,
        partText: formatAmount(part.quantity, part.unit),
        ...conversionQuestion(part.unit, ing)
      }))
    }];
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

/** What the "how much did you buy" prompt starts with. */
function buyPrefill(base: number, ing: IngredientUnits): BuyPrefill {
  const packageUnit = ing.purchase?.unit ?? 'package';
  if (ing.purchase) {
    const size = sizeForEdit(ing.purchase.size, ing, ing.purchase.label);
    const packages = base > 0 ? purchaseDisplay(base, ing).value : 1;
    return { packages, size_quantity: size.quantity, size_unit: size.unit, package_unit: packageUnit, known: true, countOnly: false, common: [] };
  }
  if (ing.base_unit === 'count') {
    return { packages: Math.max(1, Math.ceil(base - 1e-9)), size_quantity: null, size_unit: '', package_unit: ing.count_unit ?? '', known: true, countOnly: true, common: [] };
  }
  // Nothing known yet: suggest the rounded amount needed, plus common sizes.
  const p = base > 0 ? purchaseDisplay(base, ing) : null;
  return {
    packages: 1,
    size_quantity: p ? p.value : null,
    size_unit: p ? p.unit : 'g',
    package_unit: packageUnit,
    known: false,
    countOnly: false,
    common: commonSizes(ing)
  };
}
