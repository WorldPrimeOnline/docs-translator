'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { WpoLogo } from '@/components/wpo-logo';
import { createClient } from '@/lib/supabase/client';

export function Navbar() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);

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

    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-200 ${
        scrolled
          ? 'border-b border-white/10 bg-navy/90 backdrop-blur-md shadow-lg shadow-black/20'
          : 'bg-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2">
          <WpoLogo size="sm" />
        </Link>

        <nav className="flex items-center gap-1">
          {isLoggedIn ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
            >
              Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/auth/login"
                className="inline-flex items-center justify-center rounded-md px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-white/5"
              >
                Log in
              </Link>
              <Link
                href="/auth/signup"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
              >
                Get Started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
