// Creates the intake tables in Supabase by running supabase/schema.sql through
// the Supabase Management API, then reloads the REST API's schema cache and
// checks the tables are visible.
//
//   npm run setup:supabase
//
// Needs in .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and SUPABASE_ACCESS_TOKEN
// (a personal access token from supabase.com/dashboard/account/tokens — revoke it afterwards).

import { readFileSync } from 'node:fs';

try { process.loadEnvFile('.env'); } catch { /* use the real environment */ }
const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !token) {
  console.error('Set SUPABASE_URL and SUPABASE_ACCESS_TOKEN in .env first.');
  process.exit(1);
}
const ref = new URL(url).hostname.split('.')[0];

async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
console.log(`Project ${ref}: running supabase/schema.sql…`);
await runSql(schema);
await runSql("NOTIFY pgrst, 'reload schema';");

const tables = await runSql("select table_name from information_schema.tables where table_schema = 'public' and table_name like 'intake_%' order by 1;");
console.log('Tables in public schema:', tables.map((t) => t.table_name).join(', '));

if (key) {
  // The schema cache reload is asynchronous; give it a few tries.
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${url}/rest/v1/intake_sessions?select=id&limit=1`, {
      headers: { apikey: key, ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}) },
    });
    if (r.ok) { console.log('REST API can see intake_sessions. Supabase is ready.'); process.exit(0); }
    await new Promise((ok) => setTimeout(ok, 1500));
  }
  console.error('Tables exist but the REST API still cannot see them. In Supabase: Settings → API → make sure "public" is in Exposed schemas.');
  process.exit(1);
}
