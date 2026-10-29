import { createServerSupabase } from '@/app/lib/supabase-server';
import LibraryClient from './library-client';
import type { Recipe } from '@/app/lib/types';

export const dynamic = 'force-dynamic';

type RecipeRow = {
  id: string;
  user_id: string;
  name: string;
  author: string;
  author_handle: string | null;
  category: Recipe['category'];
  cuisine: string;
  servings_yield: number;
  total_time_min: number | null;
  source_url: string | null;
  image_path: string | null;
  notes: string | null;
  tags: string[];
  loved?: boolean;
};


export default async function LibraryPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // RLS returns owned recipes AND recipes shared with the user.
  // Order by created_at desc so newest recipes appear first within each group.
  const { data, error } = await supabase
    .from('recipes')
    .select('id, user_id, name, author, author_handle, category, cuisine, servings_yield, total_time_min, source_url, image_path, notes, tags')
    .order('created_at', { ascending: false });

  const { data: ratings } = await supabase.from('recipe_ratings').select('recipe_id').eq('user_id', user?.id ?? '').eq('loved', true);
  const lovedIds = new Set((ratings ?? []).map(r => r.recipe_id as string));
  const allRows: RecipeRow[] = ((data ?? []) as RecipeRow[]).map(r => ({ ...r, loved: lovedIds.has(r.id) }));

  const ownedRecipes: Recipe[] = allRows
    .filter(r => r.user_id === user?.id)
    .map(rowToRecipe);

  const sharedRecipes: Recipe[] = allRows
    .filter(r => r.user_id !== user?.id)
    .map(rowToRecipe);

  // Owned recipes with no photo whose source link might have one.
  const photoless = allRows.filter(r => r.user_id === user?.id && !r.image_path && r.source_url).length;

  return (
    <LibraryClient
      photoless={photoless}
      ownedRecipes={ownedRecipes}
      sharedRecipes={sharedRecipes}
      hasError={!!error}
    />
  );
}

function rowToRecipe(row: RecipeRow): Recipe {
  return {
    id: row.id,
    name: row.name,
    author: row.author,
    author_handle: row.author_handle ?? undefined,
    category: row.category,
    cuisine: row.cuisine,
    servings_yield: row.servings_yield,
    total_time_min: row.total_time_min ?? 0,
    source_url: row.source_url ?? undefined,
    image_path: row.image_path,
    notes: row.notes ?? undefined,
    tags: row.tags || [],
    loved: row.loved,
    ingredients: [],
    steps: []
  };
}
