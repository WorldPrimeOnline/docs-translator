import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-semibold tracking-tight">Docs Translator</CardTitle>
          <CardDescription className="text-base">
            AI-powered document translation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Upload a scanned PDF and receive a translated version in minutes — across 10+ languages.
          </p>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button render={<Link href="/auth/signup" />}>Sign up</Button>
          <Button variant="outline" render={<Link href="/auth/login" />}>Log in</Button>
        </CardFooter>
      </Card>
    </main>
  );
}
