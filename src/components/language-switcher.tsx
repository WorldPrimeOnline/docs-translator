'use client';

import { useState, useRef, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/navigation';
import { ChevronDown } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', flag: '🇬🇧', label: 'EN', name: 'English' },
  { code: 'ru', flag: '🇷🇺', label: 'RU', name: 'Русский' },
  { code: 'zh', flag: '🇨🇳', label: 'ZH', name: '中文' },
  { code: 'ko', flag: '🇰🇷', label: 'KO', name: '한국어' },
  { code: 'kk', flag: '🇰🇿', label: 'KK', name: 'Қазақша' },
] as const;

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
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

  function switchLocale(code: string) {
    router.replace(pathname, { locale: code });
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        aria-label="Switch language"
      >
        <span className="text-sm leading-none">{current.flag}</span>
        <span>{current.label}</span>
        <ChevronDown
          className={`h-3 w-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border border-white/10 bg-navy-light py-1 shadow-xl shadow-black/30">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => switchLocale(lang.code)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-white/5 ${
                lang.code === locale
                  ? 'text-primary font-semibold'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="text-sm leading-none">{lang.flag}</span>
              <span className="font-medium">{lang.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground/60">{lang.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
