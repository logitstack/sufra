/**
 * Recipe extraction from URLs, pasted text, and photos.
 * Returns a structured object matching the CreateRecipeInput shape.
 */

import { z } from 'zod';
import { claudeJson } from './anthropic';
import { canonicalUnit } from './units';
import type { Category } from './types';

export type ExtractedRecipe = {
  name: string;
  author: string;
  author_handle: string | null;
  category: Category;
  cuisine: string;
  servings_yield: number;
  total_time_min: number | null;
  source_url: string | null;
  notes: string | null;
  tags: string[];
  ingredients: { quantity: number | null; unit: string | null; name: string; prep_note: string | null }[];
  steps: string[];
};

export const RecipeSchema = z.object({
  name: z.string(),
  author: z.string().describe("Person or publication; 'Personal' if unknown"),
  author_handle: z.string().nullable().describe('e.g. @username from Instagram'),
  category: z.enum(['meat', 'vegetarian', 'baked_goods', 'desserts', 'drinks']),
  cuisine: z.string().describe('e.g. Pakistani, Levantine, Mediterranean, American'),
  servings_yield: z.number(),
  total_time_min: z.number().nullable(),
  source_url: z.string().nullable(),
  notes: z.string().nullable().describe('Notable tips from the author'),
  tags: z.array(z.string()),
  ingredients: z.array(z.object({
    quantity: z.number().nullable(),
    unit: z.string().nullable(),
    name: z.string(),
    prep_note: z.string().nullable()
  })),
  steps: z.array(z.string())
});

const EXTRACTION_SYSTEM_PROMPT = `You are a recipe extraction assistant for Sufra, a recipe library app. Convert messy recipe text or images into clean structured data.

Rules:
- Categorize as meat if it contains meat, poultry, or seafood. Vegetarian otherwise (unless clearly a dessert, baked good, or drink).
- baked_goods for breads, scones, cookies, savory bakes. desserts for sweet finished dishes (cakes, kunafa, ice cream).
- Ingredient names are lowercase, with quantities and units stripped: "chicken thighs", not "1 lb Chicken Thighs".
- Keep the ingredient as the recipe names it. "kosher salt" stays "kosher salt", "fine sea salt" stays "fine sea salt".
- Units: use one of tsp, tbsp, cup, fl_oz, ml, l, g, kg, oz, lb, pinch, dash, bunch, clove, head, can, stick, package, jar, slice, inch, sprig, or null for a plain count.
- "1/2 cup chopped onion": quantity 0.5, unit "cup", name "onion", prep_note "chopped".
- "2 large eggs": quantity 2, unit null, name "eggs", prep_note "large".
- "1 (14 oz) can sweetened condensed milk": quantity 1, unit "can", name "sweetened condensed milk", prep_note "14 oz".
- "3 cloves garlic, minced": quantity 3, unit "clove", name "garlic", prep_note "minced".
- "salt to taste": quantity null, unit null, name "salt", prep_note "to taste".
- Move phrases like "for serving" or "for garnish" into prep_note.
- Steps are imperative and concise. Combine sentences that describe one step.
- Use null when a value is unknown, never an empty string.
- Tags are lowercase and themed (e.g. "weeknight", "festive", "freezer-friendly"). At most 6.`;

/**
 * Extract a recipe from raw HTML by looking for schema.org JSON-LD first.
 * Returns null if no usable JSON-LD found.
 */
export function tryJsonLdExtraction(html: string, sourceUrl: string): ExtractedRecipe | null {
  const matches = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of matches) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const recipeNode = findRecipeNode(parsed);
      if (recipeNode) return normalizeSchemaOrg(recipeNode, sourceUrl);
    } catch {
      // Try next script tag
    }
  }
  return null;
}

function findRecipeNode(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const type = obj['@type'];
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) {
    return obj;
  }
  // Try @graph
  if (Array.isArray(obj['@graph'])) {
    for (const node of obj['@graph']) {
      const found = findRecipeNode(node);
      if (found) return found;
    }
  }
  // Try array directly
  if (Array.isArray(data)) {
    for (const node of data) {
      const found = findRecipeNode(node);
      if (found) return found;
    }
  }
  return null;
}

