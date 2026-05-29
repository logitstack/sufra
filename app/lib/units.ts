/**
 * Unit conversion for grocery list aggregation.
 *
 * Strategy:
 *   - Convert all volumes to ml, all weights to g
 *   - Counts (no unit) stay as counts
 *   - When summing across recipes, group by ingredient + type (volume/weight/count)
 *   - If density is known, weight and volume can be combined (Phase 4 enhancement)
 */

export type UnitType = 'volume' | 'weight' | 'count' | 'unknown';

export type NormalizedQuantity = {
  type: UnitType;
  value: number;       // In base unit (ml for volume, g for weight, raw for count)
  originalUnit: string | null;
};

const VOLUME_TO_ML: Record<string, number> = {
  tsp:    4.92892,
  tbsp:  14.7868,
  cup:  236.588,
  fl_oz: 29.5735,
  ml:     1,
  l:   1000,
  pinch:  0.31  // ~1/16 tsp, approximation
};

const WEIGHT_TO_G: Record<string, number> = {
  g:    1,
  kg: 1000,
  oz:  28.3495,
  lb: 453.592
};

const COUNT_UNITS = new Set(['', 'each', 'bunch', 'clove', 'head', 'whole']);

/**
 * Normalize a quantity + unit into a base value.
 */
export function normalize(quantity: number | null, unit: string | null): NormalizedQuantity {
  if (quantity === null || isNaN(quantity)) return { type: 'count', value: 0, originalUnit: unit };
  const u = (unit ?? '').toLowerCase().trim();
  if (u in VOLUME_TO_ML) return { type: 'volume', value: quantity * VOLUME_TO_ML[u], originalUnit: u };
  if (u in WEIGHT_TO_G)  return { type: 'weight', value: quantity * WEIGHT_TO_G[u],  originalUnit: u };
  if (COUNT_UNITS.has(u)) return { type: 'count', value: quantity, originalUnit: u || null };
  return { type: 'unknown', value: quantity, originalUnit: u };
}

/**
 * Format a base value back into a human-friendly unit.
 * For volumes >= 240ml, prefer cups. For smaller, tbsp/tsp.
 * For weights >= 454g (1lb), prefer lb. Smaller, oz or g.
 */
export function formatQuantity(q: NormalizedQuantity, preferImperial = true): string {
  if (q.value <= 0) return '0';

  if (q.type === 'volume') {
    if (preferImperial) {
      if (q.value >= VOLUME_TO_ML.cup) {
        const cups = q.value / VOLUME_TO_ML.cup;
        return `${roundNicely(cups)} cup${cups >= 2 ? 's' : ''}`;
      }
      if (q.value >= VOLUME_TO_ML.tbsp) {
        const tbsps = q.value / VOLUME_TO_ML.tbsp;
        return `${roundNicely(tbsps)} tbsp`;
      }
      const tsps = q.value / VOLUME_TO_ML.tsp;
      return `${roundNicely(tsps)} tsp`;
    }
    return q.value >= 1000 ? `${roundNicely(q.value / 1000)} L` : `${roundNicely(q.value)} ml`;
  }

  if (q.type === 'weight') {
    if (preferImperial && q.value >= WEIGHT_TO_G.lb) {
      return `${roundNicely(q.value / WEIGHT_TO_G.lb)} lb`;
    }
    if (preferImperial && q.value >= WEIGHT_TO_G.oz * 4) {
      return `${roundNicely(q.value / WEIGHT_TO_G.oz)} oz`;
    }
    return q.value >= 1000 ? `${roundNicely(q.value / 1000)} kg` : `${roundNicely(q.value)} g`;
  }

  if (q.type === 'count') {
    const n = roundNicely(q.value);
    return q.originalUnit ? `${n} ${q.originalUnit}${q.value >= 2 ? 's' : ''}` : `${n}`;
  }

  // Unknown — best effort
  return `${roundNicely(q.value)}${q.originalUnit ? ` ${q.originalUnit}` : ''}`;
}

function roundNicely(n: number): string {
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10)  return n.toFixed(0);
  if (n >= 1)   return (Math.round(n * 4) / 4).toString();  // Quarter-step
  return (Math.round(n * 8) / 8).toString();                 // Eighth-step
}

/**
 * Sum two normalized quantities of the same type.
 */
export function add(a: NormalizedQuantity, b: NormalizedQuantity): NormalizedQuantity {
  if (a.type !== b.type) {
    // Mismatched types: fall back to whichever is non-zero
    if (a.value === 0) return b;
    if (b.value === 0) return a;
    // Truly mixed (volume + weight, etc) — caller should handle separately
    return a;
  }
  return { type: a.type, value: a.value + b.value, originalUnit: a.originalUnit };
}

/**
 * Subtract pantry from needed. Floors at zero.
 */
