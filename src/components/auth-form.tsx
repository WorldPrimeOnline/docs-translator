'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

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
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {children}
          <Button type="submit" disabled={isLoading} className="mt-1 w-full">
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : submitLabel}
          </Button>
        </form>
      </CardContent>
      {footer && (
        <CardFooter className="justify-center text-sm text-muted-foreground">{footer}</CardFooter>
      )}
    </Card>
  );
}
