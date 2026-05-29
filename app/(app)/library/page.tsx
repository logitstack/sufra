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
};

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?auto=format&fit=crop&w=800&q=80';

export default async function LibraryPage() {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // RLS returns owned recipes AND recipes shared with the user.
  // Order by created_at desc so newest recipes appear first within each group.
  const { data, error } = await supabase
    .from('recipes')
    .select('id, user_id, name, author, author_handle, category, cuisine, servings_yield, total_time_min, source_url, image_path, notes, tags')
    .order('created_at', { ascending: false });

  const allRows: RecipeRow[] = (data ?? []) as RecipeRow[];

  const ownedRecipes: Recipe[] = allRows
    .filter(r => r.user_id === user?.id)
    .map(rowToRecipe);

  const sharedRecipes: Recipe[] = allRows
    .filter(r => r.user_id !== user?.id)
    .map(rowToRecipe);

  return (
    <LibraryClient
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
    image_path: row.image_path || FALLBACK_IMAGE,
    notes: row.notes ?? undefined,
    tags: row.tags || [],
    ingredients: [],
    steps: []
  };
}
