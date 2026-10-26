'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { loadIngredientUnits, resolveIngredients } from '@/app/lib/ingredients';
import { adjustPantry } from '@/app/lib/pantry';
import {
  extractReceipt, extractShoppingText, normalizeReceiptText, type ExtractedReceipt
} from '@/app/lib/receipt-extractor';
import { canonicalUnit, sizeForEdit, sizeLabel, toBase, type IngredientUnits } from '@/app/lib/units';
import type { ConfirmResult, ParsedReceipt, ReviewLine } from './types';

type Supabase = ReturnType<typeof createServerSupabase>;

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

async function requireUser(supabase: Supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user;
}

function cleanName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Ingredient ids that are unchecked on any open (not completed) grocery list. */
async function openListItems(supabase: Supabase, userId: string): Promise<Array<{ id: string; ingredient_id: string }>> {
  const { data: lists } = await supabase
    .from('shopping_lists')
    .select('id')
    .eq('user_id', userId)
    .is('completed_at', null);
  const listIds = (lists ?? []).map(l => l.id);
  if (listIds.length === 0) return [];
  const { data: items } = await supabase
    .from('shopping_items')
    .select('id, ingredient_id')
    .in('list_id', listIds)
    .eq('checked', false);
  return items ?? [];
}

/** Base amount in one package, or null when the size can't be converted. */
function perPackageBase(line: Pick<ReviewLine, 'size_quantity' | 'size_unit'>, ing: IngredientUnits): number | null {
  return line.size_quantity != null ? toBase(line.size_quantity, line.size_unit, ing) : toBase(1, '', ing);
}

/**
 * Read a receipt (photo, PDF, or pasted email text) or a typed list, match each
 * line to an ingredient, and return lines for the review screen. Products this
 * user confirmed before come back as 'known' and need no input.
 */
export async function parseReceipt(input:
  | { kind: 'image'; data: string; mediaType: string }
  | { kind: 'pdf'; data: string }
  | { kind: 'text'; text: string }
  | { kind: 'list'; text: string }
): Promise<ParsedReceipt> {
  const supabase = createServerSupabase();
  const user = await requireUser(supabase);

  let extracted: ExtractedReceipt;
  if (input.kind === 'image') {
    const mediaType = IMAGE_TYPES.find(t => t === input.mediaType);
    if (!mediaType) throw new Error(`Unsupported image type: ${input.mediaType}`);
    extracted = await extractReceipt([
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: input.data } },
      { type: 'text', text: 'Read this grocery receipt.' }
    ]);
  } else if (input.kind === 'pdf') {
    extracted = await extractReceipt([
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.data } },
      { type: 'text', text: 'Read this grocery receipt.' }
    ]);
  } else if (input.kind === 'text') {
    if (input.text.trim().length < 10) throw new Error('Paste the full receipt text');
    extracted = await extractReceipt(`Read this grocery receipt:\n\n${input.text}`);
  } else {
    if (!input.text.trim()) throw new Error('Type what you bought');
    extracted = await extractShoppingText(input.text);
  }

  const fromReceipt = input.kind !== 'list';
  const food = extracted.lines.filter(l => l.is_food && l.ingredient);

  // Products this user has confirmed before.
  const { data: aliases } = fromReceipt
    ? await supabase.from('product_aliases').select('receipt_text, ingredient_id, package_size, package_label, ingredients(canonical_name)').eq('user_id', user.id)
    : { data: [] };
  const aliasByText = new Map(((aliases ?? []) as unknown as Array<{
    receipt_text: string;
    ingredient_id: string;
    package_size: number | null;
    package_label: string | null;
    ingredients: { canonical_name: string } | null;
  }>).map(a => [a.receipt_text, a]));

  const unknownNames = food
    .filter(l => !(fromReceipt && aliasByText.has(normalizeReceiptText(l.raw_text))))
    .map(l => l.ingredient!);
  const resolved = await resolveIngredients(supabase, unknownNames);

  const ingredientIds = [
    ...Array.from(resolved.values()),
    ...Array.from(aliasByText.values()).map(a => a.ingredient_id)
  ];
  const units = await loadIngredientUnits(supabase, ingredientIds, user.id);
  const onList = new Set((await openListItems(supabase, user.id)).map(i => i.ingredient_id));

  const lines: ReviewLine[] = [];
  extracted.lines.forEach((l, idx) => {
    const key = `l${idx}`;
    const alias = fromReceipt ? aliasByText.get(normalizeReceiptText(l.raw_text)) : undefined;
    const ingredientId = alias?.ingredient_id ?? (l.ingredient ? resolved.get(cleanName(l.ingredient)) : undefined);
    const ing = ingredientId ? units.get(ingredientId) : undefined;

    let size_quantity = l.size_quantity;
    let size_unit = canonicalUnit(l.size_unit);
    if (alias && ing && !l.sold_by_weight && alias.package_size) {
      const s = sizeForEdit(Number(alias.package_size), ing, alias.package_label);
      size_quantity = s.quantity;
      size_unit = s.unit;
    }

    const line: ReviewLine = {
      key,
      raw_text: fromReceipt ? l.raw_text : null,
      include: l.is_food && !!ing,
      ingredient_name: ing?.name ?? l.ingredient ?? '',
      packages: l.packages > 0 ? l.packages : 1,
      size_quantity,
      size_unit,
      sold_by_weight: l.sold_by_weight,
      price: l.price,
      status: alias ? 'known' : l.confidence === 'high' ? 'new' : 'uncertain',
      on_list: !!ingredientId && onList.has(ingredientId)
    };
    // A known product whose size no longer converts still needs a look.
    if (line.status === 'known' && ing && perPackageBase(line, ing) == null) line.status = 'uncertain';
    lines.push(line);
  });

  return { store_name: extracted.store_name, purchased_on: extracted.purchased_on, lines };
}

