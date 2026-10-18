// Runs the workbook's "Test it" checklist against the intake workflow with
// fictional data, using a throwaway in-memory database. No Sarvam credit used.
//   npm test

import assert from 'node:assert/strict';
process.env.INTAKE_DB = ':memory:';
delete process.env.SUPABASE_URL;
const { openStore } = await import('../src/store.js');
const { createIntake, IntakeError } = await import('../src/intake.js');

const intake = createIntake(await openStore());
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}
const rejects = async (p, code) => {
  try { await p; } catch (e) { assert.ok(e instanceof IntakeError, e); assert.equal(e.code, code); return e; }
  assert.fail(`expected ${code}`);
};

console.log('Workbook test checklist');
let s;

await check('starting input is organised into suggestions and visible gaps', async () => {
  s = await intake.start_intake({ starting_input: 'Yesterday at 9am navigation took me into a closed road near Sector 18 Noida. I think the map is outdated.' });
  assert.equal(s.status, 'intake');
  assert.match(s.resume_code, /^\d{6}$/);
  assert.deepEqual(s.organised.known_from_input, ['problem', 'category']);
  assert.equal(s.next.type, 'ask');
  assert.equal(s.next.field, 'reporter');
});

await check('broken link stops safely', async () => {
  await rejects(intake.start_intake({ starting_input: 'https://this-domain-does-not-exist-xyz.invalid/page' }), 'INPUT_UNREADABLE');
});

await check('private/local link is refused without being opened', async () => {
  await rejects(intake.start_intake({ starting_input: 'http://127.0.0.1:3000/admin' }), 'INPUT_UNREADABLE');
  await rejects(intake.start_intake({ starting_input: 'http://192.168.1.10/' }), 'INPUT_UNREADABLE');
});

await check('answer is saved with labelled statements', async () => {
  const r = await intake.save_answer({ session_id: s.session_id, field: 'reporter', value: 'Daily commuter, I drive to office in Noida.' });
  assert.equal(r.saved.statements[0].kind, 'observation');
  assert.equal(r.next.type, 'confirm');
  assert.equal(r.next.field, 'problem');
});

await check('saying "confirm" twice does not skip a question', async () => {
  const first = await intake.confirm_suggestion({ session_id: s.session_id, field: 'problem' });
  assert.equal(first.next.field, 'category');
  const again = await intake.confirm_suggestion({ session_id: s.session_id, field: 'problem' });
  assert.equal(again.next.field, 'category', 'second confirm must not advance');
  assert.ok(again.note);
});

await check('suggested category confirmed; wrong category value rejected', async () => {
  assert.equal((await intake.get_status({ session_id: s.session_id })).next.suggestion, 'navigation_route');
  await rejects(intake.save_answer({ session_id: s.session_id, field: 'category', value: 'roads' }), 'BAD_CATEGORY');
  const r = await intake.confirm_suggestion({ session_id: s.session_id, field: 'category' });
  assert.equal(r.next.field, 'location');
});

await check('agent suggests from known facts; the person changes it', async () => {
  await intake.suggest_answer({ session_id: s.session_id, field: 'location', value: 'Sector 18, Noida', basis: 'starting input' });
  const st = await intake.get_status({ session_id: s.session_id });
  assert.equal(st.next.type, 'confirm');
  const r = await intake.save_answer({ session_id: s.session_id, field: 'location', value: 'Atta Market road, Sector 18, Noida — route from Sector 62' });
  assert.equal(r.next.field, 'when');
});

await check('pause and resume returns to the same question', async () => {
  const p = await intake.pause_intake({ session_id: s.session_id });
  assert.equal(p.status, 'paused');
  await rejects(intake.save_answer({ session_id: s.session_id, field: 'when', value: 'x' }), 'PAUSED');
  const r = await intake.resume_intake({ resume_code: s.resume_code.split('').join(' ') });
  assert.equal(r.status, 'intake');
  assert.equal(r.next.field, 'when');
});

