import Link from 'next/link';
import { notFound } from 'next/navigation';
import RecipeImage from '@/components/RecipeImage';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CATEGORY_LABEL, type Category } from '@/app/lib/types';
import PlanActions from './plan-actions';

export const dynamic = 'force-dynamic';


export default async function PlanDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabase();

  const { data: plan, error } = await supabase
    .from('meal_plans')
    .select(`
      id, name, start_date, end_date, notes,
      plan_items (
        id, times_per_period, servings_per_time,
        recipes ( id, name, category, cuisine, servings_yield, total_time_min, image_path, author )
      )
    `)
    .eq('id', params.id)
    .single();

  if (error || !plan) notFound();

  // Check if a shopping list already exists for this plan
  const { data: existingList } = await supabase
    .from('shopping_lists')
    .select('id, generated_at, completed_at')
    .eq('plan_id', params.id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const items = ((plan.plan_items ?? []) as unknown) as Array<{
    id: string;
    times_per_period: number;
    servings_per_time: number;
    recipes: {
      id: string;
      name: string;
      category: Category;
      cuisine: string;
      servings_yield: number;
      total_time_min: number | null;
      image_path: string | null;
      author: string;
    } | null;
  }>;

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-24">
      <div className="pt-6 pb-4">
        <Link href="/plan" className="inline-flex items-center gap-1.5 text-xs tracking-wide text-beige-700 hover:text-maroon-900 transition">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
          Plans
        </Link>
      </div>

      <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Meal Plan</p>
      <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95] mb-3">
        {plan.name ?? formatRange(plan.start_date, plan.end_date)}
      </h1>
      <p className="text-sm text-beige-700 mb-10">
        {formatRange(plan.start_date, plan.end_date)} · {items.length} {items.length === 1 ? 'recipe' : 'recipes'}
      </p>

      <section className="space-y-3 mb-10">
        {items.map(item => item.recipes && (
          <Link
            key={item.id}
            href={`/recipe/${item.recipes.id}`}
            className="flex items-center gap-4 p-4 bg-white border border-beige-200 rounded-sm hover:border-maroon-300 transition group"
          >
            <div className="relative w-16 h-16 rounded-sm overflow-hidden bg-beige-100 flex-shrink-0">
              <RecipeImage src={item.recipes.image_path} name={item.recipes.name} sizes="64px" initialClassName="text-2xl" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display text-lg text-maroon-900 truncate group-hover:text-maroon-700 transition">{item.recipes.name}</p>
              <p className="text-xs text-beige-700">
                {item.recipes.cuisine} · {CATEGORY_LABEL[item.recipes.category]} · By {item.recipes.author}
              </p>
            </div>
            <div className="text-right">
              <p className="font-display text-2xl text-maroon-900 tnum leading-none">{item.times_per_period}<span className="text-base text-beige-700">×</span></p>
              <p className="text-[10px] tracking-eyebrow uppercase text-beige-700 mt-1">{item.servings_per_time} servings</p>
            </div>
          </Link>
        ))}
      </section>

      {plan.notes && (
        <section className="mb-10">
          <div className="rule mb-6" />
          <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-2">Notes</p>
          <p className="font-display italic text-lg text-ink/80 leading-relaxed">{plan.notes}</p>
        </section>
      )}

      <PlanActions planId={plan.id} existingListId={existingList?.id ?? null} />
    </main>
  );
}

function formatRange(start: string, end: string): string {
  const s = new Date(start), e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}
