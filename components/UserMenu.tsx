'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/app/lib/supabase';

export default function UserMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const initial = (email[0] ?? '?').toUpperCase();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-9 h-9 rounded-full bg-maroon-100 border border-maroon-300 text-maroon-900 font-display text-base flex items-center justify-center hover:bg-maroon-200 transition"
        aria-label="Account menu"
      >
        {initial}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-2 z-40 w-56 bg-white border border-beige-200 rounded-sm shadow-card py-2">
            <div className="px-4 py-2 border-b border-beige-200">
              <p className="text-[10px] tracking-eyebrow uppercase text-beige-700">Signed in as</p>
              <p className="text-sm text-ink truncate">{email}</p>
            </div>
            <button
              onClick={handleSignOut}
              className="w-full px-4 py-2 text-left text-sm text-ink/80 hover:bg-maroon-50 hover:text-maroon-900 transition"
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
