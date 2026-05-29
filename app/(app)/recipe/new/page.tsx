'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CATEGORY_LABEL, type Category } from '@/app/lib/types';
import { createClient } from '@/app/lib/supabase';
import { uploadRecipeImage } from '@/app/lib/upload';
import { createRecipe, type IngredientInput } from './actions';
import { importFromUrl, importFromText, importFromImageBase64 } from './import-actions';
import type { ExtractedRecipe } from '@/app/lib/recipe-extractor';

const CATEGORIES: Category[] = ['meat', 'vegetarian', 'baked_goods', 'desserts', 'drinks'];

const COMMON_UNITS = [
  { value: '',      label: '—' },
  { value: 'tsp',   label: 'tsp' },
  { value: 'tbsp',  label: 'tbsp' },
  { value: 'cup',   label: 'cup' },
  { value: 'fl_oz', label: 'fl oz' },
  { value: 'ml',    label: 'ml' },
  { value: 'l',     label: 'l' },
  { value: 'g',     label: 'g' },
  { value: 'kg',    label: 'kg' },
  { value: 'oz',    label: 'oz' },
  { value: 'lb',    label: 'lb' },
  { value: 'pinch', label: 'pinch' },
  { value: 'bunch', label: 'bunch' }
];

const CUISINE_SUGGESTIONS = ['Pakistani', 'Indian', 'Levantine', 'Mediterranean', 'American', 'Mexican', 'East Asian', 'Italian', 'French'];

type IngredientRow = { id: string; quantity: string; unit: string; name: string; prep_note: string };
type StepRow = { id: string; content: string };
type ImportMode = 'link' | 'paste' | 'photo';

function newId() { return Math.random().toString(36).slice(2, 9); }

function parseQuantity(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const [, w, n, d] = mixedMatch;
    return parseInt(w) + parseInt(n) / parseInt(d);
  }
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    const [, n, d] = fracMatch;
    return parseInt(n) / parseInt(d);
  }
  const num = parseFloat(trimmed);
  return isNaN(num) ? null : num;
}

function formatQty(n: number | null): string {
  if (n === null) return '';
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(2).replace(/\.?0+$/, '');
}

