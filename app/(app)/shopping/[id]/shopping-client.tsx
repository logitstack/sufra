'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toggleShoppingItem, completeShoppingList, deleteShoppingList } from '../actions';

type Item = {
  id: string;
  name: string;
  qtyText: string;
  qtyValue: number;
  qtyUnit: string;
  basePerUnit: number;
  section: string;
  checked: boolean;
};
type Section = { key: string; label: string; items: Item[] };

export default function ShoppingClient({
  listId, sections, isComplete
}: {
  listId: string;
  sections: Section[];
  isComplete: boolean;
}) {
  const router = useRouter();
  const [optimistic, setOptimistic] = useState<Map<string, boolean>>(new Map());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  function isChecked(item: Item): boolean {
    const o = optimistic.get(item.id);
    return o !== undefined ? o : item.checked;
  }

  async function toggle(item: Item, next: boolean, overrideBaseQty?: number) {
    setOptimistic(new Map(optimistic.set(item.id, next)));
    try {
      await toggleShoppingItem(item.id, next, overrideBaseQty);
      router.refresh();
    } catch (err) {
      const reverted = new Map(optimistic);
      reverted.delete(item.id);
      setOptimistic(reverted);
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  }

  function startEdit(item: Item) {
    setEditingId(item.id);
    setEditValue(String(item.qtyValue));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue('');
  }

  async function confirmEdit(item: Item) {
    const entered = parseFloat(editValue);
    if (isNaN(entered) || entered < 0) return;
    const overrideBaseQty = entered * item.basePerUnit;
    cancelEdit();
    await toggle(item, true, overrideBaseQty);
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
                const editing = editingId === item.id;

                if (editing) {
                  return (
                    <li key={item.id}>
                      <div className="flex items-center gap-2 py-2 px-3 bg-white border border-maroon-300 rounded-sm">
                        <span className="text-sm text-ink/85 truncate flex-1">{item.name}</span>
                        <input
                          type="number"
                          step="any"
                          min="0"
                          autoFocus
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') confirmEdit(item);
                            if (e.key === 'Escape') cancelEdit();
                          }}
                          className="w-20 px-2 py-1.5 bg-beige-50 border border-beige-200 rounded-sm text-sm tnum text-center focus:outline-none focus:border-maroon-700"
                        />
                        <span className="text-xs text-beige-700 w-8">{item.qtyUnit}</span>
                        <button
                          onClick={() => confirmEdit(item)}
                          className="px-3 py-1.5 bg-maroon-900 text-beige-50 rounded-sm text-xs font-medium hover:bg-maroon-700 transition"
                        >
                          Add
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="px-2 py-1.5 text-xs text-beige-700 hover:text-maroon-900 transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </li>
                  );
                }

                return (
                  <li key={item.id}>
                    <div
                      className={`w-full flex items-center justify-between gap-3 py-2.5 px-3 bg-white border rounded-sm transition ${checked ? 'border-beige-200 opacity-50' : 'border-beige-200 hover:border-maroon-300'}`}
                    >
                      <button
                        onClick={() => toggle(item, !checked)}
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
                        {!checked && (
                          <button
                            onClick={() => startEdit(item)}
                            aria-label={`Edit quantity for ${item.name}`}
                            className="text-beige-700 hover:text-maroon-900 transition p-1"
                          >
                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                          </button>
                        )}
                      </div>
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
