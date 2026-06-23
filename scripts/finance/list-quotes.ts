#!/usr/bin/env npx tsx
/**
 * Read-only: list price quotes with optional status filter.
 * Usage: npx tsx scripts/finance/list-quotes.ts [--status <status>] [--limit <n>]
 */
import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) as any;

async function main() {
  const args = process.argv.slice(2);
  const statusIdx = args.indexOf('--status');
  const limitIdx = args.indexOf('--limit');
  const status = statusIdx !== -1 ? args[statusIdx + 1] : null;
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1] ?? '20', 10) : 20;

  let query = supabase
    .from('price_quotes')
    .select('id, status, amount_kzt, service_level, language_pair, document_type, sales_channel, urgency_level, created_at, expires_at, paid_at, job_id, source_word_count')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) { console.error(error); process.exit(1); }

  console.log(`\n=== PRICE QUOTES (${data?.length ?? 0} records) ===\n`);
  (data ?? []).forEach((q: Record<string, unknown>) => {
    const id = String(q.id).slice(0, 8);
    const statusStr = String(q.status ?? '').padEnd(25);
    const amt = String(q.amount_kzt ?? '').padEnd(9);
    const svc = String(q.service_level ?? '').slice(0, 12).padEnd(13);
    const pair = String(q.language_pair ?? '').padEnd(10);
    const date = String(q.created_at ?? '').slice(0, 16);
    console.log(`${id}… | ${statusStr}| ${amt}KZT | ${svc}| ${pair}| ${date}`);
  });
}

main().catch(console.error);
