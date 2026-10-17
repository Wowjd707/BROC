'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { BRANDING } from '@/lib/branding';
import { createClient } from '@/lib/supabase/client';
import { refusalMessage } from '@/lib/sso-core';

/**
 * Federated providers offered on this deployment, from
 * NEXT_PUBLIC_SSO_PROVIDERS (comma-separated, e.g. "azure,google").
 *
 * Off unless configured: a "Sign in with Microsoft" button that fails because
 * nobody set up the provider in Supabase is worse than no button. The provider
 * itself is configured in Supabase Auth, not here — this only decides what the
 * login page offers.
 */
const SUPPORTED_PROVIDERS = {
  azure:  { label: 'Microsoft',       scopes: 'email profile openid' },
  google: { label: 'Google',          scopes: 'email profile' },
  okta:   { label: 'Okta',            scopes: 'email profile openid' },
  keycloak: { label: 'Keycloak',      scopes: 'email profile openid' },
} as const;

type ProviderKey = keyof typeof SUPPORTED_PROVIDERS;

function enabledProviders(): ProviderKey[] {
  const raw = process.env.NEXT_PUBLIC_SSO_PROVIDERS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ProviderKey => s in SUPPORTED_PROVIDERS);
}

const SAML_ENABLED = process.env.NEXT_PUBLIC_SSO_SAML === 'true';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ssoDomain, setSsoDomain] = useState('');
  const [showSamlInput, setShowSamlInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const providers = enabledProviders();
  const hasSso = providers.length > 0 || SAML_ENABLED;

  // A refusal from /auth/callback arrives as ?sso_error=<reason>. Render it as
  // a sentence rather than leaving the person on a login page with no
  // explanation for why they were just signed out.
  const ssoError = searchParams.get('sso_error');

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading('password');

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(null);
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }

  async function handleProviderLogin(provider: ProviderKey) {
    setError(null);
    setLoading(provider);

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: provider as Parameters<typeof supabase.auth.signInWithOAuth>[0]['provider'],
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        scopes: SUPPORTED_PROVIDERS[provider].scopes,
      },
    });

    // On success the browser is navigating away, so only failure lands here.
    if (authError) {
      setError(authError.message);
      setLoading(null);
    }
  }

  async function handleSamlLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading('saml');

    const domain = ssoDomain.trim().toLowerCase().replace(/^@/, '');
    if (!domain) {
      setError('Enter your work email domain, for example acme.com');
      setLoading(null);
      return;
    }

    const { data, error: authError } = await supabase.auth.signInWithSSO({
      domain,
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/dashboard` },
    });

    if (authError) {
      setError(authError.message);
      setLoading(null);
      return;
    }
    if (data?.url) window.location.assign(data.url);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          {BRANDING.wordmarkSrc ? (
            /* The wordmark replaces the name rather than sitting above it —
               two renderings of the same word is a lockup, not a header. The
               name stays as the accessible label. */
            /* eslint-disable-next-line @next/next/no-img-element --
               next/image does not optimise SVG and would add a loader for a
               file measured in hundreds of bytes. A plain img is correct here. */
            <img
              src={BRANDING.wordmarkSrc}
              alt={BRANDING.productName}
              className="h-9 w-auto mx-auto mb-3 text-emerald-600"
            />
          ) : (
            <>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-600 text-white font-bold text-xl mb-4">
                {BRANDING.mark}
              </div>
              <h1 className="text-2xl font-semibold text-gray-900">{BRANDING.productName}</h1>
            </>
          )}
          <p className="text-sm text-gray-500 mt-1">{BRANDING.tagline}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Sign in to your account</h2>

          {ssoError && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3">
              <p className="text-sm text-amber-900">{refusalMessage(ssoError)}</p>
            </div>
          )}

          {hasSso && (
            <div className="space-y-2.5 mb-6">
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleProviderLogin(p)}
                  disabled={loading !== null}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading === p ? 'Redirecting…' : `Continue with ${SUPPORTED_PROVIDERS[p].label}`}
                </button>
              ))}

              {SAML_ENABLED && !showSamlInput && (
                <button
                  type="button"
                  onClick={() => setShowSamlInput(true)}
                  disabled={loading !== null}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 transition-colors"
                >
                  Use your organization&apos;s single sign-on
                </button>
              )}

              {SAML_ENABLED && showSamlInput && (
                <form onSubmit={handleSamlLogin} className="space-y-2.5 rounded-lg bg-gray-50 border border-gray-200 p-3.5">
                  <label htmlFor="sso-domain" className="block text-sm font-medium text-gray-700">
                    Work email domain
                  </label>
                  <input
                    id="sso-domain"
                    type="text"
                    autoComplete="off"
                    value={ssoDomain}
                    onChange={(e) => setSsoDomain(e.target.value)}
                    placeholder="acme.com"
                    className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <button
                    type="submit"
                    disabled={loading !== null}
                    className="w-full bg-gray-900 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 disabled:opacity-50 transition-colors"
                  >
                    {loading === 'saml' ? 'Redirecting…' : 'Continue'}
                  </button>
                </form>
              )}

              <div className="relative pt-3">
                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                  <div className="w-full border-t border-gray-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-xs uppercase tracking-wide text-gray-400">or</span>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handlePasswordLogin} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="you@company.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading !== null}
              className="w-full bg-emerald-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading === 'password' ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          Don&apos;t have an account?{' '}
          <Link href="/signup" className="text-emerald-600 font-medium hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * useSearchParams needs a Suspense boundary or it opts the whole route into
 * dynamic rendering and warns at build time.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <LoginForm />
    </Suspense>
  );
}
