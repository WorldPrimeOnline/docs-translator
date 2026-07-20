import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';
import { DISABLED_LOCALE_CODES, DEFAULT_LOCALE } from '@/i18n/locales';

// ---------------------------------------------------------------------------
// In-memory rate limiter — per-instance, per-IP, good enough for MVP
// ---------------------------------------------------------------------------
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
const MAX_REQUESTS_JOBS = 120;

function isRateLimited(ip: string, limit: number): boolean {
  const key = `${ip}:${limit}`;
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > limit;
}

// ---------------------------------------------------------------------------
// Locale helpers (localePrefix: 'always' — every locale has a /{code}/ prefix)
// ---------------------------------------------------------------------------
const ALL_LOCALES = routing.locales as string[];

function localeFromPath(pathname: string): string {
  for (const locale of ALL_LOCALES) {
    if (pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`) {
      return locale;
    }
  }
  return routing.defaultLocale;
}

function stripLocalePrefix(pathname: string): string {
  for (const locale of ALL_LOCALES) {
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
    if (pathname === `/${locale}`) return '/';
  }
  return pathname;
}

// ---------------------------------------------------------------------------
// next-intl middleware
// ---------------------------------------------------------------------------
const handleI18n = createIntlMiddleware(routing);

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // 1. Rate-limit API routes
  if (
    pathname.startsWith('/api/') &&
    !pathname.startsWith('/api/webhooks/')
  ) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';

    // Payment status is polled every 3 s from the result page; allow same rate as job polling.
    const isHighFreqPath =
      pathname.startsWith('/api/jobs') ||
      pathname.startsWith('/api/payments/halyk/status');
    const limit = isHighFreqPath ? MAX_REQUESTS_JOBS : MAX_REQUESTS;
    if (isRateLimited(ip, limit)) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 2. API, manifest, and auth callback routes: skip i18n
  if (pathname.startsWith('/api/') || pathname === '/auth/callback') {
    let apiResponse = NextResponse.next({ request });

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return request.cookies.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            apiResponse = NextResponse.next({ request });
            cookiesToSet.forEach(({ name, value, options }) =>
              apiResponse.cookies.set(name, value, options),
            );
          },
        },
      },
    );
    await supabase.auth.getUser();
    return apiResponse;
  }

  // 3. Disabled-locale guard — redirect /zh/..., /ko/..., etc. to /ru/...
  //    Must run before handleI18n so next-intl never serves a disabled locale.
  for (const disabledCode of DISABLED_LOCALE_CODES) {
    if (pathname.startsWith(`/${disabledCode}/`) || pathname === `/${disabledCode}`) {
      const rest = pathname === `/${disabledCode}` ? '' : pathname.slice(disabledCode.length + 1);
      const url = request.nextUrl.clone();
      url.pathname = `/${DEFAULT_LOCALE}${rest}`;
      return NextResponse.redirect(url, { status: 307 });
    }
  }

  // 4. Page routes: i18n + Supabase session refresh
  const i18nResponse = handleI18n(request) as NextResponse;

  // Let i18n locale redirects pass straight through
  const status = i18nResponse.status;
  if (status === 301 || status === 302 || status === 307 || status === 308) {
    return i18nResponse;
  }

  let response = i18nResponse;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          i18nResponse.headers.forEach((value, key) => response.headers.set(key, value));
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // 5. Auth redirects (locale-aware)
  const cleanPath = stripLocalePrefix(pathname);
  const locale = localeFromPath(pathname);
  // With localePrefix: 'always', every locale has a /{code}/ prefix including the default
  const prefix = `/${locale}`;

  if (!user && cleanPath.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/auth/login`;
    return NextResponse.redirect(url);
  }

  // Pricing Lab (internal, staging-only) requires an authenticated session at minimum —
  // the page itself and its API routes additionally check ENABLE_PRICING_LAB + the
  // operator email allowlist (src/lib/internal/pricing-lab-guard.ts).
  if (!user && cleanPath.startsWith('/internal')) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/auth/login`;
    return NextResponse.redirect(url);
  }

  // Checkout requires auth — unlike /dashboard, we preserve `?draftId=` via `next` so
  // the pre-checkout wizard draft is not lost across the login detour.
  if (!user && cleanPath.startsWith('/checkout')) {
    const originalPathWithQuery = pathname + request.nextUrl.search;
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/auth/login`;
    url.search = '';
    url.searchParams.set('next', originalPathWithQuery);
    return NextResponse.redirect(url);
  }

  if (user && (cleanPath === '/auth/login' || cleanPath === '/auth/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/dashboard`;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|txt|xml|webmanifest|pdf|ico|woff2?|ttf|otf|eot)$).*)',
  ],
};
