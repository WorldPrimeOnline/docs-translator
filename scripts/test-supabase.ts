import { supabaseServer } from '../src/lib/supabase/server';

async function main(): Promise<void> {
  console.log('Testing Supabase connection...');

  const { data, error } = await supabaseServer
    .from('users')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Connection failed:', error.message);
    process.exit(1);
  }

  console.log('Connection OK. Users rows (expect 0 for fresh DB):', data);
  console.log('Supabase is reachable and schema is applied.');
}

main();
