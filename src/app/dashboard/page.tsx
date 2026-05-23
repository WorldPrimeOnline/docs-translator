'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Session } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });
  }, []);

  const handleLogout = async (): Promise<void> => {
    setIsLoggingOut(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error('Failed to log out');
      setIsLoggingOut(false);
      return;
    }
    router.push('/');
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Welcome,{' '}
            <span className="font-medium text-foreground">
              {session?.user.email ?? 'loading…'}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            Document upload and translation will be available in Stage 3.
          </p>
          <Button
            variant="outline"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="w-fit"
          >
            {isLoggingOut ? 'Logging out…' : 'Log out'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
