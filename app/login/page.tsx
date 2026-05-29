'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/app/lib/supabase';

type Mode = 'signin' | 'signup' | 'confirm-sent';

const inputClass =
  'w-full px-4 py-3 bg-beige-50 border border-beige-200 rounded-sm text-ink placeholder-beige-700/60 focus:outline-none focus:border-maroon-700 focus:ring-1 focus:ring-maroon-700 transition';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  function switchMode(next: Mode) {
    setMode(next);
    setErrorMsg('');
  }

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push('/library');
      router.refresh();
    } catch (err) {
      setErrorMsg(friendlySignIn(err));
      setBusy(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setBusy(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
      });
      if (error) throw error;
      // With email confirmation off (the intended setup), a session comes back
      // immediately and we're in — no email, no rate limits.
      if (data.session) {
        router.push('/library');
        router.refresh();
        return;
      }
      // An existing account returns a user with no identities and sends nothing.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        switchMode('signin');
        setErrorMsg('This email already has an account. Sign in instead.');
        return;
      }
      // Confirmation is still on in the dashboard — fall back to the email link.
      switchMode('confirm-sent');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="w-full max-w-md">
        <div className="text-center mb-12">
          <Link href="/" className="inline-block">
            <h1 className="wordmark text-6xl text-maroon-900 leading-none">sufra</h1>
            <p className="mt-3 text-beige-700 text-xs tracking-eyebrow uppercase">
              Your spread, gathered
            </p>
          </Link>
        </div>

        <div className="bg-white border border-beige-200 rounded-sm shadow-card p-8">
          {mode === 'confirm-sent' ? (
            <>
              <h2 className="font-display text-2xl text-maroon-900 mb-1">Confirm your email</h2>
              <p className="text-sm text-beige-700 mb-6">
                We sent a confirmation link to <span className="text-ink font-medium">{email}</span>.
                Tap it to finish setting up your account, then sign in.
              </p>
              <button
                type="button"
                onClick={() => switchMode('signin')}
                className="block w-full text-center text-sm text-maroon-900 hover:text-maroon-700 transition font-medium"
              >
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <h2 className="font-display text-2xl text-maroon-900 mb-1">
                {mode === 'signin' ? 'Sign in' : 'Create your account'}
              </h2>
              <p className="text-sm text-beige-700 mb-6">
                {mode === 'signin'
                  ? 'Enter your email and password.'
                  : 'Set this up once — your password works every time after that.'}
              </p>

              <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-xs tracking-eyebrow uppercase text-beige-700 mb-2">
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className={inputClass}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-xs tracking-eyebrow uppercase text-beige-700 mb-2">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={mode === 'signup' ? 6 : undefined}
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className={`${inputClass} pr-16`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(s => !s)}
                      className="absolute inset-y-0 right-0 px-4 text-xs text-beige-700 hover:text-maroon-900 transition"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {mode === 'signup' && (
                    <p className="mt-2 text-xs text-beige-700">At least 6 characters.</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={busy || !email || (mode === 'signup' ? password.length < 6 : !password)}
                  className="w-full py-3 bg-maroon-900 text-beige-50 rounded-sm hover:bg-maroon-700 disabled:opacity-60 transition font-medium tracking-wide"
                >
                  {busy
                    ? (mode === 'signin' ? 'Signing in…' : 'Creating…')
                    : (mode === 'signin' ? 'Sign in' : 'Create account')}
                </button>

                {errorMsg && (
                  <p className="text-sm text-maroon-700 bg-maroon-100 px-3 py-2 rounded-sm">{errorMsg}</p>
                )}
              </form>

              <div className="border-t border-beige-200 my-6" />

              <button
                type="button"
                onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
                className="block w-full text-center text-sm text-maroon-900 hover:text-maroon-700 transition font-medium"
              >
                {mode === 'signin' ? 'Create an account' : 'Already have an account? Sign in'}
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-beige-700 mt-8">
          Your recipes stay yours. Shared dishes are read-only.
        </p>
      </div>
    </main>
  );
}

function friendlySignIn(err: unknown): string {
  const raw = err instanceof Error ? err.message : '';
  if (/invalid login credentials/i.test(raw)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(raw)) {
    return 'This account isn’t confirmed yet — check your inbox for the confirmation link.';
  }
  return raw || 'Could not sign in. Try again.';
}