function normalizeSchemaOrg(node: Record<string, unknown>, sourceUrl: string): ExtractedRecipe {
  const asString = (v: unknown): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object' && 'name' in v) return String((v as { name: string }).name);
    return '';
  };

  const author = (() => {
    const a = node.author;
    if (typeof a === 'string') return a;
    if (Array.isArray(a)) return a.map(asString).filter(Boolean).join(', ');
    if (a && typeof a === 'object') return asString(a);
    return 'Personal';
  })();

  const ingredients = ((node.recipeIngredient as string[]) ?? []).map(parseIngredientLine);

  const stepsRaw = node.recipeInstructions;
  const steps: string[] = [];
  if (Array.isArray(stepsRaw)) {
    for (const s of stepsRaw) {
      if (typeof s === 'string') steps.push(s);
      else if (s && typeof s === 'object') {
        const text = (s as { text?: string; name?: string }).text ?? (s as { name?: string }).name ?? '';
        if (text) steps.push(text);
      }
    }
  } else if (typeof stepsRaw === 'string') {
    steps.push(...stepsRaw.split(/\n+/).map(s => s.trim()).filter(Boolean));
  }

  return {
    name: asString(node.name) || 'Untitled',
    author: author || 'Personal',
    author_handle: null,
    category: guessCategory(node, ingredients.map(i => i.name).join(' ')),
    cuisine: asString(node.recipeCuisine) || 'Other',
    servings_yield: parseYield(node.recipeYield),
    total_time_min: parseDuration((node.totalTime ?? node.cookTime) as string),
    source_url: sourceUrl,
    notes: null,
    tags: Array.isArray(node.keywords)
      ? (node.keywords as string[]).slice(0, 6)
      : typeof node.keywords === 'string'
      ? node.keywords.split(',').map(s => s.trim().toLowerCase()).slice(0, 6)
      : [],
    ingredients,
    steps
  };
}

function parseIngredientLine(line: string): ExtractedRecipe['ingredients'][0] {
  // Best-effort parse: "1 1/2 cup chopped onion" → qty=1.5, unit=cup, name=onion, prep=chopped
  const trimmed = line.trim();

  // Quantity at start (decimal, fraction, or mixed)
  const qtyMatch = trimmed.match(/^(\d+(?:\s+\d+\/\d+)?|\d+\/\d+|\d+(?:\.\d+)?)\s*/);
  let quantity: number | null = null;
  let rest = trimmed;
  if (qtyMatch) {
    quantity = parseQty(qtyMatch[1]);
    rest = trimmed.slice(qtyMatch[0].length).trim();
  }

  // Optional package size before the unit: "1 (14 oz) can ..."
  let sizeNote: string | null = null;
  const sizeMatch = rest.match(/^\(([^)]+)\)\s*/);
  if (sizeMatch) {
    sizeNote = sizeMatch[1].trim();
    rest = rest.slice(sizeMatch[0].length).trim();
  }

  // Unit (one of known units)
  const unitPattern = /^(teaspoons?|tsps?|tablespoons?|tbsps?|tbs|cups?|fl\.?\s*oz|fluid\s*ounces?|milliliters?|millilitres?|ml|liters?|litres?|l|grams?|g|kilograms?|kg|ounces?|oz|pounds?|lbs?|pinch(?:es)?|dash(?:es)?|bunch(?:es)?|cloves?|heads?|cans?|tins?|sticks?|packages?|jars?|slices?|inch(?:es)?|sprigs?|quarts?|qt|pints?|pt)\b\.?\s*/i;
  const unitMatch = rest.match(unitPattern);
  let unit: string | null = null;
  if (unitMatch) {
    unit = canonicalUnit(unitMatch[1]);
    rest = rest.slice(unitMatch[0].length).trim();
  }

  // Prep note in parens or after comma at end
  let prep: string | null = null;
  const parenMatch = rest.match(/\(([^)]+)\)/);
  if (parenMatch) {
    prep = parenMatch[1].trim();
    rest = rest.replace(parenMatch[0], '').trim();
  } else {
    const commaIdx = rest.lastIndexOf(',');
    if (commaIdx > 5) {  // Skip if comma is near the start (likely part of name)
      const tail = rest.slice(commaIdx + 1).trim();
      if (tail.length < 30) {  // Prep notes are short
        prep = tail;
        rest = rest.slice(0, commaIdx).trim();
      }
    }
  }

  if (sizeNote) prep = prep ? `${sizeNote}, ${prep}` : sizeNote;
  return { quantity, unit, name: rest.toLowerCase(), prep_note: prep };
}

