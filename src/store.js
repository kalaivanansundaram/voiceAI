// The shared notebook: sessions, answers, labelled statements, and an event log.
// Two interchangeable backends with the same async methods:
//   - Supabase (when SUPABASE_URL is set) — used on Vercel, survives restarts
//   - local SQLite via node:sqlite — zero setup for local runs
// supabase/schema.sql creates the same tables in Supabase.

export async function openStore() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (url && key) return supabaseStore(url, key);
  if (process.env.VERCEL) {
    throw new Error('On Vercel, set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY — serverless functions cannot keep a local database.');
  }
  if (url || key) console.warn('Supabase is only half configured (need both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY); using local SQLite.');
  return sqliteStore(process.env.INTAKE_DB || 'data/intake.db');
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS intake_sessions (
    id TEXT PRIMARY KEY,
    resume_code TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL,
    paused_from TEXT,
    starting_input TEXT NOT NULL,
    source_url TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    approved_version INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS intake_answers (
    session_id TEXT NOT NULL,
    field TEXT NOT NULL,
    value TEXT,
    status TEXT NOT NULL,
    basis TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, field)
  );
  CREATE TABLE IF NOT EXISTS intake_statements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    field TEXT NOT NULL,
    text TEXT NOT NULL,
    kind TEXT NOT NULL,
    superseded INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS intake_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    payload TEXT,
    at TEXT NOT NULL
  );`;

async function sqliteStore(file) {
  const { DatabaseSync } = await import('node:sqlite');
  if (file !== ':memory:') {
    const { mkdirSync } = await import('node:fs');
    const { dirname } = await import('node:path');
    mkdirSync(dirname(file), { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const one = (sql, ...a) => db.prepare(sql).get(...a) ?? null;
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const sets = (patch) => Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  const plain = (rows) => rows.map((r) => ({ ...r }));

  return {
    kind: 'sqlite',
    async createSession(s) {
      run(`INSERT INTO intake_sessions (id, resume_code, status, starting_input, source_url, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)`, s.id, s.resume_code, s.status, s.starting_input, s.source_url, s.created_at, s.updated_at);
    },
    async getSession(id) { const r = one('SELECT * FROM intake_sessions WHERE id = ?', id); return r && { ...r }; },
    async getSessionByCode(code) { const r = one('SELECT * FROM intake_sessions WHERE resume_code = ?', code); return r && { ...r }; },
    async updateSession(id, patch) { run(`UPDATE intake_sessions SET ${sets(patch)} WHERE id = ?`, ...Object.values(patch), id); },
    async insertAnswers(rows) {
      for (const r of rows) run('INSERT INTO intake_answers (session_id, field, value, status, basis, updated_at) VALUES (?, ?, ?, ?, ?, ?)', r.session_id, r.field, r.value ?? null, r.status, r.basis ?? null, r.updated_at);
    },
    async getAnswers(sid) { return plain(all('SELECT * FROM intake_answers WHERE session_id = ?', sid)); },
    async updateAnswer(sid, field, patch) { run(`UPDATE intake_answers SET ${sets(patch)} WHERE session_id = ? AND field = ?`, ...Object.values(patch), sid, field); },
    async supersedeStatements(sid, field) { run('UPDATE intake_statements SET superseded = 1 WHERE session_id = ? AND field = ? AND superseded = 0', sid, field); },
    async insertStatements(rows) { for (const r of rows) run('INSERT INTO intake_statements (session_id, field, text, kind) VALUES (?, ?, ?, ?)', r.session_id, r.field, r.text, r.kind); },
    async getStatements(sid) { return plain(all('SELECT field, text, kind FROM intake_statements WHERE session_id = ? AND superseded = 0 ORDER BY id', sid)); },
    async logEvent(r) { run('INSERT INTO intake_events (session_id, type, payload, at) VALUES (?, ?, ?, ?)', r.session_id, r.type, r.payload, r.at); },
    async getEvents(sid) { return plain(all('SELECT type, payload, at FROM intake_events WHERE session_id = ? ORDER BY id', sid)); },
  };
}

// Supabase over its REST API (PostgREST) with plain fetch — no SDK needed.
// The service-role key stays server-side (Vercel env var); the browser never sees it.
function supabaseStore(url, key) {
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };

  async function call(method, path, body, extra = {}) {
    const res = await fetch(`${base}/${path}`, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return res.status === 204 || method !== 'GET' ? null : res.json();
  }
  const eq = (v) => `eq.${encodeURIComponent(v)}`;
  const first = (rows) => (rows && rows[0]) || null;

  return {
    kind: 'supabase',
    async createSession(s) { await call('POST', 'intake_sessions', { ...s, version: 1 }, { prefer: 'return=minimal' }); },
    async getSession(id) { return first(await call('GET', `intake_sessions?id=${eq(id)}&select=*`)); },
    async getSessionByCode(code) { return first(await call('GET', `intake_sessions?resume_code=${eq(code)}&select=*`)); },
    async updateSession(id, patch) { await call('PATCH', `intake_sessions?id=${eq(id)}`, patch, { prefer: 'return=minimal' }); },
    async insertAnswers(rows) { await call('POST', 'intake_answers', rows, { prefer: 'return=minimal' }); },
    async getAnswers(sid) { return call('GET', `intake_answers?session_id=${eq(sid)}&select=*`); },
    async updateAnswer(sid, field, patch) { await call('PATCH', `intake_answers?session_id=${eq(sid)}&field=${eq(field)}`, patch, { prefer: 'return=minimal' }); },
    async supersedeStatements(sid, field) { await call('PATCH', `intake_statements?session_id=${eq(sid)}&field=${eq(field)}&superseded=eq.0`, { superseded: 1 }, { prefer: 'return=minimal' }); },
    async insertStatements(rows) { if (rows.length) await call('POST', 'intake_statements', rows, { prefer: 'return=minimal' }); },
    async getStatements(sid) { return call('GET', `intake_statements?session_id=${eq(sid)}&superseded=eq.0&select=field,text,kind&order=id`); },
    async logEvent(r) { await call('POST', 'intake_events', r, { prefer: 'return=minimal' }); },
    async getEvents(sid) { return call('GET', `intake_events?session_id=${eq(sid)}&select=type,payload,at&order=id`); },
  };
}
