'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { shareRecipe, deleteRecipe, forkRecipe } from './actions';
import { cookRecipe, setPantryItemStatus, type CookedStatusItem } from '@/app/(app)/pantry/actions';
import { STATUS_LABEL, type PantryStatus } from '@/app/lib/units';

export default function RecipeActions({
  recipeId,
  isOwner,
  shareCount,
  defaultServings
}: {
  recipeId: string;
  isOwner: boolean;
  shareCount: number;
  defaultServings: number;
}) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cookOpen, setCookOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareStatus, setShareStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [shareError, setShareError] = useState('');
  const [forking, setForking] = useState(false);
  const [servingsMade, setServingsMade] = useState(String(defaultServings));
  const [cooking, setCooking] = useState(false);
  const [cookDone, setCookDone] = useState(false);
  const [statusItems, setStatusItems] = useState<CookedStatusItem[]>([]);

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    setShareStatus('sending');
    setShareError('');
    try {
      await shareRecipe(recipeId, shareEmail);
      setShareStatus('done');
      setShareEmail('');
      setTimeout(() => { setShareOpen(false); setShareStatus('idle'); router.refresh(); }, 1200);
    } catch (err) {
      setShareStatus('error');
      setShareError(err instanceof Error ? err.message : 'Share failed');
    }
  }

  async function handleDelete() {
    try {
      await deleteRecipe(recipeId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleFork() {
    setForking(true);
    try {
      await forkRecipe(recipeId);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fork failed');
      setForking(false);
    }
  }

  async function handleCook() {
    setCooking(true);
    try {
      const { statusItems } = await cookRecipe(recipeId, parseInt(servingsMade) || defaultServings);
      setStatusItems(statusItems);
      setCookDone(true);
      setCooking(false);
      if (statusItems.length === 0) {
        setTimeout(() => { setCookOpen(false); setCookDone(false); router.refresh(); }, 1500);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Could not update pantry');
      setCooking(false);
    }
  }

  async function handleStatus(item: CookedStatusItem, status: PantryStatus) {
    const previous = statusItems;
    setStatusItems(statusItems.map(s => s.ingredient_id === item.ingredient_id ? { ...s, status } : s));
    try {
      await setPantryItemStatus(item.ingredient_id, status);
    } catch (err) {
      setStatusItems(previous);
      alert(err instanceof Error ? err.message : 'Could not update pantry');
    }
  }

  function closeCook() {
    setCookOpen(false);
    setCookDone(false);
    setStatusItems([]);
    router.refresh();
  }

  return (
    <>
      <div className="mt-16 flex flex-wrap gap-3 rise-in delay-6">
        {isOwner ? (
          <>
            <button
              onClick={() => setCookOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5v14" />
              </svg>
              I cooked this
            </button>
            <button
              onClick={() => setShareOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-beige-200 text-ink rounded-sm hover:border-maroon-300 transition text-sm"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                <path d="m16 6-4-4-4 4" />
                <path d="M12 2v13" />
              </svg>
              Share{shareCount > 0 ? ` · ${shareCount}` : ''}
            </button>
            <div className="flex-1" />
            <button
              onClick={() => setDeleteOpen(true)}
              className="inline-flex items-center gap-2 px-3 py-2.5 text-beige-700 hover:text-maroon-700 text-sm transition"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              </svg>
              Delete
            </button>
          </>
        ) : (
          <button
            onClick={handleFork}
            disabled={forking}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {forking ? 'Copying…' : 'Save a copy to my library'}
          </button>
        )}
      </div>

      {/* Cook modal */}
      {cookOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={() => !cooking && (cookDone ? closeCook() : setCookOpen(false))}>
          <div className="bg-beige-50 border border-beige-200 rounded-sm shadow-card-hover w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            {cookDone ? (
              <div className="text-center py-4">
                <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-maroon-100 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-6 h-6 text-maroon-900" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                </div>
                <h3 className="font-display text-2xl text-maroon-900 mb-1">Pantry updated.</h3>
                <p className="text-sm text-beige-700">Ingredients deducted based on servings cooked.</p>
                {statusItems.length > 0 && (
                  <div className="mt-6 text-left">
                    <p className="text-sm text-ink/85 mb-3">Did any of these run low?</p>
                    <ul className="space-y-2">
                      {statusItems.map(item => (
                        <li key={item.ingredient_id} className="flex items-center justify-between gap-3">
                          <span className="text-sm text-ink/85 truncate">{item.name}</span>
                          <div className="flex gap-1 flex-shrink-0">
                            {(['have', 'low', 'out'] as const).map(st => (
                              <button
                                key={st}
                                onClick={() => handleStatus(item, st)}
                                className={`px-2 py-1 text-[11px] rounded-sm border transition ${item.status === st ? 'bg-maroon-900 border-maroon-900 text-beige-50' : 'border-beige-200 text-maroon-900 hover:border-maroon-700'}`}
                              >
                                {STATUS_LABEL[st]}
                              </button>
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="flex justify-end mt-5">
                      <button onClick={closeCook} className="px-5 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium">Done</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
                <h3 className="font-display text-2xl text-maroon-900 mb-2">Mark as cooked</h3>
                <p className="text-sm text-beige-700 mb-5">
                  Ingredients you have in your pantry will be deducted based on how many servings you made.
                </p>

                <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">
                  Servings made (recipe makes {defaultServings})
                </label>
                <input
                  type="number"
                  min="1"
                  value={servingsMade}
                  onChange={e => setServingsMade(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm tnum focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
                  autoFocus
                />

                <div className="flex gap-2 justify-end mt-6">
                  <button onClick={() => setCookOpen(false)} disabled={cooking} className="px-4 py-2 text-sm text-ink/70 hover:text-maroon-900 transition">Cancel</button>
                  <button
                    onClick={handleCook}
                    disabled={cooking}
                    className="px-5 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-60"
                  >
                    {cooking ? 'Updating…' : 'Mark cooked'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Share modal */}
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={() => setShareOpen(false)}>
          <div className="bg-beige-50 border border-beige-200 rounded-sm shadow-card-hover w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-2xl text-maroon-900 mb-2">Share this recipe</h3>
            <p className="text-sm text-beige-700 mb-5">
              Enter the email of someone with a Sufra account. They get read-only access.
            </p>

            {shareStatus === 'done' ? (
              <div className="p-3 bg-maroon-100 border border-maroon-300 text-maroon-900 text-sm rounded-sm">
                Shared successfully.
              </div>
            ) : (
              <form onSubmit={handleShare} className="space-y-4">
                <input
                  type="email"
                  required
                  value={shareEmail}
                  onChange={e => setShareEmail(e.target.value)}
                  placeholder="friend@example.com"
                  className="w-full px-4 py-3 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
                />
                {shareError && (
                  <p className="text-sm text-maroon-700 bg-maroon-100 px-3 py-2 rounded-sm">{shareError}</p>
                )}
                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShareOpen(false)} className="px-4 py-2 text-sm text-ink/70 hover:text-maroon-900 transition">Cancel</button>
                  <button type="submit" disabled={shareStatus === 'sending'} className="px-5 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-60">
                    {shareStatus === 'sending' ? 'Sharing…' : 'Share'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={() => setDeleteOpen(false)}>
          <div className="bg-beige-50 border border-beige-200 rounded-sm shadow-card-hover w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="font-display text-2xl text-maroon-900 mb-2">Delete this recipe?</h3>
            <p className="text-sm text-beige-700 mb-5">
              This cannot be undone. Any shares you created will also be removed.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteOpen(false)} className="px-4 py-2 text-sm text-ink/70 hover:text-maroon-900 transition">Cancel</button>
              <button onClick={handleDelete} className="px-5 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium">Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
