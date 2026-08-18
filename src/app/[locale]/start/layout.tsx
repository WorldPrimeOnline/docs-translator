import type { Metadata } from 'next';
import { NOINDEX_METADATA } from '@/lib/seo/site-metadata';

// Mirrors src/app/[locale]/dashboard/layout.tsx exactly — the public order form must use
// the same container width/typography as the dashboard order form, since both render the
// same OrderForm component.
//
// noindex: /start is a transactional pre-checkout wizard entry point (upload → price →
// login-gated checkout), not an SEO landing page — no unique title/description, excluded
// from the sitemap (src/app/sitemap.ts) for the same reason. SEO audit finding #11.
export const metadata: Metadata = NOINDEX_METADATA;

export default function StartLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
