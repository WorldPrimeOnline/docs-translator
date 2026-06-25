'use client';

import { useState, useRef, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { LOCALES } from '@/i18n/locales';

type LangCode = string;

// All locales have a URL prefix (localePrefix: 'always')
const ALL_LOCALE_CODES: LangCode[] = LOCALES.map((l) => l.code);

/**
 * Strip any locale prefix from the pathname and prepend the new one.
 * Works with `localePrefix: 'always'` where every locale has a /{code}/ prefix.
 */
function buildLocalePath(pathname: string, newLocale: LangCode): string {
  let clean = pathname;
  for (const loc of ALL_LOCALE_CODES) {
    if (pathname.startsWith(`/${loc}/`)) {
      clean = pathname.slice(loc.length + 1);
      break;
    }
    if (pathname === `/${loc}`) {
      clean = '/';
      break;
    }
  }

  return `/${newLocale}${clean === '/' ? '' : clean}`;
}

export function LanguageSwitcher() {
  const locale = useLocale() as LangCode;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tNav = useTranslations('nav');

  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0]!;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function switchLocale(code: LangCode) {
    if (code === locale) { setOpen(false); return; }
    document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
    const newPath = buildLocalePath(pathname, code);
    window.location.href = newPath;
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        aria-label={tNav('switchLanguage')}
      >
        <span className="text-sm leading-none">{current.flag}</span>
        <span className="hidden sm:inline">{current.nativeLabel}</span>
        <span className="sm:hidden">{current.nativeShortLabel}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-white/10 bg-navy-light py-1 shadow-xl shadow-black/30">
          {LOCALES.filter((l) => l.enabled).map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => switchLocale(lang.code)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-white/5 ${
                lang.code === locale
                  ? 'font-semibold text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="text-sm leading-none">{lang.flag}</span>
              <span>{lang.nativeLabel}</span>
              {lang.code === locale && (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
