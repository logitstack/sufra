'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { generateShoppingList, deletePlan } from '../actions';

export default function PlanActions({ planId, existingListId }: { planId: string; existingListId: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState('');

  async function handleGenerate() {
    setLoading(true); setError('');
    try {
      const { id } = await generateShoppingList(planId);
      router.push(`/shopping/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate list');
      setLoading(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        {existingListId ? (
          <>
            <Link
              href={`/shopping/${existingListId}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
            >
              View shopping list
            </Link>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-beige-200 text-ink rounded-sm hover:border-maroon-300 transition text-sm disabled:opacity-50"
            >
              {loading ? 'Regenerating…' : 'Regenerate list'}
            </button>
          </>
        ) : (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Generating…' : 'Generate shopping list'}
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setDeleteOpen(true)}
          className="inline-flex items-center gap-2 px-3 py-2.5 text-beige-700 hover:text-maroon-700 text-sm transition"
        >
          Delete plan
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">{error}</p>}

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={() => setDeleteOpen(false)}>
          <div className="bg-beige-50 border border-beige-200 rounded-sm shadow-card-hover w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-2xl text-maroon-900 mb-2">Delete this plan?</h3>
            <p className="text-sm text-beige-700 mb-5">The plan and any generated shopping lists will be removed. Recipes are not affected.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteOpen(false)} className="px-4 py-2 text-sm text-ink/70 hover:text-maroon-900 transition">Cancel</button>
              <button onClick={() => deletePlan(planId)} className="px-5 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
