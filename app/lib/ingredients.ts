/**
 * Canonical ingredient lookup and unit data loading. Server only.
 */

import { z } from 'zod';
import type { createServerSupabase } from './supabase-server';
import { claudeJson } from './anthropic';
import type { BaseUnit, IngredientUnits, TrackingMode } from './units';

type Supabase = ReturnType<typeof createServerSupabase>;

const CATEGORIES = ['spice', 'produce', 'dairy', 'grain', 'protein', 'pantry', 'condiment', 'other'] as const;

function clean(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** "onions" -> "onion", "tomatoes" -> "tomato", "berries" -> "berry". */
function singular(name: string): string {
  if (/ies$/.test(name)) return name.replace(/ies$/, 'y');
  if (/(oes|ches|shes)$/.test(name)) return name.replace(/es$/, '');
  if (/[^s]s$/.test(name)) return name.slice(0, -1);
  return name;
}

const MatchSchema = z.object({
  results: z.array(z.object({
    input: z.string(),
    existing: z.string().nullable().describe('Exact canonical name from the list when it is the same ingredient, else null'),
    new_ingredient: z.object({
      canonical_name: z.string(),
      category: z.enum(CATEGORIES),
      base_unit: z.enum(['g', 'count']),
      count_unit: z.string().nullable(),
      density_g_per_ml: z.number().nullable(),
      grams_per_count: z.number().nullable(),
      default_unit: z.string().nullable(),
      purchase_unit: z.string().nullable(),
      purchase_size: z.number().nullable(),
      purchase_label: z.string().nullable()
    }).nullable()
  }))
});

const MATCH_SYSTEM = `You map ingredient names from recipes and pantry entries to a canonical ingredient list for a grocery app. Two names are the same ingredient only when a shopper would buy the same product for both.

Same ingredient: "yellow onion" and "onion", "extra virgin olive oil" and "olive oil", "large eggs" and "eggs", "fresh cilantro leaves" and "cilantro".
Different ingredients: "kosher salt" and "salt", "chicken thighs" and "chicken breast", "brown sugar" and "sugar", "flaky sea salt" and "salt".

For each input, set existing to the matching canonical name copied exactly from the list, or null. When null, describe a new ingredient:
- category: spice for dried spices, herbs and seasonings; condiment for sauces, pastes, oils, vinegars and dressings; otherwise the closest fit.
- canonical_name: short, lowercase, singular for produce ("onion") and plural where usual ("eggs", "chickpeas").
- base_unit: "count" for things counted whole (eggs, onions, lemons, garlic cloves, herb bunches), otherwise "g".
- count_unit: what one count is called when it is not a whole item ("clove" for garlic, "bunch" for herbs), else null.
- density_g_per_ml: grams per ml for anything measured by volume (spices, flours, liquids, grains), else null.
- grams_per_count: typical weight of one item, else null.
- default_unit: the unit recipes usually use (tsp, tbsp, cup, or null).
- purchase_unit, purchase_size, purchase_label: the usual US grocery package. purchase_size is in base units (grams, or a count). Examples: salt is a "bag" of 1000 with label "1 kg"; a can of black beans is "can", 425, "15 oz"; eggs are "carton", 12, "12". Use null for things bought loose by weight or count (meat, produce).`;

/**
 * Resolve ingredient names to canonical ingredient ids. Tries exact alias and
 * name matches first, then one Claude call for the rest. New ingredients are
 * created with their unit data, and every non-exact match is saved as an alias
 * so it resolves instantly next time.
 *
 * Returns a map from the cleaned input name to ingredient id.
 */
export async function resolveIngredients(supabase: Supabase, names: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = Array.from(new Set(names.map(clean).filter(Boolean)));
  if (wanted.length === 0) return out;

  const { data: all } = await supabase.from('ingredients').select('id, canonical_name');
  const byName = new Map((all ?? []).map(i => [clean(i.canonical_name), i.id as string]));

  const { data: aliases } = await supabase.from('ingredient_aliases').select('ingredient_id, alias');
  const byAlias = new Map((aliases ?? []).map(a => [clean(a.alias), a.ingredient_id as string]));

  const unmatched: string[] = [];
  for (const name of wanted) {
    const id = byAlias.get(name) ?? byName.get(name) ?? byAlias.get(singular(name)) ?? byName.get(singular(name));
    if (id) out.set(name, id);
    else unmatched.push(name);
  }
  if (unmatched.length === 0) return out;

  let results: z.infer<typeof MatchSchema>['results'] = [];
  try {
    const canonical = Array.from(byName.keys()).sort();
    const reply = await claudeJson({
      system: MATCH_SYSTEM,
      content: `Canonical ingredients:\n${canonical.join('\n')}\n\nInputs:\n${unmatched.join('\n')}`,
      schema: MatchSchema,
      effort: 'low'
    });
    results = reply.results;
  } catch (err) {
    // Matching is a nicety. If Claude is unavailable, fall back to creating
    // plain ingredients so saving a recipe never fails on this step.
    console.error('Ingredient matching failed:', err);
  }
  const resultFor = new Map(results.map(r => [clean(r.input), r]));

  for (const name of unmatched) {
    const r = resultFor.get(name);
    let id = r?.existing ? byName.get(clean(r.existing)) : undefined;

    if (!id) {
      const n = r?.new_ingredient;
      const canonicalName = n ? clean(n.canonical_name) : name;
      id = byName.get(canonicalName);
      if (!id) {
        id = await createIngredient(supabase, canonicalName, n ?? null);
        byName.set(canonicalName, id);
      }
    }

    out.set(name, id);
    if (!byName.has(name) || byName.get(name) !== id) {
      await supabase.from('ingredient_aliases').insert({ ingredient_id: id, alias: name });
      byAlias.set(name, id);
    }
  }
  return out;
}

export async function resolveIngredient(supabase: Supabase, name: string): Promise<string> {
  const map = await resolveIngredients(supabase, [name]);
  const id = map.get(clean(name));
  if (!id) throw new Error('Ingredient name is required');
  return id;
}

async function createIngredient(
  supabase: Supabase,
  canonicalName: string,
  n: z.infer<typeof MatchSchema>['results'][number]['new_ingredient']
): Promise<string> {
  const row = {
    canonical_name: canonicalName,
    category: n?.category ?? 'other',
    base_unit: n?.base_unit ?? 'g',
    count_unit: n?.count_unit ?? null,
    density_g_per_ml: n?.density_g_per_ml ?? null,
    grams_per_count: n?.grams_per_count ?? null,
    default_unit: n?.default_unit ?? null,
    purchase_unit: n?.purchase_unit ?? null,
    purchase_size: n?.purchase_size ?? null,
    purchase_label: n?.purchase_label ?? null
  };
  const { data, error } = await supabase.from('ingredients').insert(row).select('id').single();
  if (data?.id) return data.id;

  // Another request created it first.
  const { data: existing } = await supabase.from('ingredients').select('id').eq('canonical_name', canonicalName).maybeSingle();
  if (existing?.id) return existing.id;
  throw new Error(`Failed to create ingredient: ${error?.message}`);
}

// =============================================================================
// UNIT DATA
// =============================================================================

/**
 * Load everything the unit math needs for these ingredients: base unit,
 * density, standard container sizes, the user's own conversions (which win),
 * and the user's learned purchase sizes (which win over the default).
 */
export async function loadIngredientUnits(
  supabase: Supabase,
  ingredientIds: string[],
  userId: string
): Promise<Map<string, IngredientUnits>> {
  const ids = Array.from(new Set(ingredientIds));
  const out = new Map<string, IngredientUnits>();
  if (ids.length === 0) return out;

  const [{ data: ingredients }, { data: conversions }, { data: purchases }, { data: categoryModes }, { data: userModes }] = await Promise.all([
    supabase
      .from('ingredients')
      .select('id, canonical_name, category, base_unit, count_unit, density_g_per_ml, grams_per_count, default_unit, purchase_unit, purchase_size, purchase_label, tracking_mode')
      .in('id', ids),
    supabase
      .from('ingredient_conversions')
      .select('ingredient_id, user_id, unit, base_per_unit')
      .in('ingredient_id', ids),
    supabase
      .from('user_purchase_sizes')
      .select('ingredient_id, unit, size, label')
      .eq('user_id', userId)
      .in('ingredient_id', ids),
    supabase.from('ingredient_category_modes').select('category, tracking_mode'),
    supabase
      .from('user_ingredient_modes')
      .select('ingredient_id, tracking_mode')
      .eq('user_id', userId)
      .in('ingredient_id', ids)
  ]);

  const modeByCategory = new Map((categoryModes ?? []).map(c => [c.category as string, c.tracking_mode as TrackingMode]));
  const modeByUser = new Map((userModes ?? []).map(m => [m.ingredient_id as string, m.tracking_mode as TrackingMode]));

  for (const i of ingredients ?? []) {
    out.set(i.id, {
      id: i.id,
      name: i.canonical_name,
      category: i.category,
      base_unit: (i.base_unit as BaseUnit) ?? 'g',
      tracking_mode: modeByUser.get(i.id) ?? (i.tracking_mode as TrackingMode | null) ?? modeByCategory.get(i.category) ?? 'measured',
      count_unit: i.count_unit,
      density: i.density_g_per_ml != null ? Number(i.density_g_per_ml) : null,
      grams_per_count: i.grams_per_count != null ? Number(i.grams_per_count) : null,
      default_unit: i.default_unit,
      conversions: {},
      purchase: i.purchase_unit && i.purchase_size
        ? { unit: i.purchase_unit, size: Number(i.purchase_size), label: i.purchase_label }
        : null
    });
  }

  // Standard rows first, then the user's rows overwrite them.
  const sorted = [...(conversions ?? [])].sort((a, b) => (a.user_id ? 1 : 0) - (b.user_id ? 1 : 0));
  for (const c of sorted) {
    const ing = out.get(c.ingredient_id);
    if (ing && (c.user_id === null || c.user_id === userId)) ing.conversions[c.unit] = Number(c.base_per_unit);
  }

  for (const p of purchases ?? []) {
    const ing = out.get(p.ingredient_id);
    if (ing) ing.purchase = { unit: p.unit, size: Number(p.size), label: p.label };
  }

  return out;
}

