import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import createIntlMiddleware from 'next-intl/middleware';
import { routing } from '@/i18n/routing';

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
// Locale helpers
// ---------------------------------------------------------------------------
const NON_DEFAULT_LOCALES = routing.locales.filter(
  (l) => l !== routing.defaultLocale,
) as string[];

function localeFromPath(pathname: string): string {
  for (const locale of NON_DEFAULT_LOCALES) {
    if (pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`) {
      return locale;
    }
  }
  return routing.defaultLocale;
}

function stripLocalePrefix(pathname: string): string {
  for (const locale of NON_DEFAULT_LOCALES) {
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
    !pathname.startsWith('/api/webhooks/') &&
    pathname !== '/api/payments/verify-ton-payment'
  ) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown';

    const limit = pathname.startsWith('/api/jobs/') ? MAX_REQUESTS_JOBS : MAX_REQUESTS;
    if (isRateLimited(ip, limit)) {
      return new NextResponse(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // 2. API & manifest routes: skip i18n
  if (pathname.startsWith('/api/') || pathname.includes('tonconnect-manifest')) {
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

  // 3. Page routes: i18n + Supabase session refresh
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

  // 4. Auth redirects (locale-aware)
  const cleanPath = stripLocalePrefix(pathname);
  const locale = localeFromPath(pathname);
  const prefix = locale !== routing.defaultLocale ? `/${locale}` : '';

  if (!user && cleanPath.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = `${prefix}/auth/login`;
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
