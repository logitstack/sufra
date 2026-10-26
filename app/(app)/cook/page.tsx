import { notFound } from 'next/navigation';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { byUseItUp, type Coverage } from '@/app/lib/coverage';
import { needText, type IngredientUnits } from '@/app/lib/units';
import { loadCookData } from './data';
import CookClient, { type RecipeCard } from './cook-client';

export const dynamic = 'force-dynamic';

function heldFor(days: number): string {
  if (days < 1) return 'today';
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

function card(c: Coverage, units: Map<string, IngredientUnits>): RecipeCard {
  return {
    id: c.recipe.id,
    name: c.recipe.name,
    cuisine: c.recipe.cuisine,
    useItUp: c.oldestName ? `Uses ${c.oldestName}, on hand for ${heldFor(c.oldestDays)}` : null,
    missing: c.missing.map(m => ({ name: m.name, text: needText(m.need, units.get(m.ingredient_id)!) }))
  };
}

export default async function CookPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { coverage, units, staples } = await loadCookData(supabase, user.id);

  const canMake = coverage.filter(c => c.missing.length === 0).sort(byUseItUp).map(c => card(c, units));
  const nearMisses = coverage
    .filter(c => c.missing.length >= 1 && c.missing.length <= 2)
    .sort((a, b) => a.missing.length - b.missing.length || byUseItUp(a, b))
    .map(c => card(c, units));

  return (
    <CookClient
      canMake={canMake}
      nearMisses={nearMisses}
      staples={staples}
      recipeCount={coverage.length}
    />
  );
}
