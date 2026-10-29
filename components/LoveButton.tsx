'use client';

import { useState } from 'react';
import { setLoved } from '@/app/(app)/recipe/[id]/actions';

/** Heart toggle. Loved recipes steer Claude's suggestions toward your taste. */
export default function LoveButton({ recipeId, loved, className = '' }: { recipeId: string; loved: boolean; className?: string }) {
  const [on, setOn] = useState(loved);

  async function toggle(e: React.MouseEvent) {
    // Cards wrap this in a link; don't navigate.
    e.preventDefault();
    e.stopPropagation();
    const next = !on;
    setOn(next);
    try {
      await setLoved(recipeId, next);
    } catch (err) {
      setOn(!next);
      alert(err instanceof Error ? err.message : 'Could not save');
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Loved. Tap to remove' : 'Love this recipe'}
      title={on ? 'Loved' : 'Love this recipe'}
      className={`w-8 h-8 flex items-center justify-center rounded-full bg-beige-50/95 backdrop-blur-sm transition hover:scale-110 ${className}`}
    >
      <svg viewBox="0 0 24 24" className={`w-4 h-4 ${on ? 'text-maroon-700' : 'text-beige-700'}`} fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.5 3.4 5 6.9 5c2 0 3.4 1.1 5.1 3 1.7-1.9 3.1-3 5.1-3 3.5 0 5.7 3.5 4.4 6.8C19.5 16.4 12 21 12 21Z" />
      </svg>
    </button>
  );
}
