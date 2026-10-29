import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { CATEGORY_LABEL } from '@/app/lib/types';
import RecipeActions from './recipe-actions';
import IngredientList from './ingredient-list';

export const dynamic = 'force-dynamic';

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=1600&q=80';

export default async function RecipeDetailPage({ params }: { params: { id: string } }) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // RLS lets us see owned recipes and shared ones
  const { data: recipe, error } = await supabase
    .from('recipes')
    .select('*, recipe_ingredients(quantity, unit, prep_note, order_index, raw_text, display_name, ingredients(canonical_name)), recipe_steps(step_number, content)')
    .eq('id', params.id)
    .single();

  if (error || !recipe) notFound();

  const isOwner = recipe.user_id === user?.id;

  // Sort ingredients and steps
  const ingredients = (recipe.recipe_ingredients ?? []).sort(
    (a: any, b: any) => (a.order_index ?? 0) - (b.order_index ?? 0)
  );
  const steps = (recipe.recipe_steps ?? []).sort(
    (a: any, b: any) => a.step_number - b.step_number
  );

  // Fetch share recipients if owner
  let shares: { shared_with: string; shared_at: string; email: string | null }[] = [];
  if (isOwner) {
    const { data: shareRows } = await supabase
      .from('recipe_shares')
      .select('shared_with, shared_at')
      .eq('recipe_id', params.id);
    shares = (shareRows ?? []).map(s => ({ ...s, email: null }));
  }

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-24">
      <div className="pt-6 pb-4">
        <Link href="/library" className="inline-flex items-center gap-1.5 text-xs tracking-wide text-beige-700 hover:text-maroon-900 transition">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Library
        </Link>
      </div>

      <div className="relative aspect-[16/10] sm:aspect-[2/1] rounded-sm overflow-hidden bg-beige-100 shadow-card rise-in">
        <Image
          src={recipe.image_path || FALLBACK_IMAGE}
          alt={recipe.name}
          fill
          priority
          sizes="(max-width: 768px) 100vw, 900px"
          className="object-cover"
        />
        {!isOwner && (
          <div className="absolute top-4 left-4 px-3 py-1 bg-maroon-900/95 backdrop-blur-sm text-[10px] tracking-eyebrow uppercase text-beige-50 rounded-sm">
            Shared with you · Read only
          </div>
        )}
      </div>

      <header className="mt-10 rise-in delay-1">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">{recipe.cuisine}</p>
        <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95] mb-5">
          {recipe.name}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
          <p className="text-sm text-ink/80">
            By <span className="text-maroon-900 font-medium">{recipe.author}</span>
            {recipe.author_handle && <span className="text-beige-700"> · {recipe.author_handle}</span>}
          </p>
          {recipe.source_url && (
            <a
              href={recipe.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-maroon-700 hover:text-maroon-900 transition underline underline-offset-2 decoration-maroon-300"
            >
              Source
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 17 17 7M7 7h10v10" />
              </svg>
            </a>
          )}
        </div>

        <div className="flex flex-wrap gap-6 sm:gap-8 py-4 border-y border-beige-200">
          <Stat label="Category" value={CATEGORY_LABEL[recipe.category as keyof typeof CATEGORY_LABEL]} />
          <Stat label="Cuisine" value={recipe.cuisine} />
          <Stat label="Servings" value={`${recipe.servings_yield}`} />
          {recipe.total_time_min > 0 && <Stat label="Time" value={`${recipe.total_time_min} min`} />}
        </div>
      </header>

      <div className="mt-12 grid grid-cols-1 lg:grid-cols-[1fr_1.5fr] gap-12 lg:gap-16">
        <section className="rise-in delay-2">
          <div className="lg:sticky lg:top-24">
            <IngredientList
              servingsYield={recipe.servings_yield}
              ingredients={ingredients.map((ing: any) => ({
                quantity: ing.quantity != null ? Number(ing.quantity) : null,
                unit: ing.unit,
                name: ing.display_name ?? ing.ingredients?.canonical_name ?? ing.raw_text ?? '',
                prep_note: ing.prep_note
              }))}
            />
          </div>
        </section>

        <section className="rise-in delay-3">
          <h2 className="font-display text-2xl text-maroon-900 mb-5">Method</h2>
          {steps.length === 0 ? (
            <p className="text-sm text-beige-700 italic">No method recorded.</p>
          ) : (
            <ol className="space-y-6">
              {steps.map((step: any, i: number) => (
                <li key={i} className="flex gap-5">
                  <span className="font-display text-3xl text-maroon-300 leading-none tnum w-10 flex-shrink-0">
                    {(i + 1).toString().padStart(2, '0')}
                  </span>
                  <p className="text-base leading-relaxed text-ink/90 pt-1">{step.content}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      {recipe.notes && (
        <section className="mt-16 rise-in delay-4">
          <div className="rule mb-8" />
          <div className="max-w-2xl">
            <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Notes</p>
            <p className="font-display italic text-lg text-ink/80 leading-relaxed">{recipe.notes}</p>
          </div>
        </section>
      )}

      {recipe.tags && recipe.tags.length > 0 && (
        <section className="mt-12 rise-in delay-5">
          <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Tags</p>
          <div className="flex flex-wrap gap-2">
            {recipe.tags.map((tag: string) => (
              <span key={tag} className="px-3 py-1 text-xs bg-beige-100 text-ink/70 rounded-sm border border-beige-200">
                {tag}
              </span>
            ))}
          </div>
        </section>
      )}

      <RecipeActions
        recipeId={recipe.id}
        isOwner={isOwner}
        shareCount={shares.length}
        defaultServings={recipe.servings_yield}
      />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] tracking-eyebrow uppercase text-beige-700">{label}</p>
      <p className="font-display text-lg text-maroon-900 mt-0.5">{value}</p>
    </div>
  );
}
