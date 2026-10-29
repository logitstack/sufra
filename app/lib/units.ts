/**
 * Units for Sufra.
 *
 * Three display layers and one hidden math layer:
 *   - Recipes display amounts exactly as entered (nothing here rewrites them).
 *   - Math converts every amount into ONE base unit per ingredient: grams, or a
 *     count for countable items (eggs, onions, garlic cloves). See toBase().
 *   - The pantry displays cooking units (tsp / cup / g / counts). See cookingDisplay().
 *   - The grocery list displays whole purchase packages. See purchaseDisplay().
 *
 * Conversions are looked up in this order: an explicit per-ingredient row from
 * ingredient_conversions (container sizes like "can", or sizes the user told
 * us), then the generic 'g' / 'ml' / 'each' rows, then the ingredient's own
 * density and grams_per_count. When none apply, toBase() returns null and the
 * caller keeps that part as "unresolved" instead of guessing.
 */

export type BaseUnit = 'g' | 'count';

/** measured: the pantry holds an amount. status: only have / low / out. */
export type TrackingMode = 'measured' | 'status';
export type PantryStatus = 'have' | 'low' | 'out';

export type IngredientUnits = {
  id: string;
  name: string;
  category: string;
  base_unit: BaseUnit;
  /** Effective mode: the user's choice, else the ingredient's, else its category's. */
  tracking_mode: TrackingMode;
  /** What one count is called ('clove', 'bunch'). null means "each". */
  count_unit: string | null;
  /** g per ml. */
  density: number | null;
  grams_per_count: number | null;
  default_unit: string | null;
  /** unit -> base amount in one of that unit. User rows already override standard rows. */
  conversions: Record<string, number>;
  /** How this ingredient is bought. User's learned size wins over the default. */
  purchase: PurchaseSize | null;
};

export type PurchaseSize = {
  unit: string;
  /** Base amount (g or count) in one purchase unit. */
  size: number;
  label: string | null;
};

/** One amount that could not be converted to the base unit yet. */
export type UnresolvedPart = { quantity: number; unit: string };

/** Aggregated need for one ingredient. */
export type Need = { base: number; unresolved: UnresolvedPart[] };

export const VOLUME_TO_ML: Record<string, number> = {
  tsp:      4.92892,
  tbsp:    14.7868,
  cup:    236.588,
  fl_oz:   29.5735,
  ml:       1,
  l:     1000,
  pint:   473.176,
  quart:  946.353,
  gallon: 3785.41,
  pinch:    0.31,  // ~1/16 tsp
  dash:     0.62   // ~1/8 tsp
};

export const MASS_TO_G: Record<string, number> = {
  g:    1,
  kg: 1000,
  oz:  28.3495,
  lb: 453.592
};

/** Units that just mean "one of the thing". */
const COUNT_WORDS = new Set(['', 'each', 'whole', 'large', 'medium', 'small', 'piece']);

const UNIT_ALIASES: Record<string, string> = {
  tsp: 'tsp', tsps: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tbsps: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cup: 'cup', cups: 'cup',
  floz: 'fl_oz', fl_oz: 'fl_oz', fluidounce: 'fl_oz', fluidounces: 'fl_oz',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  pt: 'pint', pint: 'pint', pints: 'pint',
  qt: 'quart', quart: 'quart', quarts: 'quart',
  gal: 'gallon', gallon: 'gallon', gallons: 'gallon',
  g: 'g', gr: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  pinch: 'pinch', pinches: 'pinch',
  dash: 'dash', dashes: 'dash',
  bunch: 'bunch', bunches: 'bunch',
  clove: 'clove', cloves: 'clove',
  head: 'head', heads: 'head',
  can: 'can', cans: 'can', tin: 'can', tins: 'can',
  stick: 'stick', sticks: 'stick',
  package: 'package', packages: 'package', pkg: 'package', packet: 'package', packets: 'package',
  jar: 'jar', jars: 'jar',
  bottle: 'bottle', bottles: 'bottle',
  slice: 'slice', slices: 'slice',
  inch: 'inch', inches: 'inch',
  sprig: 'sprig', sprigs: 'sprig',
  piece: 'piece', pieces: 'piece', pc: 'piece', pcs: 'piece',
  count: 'each', each: 'each', ea: 'each', whole: 'whole', large: 'large', medium: 'medium', small: 'small'
};