function parseQty(s: string): number | null {
  const trimmed = s.trim();
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) return parseInt(mixedMatch[1]) + parseInt(mixedMatch[2]) / parseInt(mixedMatch[3]);
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) return parseInt(fracMatch[1]) / parseInt(fracMatch[2]);
  const n = parseFloat(trimmed);
  return isNaN(n) ? null : n;
}

function parseYield(y: unknown): number {
  if (typeof y === 'number') return y;
  if (typeof y === 'string') {
    const m = y.match(/\d+/);
    if (m) return parseInt(m[0]);
  }
  if (Array.isArray(y)) return parseYield(y[0]);
  return 4;
}

function parseDuration(d: unknown): number | null {
  if (typeof d !== 'string') return null;
  // ISO 8601 duration: PT1H30M
  const match = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return null;
  const h = parseInt(match[1] ?? '0');
  const m = parseInt(match[2] ?? '0');
  const total = h * 60 + m;
  return total > 0 ? total : null;
}

function guessCategory(node: Record<string, unknown>, ingredientText: string): Category {
  const cat = String(node.recipeCategory ?? '').toLowerCase();
  if (cat.includes('dessert')) return 'desserts';
  if (cat.includes('bread') || cat.includes('bake')) return 'baked_goods';
  if (cat.includes('drink') || cat.includes('beverage') || cat.includes('cocktail')) return 'drinks';
  const text = (String(node.name ?? '') + ' ' + ingredientText).toLowerCase();
  const meatWords = ['chicken', 'beef', 'lamb', 'pork', 'fish', 'salmon', 'shrimp', 'turkey', 'bacon'];
  if (meatWords.some(w => text.includes(w))) return 'meat';
  return 'vegetarian';
}

/**
 * Extract a recipe from messy text using Claude.
 */
export async function extractFromText(text: string, sourceUrl: string | null = null): Promise<ExtractedRecipe> {
  const parsed = await claudeJson({
    system: EXTRACTION_SYSTEM_PROMPT,
    content: `Extract the recipe from this text:\n\n${text}`,
    schema: RecipeSchema
  });
  return toExtractedRecipe(parsed, sourceUrl);
}

/**
 * Extract a recipe from an image using Claude's vision.
 */
export async function extractFromImage(imageBase64: string, mediaType: string): Promise<ExtractedRecipe> {
  const parsed = await claudeJson({
    system: EXTRACTION_SYSTEM_PROMPT,
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: imageBase64 }
      },
      { type: 'text', text: 'Extract the recipe shown in this image.' }
    ],
    schema: RecipeSchema
  });
  return toExtractedRecipe(parsed, null);
}

export function toExtractedRecipe(parsed: z.infer<typeof RecipeSchema>, sourceUrl: string | null): ExtractedRecipe {
  return {
    ...parsed,
    author: parsed.author || 'Personal',
    servings_yield: parsed.servings_yield > 0 ? Math.round(parsed.servings_yield) : 4,
    source_url: parsed.source_url ?? sourceUrl,
    tags: parsed.tags.slice(0, 6),
    ingredients: parsed.ingredients.map(i => ({ ...i, unit: i.unit ? canonicalUnit(i.unit) || null : null }))
  };
}

/**
 * Fetch a URL and extract a recipe. Tries JSON-LD first, falls back to Claude.
 */
export async function extractFromUrl(url: string): Promise<ExtractedRecipe> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SufraBot/1.0)' }
  });
  if (!res.ok) throw new Error(`Could not fetch URL (${res.status})`);
  const html = await res.text();

  // Try JSON-LD first
  const jsonLd = tryJsonLdExtraction(html, url);
  if (jsonLd && jsonLd.ingredients.length > 0 && jsonLd.steps.length > 0) {
    return jsonLd;
  }

  // Fallback: extract visible text and send to Claude
  const visibleText = stripHtmlToText(html);
  const truncated = visibleText.slice(0, 12000);  // Keep prompt size reasonable
  return extractFromText(truncated, url);
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
