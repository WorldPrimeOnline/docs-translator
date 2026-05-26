'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { WpoLogo } from '@/components/wpo-logo';
import { createClient } from '@/lib/supabase/client';
import { Menu, X, ChevronDown } from 'lucide-react';
import { LanguageSwitcher } from '@/components/language-switcher';

export function Navbar() {
  const t = useTranslations('nav');

  const NAV_LINKS = [
    {
      label: t('thailand'),
      href: '/thailand',
      children: [
        { label: t('thailandOverview'), href: '/thailand' },
        { label: t('dtvVisa'), href: '/thailand/dtv-visa-translation' },
        { label: t('immigrationDocs'), href: '/thailand/immigration-document-translation' },
      ],
    },
    {
      label: t('kazakhstan'),
      href: '/kazakhstan',
      children: [
        { label: t('kazakhstanOverview'), href: '/kazakhstan' },
        { label: t('translationForNotary'), href: '/kazakhstan/notarized-translation' },
        { label: t('universityDocs'), href: '/kazakhstan/university-document-translation' },
      ],
    },
    {
      label: t('documents'),
      href: '/documents',
      children: [
        { label: t('allDocTypes'), href: '/documents' },
        { label: t('passportTranslation'), href: '/documents/passport-translation' },
        { label: t('bankStatement'), href: '/documents/bank-statement-translation' },
        { label: t('diplomaTranslation'), href: '/documents/diploma-translation' },
      ],
    },
  ];

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const pathname = usePathname();
  const navRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on route change
  useEffect(() => {
    setMenuOpen(false);
    setOpenDropdown(null);
  }, [pathname]);

  // Click-outside closes desktop dropdown
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setIsLoggedIn(!!data.session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      setIsLoggedIn(!!session);
    });

    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-200 ${
        scrolled || menuOpen
          ? 'border-b border-white/10 bg-navy/90 backdrop-blur-[12px] shadow-lg shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div ref={navRef} className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <WpoLogo size="sm" />
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <div key={link.href} className="relative">
              <button
                type="button"
                onClick={() => setOpenDropdown(openDropdown === link.href ? null : link.href)}
                className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-white/5"
              >
                {link.label}
                <ChevronDown className={`h-3 w-3 transition-transform duration-150 ${openDropdown === link.href ? 'rotate-180' : ''}`} />
              </button>

              {openDropdown === link.href && (
                <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-white/10 bg-navy-light py-1 shadow-xl shadow-black/30">
                  {link.children.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      onClick={() => setOpenDropdown(null)}
                      className="block px-4 py-2 text-xs text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                    >
                      {child.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        {/* Desktop auth + language switcher */}
        <div className="hidden items-center gap-1 lg:flex">
          <LanguageSwitcher />
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
            >
              {t('dashboard')}
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="inline-flex items-center justify-center rounded-md px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-white/5"
              >
                {t('login')}
              </Link>
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
              >
                {t('getStarted')}
              </Link>
            </>
          )}
        </div>

        {/* Mobile: language switcher + auth + hamburger */}
        <div className="flex items-center gap-2 lg:hidden">
          <LanguageSwitcher />
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
            >
              {t('dashboard')}
            </Link>
          ) : (
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
            >
              {t('getStarted')}
            </Link>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            aria-label="Toggle menu"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="border-t border-white/10 bg-navy/98 px-4 py-4 lg:hidden">
          <div className="space-y-1">
            {NAV_LINKS.map((link) => (
              <div key={link.href}>
                <div className="mb-1 px-2 pt-2 text-[10px] font-semibold uppercase tracking-widest text-primary">
                  {link.label}
                </div>
                {link.children.map((child) => (
                  <Link
                    key={child.href}
                    href={child.href}
                    className="block rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                  >
                    {child.label}
                  </Link>
                ))}
              </div>
            ))}

            <div className="mt-4 border-t border-white/10 pt-4">
              {!isLoggedIn && (
                <Link
                  href="/auth/login"
                  className="block rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
                >
                  {t('login')}
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
