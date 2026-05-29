'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createPlan } from '../actions';
import { CATEGORY_LABEL, type Category } from '@/app/lib/types';

type RecipeLite = {
  id: string;
  name: string;
  category: Category;
  cuisine: string;
  servings_yield: number;
  total_time_min: number | null;
  image_path: string | null;
  author: string;
};

type SelectedItem = {
  recipe: RecipeLite;
  times_per_period: number;
  servings_per_time: number;
};

const FALLBACK = 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=400&q=80';

export default function NewPlanClient({ recipes }: { recipes: RecipeLite[] }) {
  const router = useRouter();

  const today = new Date().toISOString().slice(0, 10);
  const twoWeeks = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(twoWeeks);
  const [notes, setNotes] = useState('');
  const [selected, setSelected] = useState<Map<string, SelectedItem>>(new Map());
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter(r =>
      r.name.toLowerCase().includes(q) ||
      r.cuisine.toLowerCase().includes(q) ||
      r.author.toLowerCase().includes(q)
    );
  }, [search, recipes]);

  function toggle(recipe: RecipeLite) {
    const next = new Map(selected);
    if (next.has(recipe.id)) {
      next.delete(recipe.id);
    } else {
      next.set(recipe.id, {
        recipe,
        times_per_period: 1,
        servings_per_time: recipe.servings_yield
      });
    }
    setSelected(next);
  }

  function updateItem(recipeId: string, field: 'times_per_period' | 'servings_per_time', value: number) {
    const next = new Map(selected);
    const item = next.get(recipeId);
    if (item) {
      next.set(recipeId, { ...item, [field]: Math.max(1, value) });
      setSelected(next);
    }
  }

  async function handleSave() {
    setError('');
    if (selected.size === 0) {
      setError('Pick at least one recipe');
      return;
    }
    setSaving(true);
    try {
      const items = Array.from(selected.values()).map(i => ({
        recipe_id: i.recipe.id,
        times_per_period: i.times_per_period,
        servings_per_time: i.servings_per_time
      }));
      const { id } = await createPlan({
        name,
        start_date: startDate,
        end_date: endDate,
        notes: notes.trim() || null,
        items
      });
      router.push(`/plan/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-32">
      <div className="pt-6 pb-4">
        <Link href="/plan" className="inline-flex items-center gap-1.5 text-xs tracking-wide text-beige-700 hover:text-maroon-900 transition">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
          Plans
        </Link>
      </div>

      <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">New plan</p>
      <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95] mb-10">
        Plan a <em className="font-medium">spread</em>.
      </h1>

      {/* Plan details */}
      <section className="mb-10">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-4">Details</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">Name (optional)</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Week of Sep 1"
              className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
            />
          </div>
          <div>
            <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
            />
          </div>
        </div>
      </section>

      {/* Selected recipes with frequency */}
      {selected.size > 0 && (
        <section className="mb-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-display text-2xl text-maroon-900">In this plan</h2>
            <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">
              {selected.size} {selected.size === 1 ? 'recipe' : 'recipes'}
            </span>
          </div>
          <div className="space-y-2">
            {Array.from(selected.values()).map(item => (
              <div key={item.recipe.id} className="flex items-center gap-3 p-3 bg-white border border-beige-200 rounded-sm">
                <div className="relative w-14 h-14 rounded-sm overflow-hidden bg-beige-100 flex-shrink-0">
                  <Image src={item.recipe.image_path ?? FALLBACK} alt="" fill sizes="56px" className="object-cover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-display text-base text-maroon-900 truncate">{item.recipe.name}</p>
                  <p className="text-xs text-beige-700">{item.recipe.cuisine} · {CATEGORY_LABEL[item.recipe.category]}</p>
                </div>
                <div className="flex items-center gap-3">
                  <FreqInput
                    label="Times"
                    value={item.times_per_period}
                    onChange={v => updateItem(item.recipe.id, 'times_per_period', v)}
                  />
                  <FreqInput
                    label="Servings"
                    value={item.servings_per_time}
                    onChange={v => updateItem(item.recipe.id, 'servings_per_time', v)}
                  />
                  <button
                    onClick={() => toggle(item.recipe)}
                    className="w-8 h-8 flex items-center justify-center text-beige-700 hover:text-maroon-700 hover:bg-maroon-50 rounded-sm transition"
                    aria-label="Remove"
                  >
                    <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recipe picker */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-2xl text-maroon-900">
            {selected.size === 0 ? 'Pick recipes' : 'Add more'}
          </h2>
          <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">
            {recipes.length} in library
          </span>
        </div>

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search recipes…"
          className="w-full mb-4 px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
        />

        {recipes.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-beige-200 rounded-sm">
            <p className="font-display text-xl text-maroon-900 mb-2">No recipes yet.</p>
            <p className="text-sm text-beige-700 mb-4">Add some to your library first.</p>
            <Link href="/recipe/new" className="text-sm text-maroon-700 hover:text-maroon-900 underline">
              Add a recipe
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filteredRecipes.map(r => {
              const isSelected = selected.has(r.id);
              return (
                <button
                  key={r.id}
                  onClick={() => toggle(r)}
                  className={`text-left rounded-sm overflow-hidden transition group ${isSelected ? 'ring-2 ring-maroon-900 ring-offset-2 ring-offset-beige-50' : ''}`}
                >
                  <div className="relative aspect-square bg-beige-100">
                    <Image src={r.image_path ?? FALLBACK} alt={r.name} fill sizes="200px" className="object-cover" />
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-maroon-900 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" className="w-4 h-4 text-beige-50" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 5 5L20 7" /></svg>
                      </div>
                    )}
                  </div>
                  <div className="p-2 bg-white border border-t-0 border-beige-200">
                    <p className="font-display text-sm text-maroon-900 leading-tight line-clamp-2">{r.name}</p>
                    <p className="text-[10px] tracking-eyebrow uppercase text-beige-700 mt-1">{r.cuisine}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-10">
        <label className="block text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything to remember about this plan…"
          className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm italic focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition resize-none"
        />
      </section>

      {error && <div className="mb-4 p-3 bg-maroon-100 border border-maroon-300 text-maroon-900 text-sm rounded-sm">{error}</div>}

      <div className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-beige-50/90 border-t border-beige-200">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between gap-3">
          <p className="text-xs text-beige-700 hidden sm:block tnum">
            {selected.size} selected
          </p>
          <div className="flex gap-3 ml-auto">
            <Link href="/plan" className="px-5 py-2.5 bg-white border border-beige-200 text-ink rounded-sm hover:border-maroon-300 transition text-sm">Cancel</Link>
            <button
              onClick={handleSave}
              disabled={saving || selected.size === 0}
              className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function FreqInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="text-center">
      <p className="text-[9px] tracking-eyebrow uppercase text-beige-700 mb-0.5">{label}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(value - 1)} className="w-6 h-6 flex items-center justify-center text-beige-700 hover:text-maroon-700 text-sm">−</button>
        <span className="font-display text-base text-maroon-900 w-6 text-center tnum">{value}</span>
        <button onClick={() => onChange(value + 1)} className="w-6 h-6 flex items-center justify-center text-beige-700 hover:text-maroon-700 text-sm">+</button>
      </div>
    </div>
  );
}
