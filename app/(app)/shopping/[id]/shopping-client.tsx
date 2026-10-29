'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toggleShoppingItem, completeShoppingList, deleteShoppingList, resolveShoppingUnit, type Bought } from '../actions';

/** A size Sufra doesn't know yet, e.g. how much is in "1 can". */
export type SizeQuestion = {
  unit: string;
  partText: string;
  answer: 'weight' | 'count';
  text: string;
};

/** Starting values for "how much did you buy". */
export type BuyPrefill = {
  packages: number;
  size_quantity: number | null;
  size_unit: string;
  package_unit: string;   // 'bag', 'can'; '' or 'clove' for counts
  known: boolean;         // a usual size exists
  countOnly: boolean;     // counted items with no package (onions)
  common: Array<{ quantity: number; unit: string }>;
};

export type ShoppingItem = {
  id: string;
  name: string;
  qtyText: string;      // "2 cans", "1 bag (1 kg)", "2 tsp + 1 can"
  /** Spices, sauces and staples: checking off sets "have it", no amount asked. */
  statusTracked: boolean;
  buy: BuyPrefill;
  checked: boolean;
  questions: SizeQuestion[];
};
type Item = ShoppingItem;
type Section = { key: string; label: string; items: Item[] };

const WEIGHT_UNITS = ['g', 'oz', 'lb', 'kg'];
const SIZE_UNITS = ['', 'g', 'kg', 'oz', 'lb', 'ml', 'l', 'fl_oz'];

function unitLabel(u: string): string {
  return u === '' ? 'count' : u.replace('_', ' ');
}