/**
 * Canonical spelling for a unit: "Teaspoons" -> "tsp", "cans" -> "can".
 * Count words collapse to ''. Unknown units are lowercased and kept.
 */
export function canonicalUnit(raw: string | null | undefined): string {
  if (!raw) return '';
  const r = raw.toLowerCase().trim().replace(/\./g, '');
  const key = r.replace(/\s+/g, '');
  const u = UNIT_ALIASES[key] ?? UNIT_ALIASES[r] ?? r;
  return COUNT_WORDS.has(u) ? '' : u;
}

export function isVolumeUnit(u: string): boolean { return u in VOLUME_TO_ML; }
export function isMassUnit(u: string): boolean { return u in MASS_TO_G; }

/** Key used in ingredient_conversions for a unit. Count words share 'each'. */
export function conversionKey(unit: string | null | undefined): string {
  return canonicalUnit(unit) || 'each';
}

/**
 * Convert an amount to the ingredient's base unit (grams or count).
 * Returns null when no conversion is known.
 */
export function toBase(quantity: number, unit: string | null | undefined, ing: IngredientUnits): number | null {
  const u = canonicalUnit(unit);
  const conv = ing.conversions;

  // Explicit row for this exact unit (container sizes, user-supplied sizes).
  const exact = conv[conversionKey(u)];
  if (exact != null) return quantity * exact;

  if (isMassUnit(u)) {
    const grams = quantity * MASS_TO_G[u];
    if (ing.base_unit === 'g') return grams;
    if (conv.g != null) return grams * conv.g;
    return ing.grams_per_count ? grams / ing.grams_per_count : null;
  }

  if (isVolumeUnit(u)) {
    const ml = quantity * VOLUME_TO_ML[u];
    if (conv.ml != null) return ml * conv.ml;
    if (ing.density == null) return null;
    const grams = ml * ing.density;
    if (ing.base_unit === 'g') return grams;
    return ing.grams_per_count ? grams / ing.grams_per_count : null;
  }

  // A bare count ("2 eggs"), or the ingredient's own count unit ("3 cloves garlic").
  if (u === '' || u === ing.count_unit) {
    if (ing.base_unit === 'count') return quantity;
    return ing.grams_per_count ? quantity * ing.grams_per_count : null;
  }

  return null;
}

/** Base amount in one `unit`, or null if unknown. */
export function basePerUnit(unit: string | null | undefined, ing: IngredientUnits): number | null {
  return toBase(1, unit, ing);
}

// =============================================================================
// AGGREGATION
// =============================================================================

export function emptyNeed(): Need {
  return { base: 0, unresolved: [] };
}

/** Add an amount to a need, keeping unconvertible parts grouped by unit. */
export function addToNeed(need: Need, quantity: number, unit: string | null | undefined, ing: IngredientUnits): Need {
  const base = toBase(quantity, unit, ing);
  if (base != null) return { base: need.base + base, unresolved: need.unresolved };
  const u = canonicalUnit(unit) || 'each';
  const existing = need.unresolved.find(p => p.unit === u);
  const unresolved = existing
    ? need.unresolved.map(p => (p.unit === u ? { ...p, quantity: p.quantity + quantity } : p))
    : [...need.unresolved, { quantity, unit: u }];
  return { base: need.base, unresolved };
}

// =============================================================================
// DISPLAY
// =============================================================================

