'use client';

import { TonConnectUIProvider } from '@tonconnect/ui-react';

const manifestUrl =
  (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000') + '/tonconnect-manifest.json';

export function TonProvider({ children }: { children: React.ReactNode }) {
  return (
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      {children}
    </TonConnectUIProvider>
  );
}
