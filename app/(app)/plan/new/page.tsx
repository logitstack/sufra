import { createServerSupabase } from '@/app/lib/supabase-server';
import NewPlanClient from './new-plan-client';

export const dynamic = 'force-dynamic';

export default async function NewPlanPage() {
  const supabase = createServerSupabase();
  const { data: recipes } = await supabase
    .from('recipes')
    .select('id, name, category, cuisine, servings_yield, total_time_min, image_path, author')
    .order('name');

  return <NewPlanClient recipes={recipes ?? []} />;
}
