'use client';

import { useState } from 'react';
import { canonicalUnit, formatRecipeQuantity, pluralUnit } from '@/app/lib/units';

export type DisplayIngredient = {
  quantity: number | null;
  unit: string | null;
  name: string;
  prep_note: string | null;
};

/**
 * Ingredients as entered, scaled to the servings picked. Cups and spoons read
 * as fractions ("1 1/2 cups"); units are never converted.
 */
export default function IngredientList({ ingredients, servingsYield }: { ingredients: DisplayIngredient[]; servingsYield: number }) {
  const [servings, setServings] = useState(servingsYield);
  const factor = servings / Math.max(1, servingsYield);

  return (
    <>
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="font-display text-2xl text-maroon-900">Ingredients</h2>
        <div className="flex items-center gap-2 text-xs tracking-eyebrow uppercase text-beige-700">
          <span>Serves</span>
          <button
            onClick={() => setServings(Math.max(1, servings - 1))}
            disabled={servings <= 1}
            aria-label="Fewer servings"
            className="w-6 h-6 flex items-center justify-center border border-beige-200 rounded-sm text-maroon-900 hover:border-maroon-700 transition disabled:opacity-30"
          >
            −
          </button>
          <span className="tnum text-maroon-900 font-medium w-5 text-center">{servings}</span>
          <button
            onClick={() => setServings(servings + 1)}
            aria-label="More servings"
            className="w-6 h-6 flex items-center justify-center border border-beige-200 rounded-sm text-maroon-900 hover:border-maroon-700 transition"
          >
            +
          </button>
        </div>
      </div>
      {servings !== servingsYield && (
        <p className="-mt-3 mb-4 text-[11px] text-beige-700">
          Scaled from {servingsYield}.{' '}
          <button onClick={() => setServings(servingsYield)} className="underline underline-offset-2 hover:text-maroon-900">Reset</button>
        </p>
      )}

      <ul className="space-y-3">
        {ingredients.map((ing, i) => {
          const qty = ing.quantity != null ? ing.quantity * factor : null;
          const unit = ing.unit ?? '';
          return (
            <li key={i} className="flex gap-3 items-baseline">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-maroon-700 flex-shrink-0 translate-y-[-2px]" />
              <div className="text-sm leading-relaxed">
                {(qty !== null || unit) && (
                  <span className="text-maroon-900 font-medium tnum mr-1">
                    {qty !== null ? formatRecipeQuantity(qty, unit) : ''}
                    {unit ? ` ${unitText(unit, qty ?? 1)}` : ''}
                  </span>
                )}
                <span className="text-ink/85">{ing.name}</span>
                {ing.prep_note && <span className="text-beige-700 italic">, {ing.prep_note}</span>}
              </div>
            </li>
          );
        })}
        {ingredients.length === 0 && (
          <li className="text-sm text-beige-700 italic">No ingredients listed.</li>
        )}
      </ul>
    </>
  );
}

/** Plural for units Sufra knows ("cups"); anything else shows as stored. */
function unitText(unit: string, qty: number): string {
  return canonicalUnit(unit) === unit ? pluralUnit(unit, qty) : unit.replace('_', ' ');
}
