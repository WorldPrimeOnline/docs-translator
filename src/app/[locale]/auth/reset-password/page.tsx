'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { createClient } from '@/lib/supabase/client';

const schema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type FormValues = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('auth');

  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  // Exchange token_hash for a session (PKCE flow, cross-device safe)
  useEffect(() => {
    // Supabase may return error params when the link is expired/invalid
    const urlError = searchParams.get('error');
    const urlErrorDescription = searchParams.get('error_description');
    if (urlError) {
      setSessionError(urlErrorDescription ?? urlError);
      return;
    }

    const supabase = createClient();

    // PKCE auth code flow (current Supabase default)
    const code = searchParams.get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setSessionError(error.message);
        else setSessionReady(true);
      });
      return;
    }

    // Older token_hash flow
    const tokenHash = searchParams.get('token_hash');
    const type = searchParams.get('type');
    if (tokenHash && type === 'recovery') {
      supabase.auth
        .verifyOtp({ token_hash: tokenHash, type: 'recovery' })
        .then(({ error }) => {
          if (error) setSessionError(error.message);
          else setSessionReady(true);
        });
      return;
    }

    // Implicit flow fallback — session arrives via hash fragment
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setSessionReady(true);
        subscription.unsubscribe();
      }
    });

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
        subscription.unsubscribe();
      }
    });

    return () => subscription.unsubscribe();
  }, [searchParams]);

  const onSubmit = async (values: FormValues): Promise<void> => {
    setIsLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.updateUser({ password: values.password });

    if (error) {
      toast.error(error.message);
      setIsLoading(false);
      return;
    }

    toast.success(t('resetPasswordSuccess'));
    router.push('/dashboard');
    router.refresh();
  };

  if (sessionError) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4">
        <p className="text-center text-sm text-red-400">
          {sessionError}
        </p>
        <Link
          href="/auth/forgot-password"
          className="text-sm text-foreground underline underline-offset-4 hover:opacity-80"
        >
          {t('forgotPassword')}
        </Link>
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="mx-auto flex w-full max-w-sm items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <AuthForm
      onSubmit={form.handleSubmit(onSubmit)}
      isLoading={isLoading}
      submitLabel={t('resetPasswordBtn')}
    >
      <Form {...form}>
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('newPassword')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('confirmPassword')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </Form>
    </AuthForm>
  );
}
