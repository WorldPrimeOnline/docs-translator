'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Link, useRouter as useLocaleRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { AuthForm } from '@/components/auth-form';
import { GoogleAuthButton } from '@/components/google-auth-button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  // Two routers, deliberately: `next` (when present) is a full path already prefixed
  // with a locale by whoever set it (middleware's checkout auth-gate, OrderWizard) —
  // pushing that through the locale-aware router would double-prefix it (e.g.
  // /kk/kk/checkout), since next-intl's prefixing has no "already prefixed" check.
  // The '/dashboard' fallback is a plain unprefixed path, so it needs the
  // locale-aware router to preserve the current locale (SEO audit finding #8).
  const router = useRouter();
  const localeRouter = useLocaleRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next');
  const t = useTranslations('auth');
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: FormValues): Promise<void> => {
    setIsLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });

    if (error) {
      toast.error('Invalid email or password');
      setIsLoading(false);
      return;
    }

    if (next) {
      router.push(next);
    } else {
      localeRouter.push('/dashboard');
    }
    router.refresh();
  };

  return (
    <AuthForm
      onSubmit={form.handleSubmit(onSubmit)}
      isLoading={isLoading}
      submitLabel={t('loginBtn')}
      topSection={<GoogleAuthButton next={next} />}
      footer={
        <span>
          {t('noAccount')}{' '}
          <Link
            href="/auth/signup"
            className="text-foreground underline underline-offset-4 hover:opacity-80"
          >
            {t('signupLink')}
          </Link>
        </span>
      }
    >
      <Form {...form}>
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('email')}</FormLabel>
              <FormControl>
                <Input type="email" placeholder={t('emailPlaceholder')} autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <div className="flex items-center justify-between">
                <FormLabel>{t('password')}</FormLabel>
                <Link
                  href="/auth/forgot-password"
                  className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
                >
                  {t('forgotPassword')}
                </Link>
              </div>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </AuthForm>
  );
}