await check('disconnect and return: saved progress is still there', async () => {
  const st = await intake.get_status({ session_id: s.session_id });
  assert.equal(st.progress, '4/10');
});

await check('claims and assumptions are separated from observations', async () => {
  await intake.save_answer({
    session_id: s.session_id, field: 'when', value: 'Yesterday 9am; it happens every day this week.',
    statements: [{ text: 'It happened yesterday at 9am', kind: 'observation' }, { text: 'It happens every day', kind: 'claim' }],
  });
  await intake.save_answer({ session_id: s.session_id, field: 'what_happened', value: 'I followed the voice guidance, it said turn left, the road had barricades. Maybe the road closure is not on the map.' });
  const p = await intake.get_preview({ session_id: s.session_id });
  assert.ok(p.brief.claims.some((c) => c.text.includes('every day')));
  assert.ok(p.brief.assumptions.some((c) => /Maybe/.test(c.text)));
  assert.ok(p.brief.observations.length >= 2);
});

await check('unknown stays a visible gap instead of being invented', async () => {
  await intake.save_answer({ session_id: s.session_id, field: 'expected', value: 'A route avoiding the closed road.' });
  await intake.save_answer({ session_id: s.session_id, field: 'impact', value: 'I was 20 minutes late and drove 4 km extra.' });
  await intake.save_answer({ session_id: s.session_id, field: 'tried', value: 'I re-routed manually.' });
  const r = await intake.mark_unknown({ session_id: s.session_id, field: 'device', reason: 'does not know the app version' });
  assert.equal(r.status, 'review');
  const p = await intake.get_preview({ session_id: s.session_id });
  assert.deepEqual(p.brief.gaps.map((g) => g.field), ['device']);
  assert.equal(p.ready_to_approve, true);
});

let preview;
await check('changed answer keeps the new version; an old preview cannot be approved', async () => {
  const before = await intake.get_preview({ session_id: s.session_id });
  await intake.save_answer({ session_id: s.session_id, field: 'impact', value: 'I was 25 minutes late and drove 4 km extra.' });
  preview = await intake.get_preview({ session_id: s.session_id });
  assert.equal(preview.brief.fields.impact.value, 'I was 25 minutes late and drove 4 km extra.');
  assert.ok(preview.version > before.version);
  await rejects(intake.finalize_intake({ session_id: s.session_id, decision: 'approve', preview_version: before.version }), 'STALE_PREVIEW');
  const hist = await intake.history({ session_id: s.session_id });
  assert.ok(hist.some((h) => h.type === 'revised' && h.payload.field === 'impact'));
});

await check('final preview matches every saved answer', async () => {
  const md = preview.brief_markdown;
  for (const [key, f] of Object.entries(preview.brief.fields)) {
    if (f.status === 'answered' && key !== 'category') assert.ok(md.includes(f.value), `${key} missing from preview`);
  }
  assert.ok(md.includes('Navigation & routes'));
});

await check('cannot approve while questions are open', async () => {
  const t = await intake.start_intake({ starting_input: 'Search does not find my village.' });
  await rejects(intake.finalize_intake({ session_id: t.session_id, decision: 'approve', preview_version: t.version }), 'NOT_READY');
});

await check('cancel: nothing filled or submitted, intake locked', async () => {
  const t = await intake.start_intake({ starting_input: 'App crashes when I open saved places.' });
  const c = await intake.finalize_intake({ session_id: t.session_id, decision: 'cancel', preview_version: t.version });
  assert.equal(c.status, 'cancelled');
  await rejects(intake.save_answer({ session_id: t.session_id, field: 'reporter', value: 'x' }), 'LOCKED');
});

await check('approve the exact preview version, then locked', async () => {
  const a = await intake.finalize_intake({ session_id: s.session_id, decision: 'approve', preview_version: preview.version });
  assert.equal(a.status, 'approved');
  assert.equal(a.approved_version, preview.version);
  await rejects(intake.save_answer({ session_id: s.session_id, field: 'impact', value: 'x' }), 'LOCKED');
});

console.log(`\n${passed} checks passed.`);
