'use client';

import { useState, useRef, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronDown } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', short: 'EN',  name: 'English'   },
  { code: 'ru', flag: '🇷🇺', short: 'RU',  name: 'Русский'   },
  { code: 'zh', flag: '🇨🇳', short: 'CN',  name: '中文'       },
  { code: 'ko', flag: '🇰🇷', short: 'KR',  name: '한국어'     },
  { code: 'kk', flag: '🇰🇿', short: 'KZ',  name: 'Қазақша'   },
  { code: 'tj', flag: '🇹🇯', short: 'TJ',  name: 'Тоҷикӣ'   },
  { code: 'uz', flag: '🇺🇿', short: 'UZ',  name: "O'zbek"    },
  { code: 'tk', flag: '🇹🇲', short: 'TK',  name: 'Türkmen'   },
  { code: 'mn', flag: '🇲🇳', short: 'MN',  name: 'Монгол'    },
  { code: 'ky', flag: '🇰🇬', short: 'KY',  name: 'Кыргызча'  },
  { code: 'es', flag: '🇪🇸', short: 'ES',  name: 'Español'   },
] as const;

type LangCode = (typeof LANGUAGES)[number]['code'];

// Non-default locales that appear as a path prefix in the URL
const PREFIXED_LOCALES: LangCode[] = ['ru', 'zh', 'ko', 'kk', 'tj', 'uz', 'tk', 'mn', 'ky', 'es'];

/**
 * Strip any locale prefix from the pathname and prepend the new one.
 * Works with `localePrefix: 'as-needed'` where EN has no prefix.
 *
 * Examples:
 *   ('/ru/dashboard', 'zh') → '/zh/dashboard'
 *   ('/dashboard',    'ru') → '/ru/dashboard'
 *   ('/ru',           'en') → '/'
 *   ('/',             'ru') → '/ru'
 */
function buildLocalePath(pathname: string, newLocale: LangCode): string {
  // Strip existing prefix
  let clean = pathname;
  for (const loc of PREFIXED_LOCALES) {
    if (pathname.startsWith(`/${loc}/`)) {
      clean = pathname.slice(loc.length + 1); // '/ru/dashboard' → 'dashboard'
      break;
    }
    if (pathname === `/${loc}`) {
      clean = '';
      break;
    }
  }

  if (newLocale === 'en') return clean ? `/${clean}` : '/';
  return `/${newLocale}${clean ? `/${clean}` : ''}`;
}

export function LanguageSwitcher() {
  const locale = useLocale() as LangCode;
  const router = useRouter();
  const pathname = usePathname(); // real URL path, e.g. '/ru/dashboard'
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = LANGUAGES.find((l) => l.code === locale) ?? LANGUAGES[0]!;

  // Close on outside click
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
    // Persist locale choice so next-intl middleware restores it on every navigation
    document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=${365 * 24 * 60 * 60}; SameSite=Lax`;
    const newPath = buildLocalePath(pathname, code);
    router.push(newPath);
    router.refresh();
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      {/* Collapsed button — flag + short code */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        aria-label="Switch language"
      >
        <span className="text-sm leading-none">{current.flag}</span>
        <span>{current.short}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown — flag + native name */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-40 rounded-lg border border-white/10 bg-navy-light py-1 shadow-xl shadow-black/30">
          {LANGUAGES.map((lang) => (
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
              <span>{lang.name}</span>
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