export function roundNicely(n: number): string {
  if (n >= 100) return Math.round(n).toString();
  if (n >= 10)  return n.toFixed(0);
  if (n >= 1)   return (Math.round(n * 4) / 4).toString();  // Quarter-step
  return (Math.round(n * 8) / 8).toString();                 // Eighth-step
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const NO_PLURAL = new Set(['tsp', 'tbsp', 'fl_oz', 'ml', 'l', 'g', 'kg', 'oz', 'lb', '']);
const ES_PLURAL = new Set(['bunch', 'pinch', 'dash', 'box', 'inch']);

export function pluralUnit(unit: string, n: number): string {
  const label = unit === 'fl_oz' ? 'fl oz' : unit;
  if (n <= 1 || NO_PLURAL.has(unit)) return label;
  return ES_PLURAL.has(unit) ? `${label}es` : `${label}s`;
}

// =============================================================================
// FRACTIONS
// Cups and spoons read as cooking fractions ("1 1/2 cups", "1/3 tsp"), never
// decimals. Metric amounts stay decimal.
// =============================================================================

const COOKING_FRACTIONS: Array<[number, string]> = [
  [0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'], [2 / 3, '2/3'], [3 / 4, '3/4'], [1, '']
];

/** Units shown as plain decimals rather than fractions. */
const DECIMAL_UNITS = new Set(['g', 'kg', 'ml', 'l']);

/** Round to the nearest common cooking fraction: 1.5 -> "1 1/2", 0.333 -> "1/3". */
export function formatFraction(n: number): string {
  if (!(n > 0)) return '0';
  let whole = Math.floor(n);
  const rest = n - whole;
  let best = COOKING_FRACTIONS[0];
  for (const f of COOKING_FRACTIONS) if (Math.abs(rest - f[0]) < Math.abs(rest - best[0])) best = f;
  if (best[0] === 1) whole += 1;
  if (whole === 0) return best[1] || '1/8';  // Never round a real amount down to nothing
  return best[1] ? `${whole} ${best[1]}` : `${whole}`;
}

function formatDecimal(n: number): string {
  if (n >= 10) return Math.round(n).toString();
  return (Math.round(n * 100) / 100).toString();
}

/**
 * A recipe amount as entered (or scaled): fractions for everything except
 * metric units. "1 1/2 cups", "1/3 tsp", "2 1/2 lb", "250 g", "2".
 */
export function formatRecipeQuantity(quantity: number, unit: string | null | undefined): string {
  return DECIMAL_UNITS.has(canonicalUnit(unit)) ? formatDecimal(quantity) : formatFraction(quantity);
}

/**
 * Parse what a cook types: "1 1/2", "1-1/2", "3/4", "1.5", "½", "1½".
 * Returns null for blank or unreadable input.
 */
export function parseQuantity(input: string | null | undefined): number | null {
  if (!input) return null;
  const vulgar: Record<string, string> = {
    '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
  };
  const s = input.trim()
    .replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, '$1 $2')
    .replace(/[¼½¾⅓⅔⅛⅜⅝⅞]/g, c => vulgar[c])
    .replace(/^(\d+)-(\d+\/\d+)$/, '$1 $2');
  if (!s) return null;
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[3]) > 0 ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : null;
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) > 0 ? Number(frac[1]) / Number(frac[2]) : null;
  if (!/^\d*\.?\d+$/.test(s)) return null;
  return parseFloat(s);
}

/** Pantry and list amounts in these units read as fractions too. */
const FRACTION_DISPLAY_UNITS = new Set(['tsp', 'tbsp', 'cup']);

/** "2 tsp", "1 can", "3" — an amount in its own unit. */
export function formatAmount(quantity: number, unit: string): string {
  const u = unit === 'each' ? '' : unit;
  const n = FRACTION_DISPLAY_UNITS.has(u) ? formatFraction(quantity) : roundNicely(quantity);
  return u ? `${n} ${pluralUnit(u, quantity)}` : n;
}


/** "2 tsp + 1 can" */
export function formatUnresolved(parts: UnresolvedPart[]): string {
  return parts.map(p => formatAmount(p.quantity, p.unit)).join(' + ');
}

/** A display string plus a matching edit value: `value` × `basePerUnit` = base. */
export type Display = {
  text: string;
  value: number;
  unit: string;
  basePerUnit: number;
};

function countDisplay(count: number, ing: IngredientUnits): Display {
  const unit = ing.count_unit ?? '';
  return { text: formatAmount(count, unit), value: round2(count), unit, basePerUnit: 1 };
}

function gramsDisplay(g: number): Display {
  if (g >= 1000) return { text: `${roundNicely(g / 1000)} kg`, value: round2(g / 1000), unit: 'kg', basePerUnit: 1000 };
  return { text: `${roundNicely(g)} g`, value: round2(g), unit: 'g', basePerUnit: 1 };
}

/**
 * Pantry display: close to how recipes describe the ingredient. Things usually
 * measured by spoon or cup (per default_unit) show in tsp / tbsp / cups when a
 * density is known; everything else shows grams or counts.
 */
