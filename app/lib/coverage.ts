/**
 * "What can I make": compare recipes against the pantry in base units.
 */

import { addToNeed, emptyNeed, toBase, type IngredientUnits, type Need } from './units';

export type CoverageRecipe = {
  id: string;
  name: string;
  cuisine: string;
  ingredients: Array<{ ingredient_id: string; quantity: number | null; unit: string | null }>;
};

export type CoveragePantryRow = {
  ingredient_id: string;
  quantity_on_hand: number;
  unit: string | null;
  /** Purchase date of the oldest stock (YYYY-MM-DD), or null. */
  since: string | null;
};

export type Missing = {
  ingredient_id: string;
  name: string;
  /** What to buy: the shortfall in base units, plus parts with no known conversion. */
  need: Need;
};

export type Coverage = {
  recipe: CoverageRecipe;
  missing: Missing[];
  /** Days since the oldest pantry ingredient this recipe uses was bought. */
  oldestDays: number;
  oldestName: string | null;
};

/**
 * For each recipe (at its own yield), which non-staple ingredients the pantry
 * doesn't cover. An ingredient counts as covered when the pantry has at least
 * the needed amount; when either side's unit can't be converted, having any
 * of it counts, since we can't do better than that without guessing.
 */
export function computeCoverage(
  recipes: CoverageRecipe[],
  pantry: CoveragePantryRow[],
  units: Map<string, IngredientUnits>,
  staples: Set<string>,
  today = new Date()
): Coverage[] {
  const pantryByIngredient = new Map(pantry.map(p => [p.ingredient_id, p]));

  return recipes.map(recipe => {
    // Sum per ingredient so a recipe listing butter twice is checked once.
    const needs = new Map<string, { need: Need; toTaste: boolean }>();
    for (const ri of recipe.ingredients) {
      const ing = units.get(ri.ingredient_id);
      if (!ing || staples.has(ri.ingredient_id)) continue;
      const entry = needs.get(ri.ingredient_id) ?? { need: emptyNeed(), toTaste: false };
      if (ri.quantity === null) entry.toTaste = true;
      else entry.need = addToNeed(entry.need, Number(ri.quantity), ri.unit, ing);
      needs.set(ri.ingredient_id, entry);
    }

    const missing: Missing[] = [];
    let oldestDays = -1;
    let oldestName: string | null = null;

    for (const [ingredientId, { need, toTaste }] of Array.from(needs.entries())) {
      const ing = units.get(ingredientId)!;
      const row = pantryByIngredient.get(ingredientId);
      const qty = row ? Number(row.quantity_on_hand) : 0;
      const have = row ? toBase(qty, row.unit, ing) : 0;
      const hasAny = qty > 0;

      let covered: boolean;
      if (!hasAny) covered = false;
      else if (have == null || need.unresolved.length > 0) covered = true;  // can't compare: having some counts
      else covered = have >= need.base * 0.999 || (toTaste && need.base === 0);

      if (!covered) {
        const shortfall = Math.max(0, need.base - (have ?? 0));
        missing.push({
          ingredient_id: ingredientId,
          name: ing.name,
          // "To taste" with nothing on hand: buy the smallest package.
          need: shortfall > 0 || need.unresolved.length > 0
            ? { base: shortfall, unresolved: hasAny ? [] : need.unresolved }
            : { base: ing.purchase?.size ?? 1, unresolved: [] }
        });
        continue;
      }

      if (row?.since) {
        const days = Math.floor((today.getTime() - new Date(row.since).getTime()) / 86_400_000);
        if (days > oldestDays) { oldestDays = days; oldestName = ing.name; }
      }
    }

    missing.sort((a, b) => a.name.localeCompare(b.name));
    return { recipe, missing, oldestDays: Math.max(0, oldestDays), oldestName };
  });
}

/** Within a group, recipes using the longest-held pantry items come first. */
export function byUseItUp(a: Coverage, b: Coverage): number {
  return b.oldestDays - a.oldestDays || a.recipe.name.localeCompare(b.recipe.name);
}
