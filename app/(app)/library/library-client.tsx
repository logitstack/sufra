'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { fillMissingPhotos } from './actions';
import LoveButton from '@/components/LoveButton';
import RecipeImage from '@/components/RecipeImage';
import { CATEGORY_LABEL, type Category, type Recipe } from '@/app/lib/types';

type ViewMode = 'cuisine' | 'category' | 'all';

const CATEGORIES: Category[] = ['meat', 'vegetarian', 'baked_goods', 'desserts', 'drinks'];

export default function LibraryClient({
  photoless,
  ownedRecipes,
  sharedRecipes,
  hasError
}: {
  photoless: number;
  ownedRecipes: Recipe[];
  sharedRecipes: Recipe[];
  hasError: boolean;
}) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [selectedCuisine, setSelectedCuisine] = useState<string | null>(null);
  const [selectedAuthor, setSelectedAuthor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('cuisine');

  const allRecipes = useMemo(() => [...ownedRecipes, ...sharedRecipes], [ownedRecipes, sharedRecipes]);

  const cuisines = useMemo(
    () => Array.from(new Set(allRecipes.map(r => r.cuisine))).sort(),
    [allRecipes]
  );
  const authors = useMemo(
    () => Array.from(new Set(allRecipes.map(r => r.author))).sort(),
    [allRecipes]
  );

  function filter(list: Recipe[]) {
    const q = search.trim().toLowerCase();
    return list.filter(r => {
      if (selectedCategory && r.category !== selectedCategory) return false;
      if (selectedCuisine && r.cuisine !== selectedCuisine) return false;
      if (selectedAuthor && r.author !== selectedAuthor) return false;
      if (q) {
        const hay = `${r.name} ${r.author} ${r.cuisine} ${r.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  const filteredOwned = useMemo(() => filter(ownedRecipes), [ownedRecipes, search, selectedCategory, selectedCuisine, selectedAuthor]);
  const filteredShared = useMemo(() => filter(sharedRecipes), [sharedRecipes, search, selectedCategory, selectedCuisine, selectedAuthor]);

  const grouped = useMemo(() => groupRecipes(filteredOwned, viewMode), [filteredOwned, viewMode]);

  const activeFilterCount = [selectedCategory, selectedCuisine, selectedAuthor].filter(Boolean).length;
  const totalCount = ownedRecipes.length + sharedRecipes.length;
  const isEmpty = totalCount === 0;

  return (
    <main className="max-w-6xl mx-auto px-5 sm:px-8 pb-24">
      <section className="pt-10 sm:pt-16 pb-10 border-b border-beige-200">
        <div className="flex items-baseline justify-between gap-6 flex-wrap">
          <div>
            <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">The Library</p>
            <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95]">
              Your <em className="font-medium">spread</em>,
              <br />
              gathered.
            </h1>
          </div>
          <div className="text-right">
            <p className="font-display text-4xl text-maroon-900 tnum">{totalCount}</p>
            <p className="text-xs tracking-eyebrow uppercase text-beige-700">
              {totalCount === 1 ? 'recipe' : 'recipes'}
            </p>
          </div>
        </div>
        {photoless > 0 && <FindPhotos count={photoless} />}
      </section>

      {hasError && (
        <div className="mt-6 p-3 bg-maroon-100 border border-maroon-300 text-maroon-900 text-sm rounded-sm">
          Could not load recipes. Check your Supabase connection.
        </div>
      )}

      {isEmpty && !hasError && (
        <div className="mt-16 text-center py-16 border border-dashed border-beige-200 rounded-sm">
          <p className="font-display text-3xl text-maroon-900 mb-3">Empty sufra.</p>
          <p className="text-beige-700 text-sm mb-6 max-w-md mx-auto">
            Your library is waiting. Add your first recipe to begin building your spread.
          </p>
          <Link
            href="/recipe/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add your first recipe
          </Link>
        </div>
      )}

      {!isEmpty && (
        <>
          <section className="sticky top-16 z-20 bg-beige-50/85 backdrop-blur-md py-4 -mx-5 sm:-mx-8 px-5 sm:px-8 border-b border-beige-200">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="relative flex-1">
                <svg viewBox="0 0 24 24" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-beige-700" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search recipes, ingredients, tags…"
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
                />
              </div>

              <div className="flex items-center gap-1 bg-white border border-beige-200 rounded-sm p-1 self-start">
                <ViewToggle active={viewMode === 'cuisine'} onClick={() => setViewMode('cuisine')}>Cuisine</ViewToggle>
                <ViewToggle active={viewMode === 'category'} onClick={() => setViewMode('category')}>Category</ViewToggle>
                <ViewToggle active={viewMode === 'all'} onClick={() => setViewMode('all')}>All</ViewToggle>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-3">
              <FilterDropdown
                label="Category"
                options={CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABEL[c] }))}
                selected={selectedCategory}
                onSelect={v => setSelectedCategory(v as Category | null)}
              />
              <FilterDropdown label="Cuisine" options={cuisines.map(c => ({ value: c, label: c }))} selected={selectedCuisine} onSelect={setSelectedCuisine} />
              <FilterDropdown label="Author" options={authors.map(a => ({ value: a, label: a }))} selected={selectedAuthor} onSelect={setSelectedAuthor} />
              {activeFilterCount > 0 && (
                <button
                  onClick={() => { setSelectedCategory(null); setSelectedCuisine(null); setSelectedAuthor(null); }}
                  className="text-xs text-maroon-700 hover:text-maroon-900 underline underline-offset-2 ml-1"
                >
                  Clear filters
                </button>
              )}
            </div>
          </section>

          {/* Owned recipes */}
          <section className="mt-10 space-y-14">
            {grouped.length === 0 && (
              <div className="text-center py-20">
                <p className="font-display text-2xl text-maroon-900 mb-2">Nothing matches yet.</p>
                <p className="text-beige-700 text-sm">Try clearing filters or a different search term.</p>
              </div>
            )}

            {grouped.map((group, gi) => (
              <div key={group.key}>
                <div className="flex items-baseline gap-4 mb-6">
                  <h2 className="font-display text-3xl text-maroon-900">{group.key}</h2>
                  <div className="flex-1 h-px bg-beige-200" />
                  <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">
                    {group.recipes.length} {group.recipes.length === 1 ? 'recipe' : 'recipes'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                  {group.recipes.map((r, i) => <RecipeCard key={r.id} recipe={r} delayIndex={(gi + i) % 6} />)}
                </div>
              </div>
            ))}
          </section>

          {/* Shared with me */}
          {filteredShared.length > 0 && (
            <section className="mt-20">
              <div className="flex items-baseline gap-4 mb-2">
                <h2 className="font-display text-3xl text-maroon-900">Shared with me</h2>
                <div className="flex-1 h-px bg-beige-200" />
                <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">
                  {filteredShared.length} {filteredShared.length === 1 ? 'recipe' : 'recipes'}
                </span>
              </div>
              <p className="text-sm text-beige-700 mb-6">Read-only. Save a copy to make it yours.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
                {filteredShared.map((r, i) => <RecipeCard key={r.id} recipe={r} delayIndex={i % 6} shared />)}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function groupRecipes(recipes: Recipe[], mode: ViewMode) {
  if (mode === 'all') return [{ key: 'All', recipes }];
  if (mode === 'cuisine') {
    const groups = new Map<string, Recipe[]>();
    recipes.forEach(r => {
      const list = groups.get(r.cuisine) ?? [];
      list.push(r);
      groups.set(r.cuisine, list);
    });
    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, recipes]) => ({ key, recipes }));
  }
  const groups = new Map<Category, Recipe[]>();
  recipes.forEach(r => {
    const list = groups.get(r.category) ?? [];
    list.push(r);
    groups.set(r.category, list);
  });
  return CATEGORIES
    .filter(c => groups.has(c))
    .map(c => ({ key: CATEGORY_LABEL[c], recipes: groups.get(c)! }));
}

function FindPhotos({ count }: { count: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');

  async function run() {
    setRunning(true); setMessage('');
    let found = 0;
    let skip: string[] = [];
    try {
      // Work through the recipes a batch at a time.
      for (;;) {
        const result = await fillMissingPhotos(skip);
        found += result.found;
        skip = [...skip, ...result.missed];
        router.refresh();
        if (result.remaining === 0 || result.found + result.missed.length === 0) break;
      }
      setMessage(skip.length
        ? `Found ${found} ${found === 1 ? 'photo' : 'photos'}. ${skip.length} ${skip.length === 1 ? 'link has' : 'links have'} no photo; you can add one by editing the recipe.`
        : `Found ${found} ${found === 1 ? 'photo' : 'photos'}.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not get photos');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 p-3 bg-maroon-50 border border-maroon-100 rounded-sm text-sm">
      <p className="flex-1 min-w-[200px] text-maroon-900">
        {message || `${count} ${count === 1 ? 'recipe has' : 'recipes have'} no photo. Sufra can use the photo from each recipe's link.`}
      </p>
      {!message && (
        <button onClick={run} disabled={running} className="px-4 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50">
          {running ? 'Finding photos…' : 'Get photos'}
        </button>
      )}
    </div>
  );
}

function ViewToggle({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs tracking-wide rounded-sm transition ${active ? 'bg-maroon-900 text-beige-50' : 'text-ink/70 hover:text-maroon-900'}`}
    >
      {children}
    </button>
  );
}

function FilterDropdown({
  label, options, selected, onSelect
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string | null;
  onSelect: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const display = selected ? options.find(o => o.value === selected)?.label : label;
  const isActive = selected !== null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs tracking-wide border transition ${isActive ? 'bg-maroon-100 border-maroon-300 text-maroon-900' : 'bg-white border-beige-200 text-ink/80 hover:border-beige-300'}`}
      >
        {display}
        <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-40 min-w-[180px] bg-white border border-beige-200 rounded-sm shadow-card py-1 max-h-72 overflow-y-auto">
            {isActive && (
              <button
                onClick={() => { onSelect(null); setOpen(false); }}
                className="w-full px-3 py-1.5 text-left text-xs text-maroon-700 hover:bg-maroon-50 border-b border-beige-200 mb-1"
              >
                Clear {label.toLowerCase()}
              </button>
            )}
            {options.map(opt => (
              <button
                key={opt.value}
                onClick={() => { onSelect(opt.value); setOpen(false); }}
                className={`w-full px-3 py-1.5 text-left text-sm hover:bg-beige-50 transition ${selected === opt.value ? 'text-maroon-900 font-medium' : 'text-ink/80'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecipeCard({ recipe, delayIndex, shared }: { recipe: Recipe; delayIndex: number; shared?: boolean }) {
  return (
    <Link href={`/recipe/${recipe.id}`} className={`group block rise-in delay-${delayIndex}`}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-sm bg-beige-100 mb-3 shadow-card group-hover:shadow-card-hover transition-shadow">
        <RecipeImage
          src={recipe.image_path}
          name={recipe.name}
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
          initialClassName="text-7xl"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-maroon-950/40 via-transparent to-transparent" />
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <span className="px-2 py-0.5 bg-beige-50/95 backdrop-blur-sm text-[10px] tracking-eyebrow uppercase text-maroon-900 rounded-sm">
            {CATEGORY_LABEL[recipe.category]}
          </span>
          {shared && (
            <span className="px-2 py-0.5 bg-maroon-900/95 backdrop-blur-sm text-[10px] tracking-eyebrow uppercase text-beige-50 rounded-sm">
              Shared
            </span>
          )}
        </div>
        <LoveButton recipeId={recipe.id} loved={!!recipe.loved} className="absolute top-3 right-3" />
        {recipe.total_time_min > 0 && (
          <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-beige-50/95 backdrop-blur-sm text-[10px] tnum text-ink rounded-sm">
            {recipe.total_time_min} min
          </div>
        )}
      </div>

      <div className="px-1">
        <p className="text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1">{recipe.cuisine}</p>
        <h3 className="font-display text-xl text-maroon-900 leading-tight group-hover:text-maroon-700 transition">
          {recipe.name}
        </h3>
        <p className="text-xs text-beige-700 mt-1">
          By <span className="text-ink/80">{recipe.author}</span>
        </p>
      </div>
    </Link>
  );
}
