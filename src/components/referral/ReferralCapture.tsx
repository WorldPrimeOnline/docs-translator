'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { extractReferralParams, saveReferralParams } from '@/lib/referral/capture';

/**
 * Drop this into the root locale layout (or any page) to capture ref + UTM params on arrival.
 * Stores params in sessionStorage for later attachment to order creation.
 * Safe to include on every page — only writes when params are present.
 */
export function ReferralCapture() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const params = extractReferralParams(searchParams.toString());
    if (params) saveReferralParams(params);
  }, [searchParams]);

  return null;
}