/**
 * Apply the reviewed lines: add purchased amounts to the pantry, check off
 * matching grocery list items, remember each confirmed receipt product and
 * its size, and keep the usual purchase size current. Nothing is applied if
 * any line has a size we can't convert.
 */
export async function confirmReceipt(input: {
  store_name: string | null;
  purchased_on: string | null;
  lines: ReviewLine[];
}): Promise<ConfirmResult> {
  const supabase = createServerSupabase();
  const user = await requireUser(supabase);

  const lines = input.lines.filter(l => l.include && l.ingredient_name.trim() && l.packages > 0);
  const ids = await resolveIngredients(supabase, lines.map(l => l.ingredient_name));
  const units = await loadIngredientUnits(supabase, Array.from(ids.values()), user.id);

  const problems: Record<string, string> = {};
  const planned: Array<{ line: ReviewLine; ing: IngredientUnits; perPackage: number }> = [];
  for (const line of lines) {
    const ing = units.get(ids.get(cleanName(line.ingredient_name)) ?? '');
    if (!ing) { problems[line.key] = 'Could not find this ingredient'; continue; }
    const perPackage = perPackageBase(line, ing);
    if (perPackage == null) {
      problems[line.key] = ing.base_unit === 'count'
        ? `Enter how many ${ing.name} came in each package`
        : `Enter the size by weight (g, oz, lb, kg) for ${ing.name}`;
      continue;
    }
    planned.push({ line, ing, perPackage });
  }
  if (Object.keys(problems).length > 0) return { ok: false, problems };

  const listItems = await openListItems(supabase, user.id);
  const now = new Date().toISOString();
  let checkedOff = 0;

  for (const { line, ing, perPackage } of planned) {
    await adjustPantry(supabase, user.id, ing, line.packages * perPackage, { purchased: true });

    const label = line.size_quantity != null ? sizeLabel(line.size_quantity, line.size_unit) : null;
    const packageUnit = ing.purchase?.unit ?? 'package';

    if (line.raw_text) {
      await supabase.from('product_aliases').upsert({
        user_id: user.id,
        receipt_text: normalizeReceiptText(line.raw_text),
        ingredient_id: ing.id,
        package_size: line.sold_by_weight ? null : perPackage,
        package_unit: line.sold_by_weight ? null : packageUnit,
        package_label: line.sold_by_weight ? null : label,
        updated_at: now
      }, { onConflict: 'user_id,receipt_text' });
    }

    // What they actually buy becomes the usual size for the grocery list.
    if (!line.sold_by_weight && line.size_quantity != null) {
      await supabase.from('user_purchase_sizes').upsert({
        user_id: user.id,
        ingredient_id: ing.id,
        unit: packageUnit,
        size: perPackage,
        label,
        updated_at: now
      }, { onConflict: 'user_id,ingredient_id' });
    }

    const toCheck = listItems.filter(i => i.ingredient_id === ing.id).map(i => i.id);
    if (toCheck.length > 0) {
      await supabase.from('shopping_items').update({ checked: true }).in('id', toCheck);
      checkedOff += toCheck.length;
    }

    if (line.price != null && input.store_name) {
      await supabase.from('price_history').insert({
        user_id: user.id,
        ingredient_id: ing.id,
        store_name: input.store_name,
        price: line.price,
        unit: label ?? (ing.base_unit === 'g' ? 'g' : 'each'),
        quantity: line.packages,
        purchased_on: input.purchased_on ?? now.slice(0, 10)
      });
    }
  }

  revalidatePath('/pantry');
  revalidatePath('/shopping');
  return { ok: true, added: planned.length, checkedOff };
}
