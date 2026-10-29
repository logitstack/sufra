'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { finalizeShoppingList } from '../../actions';
import type { ShoppingSection } from '@/app/lib/shopping';
import type { Substitute } from '@/app/lib/substitutes';

export type ReviewItem = {
  id: string;
  name: string;
  section: ShoppingSection;
  selected: boolean;
  /** Whole packages to buy, e.g. "2 cans". */
  qtyText: string;
  /** "You have 200 g", "Running low". */
  haveText: string | null;
  suggestions: Substitute[];
  substitute: string | null;
};

type Choice = { selected: boolean; substitute: string | null };

const SECTIONS: Array<{ key: ShoppingSection; title: string; blurb: string }> = [
  { key: 'buy', title: 'To buy', blurb: 'Not in your pantry, or not enough of it.' },
  { key: 'similar', title: 'You may have something similar', blurb: 'Pick something from your pantry to use instead, or check it to buy.' },
  { key: 'low', title: 'Running low', blurb: 'Staples marked running low or out. Check any you want to top up.' },
  { key: 'have', title: 'Already have', blurb: 'Your pantry covers these.' }
];

export default function ReviewClient({ listId, items }: { listId: string; items: ReviewItem[] }) {
  const router = useRouter();
  const [choices, setChoices] = useState<Map<string, Choice>>(
    () => new Map(items.map(i => [i.id, { selected: i.selected, substitute: i.substitute }]))
  );
  const [saving, setSaving] = useState(false);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [error, setError] = useState('');

  function set(id: string, next: Choice) {
    setChoices(new Map(choices).set(id, next));
    setUnresolved([]);
  }

  async function handleOk() {
    setSaving(true); setError('');
    try {
      const result = await finalizeShoppingList(listId, items.map(i => {
        const c = choices.get(i.id)!;
        return { itemId: i.id, selected: c.selected, substitute_ingredient_id: c.substitute };
      }));
      if (!result.ok) {
        setUnresolved(result.unresolved);
        setSaving(false);
        return;
      }
      router.push(`/shopping/${listId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the list');
      setSaving(false);
    }
  }

  const selectedCount = items.filter(i => choices.get(i.id)?.selected).length;

  return (
    <>
      <div className="space-y-10">
        {SECTIONS.map(section => {
          const sectionItems = items.filter(i => i.section === section.key);
          if (sectionItems.length === 0) return null;

          const header = (
            <div className="flex items-baseline gap-4">
              <h2 className="font-display text-xl text-maroon-900">{section.title}</h2>
              <div className="flex-1 h-px bg-beige-200" />
              <span className="text-[10px] tracking-eyebrow uppercase text-beige-700 tnum">{sectionItems.length}</span>
            </div>
          );

          const list = (
            <ul className="space-y-1">
              {sectionItems.map(item => (
                <ReviewRow
                  key={item.id}
                  item={item}
                  choice={choices.get(item.id)!}
                  flagged={unresolved.includes(item.name)}
                  onChange={c => set(item.id, c)}
                />
              ))}
            </ul>
          );

          if (section.key === 'have') {
            return (
              <details key={section.key} className="group">
                <summary className="list-none cursor-pointer mb-3">
                  {header}
                  <p className="text-xs text-beige-700 mt-1">{section.blurb} <span className="underline underline-offset-2 group-open:hidden">Show</span></p>
                </summary>
                {list}
              </details>
            );
          }

          return (
            <section key={section.key}>
              <div className="mb-3">
                {header}
                <p className="text-xs text-beige-700 mt-1">{section.blurb}</p>
              </div>
              {list}
            </section>
          );
        })}
        {items.length === 0 && (
          <div className="text-center py-12 border border-dashed border-beige-200 rounded-sm">
            <p className="font-display text-2xl text-maroon-900 mb-2">Nothing to review.</p>
            <p className="text-beige-700 text-sm">This plan has no ingredients.</p>
          </div>
        )}
      </div>

      {unresolved.length > 0 && (
        <div className="mt-8 p-3 bg-maroon-100 border border-maroon-300 text-maroon-900 text-sm rounded-sm">
          Before finishing, check these to buy them or pick something from your pantry to use instead: {unresolved.join(', ')}.
        </div>
      )}
      {error && <p className="mt-8 p-3 bg-maroon-100 border border-maroon-300 text-maroon-900 text-sm rounded-sm">{error}</p>}

      <div className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-beige-50/90 border-t border-beige-200">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between gap-3">
          <p className="text-xs text-beige-700 tnum">{selectedCount} {selectedCount === 1 ? 'item' : 'items'} to buy</p>
          <button
            onClick={handleOk}
            disabled={saving}
            className="px-6 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'OK'}
          </button>
        </div>
      </div>
    </>
  );
}

function ReviewRow({ item, choice, flagged, onChange }: {
  item: ReviewItem;
  choice: Choice;
  flagged: boolean;
  onChange: (c: Choice) => void;
}) {
  const muted = item.section === 'have';
  return (
    <li className={`py-2.5 px-3 bg-white border rounded-sm transition ${flagged ? 'border-maroon-700' : 'border-beige-200'}`}>
      <div className="flex items-center justify-between gap-3">
        {muted ? (
          <span className="text-sm text-ink/60 truncate pl-8">{item.name}</span>
        ) : (
          <button
            onClick={() => onChange({ selected: !choice.selected, substitute: choice.selected ? choice.substitute : null })}
            className="flex items-center gap-3 min-w-0 flex-1 text-left"
          >
            <span className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 transition ${choice.selected ? 'bg-maroon-900 border-maroon-900' : 'border-beige-300'}`}>
              {choice.selected && (
                <svg viewBox="0 0 24 24" className="w-3 h-3 text-beige-50" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 5 5L20 7" /></svg>
              )}
            </span>
            <span className="text-sm text-ink/85 truncate">{item.name}</span>
          </button>
        )}
        <div className="text-right flex-shrink-0">
          {item.qtyText && <span className="text-sm text-maroon-900 font-medium tnum">{item.qtyText}</span>}
          {item.haveText && <p className="text-[11px] text-beige-700">{item.haveText}</p>}
        </div>
      </div>

      {item.section === 'similar' && item.suggestions.length > 0 && (
        <div className="mt-2 pl-8 space-y-1">
          <p className="text-[11px] text-beige-700">Use from your pantry instead:</p>
          {item.suggestions.map(s => {
            const picked = choice.substitute === s.ingredient_id;
            return (
              <button
                key={s.ingredient_id}
                onClick={() => onChange({ selected: false, substitute: picked ? null : s.ingredient_id })}
                className={`w-full flex items-start gap-2 px-2 py-1.5 text-left rounded-sm border transition ${picked ? 'border-maroon-700 bg-maroon-50' : 'border-beige-200 hover:border-maroon-300'}`}
              >
                <span className={`mt-0.5 w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${picked ? 'border-maroon-900 bg-maroon-900' : 'border-beige-300'}`} />
                <span className="text-xs">
                  <span className="text-maroon-900 font-medium">{s.name}</span>
                  {s.note && <span className="text-beige-700">. {s.note}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}
