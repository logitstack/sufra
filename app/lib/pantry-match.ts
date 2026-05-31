/**
 * Fuzzy pantry matching for shopping-list suggestions.
 *
 * The shopping list subtracts pantry only on an exact ingredient match with
 * compatible units (see generateShoppingList). When that precise path can't
 * apply — a different-but-related ingredient (recipe wants "chicken thighs",
 * pantry has "chicken breast") or the same ingredient in an incomparable unit
 * (recipe wants "garlic cloves", pantry has a jar of "minced garlic") — we
 * don't guess at the math. Instead we surface a hint beneath the item so the
 * shopper can decide whether what they have will do.
 */

import { normalizeWithDensity, type UnitType } from './units';

export type PantryRowForMatch = {
  ingredient_id: string;
  quantity_on_hand: number;
  unit: string | null;
  canonical_name: string;
};

export type ShoppingItemForMatch = {
  ingredient_id: string;
  name: string;
  /** Measurement type of the listed quantity (after density collapse). */
  type: UnitType;
  /** Ingredient density, so a same-ingredient pantry row collapses the same way. */
  density: number | null;
};

// Descriptors and form words that say nothing about *which* ingredient it is.
// Dropping them keeps the keyword overlap focused on the food itself, so
// "minced garlic" still relates to "garlic" and "boneless chicken thighs" to
// "chicken breast".
const STOPWORDS = new Set([
  'fresh', 'ground', 'large', 'small', 'medium', 'boneless', 'skinless',
  'chopped', 'minced', 'diced', 'sliced', 'whole', 'raw', 'cooked', 'dried',
  'frozen', 'organic', 'ripe', 'extra', 'virgin', 'pure', 'plain', 'with',
  'and', 'the', 'for', 'of', 'in', 'powder', 'powdered'
]);

/**
 * Significant lowercase tokens of an ingredient name: letters only, at least
 * 4 chars, excluding generic descriptors.
 */
export function keywords(name: string): Set<string> {
  const out = new Set<string>();
  for (const raw of name.toLowerCase().split(/[^a-z]+/)) {
    if (raw.length >= 4 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

function intersects(a: Set<string>, b: Set<string>): boolean {
  for (const k of a) if (b.has(k)) return true;
  return false;
}

function label(row: PantryRowForMatch): string {
  const qty = Number.isInteger(row.quantity_on_hand)
    ? String(row.quantity_on_hand)
    : String(Math.round(row.quantity_on_hand * 100) / 100);
  const unit = row.unit ? ` ${row.unit}` : '';
  return `In pantry: ${qty}${unit} ${row.canonical_name}`;
}

/**
 * Pantry rows worth suggesting for a shopping item that survived precise
 * subtraction. A row qualifies when it is:
 *   - a different-but-related ingredient (shared keyword, e.g. chicken
 *     thighs <-> chicken breast), or
 *   - the same ingredient in an INCOMPARABLE unit — its measurement type
 *     differs from the item's, so subtraction couldn't touch it. (Same-type
 *     rows were already subtracted in generateShoppingList, so suggesting them
 *     would double-count what's still on the list.)
 * Rows with nothing on hand are skipped. Returns ready-to-render labels.
 */
export function relatedPantry(
  item: ShoppingItemForMatch,
  pantry: PantryRowForMatch[]
): string[] {
  const itemKeywords = keywords(item.name);
  const out: string[] = [];
  for (const row of pantry) {
    if (row.quantity_on_hand <= 0) continue;
    if (row.ingredient_id === item.ingredient_id) {
      const haveType = normalizeWithDensity(row.quantity_on_hand, row.unit, item.density).type;
      if (haveType !== item.type) out.push(label(row));  // incomparable -> suggest
      continue;
    }
    if (intersects(itemKeywords, keywords(row.canonical_name))) out.push(label(row));
  }
  return out;
}
