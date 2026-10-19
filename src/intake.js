// The intake workflow. Every tool the agent can call is a method here; each
// returns plain JSON including what to ask next, so the agent never has to
// remember progress itself.

import { randomUUID, randomInt } from 'node:crypto';
import { FIELDS, FIELD_KEYS, FIELD_BY_KEY, CATEGORIES, STATEMENT_KINDS, GROUPS, groupQuestion } from './fields.js';
import { classifyStatements, guessCategory } from './classify.js';
import { readStartingInput, InputError } from './reader.js';

export class IntakeError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const LOCKED = new Set(['approved', 'cancelled']);
const DONE = new Set(['answered', 'unknown']);

export function createIntake(store) {
  const log = (session_id, type, payload) => store.logEvent({ session_id, type, payload: JSON.stringify(payload ?? {}), at: now() });

  async function load(sessionId) {
    const s = await store.getSession(String(sessionId ?? ''));
    if (!s) throw new IntakeError('NOT_FOUND', 'No intake session with that id. Ask for the resume code, or start a new intake.');
    return s;
  }

  async function writable(sessionId) {
    const s = await load(sessionId);
    if (LOCKED.has(s.status)) throw new IntakeError('LOCKED', `This intake is already ${s.status} and can no longer be changed.`);
    if (s.status === 'paused') throw new IntakeError('PAUSED', 'This intake is paused. Call resume_intake first.');
    return s;
  }

  function checkField(field) {
    if (!FIELD_BY_KEY[field]) throw new IntakeError('BAD_FIELD', `Unknown field "${field}". Valid fields: ${FIELD_KEYS.join(', ')}.`);
  }

  function normaliseValue(field, value) {
    const v = String(value ?? '').trim();
    if (!v) throw new IntakeError('EMPTY', `The answer for ${field} is empty. Ask again, or use mark_unknown if they do not know.`);
    if (field === 'category' && !CATEGORIES[v]) {
      throw new IntakeError('BAD_CATEGORY', `category must be one of: ${Object.keys(CATEGORIES).join(', ')}.`);
    }
    return v.slice(0, 2000);
  }

  async function answerMap(sessionId) {
    return Object.fromEntries((await store.getAnswers(sessionId)).map((a) => [a.field, a]));
  }

  // The single source of truth for "what should the agent say next".
  // Missing fields are asked a group at a time; suggested fields do not block —
  // they are read back for confirmation in the final review.
  function nextStep(s, answers) {
    if (s.status === 'paused') return { type: 'paused', say: `Your progress is saved. Your resume code is ${s.resume_code.split('').join(' ')}.` };
    if (s.status === 'approved') return { type: 'done', say: 'The brief is approved and saved for the Mappls team. Nothing else was sent.' };
    if (s.status === 'cancelled') return { type: 'done', say: 'The intake was cancelled. Nothing was sent.' };
    for (const g of GROUPS) {
      const missing = FIELDS.filter((f) => f.group === g.key && answers[f.key].status === 'missing').map((f) => f.key);
      if (missing.length) return { type: 'ask', fields: missing, question: groupQuestion(g, missing) };
    }
    const toConfirm = FIELDS.filter((f) => answers[f.key].status === 'suggested').map((f) => f.key);
    return {
      type: 'review',
      to_confirm: toConfirm,
      say: 'All questions are covered. Call get_preview, read it back briefly (point out any guessed items in to_confirm), and ask: approve, change something, or cancel?',
    };
  }

  function progress(answers) {
    const done = FIELDS.filter((f) => DONE.has(answers[f.key].status)).length;
    return `${done}/${FIELDS.length}`;
  }

  function snapshot(s, answers) {
    return { session_id: s.id, resume_code: s.resume_code, status: s.status, version: s.version, progress: progress(answers), next: nextStep(s, answers) };
  }

  // After any change: move between intake and review depending on whether gaps remain.
  async function settle(s, answers, writes) {
    const step = nextStep(s, answers);
    let status = s.status;
    if (status === 'intake' && step.type === 'review') status = 'review';
    if (status === 'review' && step.type !== 'review') status = 'intake';
    s.status = status;
    s.version += 1;
    writes.push(store.updateSession(s.id, { status, version: s.version, updated_at: now() }));
    await Promise.all(writes);
    return snapshot(s, answers);
  }

  function labelStatements(value, statements) {
    return (Array.isArray(statements) && statements.length ? statements : classifyStatements(value))
      .filter((st) => st && String(st.text ?? '').trim())
      .map((st) => ({ text: String(st.text).trim().slice(0, 500), kind: STATEMENT_KINDS.includes(st.kind) ? st.kind : 'claim' }));
  }

  // Replace a field's statements: supersede the old ones, then add the new ones.
  const replaceStatements = (s, field, list) =>
    store.supersedeStatements(s.id, field).then(() => store.insertStatements(list.map((st) => ({ session_id: s.id, field, ...st }))));

  function setAnswer(s, answers, field, value, status, basis) {
    const row = { value, status, basis: basis ?? null, updated_at: now() };
    answers[field] = { ...answers[field], ...row };
    return store.updateAnswer(s.id, field, row);
  }

  async function saveMany(session_id, items) {
    if (!Array.isArray(items) || !items.length) throw new IntakeError('EMPTY', 'No answers to save.');
    const s = await writable(session_id);
    const answers = await answerMap(s.id);
    const writes = [];
    const saved = [];
    for (const item of items) {
      checkField(item?.field);
      const v = normaliseValue(item.field, item.value);
      const previous = answers[item.field];
      writes.push(setAnswer(s, answers, item.field, v, 'answered', null));
      const labelled = item.field === 'category' ? [] : labelStatements(v, item.statements);
      if (item.field !== 'category') writes.push(replaceStatements(s, item.field, labelled));
      writes.push(log(s.id, previous.status === 'answered' ? 'revised' : 'answered', { field: item.field, from: previous.value, to: v }));
      saved.push({ field: item.field, value: v, statements: labelled });
    }
    return { ...(await settle(s, answers, writes)), saved };
  }

  return {
    async start_intake({ starting_input }) {
      let read;
      try {
        read = await readStartingInput(starting_input);
      } catch (err) {
        if (err instanceof InputError) throw new IntakeError('INPUT_UNREADABLE', err.message);
        throw err;
      }
      let code;
      do code = String(randomInt(100000, 1000000)); while (await store.getSessionByCode(code));
      const t = now();
      const s = { id: randomUUID(), resume_code: code, status: 'intake', starting_input: read.text, source_url: read.source_url, created_at: t, updated_at: t };
      await store.createSession(s);
      s.version = 1;

      // Organise: the person's own words are their answer to "what went wrong";
      // text read from a link, and the guessed problem type, are only suggestions.
      const problem = read.text.length > 400 ? `${read.text.slice(0, 400)}…` : read.text;
      const cat = guessCategory(read.text);
      const rows = FIELD_KEYS.map((field) => ({ session_id: s.id, field, value: null, status: 'missing', basis: null, updated_at: t }));
      const answers = Object.fromEntries(rows.map((r) => [r.field, r]));
      Object.assign(answers.problem, read.source_url
        ? { value: problem, status: 'suggested', basis: `read from ${read.source_url}` }
        : { value: problem, status: 'answered', basis: 'their opening words' });
      if (cat) Object.assign(answers.category, { value: cat, status: 'suggested', basis: 'keyword match on their words' });
      const writes = [store.insertAnswers(rows), log(s.id, 'started', { source_url: read.source_url, category_guess: cat })];
      if (!read.source_url) writes.push(writes[0].then(() => replaceStatements(s, 'problem', labelStatements(problem))));
      const known = FIELD_KEYS.filter((k) => answers[k].status !== 'missing');
      return {
        ...(await settle(s, answers, writes)),
        organised: { known_from_input: known, missing: FIELD_KEYS.filter((k) => !known.includes(k)) },
        source_url: read.source_url,
      };
    },

    async get_status({ session_id }) {
      const s = await load(session_id);
      return snapshot(s, await answerMap(s.id));
    },

    async suggest_answer({ session_id, field, value, basis }) {
      checkField(field);
      const s = await writable(session_id);
      const answers = await answerMap(s.id);
      if (answers[field].status === 'answered') {
        throw new IntakeError('ALREADY_ANSWERED', 'The person already answered this. Use save_answers only if they ask to change it.');
      }
      const writes = [
        setAnswer(s, answers, field, normaliseValue(field, value), 'suggested', String(basis ?? '').slice(0, 300) || null),
        log(s.id, 'suggested', { field, value, basis }),
      ];
      return settle(s, answers, writes);
    },

    // Several fields from one natural answer, in one call.
    async save_answers({ session_id, answers }) {
      return saveMany(session_id, answers);
    },

    async save_answer({ session_id, field, value, statements }) {
      const r = await saveMany(session_id, [{ field, value, statements }]);
      return { ...r, saved: r.saved[0] };
    },

    // Only acts on a pending suggestion, so "confirm" said twice never skips anything.
    async confirm_suggestion({ session_id, field }) {
      checkField(field);
      const s = await writable(session_id);
      const answers = await answerMap(s.id);
      const a = answers[field];
      if (a.status !== 'suggested') {
        return { ...snapshot(s, answers), note: `Nothing to confirm for ${field} (status: ${a.status}). Follow "next".` };
      }
      const writes = [setAnswer(s, answers, field, a.value, 'answered', a.basis), log(s.id, 'confirmed', { field, value: a.value })];
      if (field !== 'category') writes.push(replaceStatements(s, field, labelStatements(a.value)));
      return settle(s, answers, writes);
    },

    async mark_unknown({ session_id, field, reason }) {
      checkField(field);
      const s = await writable(session_id);
      const answers = await answerMap(s.id);
      const writes = [
        setAnswer(s, answers, field, null, 'unknown', String(reason || 'person does not know').slice(0, 300)),
        store.supersedeStatements(s.id, field),
        log(s.id, 'unknown', { field, reason }),
      ];
      return settle(s, answers, writes);
    },

    async pause_intake({ session_id }) {
      const s = await writable(session_id);
      await Promise.all([store.updateSession(s.id, { status: 'paused', paused_from: s.status, updated_at: now() }), log(s.id, 'paused', {})]);
      return snapshot({ ...s, status: 'paused' }, await answerMap(s.id));
    },

    async resume_intake({ resume_code, session_id }) {
      const s = resume_code
        ? await store.getSessionByCode(String(resume_code).replace(/\D/g, ''))
        : await store.getSession(String(session_id ?? ''));
      if (!s) throw new IntakeError('NOT_FOUND', 'That resume code was not found. Ask the person to read it again, or start a new intake.');
      if (s.status === 'paused') {
        s.status = s.paused_from || 'intake';
        await Promise.all([store.updateSession(s.id, { status: s.status, paused_from: null, updated_at: now() }), log(s.id, 'resumed', {})]);
      }
      return snapshot(s, await answerMap(s.id));
    },

    async get_preview({ session_id }) {
      const s = await load(session_id);
      const [answers, statements] = await Promise.all([answerMap(s.id), store.getStatements(s.id)]);
      const pending = FIELDS.filter((f) => answers[f.key].status === 'missing').map((f) => f.key);
      return {
        ...snapshot(s, answers),
        ready_to_approve: pending.length === 0 && s.status === 'review',
        still_pending: pending,
        brief: buildBrief(s, answers, statements),
        brief_markdown: briefMarkdown(s, answers, statements),
      };
    },

    // Approving the exact read-back also confirms the suggested items it contained.
    async finalize_intake({ session_id, decision, preview_version }) {
      const s = await writable(session_id);
      if (decision === 'cancel') {
        await Promise.all([store.updateSession(s.id, { status: 'cancelled', updated_at: now() }), log(s.id, 'cancelled', {})]);
        return snapshot({ ...s, status: 'cancelled' }, await answerMap(s.id));
      }
      if (decision !== 'approve') throw new IntakeError('BAD_DECISION', 'decision must be "approve" or "cancel". To revise, call save_answers.');
      if (s.status !== 'review') throw new IntakeError('NOT_READY', 'Some questions are still open. Finish them (or mark them unknown) first.');
      if (Number(preview_version) !== s.version) {
        throw new IntakeError('STALE_PREVIEW', `The brief changed since that preview (now version ${s.version}). Call get_preview and read it back again before approving.`);
      }
      const answers = await answerMap(s.id);
      const confirmed = FIELDS.filter((f) => answers[f.key].status === 'suggested').map((f) => f.key);
      await Promise.all([
        ...confirmed.map((field) => setAnswer(s, answers, field, answers[field].value, 'answered', answers[field].basis)),
        ...confirmed.filter((f) => f !== 'category').map((field) => replaceStatements(s, field, labelStatements(answers[field].value))),
        store.updateSession(s.id, { status: 'approved', approved_version: s.version, updated_at: now() }),
        log(s.id, 'approved', { version: s.version, confirmed_on_approval: confirmed }),
      ]);
      return { ...snapshot({ ...s, status: 'approved' }, answers), approved_version: s.version, confirmed_on_approval: confirmed };
    },

    // For the UI; not offered to the agent.
    async history({ session_id }) {
      const s = await load(session_id);
      return (await store.getEvents(s.id)).map((e) => ({ ...e, payload: JSON.parse(e.payload || '{}') }));
    },
  };
}

