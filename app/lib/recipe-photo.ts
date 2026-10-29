/**
 * Recipe photos taken from the recipe's own source link. Server only.
 *
 * Recipe sites publish their hero photo in schema.org JSON-LD ("image") and
 * in og:image / twitter:image meta tags. We copy that image into Supabase
 * Storage so the recipe keeps it even if the site changes.
 */

import type { createServerSupabase } from './supabase-server';

type Supabase = ReturnType<typeof createServerSupabase>;

const UA = 'Mozilla/5.0 (compatible; SufraBot/1.0)';
const MAX_BYTES = 8 * 1024 * 1024;
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' };

/** Pick the image URL out of a JSON-LD "image" value (string, array, or ImageObject). */
function jsonLdImage(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    for (const x of v) {
      const found = jsonLdImage(x);
      if (found) return found;
    }
    return null;
  }
  if (v && typeof v === 'object' && 'url' in v) return jsonLdImage((v as { url: unknown }).url);
  return null;
}

function findRecipeImage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  if (Array.isArray(data)) {
    for (const node of data) {
      const found = findRecipeImage(node);
      if (found) return found;
    }
    return null;
  }
  const obj = data as Record<string, unknown>;
  const type = obj['@type'];
  if ((type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) && obj.image) return jsonLdImage(obj.image);
  return Array.isArray(obj['@graph']) ? findRecipeImage(obj['@graph']) : null;
}

function metaContent(html: string, property: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (key !== property) continue;
    const content = tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) return content.replace(/&amp;/g, '&');
  }
  return null;
}

/** The recipe's photo URL in a page's HTML: JSON-LD first, then og:image / twitter:image. */
export function findImageInHtml(html: string, pageUrl: string): string | null {
  let found: string | null = null;
  for (const m of Array.from(html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))) {
    try {
      found = findRecipeImage(JSON.parse(m[1].trim()));
      if (found) break;
    } catch {
      // Try the next script tag
    }
  }
  found ??= metaContent(html, 'og:image') ?? metaContent(html, 'og:image:url') ?? metaContent(html, 'twitter:image');
  if (!found) return null;
  try {
    const url = new URL(found, pageUrl);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Fetch a recipe page and return its photo URL, or null. */
export async function findSourceImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    return findImageInHtml(await res.text(), pageUrl);
  } catch {
    return null;
  }
}

/**
 * Download an image and store it in the recipe-images bucket under the
 * user's folder. Returns the public URL, or null if it isn't a usable image.
 */
export async function saveRemoteImage(supabase: Supabase, userId: string, imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const ext = EXT[type];
    if (!ext) return null;
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return null;

    const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('recipe-images').upload(path, bytes, { contentType: type, cacheControl: '3600' });
    if (error) {
      console.error('Recipe photo upload failed:', error.message);
      return null;
    }
    return supabase.storage.from('recipe-images').getPublicUrl(path).data.publicUrl;
  } catch (err) {
    console.error('Recipe photo download failed:', err);
    return null;
  }
}

/** Photo for a recipe saved without one: its source link's image, stored in Supabase. */
export async function photoFromSource(supabase: Supabase, userId: string, sourceUrl: string | null): Promise<string | null> {
  if (!sourceUrl || !/^https?:\/\//.test(sourceUrl)) return null;
  const imageUrl = await findSourceImage(sourceUrl);
  return imageUrl ? saveRemoteImage(supabase, userId, imageUrl) : null;
}
