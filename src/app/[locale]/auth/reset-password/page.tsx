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
import { createClient } from '@/lib/supabase/client';
import { AuthForm } from '@/components/auth-form';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';

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

  useEffect(() => {
    const supabase = createClient();

    // Error params from Supabase (expired/invalid link)
    const urlError = searchParams.get('error');
    if (urlError) {
      setSessionError(searchParams.get('error_description') ?? urlError);
      return;
    }

    // token_hash flow — works cross-browser, no PKCE verifier needed
    // Requires email template: ?token_hash={{ .TokenHash }}&type=recovery
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

    // Fallback: check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
      } else {
        setSessionError('Invalid or expired reset link. Please request a new one.');
      }
    });
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
        <p className="text-center text-sm text-red-400">{sessionError}</p>
        <Link href="/auth/forgot-password" className="text-sm text-foreground underline underline-offset-4 hover:opacity-80">
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
