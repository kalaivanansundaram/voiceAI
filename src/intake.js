// The intake workflow. Every tool the agent can call is a method here; each
// returns plain JSON including what to ask next, so the agent never has to
// remember progress itself.

import { randomUUID, randomInt } from 'node:crypto';
import { FIELDS, FIELD_KEYS, FIELD_BY_KEY, CATEGORIES, STATEMENT_KINDS } from './fields.js';
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
    if (!v) throw new IntakeError('EMPTY', 'The answer is empty. Ask the question again, or use mark_unknown if they do not know.');
    if (field === 'category' && !CATEGORIES[v]) {
      throw new IntakeError('BAD_CATEGORY', `category must be one of: ${Object.keys(CATEGORIES).join(', ')}.`);
    }
    return v.slice(0, 2000);
  }

  async function answerMap(sessionId) {
    return Object.fromEntries((await store.getAnswers(sessionId)).map((a) => [a.field, a]));
  }

  async function setAnswer(s, field, value, status, basis) {
    await store.updateAnswer(s.id, field, { value, status, basis: basis ?? null, updated_at: now() });
  }

  // Every content change bumps the version, so an approval always matches the exact preview read aloud.
  async function bump(s) {
    s.version += 1;
    await store.updateSession(s.id, { version: s.version, updated_at: now() });
  }

  // The single source of truth for "what should the agent say next".
  function nextStep(s, answers) {
    if (s.status === 'paused') return { type: 'paused', say: `Your progress is saved. Your resume code is ${s.resume_code.split('').join(' ')}.` };
    if (s.status === 'approved') return { type: 'done', say: 'The brief is approved and saved for the Mappls team. Nothing else was sent.' };
    if (s.status === 'cancelled') return { type: 'done', say: 'The intake was cancelled. Nothing was sent.' };
    for (const f of FIELDS) {
      const a = answers[f.key];
      if (a.status === 'missing') return { type: 'ask', field: f.key, question: f.question };
      if (a.status === 'suggested') {
        const shown = f.key === 'category' ? CATEGORIES[a.value].label : a.value;
        return {
          type: 'confirm',
          field: f.key,
          suggestion: a.value,
          question: `From what you said, I have noted ${f.label.toLowerCase()} as: "${shown}". Is that right, or would you like to change it?`,
        };
      }
    }
    return { type: 'review', say: 'All questions are covered. Call get_preview, read it back, and ask: approve, change something, or cancel?' };
  }

  function progress(answers) {
    const done = FIELDS.filter((f) => ['answered', 'unknown'].includes(answers[f.key].status)).length;
    return `${done}/${FIELDS.length}`;
  }

  function snapshot(s, answers) {
    return {
      session_id: s.id,
      resume_code: s.resume_code,
      status: s.status,
      version: s.version,
      progress: progress(answers),
      next: nextStep(s, answers),
    };
  }

  // After any change: move between intake and review depending on whether gaps remain.
  async function settle(s) {
    const answers = await answerMap(s.id);
    const step = nextStep(s, answers);
    let status = s.status;
    if (status === 'intake' && step.type === 'review') status = 'review';
    if (status === 'review' && step.type !== 'review') status = 'intake';
    if (status !== s.status) {
      s.status = status;
      await store.updateSession(s.id, { status, updated_at: now() });
    }
    return snapshot(s, answers);
  }

  async function replaceStatements(s, field, value, statements) {
    await store.supersedeStatements(s.id, field);
    const list = (Array.isArray(statements) && statements.length ? statements : classifyStatements(value))
      .filter((st) => st && String(st.text ?? '').trim())
      .map((st) => ({ text: String(st.text).trim().slice(0, 500), kind: STATEMENT_KINDS.includes(st.kind) ? st.kind : 'claim' }));
    await store.insertStatements(list.map((st) => ({ session_id: s.id, field, ...st })));
    return list;
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

      // Organise: what the starting input already tells us becomes a suggestion
      // the person must confirm. Everything else stays visibly missing.
      const problem = read.text.length > 400 ? `${read.text.slice(0, 400)}…` : read.text;
      const cat = guessCategory(read.text);
      await store.insertAnswers(FIELD_KEYS.map((field) => {
        if (field === 'problem') return { session_id: s.id, field, value: problem, status: 'suggested', basis: 'from starting input', updated_at: t };
        if (field === 'category' && cat) return { session_id: s.id, field, value: cat, status: 'suggested', basis: 'keyword match on starting input', updated_at: t };
        return { session_id: s.id, field, value: null, status: 'missing', basis: null, updated_at: t };
      }));
      const suggestions = cat ? ['problem', 'category'] : ['problem'];
      await log(s.id, 'started', { source_url: read.source_url, suggestions });
      return {
        ...(await settle(s)),
        organised: { known_from_input: suggestions, missing: FIELD_KEYS.filter((k) => !suggestions.includes(k)) },
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
      const current = (await answerMap(s.id))[field];
      if (current.status === 'answered') {
        throw new IntakeError('ALREADY_ANSWERED', 'The person already answered this. Use save_answer only if they ask to change it.');
      }
      await setAnswer(s, field, normaliseValue(field, value), 'suggested', String(basis ?? '').slice(0, 300) || null);
      await bump(s);
      await log(s.id, 'suggested', { field, value, basis });
      return settle(s);
    },

    async save_answer({ session_id, field, value, statements }) {
      checkField(field);
      const s = await writable(session_id);
      const v = normaliseValue(field, value);
      const previous = (await answerMap(s.id))[field];
      await setAnswer(s, field, v, 'answered', null);
      const labelled = field === 'category' ? [] : await replaceStatements(s, field, v, statements);
      await bump(s);
      await log(s.id, previous.status === 'answered' ? 'revised' : 'answered', { field, from: previous.value, to: v });
      return { ...(await settle(s)), saved: { field, value: v, statements: labelled } };
    },

    // Only acts on a pending suggestion, so "confirm" said twice never skips a question.
    async confirm_suggestion({ session_id, field }) {
      checkField(field);
      const s = await writable(session_id);
      const a = (await answerMap(s.id))[field];
      if (a.status !== 'suggested') {
        return { ...snapshot(s, await answerMap(s.id)), note: `Nothing to confirm for ${field} (status: ${a.status}). Follow "next".` };
      }
      await setAnswer(s, field, a.value, 'answered', a.basis);
      if (field !== 'category') await replaceStatements(s, field, a.value);
      await bump(s);
      await log(s.id, 'confirmed', { field, value: a.value });
      return settle(s);
    },

    async mark_unknown({ session_id, field, reason }) {
      checkField(field);
      const s = await writable(session_id);
      await setAnswer(s, field, null, 'unknown', String(reason || 'person does not know').slice(0, 300));
      await store.supersedeStatements(s.id, field);
      await bump(s);
      await log(s.id, 'unknown', { field, reason });
      return settle(s);
    },

    async pause_intake({ session_id }) {
      const s = await writable(session_id);
      await store.updateSession(s.id, { status: 'paused', paused_from: s.status, updated_at: now() });
      await log(s.id, 'paused', {});
      return snapshot({ ...s, status: 'paused' }, await answerMap(s.id));
    },

    async resume_intake({ resume_code, session_id }) {
      const s = resume_code
        ? await store.getSessionByCode(String(resume_code).replace(/\D/g, ''))
        : await store.getSession(String(session_id ?? ''));
      if (!s) throw new IntakeError('NOT_FOUND', 'That resume code was not found. Ask the person to read it again, or start a new intake.');
      if (s.status === 'paused') {
        s.status = s.paused_from || 'intake';
        await store.updateSession(s.id, { status: s.status, paused_from: null, updated_at: now() });
        await log(s.id, 'resumed', {});
      }
      return snapshot(s, await answerMap(s.id));
    },

    async get_preview({ session_id }) {
      const s = await load(session_id);
      const answers = await answerMap(s.id);
      const statements = await store.getStatements(s.id);
      const pending = FIELDS.filter((f) => ['missing', 'suggested'].includes(answers[f.key].status)).map((f) => f.key);
      return {
        ...snapshot(s, answers),
        ready_to_approve: pending.length === 0 && s.status === 'review',
        still_pending: pending,
        brief: buildBrief(s, answers, statements),
        brief_markdown: briefMarkdown(s, answers, statements),
      };
    },

    async finalize_intake({ session_id, decision, preview_version }) {
      const s = await writable(session_id);
      if (decision === 'cancel') {
        await store.updateSession(s.id, { status: 'cancelled', updated_at: now() });
        await log(s.id, 'cancelled', {});
        return snapshot({ ...s, status: 'cancelled' }, await answerMap(s.id));
      }
      if (decision !== 'approve') throw new IntakeError('BAD_DECISION', 'decision must be "approve" or "cancel". To revise, call save_answer.');
      if (s.status !== 'review') throw new IntakeError('NOT_READY', 'Some questions are still open. Finish them (or mark them unknown) first.');
      if (Number(preview_version) !== s.version) {
        throw new IntakeError('STALE_PREVIEW', `The brief changed since that preview (now version ${s.version}). Call get_preview and read it back again before approving.`);
      }
      await store.updateSession(s.id, { status: 'approved', approved_version: s.version, updated_at: now() });
      await log(s.id, 'approved', { version: s.version });
      return { ...snapshot({ ...s, status: 'approved' }, await answerMap(s.id)), approved_version: s.version };
    },

    // For the UI; not offered to the agent.
    async history({ session_id }) {
      const s = await load(session_id);
      return (await store.getEvents(s.id)).map((e) => ({ ...e, payload: JSON.parse(e.payload || '{}') }));
    },
  };
}

function buildBrief(s, answers, statements) {
  const cat = answers.category.status === 'answered' ? answers.category.value : null;
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
    const shown = a.status === 'unknown' ? `_unknown — ${a.basis}_` : a.status === 'answered' ? (f.key === 'category' ? CATEGORIES[a.value].label : a.value) : `_${a.status}_`;
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