export default function NewRecipePage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Header fields
  const [name, setName] = useState('');
  const [author, setAuthor] = useState('Personal');
  const [authorHandle, setAuthorHandle] = useState('');
  const [category, setCategory] = useState<Category>('meat');
  const [cuisine, setCuisine] = useState('');
  const [servings, setServings] = useState('4');
  const [totalTime, setTotalTime] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [ingredients, setIngredients] = useState<IngredientRow[]>([
    { id: newId(), quantity: '', unit: '', name: '', prep_note: '' }
  ]);
  const [steps, setSteps] = useState<StepRow[]>([
    { id: newId(), content: '' }
  ]);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Import state
  const [importMode, setImportMode] = useState<ImportMode | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const importImageRef = useRef<HTMLInputElement>(null);

  function applyExtracted(data: ExtractedRecipe) {
    if (data.name) setName(data.name);
    if (data.author) setAuthor(data.author);
    if (data.author_handle) setAuthorHandle(data.author_handle);
    if (data.category) setCategory(data.category);
    if (data.cuisine) setCuisine(data.cuisine);
    if (data.servings_yield) setServings(String(data.servings_yield));
    if (data.total_time_min) setTotalTime(String(data.total_time_min));
    if (data.source_url) setSourceUrl(data.source_url);
    if (data.notes) setNotes(data.notes);
    if (data.tags) setTags(data.tags.map(t => t.toLowerCase()));
    if (data.ingredients && data.ingredients.length > 0) {
      setIngredients(data.ingredients.map(i => ({
        id: newId(),
        quantity: formatQty(i.quantity),
        unit: i.unit ?? '',
        name: i.name,
        prep_note: i.prep_note ?? ''
      })));
    }
    if (data.steps && data.steps.length > 0) {
      setSteps(data.steps.map(s => ({ id: newId(), content: s })));
    }
    setImportMode(null);
  }

  async function handleImportUrl() {
    setImporting(true); setImportError('');
    try {
      const data = await importFromUrl(importUrl);
      applyExtracted(data);
      setImportUrl('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function handleImportText() {
    setImporting(true); setImportError('');
    try {
      const data = await importFromText(importText);
      applyExtracted(data);
      setImportText('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function handleImportImage(file: File) {
    setImporting(true); setImportError('');
    try {
      const base64 = await fileToBase64(file);
      const data = await importFromImageBase64(base64, file.type);
      applyExtracted(data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsDataURL(file);
    });
  }

  function handleImageSelect(file: File) {
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = e => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput('');
  }

  function updateIngredient(id: string, field: keyof IngredientRow, value: string) {
    setIngredients(ingredients.map(i => i.id === id ? { ...i, [field]: value } : i));
  }

  function updateStep(id: string, content: string) {
    setSteps(steps.map(s => s.id === id ? { ...s, content } : s));
  }

  async function handleSave() {
    setErrorMsg('');
    if (!name.trim()) {
      setErrorMsg('Recipe name is required');
      return;
    }
    setSaving(true);
    try {
      let imagePath: string | null = null;
      if (imageFile) {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Not signed in');
        imagePath = await uploadRecipeImage(imageFile, user.id);
      }

      const cleanIngredients: IngredientInput[] = ingredients
        .filter(i => i.name.trim())
        .map(i => ({
          quantity: parseQuantity(i.quantity),
          unit: i.unit || null,
          name: i.name.trim(),
          prep_note: i.prep_note.trim() || null
        }));

      const cleanSteps = steps.map(s => s.content.trim()).filter(Boolean);

      const { id } = await createRecipe({
        name: name.trim(),
        author: author.trim() || 'Personal',
        author_handle: authorHandle.trim() || null,
        category,
        cuisine: cuisine.trim() || 'Other',
        servings_yield: parseInt(servings) || 4,
        total_time_min: totalTime ? parseInt(totalTime) : null,
        source_url: sourceUrl.trim() || null,
        image_path: imagePath,
        notes: notes.trim() || null,
        tags,
        ingredients: cleanIngredients,
        steps: cleanSteps
      });
      router.push(`/recipe/${id}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  }

  return (
    <main className="max-w-4xl mx-auto px-5 sm:px-8 pb-32">
      <div className="pt-6 pb-4">
        <Link href="/library" className="inline-flex items-center gap-1.5 text-xs tracking-wide text-beige-700 hover:text-maroon-900 transition">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m15 18-6-6 6-6" />
          </svg>
          Library
        </Link>
      </div>

      {/* IMPORT WIDGET */}
      <div className="mb-10 p-5 bg-maroon-50 border border-maroon-100 rounded-sm">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <p className="text-sm text-maroon-900 font-medium">Have a link, paste, or photo?</p>
            <p className="text-xs text-beige-700 mt-0.5">Sufra extracts the recipe automatically. Review and save.</p>
          </div>
          {importMode && (
            <button
              type="button"
              onClick={() => { setImportMode(null); setImportError(''); }}
              className="text-xs text-beige-700 hover:text-maroon-900"
            >
              Close
            </button>
          )}
        </div>

        {!importMode ? (
          <div className="flex flex-wrap gap-2">
            <ImportTab onClick={() => setImportMode('link')} icon="link">From a link</ImportTab>
            <ImportTab onClick={() => setImportMode('paste')} icon="paste">Paste text</ImportTab>
            <ImportTab onClick={() => setImportMode('photo')} icon="photo">From a photo</ImportTab>
          </div>
        ) : (
          <div className="mt-2">
            {importMode === 'link' && (
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={importUrl}
                  onChange={e => setImportUrl(e.target.value)}
                  placeholder="https://nytcooking.com/recipes/…"
                  className="flex-1 px-3 py-2 bg-white border border-maroon-100 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
                />
                <button
                  type="button"
                  onClick={handleImportUrl}
                  disabled={importing || !importUrl.trim()}
                  className="px-4 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
                >
                  {importing ? 'Extracting…' : 'Extract'}
                </button>
              </div>
            )}

            {importMode === 'paste' && (
              <div className="space-y-2">
                <textarea
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder="Paste a recipe, Instagram caption, or anything with ingredients and steps…"
                  rows={6}
                  className="w-full px-3 py-2 bg-white border border-maroon-100 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition resize-y"
                />
                <button
                  type="button"
                  onClick={handleImportText}
                  disabled={importing || importText.trim().length < 20}
                  className="px-4 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
                >
                  {importing ? 'Extracting…' : 'Extract'}
                </button>
              </div>
            )}

            {importMode === 'photo' && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => importImageRef.current?.click()}
                  disabled={importing}
                  className="block w-full py-8 px-4 bg-white border-2 border-dashed border-maroon-100 rounded-sm hover:border-maroon-700 transition text-center disabled:opacity-50"
                >
                  <p className="text-sm text-maroon-900 font-medium">
                    {importing ? 'Reading the photo…' : 'Tap to upload a recipe photo'}
                  </p>
                  <p className="text-xs text-beige-700 mt-1">Cookbook page, handwritten card, screenshot — all work</p>
                </button>
                <input
                  ref={importImageRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) handleImportImage(f);
                  }}
                />
              </div>
            )}

            {importError && (
              <p className="mt-3 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">{importError}</p>
            )}
          </div>
        )}
      </div>

      <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">New recipe</p>

      <input
        type="text"
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Recipe name…"
        className="w-full font-display text-5xl sm:text-6xl text-maroon-900 leading-[0.95] bg-transparent border-0 border-b border-beige-200 pb-3 focus:outline-none focus:border-maroon-700 transition placeholder:text-beige-300"
      />

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ink/60">By</span>
        <input type="text" value={author} onChange={e => setAuthor(e.target.value)} placeholder="Author" className="px-2 py-1 bg-transparent border-b border-beige-200 text-maroon-900 font-medium focus:outline-none focus:border-maroon-700 transition w-40" />
        <input type="text" value={authorHandle} onChange={e => setAuthorHandle(e.target.value)} placeholder="@handle (optional)" className="px-2 py-1 bg-transparent border-b border-beige-200 text-beige-700 focus:outline-none focus:border-maroon-700 transition w-44" />
      </div>

      <section className="mt-10">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Photograph</p>
        <button onClick={() => fileInputRef.current?.click()} type="button" className="block w-full relative aspect-[16/10] sm:aspect-[2/1] rounded-sm overflow-hidden border-2 border-dashed border-beige-200 bg-beige-100/50 hover:border-maroon-300 hover:bg-maroon-50 transition group">
          {imagePreview ? (
            <>
              <img src={imagePreview} alt="" className="absolute inset-0 w-full h-full object-cover" />
              <div className="absolute inset-0 bg-maroon-950/0 group-hover:bg-maroon-950/30 transition flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 transition px-4 py-2 bg-beige-50 text-maroon-900 text-sm rounded-sm">Change image</span>
              </div>
            </>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-beige-700">
              <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="1" /><circle cx="9" cy="11" r="2" /><path d="m3 17 5-5 4 4 3-3 6 6" /></svg>
              <p className="text-sm">Tap to upload or drop a photo</p>
              <p className="text-xs text-beige-700/70">JPG, PNG, HEIC</p>
            </div>
          )}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) handleImageSelect(file); }} />
      </section>

      <section className="mt-10">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-4">Details</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Field label="Category">
            <select value={category} onChange={e => setCategory(e.target.value as Category)} className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition">
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </Field>
          <Field label="Cuisine">
            <input type="text" value={cuisine} onChange={e => setCuisine(e.target.value)} list="cuisine-list" placeholder="Pakistani" className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition" />
            <datalist id="cuisine-list">{CUISINE_SUGGESTIONS.map(c => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Servings">
            <input type="number" min="1" value={servings} onChange={e => setServings(e.target.value)} className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm tnum focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition" />
          </Field>
          <Field label="Time (min)">
            <input type="number" min="0" value={totalTime} onChange={e => setTotalTime(e.target.value)} placeholder="45" className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm tnum focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition" />
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Source URL (optional)">
            <input type="url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://example.com/recipe" className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition" />
          </Field>
        </div>
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-2xl text-maroon-900">Ingredients</h2>
          <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">{ingredients.filter(i => i.name.trim()).length} items</span>
        </div>
        <div className="space-y-2">
          {ingredients.map(ing => (
            <div key={ing.id} className="grid grid-cols-[64px_88px_1fr_36px] sm:grid-cols-[80px_100px_1fr_180px_36px] gap-2 items-center">
              <input type="text" inputMode="decimal" value={ing.quantity} onChange={e => updateIngredient(ing.id, 'quantity', e.target.value)} placeholder="Qty" className="px-2 py-2 bg-white border border-beige-200 rounded-sm text-sm tnum text-center focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition" />
              <select value={ing.unit} onChange={e => updateIngredient(ing.id, 'unit', e.target.value)} className="px-2 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition">
                {COMMON_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
              <input type="text" value={ing.name} onChange={e => updateIngredient(ing.id, 'name', e.target.value)} placeholder="chicken thighs" className="px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition" />
              <input type="text" value={ing.prep_note} onChange={e => updateIngredient(ing.id, 'prep_note', e.target.value)} placeholder="diced (optional)" className="hidden sm:block px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm italic text-beige-700 focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition" />
              <button type="button" onClick={() => setIngredients(ingredients.filter(x => x.id !== ing.id))} disabled={ingredients.length === 1} className="w-9 h-9 flex items-center justify-center text-beige-700 hover:text-maroon-700 hover:bg-maroon-50 rounded-sm disabled:opacity-30 disabled:cursor-not-allowed transition" aria-label="Remove">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setIngredients([...ingredients, { id: newId(), quantity: '', unit: '', name: '', prep_note: '' }])} className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-sm text-maroon-700 hover:text-maroon-900 hover:bg-maroon-50 rounded-sm transition">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Add ingredient
        </button>
      </section>

      <section className="mt-12">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-display text-2xl text-maroon-900">Method</h2>
          <span className="text-xs tracking-eyebrow uppercase text-beige-700 tnum">{steps.filter(s => s.content.trim()).length} steps</span>
        </div>
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={step.id} className="flex gap-4 items-start">
              <span className="font-display text-3xl text-maroon-300 leading-none tnum w-10 flex-shrink-0 pt-2">{(i + 1).toString().padStart(2, '0')}</span>
              <textarea value={step.content} onChange={e => updateStep(step.id, e.target.value)} placeholder="Describe this step…" rows={2} className="flex-1 px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm leading-relaxed focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition resize-none" />
              <button type="button" onClick={() => setSteps(steps.filter(x => x.id !== step.id))} disabled={steps.length === 1} className="w-9 h-9 mt-1 flex items-center justify-center text-beige-700 hover:text-maroon-700 hover:bg-maroon-50 rounded-sm disabled:opacity-30 disabled:cursor-not-allowed transition flex-shrink-0" aria-label="Remove">
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setSteps([...steps, { id: newId(), content: '' }])} className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-sm text-maroon-700 hover:text-maroon-900 hover:bg-maroon-50 rounded-sm transition">
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
          Add step
        </button>
      </section>

      <section className="mt-12">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Notes (optional)</p>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Personal tips, variations, what Mom said about the cardamom…" rows={3} className="w-full px-3 py-2 bg-white border border-beige-200 rounded-sm text-sm leading-relaxed italic focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition resize-none" />
      </section>

      <section className="mt-10">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Tags</p>
        <div className="flex flex-wrap items-center gap-2">
          {tags.map(tag => (
            <span key={tag} className="inline-flex items-center gap-1.5 px-3 py-1 text-xs bg-beige-100 text-ink/80 rounded-sm border border-beige-200">
              {tag}
              <button type="button" onClick={() => setTags(tags.filter(t => t !== tag))} className="text-beige-700 hover:text-maroon-700">
                <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </span>
          ))}
          <input type="text" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } if (e.key === 'Backspace' && !tagInput && tags.length) setTags(tags.slice(0, -1)); }} onBlur={addTag} placeholder={tags.length ? 'Add another…' : 'quick, weeknight, festive…'} className="px-2 py-1 text-xs bg-transparent border-b border-beige-200 focus:outline-none focus:border-maroon-700 transition min-w-[150px]" />
        </div>
      </section>

      {errorMsg && <div className="mt-8 p-3 bg-maroon-100 border border-maroon-300 text-maroon-900 text-sm rounded-sm">{errorMsg}</div>}

      <div className="fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md bg-beige-50/90 border-t border-beige-200">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-4 flex items-center justify-between gap-3">
          <p className="text-xs text-beige-700 hidden sm:block">Recipes are private by default.</p>
          <div className="flex gap-3 ml-auto">
            <Link href="/library" className="px-5 py-2.5 bg-white border border-beige-200 text-ink rounded-sm hover:border-maroon-300 transition text-sm">Cancel</Link>
            <button type="button" onClick={handleSave} disabled={!name.trim() || saving} className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving…' : 'Save recipe'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] tracking-eyebrow uppercase text-beige-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function ImportTab({ onClick, icon, children }: { onClick: () => void; icon: 'link' | 'paste' | 'photo'; children: React.ReactNode }) {
  const icons = {
    link: <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
    paste: <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1" /></svg>,
    photo: <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="1" /><circle cx="9" cy="11" r="2" /><path d="m3 17 5-5 4 4 3-3 6 6" /></svg>
  };
  return (
    <button type="button" onClick={onClick} className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-maroon-100 rounded-sm text-sm text-maroon-900 hover:bg-maroon-100 transition">
      {icons[icon]}
      {children}
    </button>
  );
}
