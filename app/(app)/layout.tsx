import Link from 'next/link';
import { createServerSupabase } from '@/app/lib/supabase-server';
import UserMenu from '@/components/UserMenu';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-30 backdrop-blur-md bg-beige-50/85 border-b border-beige-200">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-3">
          <Link href="/library" className="wordmark text-3xl text-maroon-900 leading-none">
            sufra
          </Link>

          <nav className="flex items-center gap-1 sm:gap-2">
            <NavLink href="/library" label="Library" />
            <NavLink href="/plan" label="Plan" />
            <NavLink href="/pantry" label="Pantry" />
            <NavLink href="/shopping" label="List" />
          </nav>

          <div className="flex items-center gap-3">
            <Link
              href="/recipe/new"
              className="hidden sm:inline-flex items-center gap-2 px-4 py-2 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 transition text-sm font-medium"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add
            </Link>
            <Link
              href="/recipe/new"
              className="sm:hidden w-9 h-9 inline-flex items-center justify-center bg-maroon-900 text-beige-50 rounded-sm"
              aria-label="Add recipe"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </Link>
            <UserMenu email={user?.email ?? ''} />
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="px-2 sm:px-3 py-2 text-sm text-ink/80 hover:text-maroon-900 transition tracking-wide">
      {label}
    </Link>
  );
}