export function cookingDisplay(base: number, ing: IngredientUnits): Display {
  if (ing.base_unit === 'count') return countDisplay(base, ing);

  const defaultU = canonicalUnit(ing.default_unit);
  const density = ing.conversions.ml ?? ing.density;
  if (density && isVolumeUnit(defaultU) && base > 0) {
    const ml = base / density;
    if (ml < 4 * VOLUME_TO_ML.cup) {
      const unit = ml >= VOLUME_TO_ML.cup / 4 ? 'cup' : ml >= VOLUME_TO_ML.tbsp ? 'tbsp' : 'tsp';
      const per = VOLUME_TO_ML[unit] * density;
      const value = base / per;
      return { text: formatAmount(value, unit), value: round2(value), unit, basePerUnit: per };
    }
  }
  return gramsDisplay(base);
}

/** Units that are themselves the package, so "2 cans" needs no size label. */
const SELF_DESCRIBING = new Set(['can', 'stick', 'head', 'bunch', 'each', '']);

/**
 * Grocery display: whole purchase packages, rounded up. "2 cans",
 * "1 bag (1 kg)". Without a purchase size, weights round up to a buyable amount
 * and counts round up to whole items.
 *
 * `value`/`unit`/`basePerUnit` pre-fill the "how much did you buy" input, and
 * `purchaseBase` is the base amount you'd bring home.
 */
export function purchaseDisplay(base: number, ing: IngredientUnits): Display & { purchaseBase: number } {
  const p = ing.purchase;
  if (p && p.size > 0) {
    const packages = Math.max(1, Math.ceil(base / p.size - 1e-9));
    const label = p.label && !SELF_DESCRIBING.has(p.unit) ? ` (${p.label})` : '';
    return {
      text: `${packages} ${pluralUnit(p.unit, packages)}${label}`,
      value: packages,
      unit: p.unit,
      basePerUnit: p.size,
      purchaseBase: packages * p.size
    };
  }

  if (ing.base_unit === 'count') {
    const n = Math.max(1, Math.ceil(base - 1e-9));
    return { ...countDisplay(n, ing), purchaseBase: n };
  }

  // Meat, produce and anything sold loose: buy by the quarter pound once it's
  // big enough, otherwise round grams up to the next 10.
  if (base >= MASS_TO_G.lb / 2 || ing.category === 'protein') {
    const lb = Math.ceil(base / MASS_TO_G.lb * 4 - 1e-9) / 4;
    return { text: `${lb} lb`, value: lb, unit: 'lb', basePerUnit: MASS_TO_G.lb, purchaseBase: lb * MASS_TO_G.lb };
  }
  const g = Math.max(10, Math.ceil(base / 10 - 1e-9) * 10);
  return { text: `${g} g`, value: g, unit: 'g', basePerUnit: 1, purchaseBase: g };
}

/** Full grocery line text, e.g. "1 bag (1 kg)", "2 tsp + 1 can". */
export function needText(need: Need, ing: IngredientUnits): string {
  const parts: string[] = [];
  if (need.base > 0) parts.push(purchaseDisplay(need.base, ing).text);
  if (need.unresolved.length) parts.push(formatUnresolved(need.unresolved));
  return parts.join(' + ');
}

// =============================================================================
// MISSING CONVERSIONS
// What to ask the user when a unit can't be converted, and how to store the
// answer as an ingredient_conversions row.
// =============================================================================

export type ConversionQuestion = {
  /** What the answer measures: a weight (g/oz/lb/kg) or a count of items. */
  answer: 'weight' | 'count';
  text: string;
};

export function conversionQuestion(unit: string, ing: IngredientUnits): ConversionQuestion {
  const u = canonicalUnit(unit);
  const item = ing.count_unit ? `${ing.count_unit} of ${ing.name}` : ing.name;
  if (ing.base_unit === 'count') {
    if (isMassUnit(u)) return { answer: 'weight', text: `How much does 1 ${item} weigh?` };
    const what = ing.count_unit ? pluralUnit(ing.count_unit, 2) : ing.name;
    return { answer: 'count', text: `How many ${what} are in 1 ${u.replace('_', ' ') || 'item'}?` };
  }
  if (isVolumeUnit(u)) return { answer: 'weight', text: `How much does 1 ${u.replace('_', ' ')} of ${ing.name} weigh?` };
  if (u === '') return { answer: 'weight', text: `How much does 1 ${ing.name} weigh?` };
  return { answer: 'weight', text: `How much ${ing.name} is in 1 ${u}?` };
}