export function subtract(needed: NormalizedQuantity, have: NormalizedQuantity): NormalizedQuantity {
  if (needed.type !== have.type) return needed;
  return {
    type: needed.type,
    value: Math.max(0, needed.value - have.value),
    originalUnit: needed.originalUnit
  };
}

/**
 * Scale a normalized quantity by a factor (for "I cooked X servings").
 */
export function scale(q: NormalizedQuantity, factor: number): NormalizedQuantity {
  return { ...q, value: q.value * factor };
}

// =============================================================================
// DENSITY-AWARE CONVERSION
// A recipe measures salt in tsp (volume) but the pantry stocks it in grams
// (weight). Without density those two never reconcile. When an ingredient has a
// known density_g_per_ml, we collapse its volumes into grams so weight and
// volume live in one bucket and subtract/aggregate normally.
// =============================================================================

/**
 * Like normalize(), but converts volume → grams (type 'weight') when a density
 * is known. Weights and counts pass through unchanged.
 */
export function normalizeWithDensity(
  quantity: number | null,
  unit: string | null,
  density: number | null | undefined
): NormalizedQuantity {
  const n = normalize(quantity, unit);
  if (n.type === 'volume' && density != null) {
    return { type: 'weight', value: n.value * density, originalUnit: n.originalUnit };
  }
  return n;
}

/**
 * Convert a base value (grams for weight, ml for volume, raw for count) back
 * into `unit`. Uses density when the unit crosses between volume and weight.
 * Inverse of normalizeWithDensity for a single unit.
 */
export function fromBase(
  baseValue: number,
  unit: string | null,
  density: number | null | undefined
): number {
  const perUnit = normalizeWithDensity(1, unit, density).value;
  return perUnit ? baseValue / perUnit : baseValue;
}

const LIQUID_KEYWORDS = [
  'oil', 'milk', 'vinegar', 'juice', 'water', 'sauce',
  'syrup', 'stock', 'broth', 'cream', 'wine'
];

function isLiquid(name: string): boolean {
  const n = name.toLowerCase();
  return LIQUID_KEYWORDS.some(k => n.includes(k));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * How a reconciled shopping quantity is shown and edited. `text` is the label,
 * `value`+`unit` pre-fill the edit input, and `basePerUnit` converts an edited
 * display value back into the stored base value (grams / ml / count).
 */
export type ShoppingDisplay = {
  text: string;
  value: number;
  unit: string;
  basePerUnit: number;
};

/**
 * Format a shopping quantity in the unit you actually BUY it in:
 *   spices → grams, protein → lb, oils/liquids → ml, produce/eggs → counts.
 * `q` is the reconciled quantity (grams for weight, ml for volume, raw count).
 */
export function shoppingDisplay(
  q: NormalizedQuantity,
  category: string,
  name: string,
  density: number | null | undefined
): ShoppingDisplay {
  if (q.value <= 0) return { text: '0', value: 0, unit: q.originalUnit ?? '', basePerUnit: 1 };

  if (q.type === 'count') {
    const unit = q.originalUnit ?? '';
    return { text: formatQuantity(q), value: round2(q.value), unit, basePerUnit: 1 };
  }

  // Liquids: buy by volume. Convert grams → ml via density when collapsed.
  if (isLiquid(name)) {
    const gramsPerMl = q.type === 'weight' && density != null ? density : 1;
    const ml = q.type === 'weight' ? q.value / gramsPerMl : q.value;
    if (ml >= 1000) {
      return { text: `${roundNicely(ml / 1000)} L`, value: round2(ml / 1000), unit: 'L', basePerUnit: 1000 * gramsPerMl };
    }
    return { text: `${roundNicely(ml)} ml`, value: round2(ml), unit: 'ml', basePerUnit: gramsPerMl };
  }

  // Volume with no known density and not a recognized liquid — keep as ml/L.
  if (q.type === 'volume') {
    if (q.value >= 1000) return { text: `${roundNicely(q.value / 1000)} L`, value: round2(q.value / 1000), unit: 'L', basePerUnit: 1000 };
    return { text: `${roundNicely(q.value)} ml`, value: round2(q.value), unit: 'ml', basePerUnit: 1 };
  }

  // Weight (grams).
  if (category === 'protein') {
    const lb = q.value / WEIGHT_TO_G.lb;
    return { text: `${roundNicely(lb)} lb`, value: round2(lb), unit: 'lb', basePerUnit: WEIGHT_TO_G.lb };
  }
  if (q.value >= 1000) {
    return { text: `${roundNicely(q.value / 1000)} kg`, value: round2(q.value / 1000), unit: 'kg', basePerUnit: 1000 };
  }
  return { text: `${roundNicely(q.value)} g`, value: round2(q.value), unit: 'g', basePerUnit: 1 };
}
