'use client';

import { useState, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { parseReceipt, confirmReceipt } from './actions';
import type { ParsedReceipt, ReviewLine } from './types';

type Mode = 'photo' | 'file' | 'paste' | 'list';

const MODES: { key: Mode; label: string }[] = [
  { key: 'photo', label: 'Photo' },
  { key: 'file',  label: 'Image or PDF' },
  { key: 'paste', label: 'Paste email' },
  { key: 'list',  label: 'Type a list' }
];

const SIZE_UNITS = [
  { value: '',      label: 'count' },
  { value: 'g',     label: 'g' },
  { value: 'kg',    label: 'kg' },
  { value: 'oz',    label: 'oz' },
  { value: 'lb',    label: 'lb' },
  { value: 'ml',    label: 'ml' },
  { value: 'l',     label: 'l' },
  { value: 'fl_oz', label: 'fl oz' }
];

const inputClass = 'px-2 py-1.5 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition';

export default function ReceiptPage() {
  return (
    <Suspense>
      <ReceiptFlow />
    </Suspense>
  );
}

function ReceiptFlow() {
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'list' ? 'list' : 'photo');
  const [text, setText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ added: number; checkedOff: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<ParsedReceipt>) {
    setWorking(true); setError('');
    try {
      setReceipt(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that');
    } finally {
      setWorking(false);
    }
  }

  async function handleFile(file: File) {
    if (file.type === 'application/pdf') {
      const data = await fileToBase64(file);
      return run(() => parseReceipt({ kind: 'pdf', data }));
    }
    if (!file.type.startsWith('image/')) {
      setError('Choose an image or a PDF');
      return;
    }
    const { data, mediaType } = await shrinkImage(file);
    return run(() => parseReceipt({ kind: 'image', data, mediaType }));
  }

  function updateLine(key: string, patch: Partial<ReviewLine>) {
    if (!receipt) return;
    setReceipt({ ...receipt, lines: receipt.lines.map(l => (l.key === key ? { ...l, ...patch } : l)) });
    if (problems[key]) {
      const next = { ...problems };
      delete next[key];
      setProblems(next);
    }
  }

  async function handleConfirm() {
    if (!receipt) return;
    setWorking(true); setError('');
    try {
      const result = await confirmReceipt(receipt);
      if (result.ok) setDone({ added: result.added, checkedOff: result.checkedOff });
      else setProblems(result.problems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update pantry');
    } finally {
      setWorking(false);
    }
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center py-12 border border-dashed border-beige-200 rounded-sm">
          <p className="font-display text-3xl text-maroon-900 mb-3">Pantry updated.</p>
          <p className="text-beige-700 text-sm mb-6">
            Added {done.added} {done.added === 1 ? 'item' : 'items'}
            {done.checkedOff > 0 && <> and checked off {done.checkedOff} on your grocery list</>}.
          </p>
          <div className="flex gap-3 justify-center">
            <Link href="/pantry" className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium">See pantry</Link>
            <button onClick={() => { setDone(null); setReceipt(null); setText(''); }} className="px-5 py-2.5 text-sm text-ink/70 hover:text-maroon-900 transition">Add another</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (receipt) {
    const food = receipt.lines.filter(l => l.include || l.ingredient_name);
    const review = food.filter(l => l.status !== 'known' || problems[l.key]);
    const known = food.filter(l => l.status === 'known' && !problems[l.key]);
    const skipped = receipt.lines.filter(l => !food.includes(l));
    const includedCount = receipt.lines.filter(l => l.include).length;

    return (
      <Shell>
        {(receipt.store_name || receipt.purchased_on) && (
          <p className="text-sm text-beige-700 mb-6">
            {[receipt.store_name, receipt.purchased_on].filter(Boolean).join(' · ')}
          </p>
        )}

        {review.length > 0 && (
          <section className="mb-10">
            <SectionHeading title="Check these" count={review.length} />
            <p className="text-sm text-beige-700 mb-4">
              New products or guesses. Fix anything that's wrong. Sufra remembers what you confirm, so next time these go straight in.
            </p>
            <div className="space-y-3">
              {review.map(l => (
                <LineEditor key={l.key} line={l} problem={problems[l.key]} onChange={p => updateLine(l.key, p)} />
              ))}
            </div>
          </section>
        )}

        {known.length > 0 && (
          <section className="mb-10">
            <SectionHeading title="Matched" count={known.length} />
            <div className="space-y-2">
              {known.map(l => <KnownLine key={l.key} line={l} onChange={p => updateLine(l.key, p)} />)}
            </div>
          </section>
        )}

        {skipped.length > 0 && (
          <section className="mb-10">
            <SectionHeading title="Skipped" count={skipped.length} />
            <ul className="text-xs text-beige-700 space-y-1">
              {skipped.map(l => <li key={l.key}>{l.raw_text}</li>)}
            </ul>
          </section>
        )}

        {error && <p className="mb-4 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">{error}</p>}
        {Object.keys(problems).length > 0 && (
          <p className="mb-4 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">Fix the highlighted lines, then try again.</p>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={() => setReceipt(null)} className="px-4 py-2 text-sm text-ink/70 hover:text-maroon-900 transition">Start over</button>
          <button
            onClick={handleConfirm}
            disabled={working || includedCount === 0}
            className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
          >
            {working ? 'Updating…' : `Add ${includedCount} to pantry`}
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex flex-wrap gap-1 mb-6 border-b border-beige-200">
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => { setMode(m.key); setError(''); }}
            className={`px-3 py-2 text-sm -mb-px border-b-2 transition ${mode === m.key ? 'border-maroon-900 text-maroon-900' : 'border-transparent text-beige-700 hover:text-maroon-900'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {(mode === 'photo' || mode === 'file') && (
        <div className="text-center py-12 border border-dashed border-beige-200 rounded-sm">
          <p className="text-sm text-beige-700 mb-5">
            {mode === 'photo' ? 'Take a photo of the whole receipt, flat and well lit.' : 'Upload a receipt image or a PDF from your email.'}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept={mode === 'photo' ? 'image/*' : 'image/*,application/pdf'}
            capture={mode === 'photo' ? 'environment' : undefined}
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={working}
            className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
          >
            {working ? 'Reading receipt…' : mode === 'photo' ? 'Take photo' : 'Choose file'}
          </button>
        </div>
      )}

      {(mode === 'paste' || mode === 'list') && (
        <div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={mode === 'paste' ? 12 : 5}
            placeholder={mode === 'paste' ? 'Paste the receipt from your email' : '2 lb chicken, bag of rice, 3 onions, olive oil'}
            className="w-full px-3 py-2.5 bg-white border border-beige-200 rounded-sm text-sm focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition"
          />
          <div className="flex justify-end mt-3">
            <button
              onClick={() => run(() => parseReceipt(mode === 'paste' ? { kind: 'text', text } : { kind: 'list', text }))}
              disabled={working || !text.trim()}
              className="px-5 py-2.5 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium disabled:opacity-50"
            >
              {working ? 'Reading…' : 'Continue'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-sm text-maroon-900 bg-maroon-100 px-3 py-2 rounded-sm">{error}</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="max-w-3xl mx-auto px-5 sm:px-8 pb-32">
      <div className="pt-6 pb-4">
        <Link href="/pantry" className="inline-flex items-center gap-1.5 text-xs tracking-wide text-beige-700 hover:text-maroon-900 transition">
          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6" /></svg>
          Pantry
        </Link>
      </div>
      <div className="mb-8">
        <p className="text-xs tracking-eyebrow uppercase text-beige-700 mb-3">Pantry</p>
        <h1 className="font-display text-4xl sm:text-5xl text-maroon-900 leading-[0.95]">
          Add <em className="font-medium">groceries</em>.
        </h1>
      </div>
      {children}
    </main>
  );
}

function SectionHeading({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-baseline gap-4 mb-3">
      <h2 className="font-display text-xl text-maroon-900">{title}</h2>
      <div className="flex-1 h-px bg-beige-200" />
      <span className="text-[10px] tracking-eyebrow uppercase text-beige-700 tnum">{count}</span>
    </div>
  );
}

function amountText(line: ReviewLine): string {
  const size = line.size_quantity != null
    ? `${line.size_quantity}${line.size_unit ? ` ${line.size_unit.replace('_', ' ')}` : ''}`
    : null;
  if (line.sold_by_weight && size) return size;
  if (!size) return `${line.packages}`;
  return line.packages === 1 ? size : `${line.packages} × ${size}`;
}

function KnownLine({ line, onChange }: { line: ReviewLine; onChange: (p: Partial<ReviewLine>) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <LineEditor line={line} onChange={onChange} onDone={() => setEditing(false)} />;
  return (
    <div className={`flex items-center justify-between gap-3 p-3 bg-white border border-beige-200 rounded-sm ${line.include ? '' : 'opacity-50'}`}>
      <label className="flex items-center gap-3 min-w-0 flex-1">
        <input type="checkbox" checked={line.include} onChange={e => onChange({ include: e.target.checked })} className="accent-maroon-900" />
        <span className="text-sm text-ink/85 truncate">{line.ingredient_name}</span>
        {line.on_list && <OnListBadge />}
      </label>
      <span className="text-sm text-maroon-900 font-medium tnum">{amountText(line)}</span>
      <button onClick={() => setEditing(true)} className="text-xs text-beige-700 hover:text-maroon-900">Edit</button>
    </div>
  );
}

function OnListBadge() {
  return <span className="text-[10px] tracking-eyebrow uppercase text-maroon-700 whitespace-nowrap">on list</span>;
}

function LineEditor({
  line, problem, onChange, onDone
}: {
  line: ReviewLine;
  problem?: string;
  onChange: (p: Partial<ReviewLine>) => void;
  onDone?: () => void;
}) {
  return (
    <div className={`p-3 bg-white border rounded-sm ${problem ? 'border-maroon-700' : 'border-maroon-300'} ${line.include ? '' : 'opacity-60'}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <label className="flex items-center gap-2 min-w-0">
          <input type="checkbox" checked={line.include} onChange={e => onChange({ include: e.target.checked })} className="accent-maroon-900" />
          <span className="text-xs text-beige-700 truncate font-mono">{line.raw_text ?? 'Typed item'}</span>
        </label>
        <div className="flex items-center gap-2">
          {line.on_list && <OnListBadge />}
          <span className="text-[10px] tracking-eyebrow uppercase text-beige-700">{line.status === 'uncertain' ? 'guess' : line.status === 'new' ? 'new' : ''}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={line.ingredient_name}
          onChange={e => onChange({ ingredient_name: e.target.value })}
          aria-label="Ingredient"
          className={`${inputClass} flex-1 min-w-[140px]`}
        />
        {!line.sold_by_weight && (
          <>
            <input
              type="number" step="any" min="0"
              value={line.packages}
              onChange={e => onChange({ packages: parseFloat(e.target.value) || 0 })}
              aria-label="How many"
              className={`${inputClass} w-16 tnum text-center`}
            />
            <span className="text-xs text-beige-700">×</span>
          </>
        )}
        <input
          type="number" step="any" min="0"
          value={line.size_quantity ?? ''}
          placeholder="size"
          onChange={e => onChange({ size_quantity: e.target.value === '' ? null : parseFloat(e.target.value) })}
          aria-label={line.sold_by_weight ? 'Weight' : 'Size of each'}
          className={`${inputClass} w-20 tnum text-center`}
        />
        <select value={line.size_unit} onChange={e => onChange({ size_unit: e.target.value })} aria-label="Unit" className={inputClass}>
          {SIZE_UNITS.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
        </select>
        {onDone && <button onClick={onDone} className="px-3 py-1.5 text-xs text-beige-700 hover:text-maroon-900">Done</button>}
      </div>
      {problem && <p className="mt-2 text-xs text-maroon-900">{problem}</p>}
    </div>
  );
}

function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Phone photos are often 5 to 10 MB. Scale to at most 2000 px on the long side
 * and re-encode as JPEG, which keeps receipt text readable and the upload small.
 */
async function shrinkImage(file: File): Promise<{ data: string; mediaType: string }> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (blob) return { data: await fileToBase64(blob), mediaType: 'image/jpeg' };
  } catch {
    // Fall through to the original file (e.g. a format the browser can't decode).
  }
  return { data: await fileToBase64(file), mediaType: file.type };
}