/**
 * Turn the user's answer into the conversion row to store: { unit key, base per unit }.
 * `answerQty`/`answerUnit` are what they typed ("397", "g"), or a plain count.
 */
export function conversionFromAnswer(
  unit: string,
  answerQty: number,
  answerUnit: string,
  ing: IngredientUnits
): { unit: string; base_per_unit: number } | null {
  if (!(answerQty > 0)) return null;
  const u = canonicalUnit(unit);
  const q = conversionQuestion(u, ing);

  if (q.answer === 'count') {
    // Count ingredients: N items per one of `u`.
    if (isVolumeUnit(u)) return { unit: 'ml', base_per_unit: answerQty / VOLUME_TO_ML[u] };
    return { unit: conversionKey(u), base_per_unit: answerQty };
  }

  const au = canonicalUnit(answerUnit);
  if (!isMassUnit(au)) return null;
  const grams = answerQty * MASS_TO_G[au];

  if (ing.base_unit === 'count') {
    // Weight of one item -> counts per gram.
    return { unit: 'g', base_per_unit: 1 / grams };
  }
  if (isVolumeUnit(u)) return { unit: 'ml', base_per_unit: grams / VOLUME_TO_ML[u] };
  return { unit: conversionKey(u), base_per_unit: grams };
}

// =============================================================================
// PACKAGE SIZES
// =============================================================================

/**
 * A package size as an editable amount + unit, e.g. 1000 g with label "1 kg"
 * -> { quantity: 1, unit: 'kg' }. Uses the label when it parses and agrees
 * with the base size, otherwise grams / kg or a count.
 */
export function sizeForEdit(sizeBase: number, ing: IngredientUnits, label?: string | null): { quantity: number; unit: string } {
  const m = label?.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (m) {
    const q = parseFloat(m[1]);
    const u = canonicalUnit(m[2]);
    const b = toBase(q, u, ing);
    if (b != null && Math.abs(b - sizeBase) <= sizeBase * 0.05) return { quantity: q, unit: u };
  }
  if (ing.base_unit === 'count') return { quantity: round2(sizeBase), unit: '' };
  return sizeBase >= 1000 ? { quantity: round2(sizeBase / 1000), unit: 'kg' } : { quantity: round2(sizeBase), unit: 'g' };
}

/** "1 kg", "26 oz", "12" */
export function sizeLabel(quantity: number, unit: string): string {
  return formatAmount(quantity, canonicalUnit(unit));
}

/** Common sizes to offer when we don't know what the user usually buys. */
// =============================================================================
// PANTRY STATUS
// =============================================================================

/**
 * Status of a status-tracked pantry row. Rows saved before tracking modes
 * existed have no status: any amount on hand reads as 'have'.
 */
export function pantryStatusOf(row: { status?: string | null; quantity_on_hand: number } | null | undefined): PantryStatus {
  if (!row) return 'out';
  if (row.status === 'have' || row.status === 'low' || row.status === 'out') return row.status;
  return Number(row.quantity_on_hand) > 0 ? 'have' : 'out';
}

export const STATUS_LABEL: Record<PantryStatus, string> = {
  have: 'Have it',
  low: 'Running low',
  out: 'Out'
};

export function commonSizes(ing: IngredientUnits): Array<{ quantity: number; unit: string }> {
  if (ing.base_unit === 'count') {
    return ing.count_unit ? [{ quantity: 1, unit: '' }, { quantity: 2, unit: '' }] : [{ quantity: 1, unit: '' }, { quantity: 6, unit: '' }, { quantity: 12, unit: '' }];
  }
  if (ing.category === 'protein') return [{ quantity: 1, unit: 'lb' }, { quantity: 2, unit: 'lb' }, { quantity: 3, unit: 'lb' }];
  if (ing.category === 'spice') return [{ quantity: 50, unit: 'g' }, { quantity: 100, unit: 'g' }, { quantity: 1, unit: 'kg' }];
  return [{ quantity: 250, unit: 'g' }, { quantity: 500, unit: 'g' }, { quantity: 1, unit: 'kg' }, { quantity: 1, unit: 'lb' }, { quantity: 2, unit: 'lb' }];
}
