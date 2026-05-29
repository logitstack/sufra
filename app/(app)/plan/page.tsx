import Link from 'next/link';
import { createServerSupabase } from '@/app/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function PlanPage() {
  const supabase = createServerSupabase();
  const { data: plans } = await supabase
    .from('meal_plans')
    .select('id, name, start_date, end_date, plan_items(count)')
    .order('start_date', { ascending: false });

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-24 pt-10 sm:pt-16">
      <div className="flex items-start justify-between gap-4 mb-10 flex-wrap">
        <div>
          <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Meal Plans</p>
          <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95]">
            Plan your <em className="font-medium">spread</em>.
          </h1>
        </div>
        <Link
          href="/plan/new"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          New plan
        </Link>
      </div>

      {!plans || plans.length === 0 ? (
        <div className="mt-8 text-center py-16 border border-dashed border-beige-200 rounded-sm">
          <p className="font-display text-3xl text-maroon-900 mb-3">No plans yet.</p>
          <p className="text-beige-700 text-sm mb-6 max-w-md mx-auto">
            Pick the recipes you want to make and how often, and Sufra will generate a single grocery list.
          </p>
          <Link
            href="/plan/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
          >
            Create your first plan
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {plans.map(plan => {
            const itemCount = (plan.plan_items as Array<{ count: number }>)[0]?.count ?? 0;
            return (
              <Link
                key={plan.id}
                href={`/plan/${plan.id}`}
                className="block p-5 bg-white border border-beige-200 rounded-sm hover:border-maroon-300 hover:shadow-card transition group"
              >
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="font-display text-2xl text-maroon-900 group-hover:text-maroon-700 transition">
                      {plan.name ?? formatRange(plan.start_date, plan.end_date)}
                    </h2>
                    <p className="text-xs text-beige-700 mt-1 tracking-wide">
                      {formatRange(plan.start_date, plan.end_date)} · {itemCount} {itemCount === 1 ? 'recipe' : 'recipes'}
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

function formatRange(start: string, end: string): string {
  const s = new Date(start), e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}
