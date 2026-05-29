/**
 * Recipe extraction from URLs, pasted text, and photos.
 * Returns a structured object matching the CreateRecipeInput shape.
 */

import { callClaude, MODEL_SONNET } from './anthropic';
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

const EXTRACTION_SYSTEM_PROMPT = `You are a recipe extraction assistant for Sufra, a recipe library app.

Your job: convert messy recipe text or images into clean structured data.

Return ONLY valid JSON matching this exact schema, with no preamble, no markdown fences, no explanation:

{
  "name": "string",
  "author": "string (person or publication; 'Personal' if unknown)",
  "author_handle": "string or null (e.g. @username from Instagram)",
  "category": "meat | vegetarian | baked_goods | desserts | drinks",
  "cuisine": "string (e.g. Pakistani, Levantine, Mediterranean, American)",
  "servings_yield": number,
  "total_time_min": number or null,
  "source_url": "string or null",
  "notes": "string or null (notable tips from the author)",
  "tags": ["array", "of", "lowercase", "tags"],
  "ingredients": [
    { "quantity": number or null, "unit": "tsp|tbsp|cup|fl_oz|ml|l|g|kg|oz|lb|pinch|bunch or null", "name": "ingredient name without quantity or unit", "prep_note": "diced/chopped/etc or null" }
  ],
  "steps": ["step 1", "step 2", "..."]
}

Rules:
- Categorize as MEAT if it contains meat, poultry, or seafood. VEGETARIAN otherwise (unless clearly a dessert/baked good/drink).
- BAKED_GOODS for breads, scones, cookies, savory bakes. DESSERTS for sweet finished dishes (cakes, kunafa, ice cream).
- Use lowercase canonical ingredient names: "chicken thighs" not "1 lb Chicken Thighs". Strip quantities and units from the name.
- For "1/2 cup chopped onion": quantity=0.5, unit="cup", name="onion", prep_note="chopped"
- For "2 large eggs": quantity=2, unit=null, name="eggs", prep_note="large"
- For "salt to taste": quantity=null, unit=null, name="salt", prep_note="to taste"
- Strip phrases like "for serving" or "for garnish" into prep_note.
- Steps should be imperative and concise. Combine multiple sentences if they describe one step.
- If you cannot determine a value, use null (not empty string).
- Tags should be lowercase, themed (e.g. "weeknight", "festive", "freezer-friendly"). Max 6 tags.`;

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

  // Unit (one of known units)
  const unitPattern = /^(tsp|teaspoon|tbsp|tablespoon|cup|cups|fl\s*oz|fluid\s*ounce|ml|liter|litre|l|gram|grams|g|kg|kilogram|oz|ounce|lb|lbs|pound|pounds|pinch|bunch|clove|cloves|head)\b\.?\s*/i;
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

  return { quantity, unit, name: rest, prep_note: prep };
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

function canonicalUnit(raw: string): string {
  const r = raw.toLowerCase().replace(/\s+/g, '').replace('.', '');
  if (['tsp', 'teaspoon'].includes(r)) return 'tsp';
  if (['tbsp', 'tablespoon'].includes(r)) return 'tbsp';
  if (['cup', 'cups'].includes(r)) return 'cup';
  if (['floz', 'fluidounce'].includes(r)) return 'fl_oz';
  if (['ml'].includes(r)) return 'ml';
  if (['l', 'liter', 'litre'].includes(r)) return 'l';
  if (['g', 'gram', 'grams'].includes(r)) return 'g';
  if (['kg', 'kilogram'].includes(r)) return 'kg';
  if (['oz', 'ounce'].includes(r)) return 'oz';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(r)) return 'lb';
  if (['pinch'].includes(r)) return 'pinch';
  if (['bunch'].includes(r)) return 'bunch';
  return r;
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
  const raw = await callClaude({
    model: MODEL_SONNET,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Extract the recipe from this text:\n\n${text}` }]
  });
  return parseClaudeJson(raw, sourceUrl);
}

/**
 * Extract a recipe from an image using Claude's vision.
 */
export async function extractFromImage(imageBase64: string, mediaType: string): Promise<ExtractedRecipe> {
  const raw = await callClaude({
    model: MODEL_SONNET,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: 'Extract the recipe shown in this image.' }
      ]
    }]
  });
  return parseClaudeJson(raw, null);
}

function parseClaudeJson(raw: string, sourceUrl: string | null): ExtractedRecipe {
  // Strip markdown fences if present
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
  let parsed: Partial<ExtractedRecipe>;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Could not parse extraction result: ${err instanceof Error ? err.message : 'invalid JSON'}`);
  }

  return {
    name: parsed.name ?? 'Untitled',
    author: parsed.author ?? 'Personal',
    author_handle: parsed.author_handle ?? null,
    category: (parsed.category as Category) ?? 'vegetarian',
    cuisine: parsed.cuisine ?? 'Other',
    servings_yield: parsed.servings_yield ?? 4,
    total_time_min: parsed.total_time_min ?? null,
    source_url: parsed.source_url ?? sourceUrl,
    notes: parsed.notes ?? null,
    tags: parsed.tags ?? [],
    ingredients: parsed.ingredients ?? [],
    steps: parsed.steps ?? []
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
