'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
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
  const t = useTranslations('auth');

  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const supabaseRef = useRef(
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: 'implicit', detectSessionInUrl: true } },
    )
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  useEffect(() => {
    const supabase = supabaseRef.current;

    // onAuthStateChange must be set up before getSession to avoid missing the event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
        setSessionReady(true);
        subscription.unsubscribe();
      }
    });

    // Also handle case where session is already established
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSessionReady(true);
        subscription.unsubscribe();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const onSubmit = async (values: FormValues): Promise<void> => {
    setIsLoading(true);
    const { error } = await supabaseRef.current.auth.updateUser({ password: values.password });

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
