'use server';

import { createServerSupabase } from '@/app/lib/supabase-server';
import { extractFromUrl, extractFromText, extractFromImage, type ExtractedRecipe } from '@/app/lib/recipe-extractor';

export async function importFromUrl(url: string): Promise<ExtractedRecipe> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const cleanUrl = url.trim();
  if (!cleanUrl) throw new Error('URL is required');
  if (!/^https?:\/\//.test(cleanUrl)) throw new Error('URL must start with http:// or https://');

  return extractFromUrl(cleanUrl);
}

export async function importFromText(text: string): Promise<ExtractedRecipe> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const clean = text.trim();
  if (clean.length < 20) throw new Error('Paste more text — at least an ingredient list');

  return extractFromText(clean);
}

export async function importFromImageBase64(
  base64: string,
  mediaType: string
): Promise<ExtractedRecipe> {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  if (!base64) throw new Error('Image is required');
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowed.includes(mediaType)) throw new Error(`Unsupported image type: ${mediaType}`);

  return extractFromImage(base64, mediaType);
}
