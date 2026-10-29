'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { addMissingToList, addStaple, removeStaple, suggestDishes, type PantryMode, type Suggestion } from './actions';
import { formatRecipeQuantity, pluralUnit } from '@/app/lib/units';

export type RecipeCard = {
  id: string;
  name: string;
  cuisine: string;
  /** "Uses chickpeas, on hand for 3 weeks" */
  useItUp: string | null;
  missing: Array<{ name: string; text: string }>;
};

/** Must match PREFILL_KEY in recipe/recipe-form.tsx. */
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

const KINDS = ['dessert', 'breakfast', 'lunch', 'dinner', 'soup', 'baked goods', 'snack', 'drinks'];

const PANTRY_MODES: Array<{ value: PantryMode; label: string }> = [
  { value: 'stick', label: 'Only what I have' },
  { value: 'few', label: 'A few things to buy' },
  { value: 'ignore', label: 'Ignore my pantry' }
];

function Suggestions() {
  const router = useRouter();
  const [request, setRequest] = useState('');
  const [kinds, setKinds] = useState<string[]>([]);
  const [servings, setServings] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [pantryMode, setPantryMode] = useState<PantryMode>('few');
  const [refinements, setRefinements] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState('');
  const [shown, setShown] = useState<Suggestion[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [loading, setLoading] = useState<'ask' | 'more' | 'refine' | null>(null);
  const [error, setError] = useState('');

  async function run(kind: 'ask' | 'more' | 'refine') {
    const nextRefinements = kind === 'ask' ? [] : kind === 'refine' ? [...refinements, followUp.trim()] : refinements;
    const priorShown = kind === 'ask' ? [] : shown;
    setLoading(kind); setError('');
    try {
      const result = await suggestDishes({
        request,
        kinds,
        servings: parseInt(servings) || null,
        maxMinutes: parseInt(maxMinutes) || null,
        pantryMode,
        refinements: nextRefinements,
        shown: priorShown.map(s => ({ name: s.recipe.name, why: s.why }))
      });
      setRefinements(nextRefinements);
      setShown([...priorShown, ...result]);
      setSuggestions(kind === 'more' ? [...(suggestions ?? []), ...result] : result);
      if (kind === 'refine') setFollowUp('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not get suggestions');
    } finally {
      setLoading(null);
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

  const inputClass = 'px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition';

  return (
    <Section title="Ideas from Claude">
      <p className="text-sm text-beige-700 mb-4 max-w-xl">
        Describe what you're in the mood for. Claude suggests halal dishes outside your library, shaped by what you cook and the recipes you love.
      </p>

      <form onSubmit={e => { e.preventDefault(); run('ask'); }} className="space-y-3">
        <textarea
          value={request}
          onChange={e => setRequest(e.target.value)}
          rows={2}
          placeholder="A dessert for a family gathering, a quick weeknight soup, something with the chicken I have…"
          className={`w-full resize-y ${inputClass}`}
        />
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map(k => {
            const on = kinds.includes(k);
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKinds(on ? kinds.filter(x => x !== k) : [...kinds, k])}
                className={`px-3 py-1 text-xs rounded-sm border transition capitalize ${on ? 'bg-maroon-900 border-maroon-900 text-beige-50' : 'bg-white border-beige-200 text-maroon-900 hover:border-maroon-700'}`}
              >
                {k}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[10px] tracking-eyebrow uppercase text-beige-700">
            Servings
            <input type="number" min="1" value={servings} onChange={e => setServings(e.target.value)} placeholder="Any" className={`block mt-1 w-20 tnum ${inputClass}`} />
          </label>
          <label className="text-[10px] tracking-eyebrow uppercase text-beige-700">
            Max time (min)
            <input type="number" min="5" value={maxMinutes} onChange={e => setMaxMinutes(e.target.value)} placeholder="Any" className={`block mt-1 w-24 tnum ${inputClass}`} />
          </label>
          <div className="flex flex-wrap gap-1">
            {PANTRY_MODES.map(m => (
              <button
                key={m.value}
                type="button"
                onClick={() => setPantryMode(m.value)}
                className={`px-3 py-2 text-xs rounded-sm border transition ${pantryMode === m.value ? 'bg-maroon-50 border-maroon-700 text-maroon-900' : 'bg-white border-beige-200 text-beige-700 hover:border-maroon-300'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <button
          type="submit"
          disabled={loading !== null}
          className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
        >
          {loading === 'ask' ? 'Looking for recipes…' : suggestions ? 'Start over' : 'Suggest dishes'}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">{error}</p>}

      {suggestions && (
        <div className="mt-6">
          {refinements.length > 0 && (
            <p className="text-xs text-beige-700 mb-3">Refined: {refinements.join(', then ')}</p>
          )}
          <div className="grid gap-3">
            {suggestions.map((s, i) => <SuggestionCard key={`${s.recipe.name}-${i}`} suggestion={s} onSave={() => save(s)} />)}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => run('more')}
              disabled={loading !== null}
              className="px-4 py-2 border border-beige-300 text-maroon-900 rounded-sm text-sm hover:border-maroon-700 transition disabled:opacity-50"
            >
              {loading === 'more' ? 'Finding more…' : 'Show 3 more'}
            </button>
            <form onSubmit={e => { e.preventDefault(); if (followUp.trim()) run('refine'); }} className="flex flex-1 min-w-[240px] gap-2">
              <input
                type="text"
                value={followUp}
                onChange={e => setFollowUp(e.target.value)}
                placeholder="Less sweet, no oven, more veg…"
                className={`flex-1 ${inputClass}`}
              />
              <button type="submit" disabled={loading !== null || !followUp.trim()} className="px-4 py-2 bg-maroon-900 text-beige-50 rounded-sm text-sm hover:bg-maroon-700 transition disabled:opacity-50">
                {loading === 'refine' ? 'Refining…' : 'Refine'}
              </button>
            </form>
          </div>
        </div>
      )}
    </Section>
  );
}

function SuggestionCard({ suggestion: s, onSave }: { suggestion: Suggestion; onSave: () => void }) {
  const [open, setOpen] = useState(false);
  const r = s.recipe;
  return (
    <div className="p-4 bg-white border border-beige-200 rounded-sm">
      <p className="text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1">
        {r.cuisine}{r.total_time_min ? ` · ${r.total_time_min} min` : ''} · Serves {r.servings_yield}
      </p>
      <h3 className="font-display text-xl text-maroon-900 leading-tight mb-2">{r.name}</h3>
      <p className="text-sm text-ink/80">{s.why}</p>
      {s.missing.length > 0 && <p className="text-xs text-beige-700 mt-2">To buy: {s.missing.join(', ')}</p>}
      {s.source_url && (
        <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-xs text-maroon-700 hover:text-maroon-900 underline underline-offset-2 decoration-maroon-300">
          Based on {hostOf(s.source_url)}
        </a>
      )}

      {open && (
        <div className="mt-4 grid sm:grid-cols-[1fr_1.4fr] gap-5 text-sm">
          <ul className="space-y-1">
            {r.ingredients.map((ing, i) => (
              <li key={i} className="text-ink/85">
                {ing.quantity != null && <span className="text-maroon-900 font-medium tnum">{formatRecipeQuantity(ing.quantity, ing.unit)} </span>}
                {ing.unit && <span className="text-maroon-900 font-medium">{pluralUnit(ing.unit, ing.quantity ?? 1)} </span>}
                {ing.name}{ing.prep_note && <span className="text-beige-700 italic">, {ing.prep_note}</span>}
              </li>
            ))}
          </ul>
          <div>
            <ol className="space-y-2 list-decimal pl-4">
              {r.steps.map((step, i) => <li key={i} className="text-ink/85 leading-relaxed">{step}</li>)}
            </ol>
            {s.tips.length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1">Tips</p>
                <ul className="space-y-1 list-disc pl-4 text-ink/80">
                  {s.tips.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button onClick={() => setOpen(!open)} className="px-3 py-1.5 border border-beige-300 text-maroon-900 rounded-sm text-xs hover:border-maroon-700 transition">
          {open ? 'Hide recipe' : 'See recipe'}
        </button>
        <button onClick={onSave} className="px-3 py-1.5 bg-maroon-900 text-beige-50 rounded-sm text-xs font-medium hover:bg-maroon-700 transition">
          Save as recipe
        </button>
      </div>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'a published recipe';
  }
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
    <Section title="Always available">
      <p className="text-sm text-beige-700 mb-4 max-w-xl">
        These never block a match, even when they aren't in your pantry. Water always counts.
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
