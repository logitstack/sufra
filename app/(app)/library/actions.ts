'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabase } from '@/app/lib/supabase-server';
import { photoFromSource } from '@/app/lib/recipe-photo';

/** How many recipes one tap looks up, so the request stays well under timeouts. */
const BATCH = 8;

/**
 * Give the user's recipes that have no photo the photo from their source
 * link. Works through a batch at a time; `remaining` says how many are left
 * to try. Recipes whose link has no usable photo are counted as `missed`.
 */
export async function fillMissingPhotos(skip: string[] = []): Promise<{ found: number; missed: string[]; remaining: number }> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data } = await supabase
    .from('recipes')
    .select('id, source_url')
    .eq('user_id', user.id)
    .is('image_path', null)
    .not('source_url', 'is', null);
  const todo = (data ?? []).filter(r => !skip.includes(r.id));

  let found = 0;
  const missed: string[] = [];
  await Promise.all(todo.slice(0, BATCH).map(async r => {
    const photo = await photoFromSource(supabase, user.id, r.source_url);
    if (!photo) { missed.push(r.id); return; }
    await supabase.from('recipes').update({ image_path: photo }).eq('id', r.id);
    found++;
  }));

  revalidatePath('/library');
  return { found, missed, remaining: Math.max(0, todo.length - BATCH) };
}
