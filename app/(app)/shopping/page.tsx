import Link from 'next/link';
import { createServerSupabase } from '@/app/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function ShoppingPage() {
  const supabase = createServerSupabase();
  const { data: lists } = await supabase
    .from('shopping_lists')
    .select(`
      id, generated_at, completed_at, finalized_at,
      shopping_items(selected),
      meal_plans(name, start_date, end_date)
    `)
    .order('generated_at', { ascending: false });

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-24 pt-10 sm:pt-16">
      <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Shopping</p>
      <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95] mb-10">
        What to <em className="font-medium">buy</em>.
      </h1>

      {!lists || lists.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-beige-200 rounded-sm">
          <p className="font-display text-3xl text-maroon-900 mb-3">No lists yet.</p>
          <p className="text-beige-700 text-sm mb-6 max-w-md mx-auto">
            Create a meal plan and generate a shopping list from it.
          </p>
          <Link
            href="/plan/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
          >
            Create a meal plan
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map(list => {
            const itemCount = (list.shopping_items as Array<{ selected: boolean }>).filter(i => i.selected).length;
            const isDraft = !list.finalized_at;
            const plan = (list.meal_plans as unknown) as { name: string | null; start_date: string; end_date: string } | null;
            const isComplete = !!list.completed_at;
            return (
              <Link
                key={list.id}
                href={isDraft ? `/shopping/${list.id}/review` : `/shopping/${list.id}`}
                className={`block p-5 bg-white border rounded-sm transition group ${isComplete ? 'border-beige-200 opacity-60' : 'border-beige-200 hover:border-maroon-300 hover:shadow-card'}`}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="font-display text-2xl text-maroon-900 group-hover:text-maroon-700 transition">
                      {plan?.name ?? (plan ? formatRange(plan.start_date, plan.end_date) : 'Shopping list')}
                    </h2>
                    <p className="text-xs text-beige-700 mt-1 tracking-wide">
                      Generated {formatDate(list.generated_at)} · {itemCount} {itemCount === 1 ? 'item' : 'items'}
                      {isDraft && ' · Needs review'}
                      {isComplete && ' · Complete'}
                    </p>
                  </div>
                  <svg viewBox="0 0 24 24" className="w-5 h-5 text-beige-700 group-hover:text-maroon-700 transition" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </main>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRange(start: string, end: string): string {
  const s = new Date(start), e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}
