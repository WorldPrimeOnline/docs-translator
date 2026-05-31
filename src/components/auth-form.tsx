'use client';

import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';

interface AuthFormProps {
  title: string;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  submitLabel: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function AuthForm({
  title,
  onSubmit,
  isLoading,
  submitLabel,
  footer,
  children,
}: AuthFormProps) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-6">
      <Card className="w-full border-white/10 bg-card shadow-xl shadow-black/30">

        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {children}
            <button
              type="submit"
              disabled={isLoading}
              className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="size-4 animate-spin" /> : submitLabel}
            </button>
          </form>
        </CardContent>
        {footer && (
          <CardFooter className="justify-center text-sm text-muted-foreground">{footer}</CardFooter>
        )}
      </Card>
    </div>
  );
}
