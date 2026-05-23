import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
          <p className="mt-4 text-xs text-muted-foreground/60 font-medium uppercase tracking-widest">
            Coming soon
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
