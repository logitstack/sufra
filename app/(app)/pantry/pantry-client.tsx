'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { addPantryItem, updatePantryItem, deletePantryItem } from './actions';
import type { PantryRow } from './page';

const CATEGORY_ORDER = ['spice', 'produce', 'protein', 'dairy', 'grain', 'pantry', 'condiment', 'other'];
const CATEGORY_LABELS: Record<string, string> = {
  spice: 'Spices',
  produce: 'Produce',
  protein: 'Protein',
  dairy: 'Dairy',
  grain: 'Grains',
  pantry: 'Pantry',
  condiment: 'Condiments',
  other: 'Other'
};

const UNITS = ['', 'tsp', 'tbsp', 'cup', 'fl_oz', 'ml', 'l', 'g', 'kg', 'oz', 'lb', 'pinch', 'bunch'];

export default function PantryClient({ rows }: { rows: PantryRow[] }) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => r.canonical_name.toLowerCase().includes(q));
  }, [search, rows]);

  const grouped = useMemo(() => {
    const groups = new Map<string, PantryRow[]>();
    for (const r of filtered) {
      const list = groups.get(r.category) ?? [];
      list.push(r);
      groups.set(r.category, list);
    }
    return CATEGORY_ORDER
      .filter(c => groups.has(c))
      .map(c => ({ key: c, rows: groups.get(c)! }));
  }, [filtered]);

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-32 pt-10 sm:pt-16">
      <div className="flex items-start justify-between gap-4 mb-10 flex-wrap">
        <div>
          <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Pantry</p>
          <h1 className="font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95]">
            What's <em className="font-medium">on hand</em>.
          </h1>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add item
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-beige-200 rounded-sm">
          <p className="font-display text-3xl text-maroon-900 mb-3">Empty pantry.</p>
          <p className="text-beige-700 text-sm mb-6 max-w-md mx-auto">
            Track what's at home so the shopping list only shows what you need to buy. Especially helpful for spices.
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
          >
            Add your first item
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search pantry…"
            className="w-full mb-6 px-4 py-2.5 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
          />

          <div className="space-y-10">
            {grouped.map(group => (
              <section key={group.key}>
                <div className="flex items-baseline gap-4 mb-4">
                  <h2 className="font-display text-2xl text-maroon-900">{CATEGORY_LABELS[group.key] ?? group.key}</h2>
                  <div className="flex-1 h-px bg-beige-200" />
                  <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">
                    {group.rows.length} {group.rows.length === 1 ? 'item' : 'items'}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.rows.map(row => (
                    <PantryRowEditor key={row.id} row={row} onChange={() => router.refresh()} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {addOpen && (
        <AddPantryModal
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); router.refresh(); }}
        />
      )}
    </main>
  );
}

function PantryRowEditor({ row, onChange }: { row: PantryRow; onChange: () => void }) {
  const [editing, setEditing] = useState(false);
  const [qty, setQty] = useState(String(row.quantity_on_hand));
  const [exp, setExp] = useState(row.expiration_date ?? '');
  const [saving, setSaving] = useState(false);

  const isExpired = row.expiration_date && new Date(row.expiration_date) < new Date();
  const isEmpty = row.quantity_on_hand === 0;

  async function handleSave() {
    setSaving(true);
    try {
      await updatePantryItem(row.id, parseFloat(qty) || 0, exp || null);
      setEditing(false);
      onChange();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${row.canonical_name} from pantry?`)) return;
    await deletePantryItem(row.id);
    onChange();
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2 p-3 bg-white border border-maroon-300 rounded-sm">
        <span className="flex-1 min-w-[120px] font-medium text-ink/85 text-sm">{row.canonical_name}</span>
        <input
          type="number"
          step="any"
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-20 px-2 py-1.5 bg-beige-50 border border-beige-200 rounded-sm text-sm tnum text-center focus:outline-none focus:border-maroon-700"
        />
        <span className="text-xs text-beige-700 tnum">{row.unit ?? ''}</span>
        <input
          type="date"
          value={exp}
          onChange={e => setExp(e.target.value)}
          className="px-2 py-1.5 bg-beige-50 border border-beige-200 rounded-sm text-xs focus:outline-none focus:border-maroon-700"
        />
        <button onClick={handleSave} disabled={saving} className="px-3 py-1.5 bg-maroon-900 text-beige-50 rounded-sm text-xs disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs text-beige-700 hover:text-maroon-900">Cancel</button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 p-3 bg-white border border-beige-200 rounded-sm hover:border-maroon-300 transition group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isEmpty ? 'bg-beige-200' : isExpired ? 'bg-maroon-700' : 'bg-maroon-300'}`} />
        <span className="text-sm text-ink/85 truncate">{row.canonical_name}</span>
        {isExpired && <span className="text-[10px] tracking-eyebrow uppercase text-maroon-700">expired</span>}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-sm text-maroon-900 font-medium tnum">
          {row.quantity_on_hand} {row.unit ?? ''}
        </span>
        <button
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 transition text-xs text-beige-700 hover:text-maroon-900"
        >
          Edit
        </button>
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 transition text-beige-700 hover:text-maroon-700"
          aria-label="Delete"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

function AddPantryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('');
  const [exp, setExp] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSave() {
    setError(''); setSaving(true);
    try {
      await addPantryItem({
        ingredient_name: name,
        quantity: parseFloat(quantity) || 0,
        unit: unit || null,
        expiration_date: exp || null
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-beige-50 border border-beige-200 rounded-sm shadow-card-hover w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="font-display text-2xl text-maroon-900 mb-5">Add to pantry</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">Ingredient</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="garam masala"
              className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">Quantity</label>
              <input
                type="number"
                step="any"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm tnum focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
              />
            </div>
            <div>
              <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">Unit</label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
              >
                {UNITS.map(u => <option key={u} value={u}>{u || '—'}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">Expiration (optional)</label>
            <input
              type="date"
              value={exp}
              onChange={e => setExp(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
            />
          </div>
        </div>

        {error && <p className="mt-4 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">{error}</p>}

        <div className="flex gap-2 justify-end mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-ink/70 hover:text-maroon-900 transition">Cancel</button>
          <button onClick={handleSave} disabled={!name.trim() || saving} className="px-5 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50">
            {saving ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