function buildBrief(s, answers, statements) {
  const cat = answers.category.value && CATEGORIES[answers.category.value] ? answers.category.value : null;
  const by = (kind) => statements.filter((st) => st.kind === kind).map((st) => ({ field: st.field, text: st.text }));
  return {
    title: answers.problem.value ? String(answers.problem.value).slice(0, 90) : 'Untitled problem',
    category: cat,
    category_label: cat ? CATEGORIES[cat].label : null,
    route_to: cat ? CATEGORIES[cat].route_to : 'Feedback team triage',
    fields: Object.fromEntries(FIELDS.map((f) => [f.key, { label: f.label, value: answers[f.key].value, status: answers[f.key].status, basis: answers[f.key].basis }])),
    observations: by('observation'),
    claims: by('claim'),
    assumptions: by('assumption'),
    gaps: FIELDS.filter((f) => answers[f.key].status === 'unknown').map((f) => ({ field: f.key, reason: answers[f.key].basis })),
    source_url: s.source_url,
    version: s.version,
    approved: s.status === 'approved',
  };
}

function briefMarkdown(s, answers, statements) {
  const b = buildBrief(s, answers, statements);
  const lines = [`# Problem brief — ${b.title}`, '', `Type: ${b.category_label ?? 'not set'}  `, `Route to: ${b.route_to}  `, `Version: ${b.version}${b.approved ? ' (approved)' : ' (draft)'}`, ''];
  for (const f of FIELDS) {
    const a = answers[f.key];
    const value = f.key === 'category' && CATEGORIES[a.value] ? CATEGORIES[a.value].label : a.value;
    const shown = a.status === 'unknown' ? `_unknown — ${a.basis}_` : a.status === 'answered' ? value : a.status === 'suggested' ? `${value} _(guessed — please confirm)_` : '_missing_';
    lines.push(`- **${f.label}:** ${shown}`);
  }
  for (const [title, list] of [['Observed first-hand', b.observations], ['Claims (reported or generalised)', b.claims], ['Assumptions (guesses about cause or fix)', b.assumptions]]) {
    lines.push('', `## ${title}`);
    lines.push(...(list.length ? list.map((st) => `- ${st.text} _(${st.field})_`) : ['- none']));
  }
  lines.push('', '## Gaps');
  lines.push(...(b.gaps.length ? b.gaps.map((g) => `- ${FIELD_BY_KEY[g.field].label}: ${g.reason}`) : ['- none']));
  return lines.join('\n');
}