export default function ShoppingClient({
  listId, sections, isComplete
}: {
  listId: string;
  sections: Section[];
  isComplete: boolean;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(new Map());
  const [buyingId, setBuyingId] = useState<string | null>(null);

  function isChecked(item: Item): boolean {
    const o = optimistic.get(item.id);
    return o !== undefined ? o : item.checked;
  }

  async function toggle(item: Item, next: boolean, bought?: Bought) {
    setOptimistic(new Map(optimistic.set(item.id, next)));
    setBuyingId(null);
    try {
      await toggleShoppingItem(item.id, next, bought);
      router.refresh();
    } catch (err) {
      const reverted = new Map(optimistic);
      reverted.delete(item.id);
      setOptimistic(reverted);
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function handleComplete() {
    try {
      await completeShoppingList(listId);
      router.push('/shopping');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not complete list');
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this shopping list?')) return;
    try {
      await deleteShoppingList(listId);
      router.push('/shopping');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  return (
    <>
      <div className="space-y-8">
        {sections.map(section => (
          <section key={section.key}>
            <div className="flex items-baseline gap-4 mb-3">
              <h2 className="font-display text-xl text-maroon-900">{section.label}</h2>
              <div className="flex-1 h-px bg-beige-200" />
              <span className="text-[10px] tracking-eyebrow uppercase text-beige-700 tnum">
                {section.items.length}
              </span>
            </div>
            <ul className="space-y-1">
              {section.items.map(item => {
                const checked = isChecked(item);
                if (buyingId === item.id) {
                  return (
                    <li key={item.id}>
                      <BuyPanel
                        item={item}
                        onConfirm={bought => toggle(item, true, bought)}
                        onCancel={() => setBuyingId(null)}
                      />
                    </li>
                  );
                }

                return (
                  <li key={item.id}>
                    <div
                      className={`w-full py-2.5 px-3 bg-white border rounded-sm transition ${checked ? 'border-beige-200 opacity-50' : 'border-beige-200 hover:border-maroon-300'}`}
                    >
                     <div className="flex items-center justify-between gap-3">
                      <button
                        onClick={() => (checked ? toggle(item, false) : item.statusTracked ? toggle(item, true) : setBuyingId(item.id))}
                        className="flex items-center gap-3 min-w-0 flex-1 text-left"
                      >
                        <span className={`w-5 h-5 rounded-sm border-2 flex items-center justify-center flex-shrink-0 transition ${checked ? 'bg-maroon-900 border-maroon-900' : 'border-beige-300'}`}>
                          {checked && (
                            <svg viewBox="0 0 24 24" className="w-3 h-3 text-beige-50" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="m5 12 5 5L20 7" />
                            </svg>
                          )}
                        </span>
                        <span className={`text-sm text-ink/85 truncate ${checked ? 'line-through' : ''}`}>{item.name}</span>
                      </button>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-sm text-maroon-900 font-medium tnum">{item.qtyText}</span>
                      </div>
                     </div>
                      {!checked && item.questions.map(q => (
                        <SizePrompt key={q.unit} itemId={item.id} question={q} onSaved={() => router.refresh()} />
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-beige-50/90 border-t border-beige-200">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between gap-3">
          <button onClick={handleDelete} className="text-xs text-beige-700 hover:text-maroon-700 transition">Delete list</button>
          {!isComplete && (
            <button
              onClick={handleComplete}
              className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
            >
              Mark complete
            </button>
          )}
        </div>
      </div>
    </>
  );
}

function SizePrompt({ itemId, question, onSaved }: { itemId: string; question: SizeQuestion; onSaved: () => void }) {
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState(question.answer === 'weight' ? 'g' : '');
  const [saving, setSaving] = useState(false);

  async function save() {
    const qty = parseFloat(value);
    if (isNaN(qty) || qty <= 0) return;
    setSaving(true);
    try {
      await resolveShoppingUnit(itemId, question.unit, qty, unit);
      onSaved();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not save size');
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 ml-8 p-2.5 bg-maroon-50 border border-maroon-100 rounded-sm">
      <p className="text-xs text-maroon-900 mb-2">
        Sufra needs a size to add <span className="font-medium">{question.partText}</span> to this line. {question.text}
      </p>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step="any"
          min="0"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); }}
          className="w-20 px-2 py-1.5 bg-white border border-beige-200 rounded-sm text-sm tnum text-center focus:outline-none focus:border-maroon-700"
        />
        {question.answer === 'weight' && (
          <select
            value={unit}
            onChange={e => setUnit(e.target.value)}
            className="px-2 py-1.5 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700"
          >
            {WEIGHT_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        )}
        <button
          onClick={save}
          disabled={saving || !value}
          className="px-3 py-1.5 bg-maroon-900 text-beige-50 rounded-sm text-xs font-medium hover:bg-maroon-700 transition disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save size'}
        </button>
      </div>
    </div>
  );
}

function BuyPanel({ item, onConfirm, onCancel }: {
  item: Item;
  onConfirm: (bought: Bought) => void;
  onCancel: () => void;
}) {
  const b = item.buy;
  const [packages, setPackages] = useState(String(b.packages));
  const [size, setSize] = useState(b.size_quantity != null ? String(b.size_quantity) : '');
  const [unit, setUnit] = useState(b.size_unit);

  function confirm() {
    const n = parseFloat(packages);
    if (isNaN(n) || n < 0) return;
    const sz = parseFloat(size);
    onConfirm({ packages: n, size_quantity: b.countOnly || isNaN(sz) ? null : sz, size_unit: unit });
  }

  const packageWord = b.countOnly ? (b.package_unit || item.name) : (b.package_unit || 'package');

  return (
    <div className="py-3 px-3 bg-white border border-maroon-300 rounded-sm">
      <p className="text-sm text-ink/85 mb-2">How much <span className="font-medium">{item.name}</span> did you buy?</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="number" step="any" min="0" autoFocus
          value={packages}
          onChange={e => setPackages(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') onCancel(); }}
          aria-label="How many"
          className="w-16 px-2 py-1.5 bg-beige-50 border border-beige-200 rounded-sm text-sm tnum text-center focus:outline-none focus:border-maroon-700"
        />
        <span className="text-xs text-beige-700">{packageWord}{parseFloat(packages) === 1 ? '' : 's'}</span>
        {!b.countOnly && (
          <>
            <span className="text-xs text-beige-700">of</span>
            <input
              type="number" step="any" min="0"
              value={size}
              onChange={e => setSize(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirm(); }}
              aria-label="Size of each"
              className="w-20 px-2 py-1.5 bg-beige-50 border border-beige-200 rounded-sm text-sm tnum text-center focus:outline-none focus:border-maroon-700"
            />
            <select
              value={unit}
              onChange={e => setUnit(e.target.value)}
              aria-label="Size unit"
              className="px-2 py-1.5 bg-beige-50 border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700"
            >
              {SIZE_UNITS.map(u => <option key={u} value={u}>{unitLabel(u)}</option>)}
            </select>
          </>
        )}
      </div>
      {!b.known && b.common.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          <span className="text-[11px] text-beige-700 self-center">Common sizes:</span>
          {b.common.map(c => (
            <button
              key={`${c.quantity}${c.unit}`}
              onClick={() => { setSize(String(c.quantity)); setUnit(c.unit); }}
              className="px-2 py-1 text-[11px] border border-beige-200 rounded-sm text-maroon-900 hover:border-maroon-700 transition"
            >
              {c.quantity} {unitLabel(c.unit)}
            </button>
          ))}
        </div>
      )}
      {!b.countOnly && (
        <p className="text-[11px] text-beige-700 mt-2">A new size becomes your usual size for {item.name}.</p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        <button onClick={confirm} className="px-3 py-1.5 bg-maroon-900 text-beige-50 rounded-sm text-xs font-medium hover:bg-maroon-700 transition">
          Add to pantry
        </button>
        <button
          onClick={() => onConfirm({ packages: 0, size_quantity: null, size_unit: '' })}
          className="px-3 py-1.5 text-xs text-maroon-900 border border-beige-200 rounded-sm hover:border-maroon-700 transition"
        >
          Check off only
        </button>
        <button onClick={onCancel} className="px-2 py-1.5 text-xs text-beige-700 hover:text-maroon-900 transition">Cancel</button>
      </div>
    </div>
  );
}
