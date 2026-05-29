import { createClient } from './supabase';

/**
 * Upload an image to the recipe-images bucket.
 * Returns the public URL of the uploaded file.
 */
export async function uploadRecipeImage(file: File, userId: string): Promise<string> {
  const supabase = createClient();

  // Generate a unique filename: {userId}/{timestamp}-{random}.{ext}
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const filename = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error } = await supabase.storage
    .from('recipe-images')
    .upload(filename, file, {
      cacheControl: '3600',
      upsert: false
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data: { publicUrl } } = supabase.storage
    .from('recipe-images')
    .getPublicUrl(filename);

  return publicUrl;
}
