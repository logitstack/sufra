'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addMissingToList, addStaple, removeStaple, suggestDishes, type Suggestion } from './actions';

export type RecipeCard = {
  id: string;
  name: string;
  cuisine: string;
  /** "Uses chickpeas, on hand for 3 weeks" */
  useItUp: string | null;
  missing: Array<{ name: string; text: string }>;
};

/** Must match PREFILL_KEY in recipe/new/page.tsx. */
const PREFILL_KEY = 'sufra:recipe-prefill';

export default function CookClient({
  canMake, nearMisses, staples, recipeCount
}: {
  canMake: RecipeCard[];
  nearMisses: RecipeCard[];
  staples: Array<{ id: string; name: string }>;
  recipeCount: number;
}) {
  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-32 pt-10 sm:pt-16">
      <div className="mb-10">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Cook</p>
        <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95]">
          What can I <em className="font-medium">make</em>?
        </h1>
        <p className="text-sm text-beige-700 mt-4 max-w-xl">
          Your recipes, checked against the pantry. Recipes that use what you've had longest come first.
        </p>
      </div>

      {recipeCount === 0 ? (
        <div className="text-center py-12 border border-dashed border-beige-200 rounded-sm mb-12">
          <p className="font-display text-2xl text-maroon-900 mb-2">No recipes yet.</p>
          <p className="text-beige-700 text-sm">Add a few to your library, or ask Claude below.</p>
        </div>
      ) : (
        <>
          <Section title="Can make now" count={canMake.length}>
            {canMake.length === 0
              ? <Empty text="Nothing is fully covered yet. Check the near misses." />
              : <div className="grid sm:grid-cols-2 gap-3">{canMake.map(r => <Card key={r.id} recipe={r} />)}</div>}
          </Section>

          <Section title="Near misses" count={nearMisses.length}>
            {nearMisses.length === 0
              ? <Empty text="No recipes are one or two ingredients away." />
              : <div className="grid sm:grid-cols-2 gap-3">{nearMisses.map(r => <Card key={r.id} recipe={r} nearMiss />)}</div>}
          </Section>
        </>
      )}

      <Suggestions />
      <Staples staples={staples} />
    </main>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="flex items-baseline gap-4 mb-4">
        <h2 className="font-display text-2xl text-maroon-900">{title}</h2>
        <div className="flex-1 h-px bg-beige-200" />
        {count !== undefined && <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-beige-700 italic">{text}</p>;
}

function Card({ recipe, nearMiss }: { recipe: RecipeCard; nearMiss?: boolean }) {
  const [state, setState] = useState<'idle' | 'adding' | { listId: string }>('idle');

  async function add() {
    setState('adding');
    try {
      setState(await addMissingToList(recipe.id));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not add to list');
      setState('idle');
    }
  }

  return (
    <div className="p-4 bg-white border border-beige-200 rounded-sm hover:border-maroon-300 transition">
      <Link href={`/recipe/${recipe.id}`} className="block">
        <p className="text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1">{recipe.cuisine}</p>
        <h3 className="font-display text-xl text-maroon-900 leading-tight">{recipe.name}</h3>
      </Link>
      {recipe.useItUp && <p className="text-xs text-beige-700 mt-2">{recipe.useItUp}</p>}
      {nearMiss && (
        <>
          <ul className="mt-3 space-y-1">
            {recipe.missing.map(m => (
              <li key={m.name} className="flex justify-between gap-3 text-sm">
                <span className="text-ink/85">Need {m.name}</span>
                <span className="text-maroon-900 tnum">{m.text}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3">
            {typeof state === 'object' ? (
              <Link href={`/shopping/${state.listId}`} className="text-xs text-maroon-700 hover:text-maroon-900">
                Added. See grocery list
              </Link>
            ) : (
              <button
                onClick={add}
                disabled={state === 'adding'}
                className="px-3 py-1.5 bg-maroon-900 text-beige-50 rounded-sm text-xs font-medium hover:bg-maroon-700 transition disabled:opacity-50"
              >
                {state === 'adding' ? 'Adding…' : `Add ${recipe.missing.length === 1 ? 'it' : 'both'} to grocery list`}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Suggestions() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);

  async function ask() {
    setLoading(true); setError('');
    try {
      setSuggestions(await suggestDishes());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get suggestions');
    } finally {
      setLoading(false);
    }
  }

  function save(s: Suggestion) {
    try {
      sessionStorage.setItem(PREFILL_KEY, JSON.stringify(s.recipe));
    } catch {
      alert('Could not hand this recipe to the form. Copy it in by hand.');
      return;
    }
    router.push('/recipe/new');
  }

  return (
    <Section title="Ideas from Claude">
      <p className="text-sm text-beige-700 mb-4 max-w-xl">
        Dishes outside your library, built around what's in your pantry. Save one to review and add it like any other recipe.
      </p>
      {!suggestions && (
        <button
          onClick={ask}
          disabled={loading}
          className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Suggest dishes'}
        </button>
      )}
      {error && <p className="mt-4 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">{error}</p>}
      {suggestions && (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            {suggestions.map((s, i) => (
              <div key={i} className="p-4 bg-white border border-beige-200 rounded-sm">
                <p className="text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1">{s.recipe.cuisine}</p>
                <h3 className="font-display text-xl text-maroon-900 leading-tight mb-2">{s.recipe.name}</h3>
                <p className="text-sm text-ink/80">{s.why}</p>
                {s.missing.length > 0 && <p className="text-xs text-beige-700 mt-2">Still need: {s.missing.join(', ')}</p>}
                <button
                  onClick={() => save(s)}
                  className="mt-3 px-3 py-1.5 border border-beige-300 text-maroon-900 rounded-sm text-xs hover:border-maroon-700 transition"
                >
                  Save as recipe
                </button>
              </div>
            ))}
          </div>
          <button onClick={ask} disabled={loading} className="mt-4 text-xs text-beige-700 hover:text-maroon-900 disabled:opacity-50">
            {loading ? 'Thinking…' : 'Suggest different dishes'}
          </button>
        </>
      )}
    </Section>
  );
}

function Staples({ staples }: { staples: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not update staples');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Always on hand">
      <p className="text-sm text-beige-700 mb-4 max-w-xl">
        Staples never block a match, even when they aren't in your pantry.
      </p>
      <div className="flex flex-wrap gap-2 mb-4">
        {staples.map(s => (
          <span key={s.id} className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 bg-white border border-beige-200 rounded-sm text-sm text-ink/85">
            {s.name}
            <button
              onClick={() => act(() => removeStaple(s.id))}
              disabled={busy}
              aria-label={`Remove ${s.name}`}
              className="text-beige-700 hover:text-maroon-700 p-0.5"
            >
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </span>
        ))}
        {staples.length === 0 && <Empty text="No staples. Every ingredient counts." />}
      </div>
      <form
        onSubmit={e => { e.preventDefault(); if (name.trim()) act(async () => { await addStaple(name); setName(''); }); }}
        className="flex gap-2 max-w-sm"
      >
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="black pepper"
          className="flex-1 px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
        />
        <button type="submit" disabled={busy || !name.trim()} className="px-4 py-2 bg-maroon-900 text-beige-50 rounded-sm text-sm hover:bg-maroon-700 transition disabled:opacity-50">
          Add
        </button>
      </form>
    </Section>
  );
}
