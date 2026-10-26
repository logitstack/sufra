/**
 * Receipt and shopping-list extraction with Claude. Server only.
 */

import { z } from 'zod';
import { claudeJson, type UserContent } from './anthropic';

export const ReceiptSchema = z.object({
  store_name: z.string().nullable(),
  purchased_on: z.string().nullable().describe('YYYY-MM-DD, or null if not printed'),
  lines: z.array(z.object({
    raw_text: z.string().describe('The product text as printed, without price, count multiplier, or weight-at-price'),
    is_food: z.boolean().describe('False for bags, deposits, household goods, taxes, discounts'),
    ingredient: z.string().nullable().describe('Plain lowercase grocery ingredient, e.g. "salt", "chicken breast"'),
    packages: z.number().describe('How many packages. "2 @ 3.99" is 2. Weighed produce is 1'),
    size_quantity: z.number().nullable(),
    size_unit: z.string().nullable().describe('g, kg, oz, lb, ml, l, fl_oz, or null for a plain count'),
    sold_by_weight: z.boolean().describe('True when the line prints a weight, like "1.42 lb @ 2.99/lb"'),
    price: z.number().nullable().describe('Line total'),
    confidence: z.enum(['high', 'low']).describe('low when the abbreviation or size is a guess')
  }))
});

export type ExtractedReceipt = z.infer<typeof ReceiptSchema>;

const RECEIPT_SYSTEM = `You read grocery receipts for Sufra, a kitchen app that tracks a pantry. Return every purchased line.

For each line:
- raw_text: the product text as printed, e.g. "MORTON SALT 26OZ" or "CHKN BRST BNLS". Leave out the price, count multipliers like "2 @ 1.29", and weight-at-price like "1.62 lb @ 6.99/lb".
- ingredient: the plain grocery ingredient it is, lowercase. "CHKN BRST BNLS" is "chicken breast". "MORTON SALT" is "salt". "DC KOSHER SALT" is "kosher salt". Null for non-food lines.
- packages: "2 @ 3.99" means 2. A single item is 1. Items sold by weight are 1.
- size_quantity and size_unit: the package size when printed ("26OZ" is 26 oz). When it is not printed, give the most common US package size for that product and set confidence to low. For items sold by weight, use the printed weight.
- confidence: high only when both the product and the size are clear from the text.
- Skip subtotals, tax, totals, payment, and change lines entirely. Mark bags, bottle deposits, and household goods as is_food false.`;

const LIST_SYSTEM = `You turn a typed or dictated shopping haul into structured lines for Sufra, a kitchen app that tracks a pantry. Example input: "2 lb chicken, bag of rice, 3 onions, olive oil".

For each item:
- raw_text: the phrase as the user wrote it.
- ingredient: the plain grocery ingredient, lowercase ("chicken" alone means "chicken breast" unless the text says otherwise).
- packages and size: "2 lb chicken" is 1 package of 2 lb. "3 onions" is 3 packages with no size (a plain count). "bag of rice" is 1 package; give the common US bag size and set confidence to low. "olive oil" alone is 1 bottle of the common size, confidence low.
- sold_by_weight: true when the user gave a weight for something bought loose.
- is_food: true unless it is clearly not food. price, store_name, purchased_on: null.`;

export async function extractReceipt(content: UserContent): Promise<ExtractedReceipt> {
  return claudeJson({ system: RECEIPT_SYSTEM, content, schema: ReceiptSchema });
}

export async function extractShoppingText(text: string): Promise<ExtractedReceipt> {
  return claudeJson({ system: LIST_SYSTEM, content: text, schema: ReceiptSchema, effort: 'low' });
}

/**
 * Receipt text as stored in product_aliases: uppercase, single spaces, and no
 * per-purchase details, so "2 @ 1.29 GOYA CHICKPEAS" and "GOYA CHICKPEAS"
 * are the same product.
 */
export function normalizeReceiptText(text: string): string {
  return text
    .toUpperCase()
    .replace(/\d+(?:\.\d+)?\s*(?:LB|LBS|KG|G|OZ)\s*@\s*\$?\d+(?:\.\d+)?\s*\/\s*\w+/g, ' ')  // 1.62 lb @ 6.99/lb
    .replace(/\b\d+\s*@\s*\$?\d+(?:\.\d+)?/g, ' ')                                          // 2 @ 1.29
    .replace(/\$?\d+\.\d{2}\s*$/, ' ')                                                         // trailing price
    .replace(/\s+/g, ' ')
    .trim();
}
