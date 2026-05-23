import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

// Service-role client — bypasses RLS. Server-side only. Never expose to browser.
export const supabaseServer = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
