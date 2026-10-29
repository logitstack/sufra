/**
 * Pantry substitutes for a grocery list: "shallots needed, you have red onion".
 * One Claude call per list generation. Server only.
 */

import { z } from 'zod';
import { claudeJson } from './anthropic';

export type Substitute = { ingredient_id: string; name: string; note: string };

const SubstitutesSchema = z.object({
  items: z.array(z.object({
    needed: z.string().describe('The needed ingredient, copied exactly from the input'),
    substitutes: z.array(z.object({
      pantry_item: z.string().describe('A pantry item, copied exactly from the pantry list'),
      note: z.string().describe('A few words on how it changes the dish, e.g. "a bit sharper, use a little less"')
    }))
  }))
});

const SUBSTITUTES_SYSTEM = `You help a home cook decide whether something already in their pantry can stand in for an ingredient on their grocery list.

For each needed ingredient, list up to 3 pantry items a good home cook would actually swap in for it in most recipes. Examples: red onion or yellow onion for shallots, half-and-half for heavy cream, lime juice for lemon juice, chicken thighs for chicken breast, dried parsley for fresh parsley.

Only suggest items that appear in the pantry list, copied exactly. Leave substitutes empty when nothing in the pantry is a reasonable swap; an empty list is better than a stretch. Never suggest pork or alcohol. Keep each note short and plain, with no em dashes.`;

/**
 * Suggest pantry substitutes for each needed ingredient. `needed` and `pantry`
 * map ingredient id -> name. Returns needed id -> substitutes; ingredients with
 * no good swap are left out. Failures return no suggestions so list
 * generation never breaks on this step.
 */
export async function suggestSubstitutes(
  needed: Map<string, string>,
  pantry: Map<string, string>
): Promise<Map<string, Substitute[]>> {
  const out = new Map<string, Substitute[]>();
  if (needed.size === 0 || pantry.size === 0) return out;

  const neededByName = new Map(Array.from(needed.entries()).map(([id, name]) => [name.toLowerCase(), id]));
  const pantryByName = new Map(Array.from(pantry.entries()).map(([id, name]) => [name.toLowerCase(), id]));

  try {
    const reply = await claudeJson({
      system: SUBSTITUTES_SYSTEM,
      content: `Needed:\n${Array.from(needed.values()).join('\n')}\n\nPantry:\n${Array.from(pantry.values()).join('\n')}`,
      schema: SubstitutesSchema,
      effort: 'low'
    });
    for (const item of reply.items) {
      const neededId = neededByName.get(item.needed.trim().toLowerCase());
      if (!neededId) continue;
      const subs: Substitute[] = [];
      for (const s of item.substitutes) {
        const id = pantryByName.get(s.pantry_item.trim().toLowerCase());
        if (id && id !== neededId && !subs.some(x => x.ingredient_id === id)) {
          subs.push({ ingredient_id: id, name: pantry.get(id)!, note: s.note });
        }
      }
      if (subs.length > 0) out.set(neededId, subs.slice(0, 3));
    }
  } catch (err) {
    console.error('Substitute suggestions failed:', err);
  }
  return out;
}
