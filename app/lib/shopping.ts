/**
 * How a shopping item reads, shared by the review screen and the final list.
 */

import { formatUnresolved, purchaseDisplay, toBase, type IngredientUnits, type UnresolvedPart } from './units';

export type ShoppingSection = 'buy' | 'similar' | 'low' | 'have';

export type LineAmount = {
  /** Base amount still to buy. */
  base: number;
  unresolved: UnresolvedPart[];
  /** "2 cans", "1 bag (1 kg)", "2 tsp + 1 can". Empty when there's nothing to show. */
  text: string;
};

/**
 * Amount for a stored shopping item in whole purchase packages. Status-tracked
 * items are bought one package at a time, whatever the recipes call for.
 */
export function lineAmount(
  item: { quantity_needed: number; unit: string | null; unresolved: UnresolvedPart[] | null },
  ing: IngredientUnits
): LineAmount {
  if (ing.tracking_mode === 'status') {
    const size = ing.purchase?.size ?? 0;
    return { base: size, unresolved: [], text: size > 0 ? purchaseDisplay(size, ing).text : '' };
  }

  // Older lists stored ml / g / count units; toBase reads those too.
  const unresolved = [...(item.unresolved ?? [])];
  let base = toBase(Number(item.quantity_needed), item.unit, ing);
  if (base == null) {
    unresolved.push({ quantity: Number(item.quantity_needed), unit: item.unit ?? 'each' });
    base = 0;
  }
  const parts = [base > 0 ? purchaseDisplay(base, ing).text : null, unresolved.length ? formatUnresolved(unresolved) : null];
  return { base, unresolved, text: parts.filter(Boolean).join(' + ') };
}
