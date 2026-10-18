// Tool definitions the agent can call, in the OpenAI-style function format that
// Sarvam chat completions accepts. The same list is exported to
// voice/tools.json for any hosted voice provider.

import { FIELD_KEYS, CATEGORIES, STATEMENT_KINDS } from './fields.js';

const sessionId = { type: 'string', description: 'The session_id returned by start_intake.' };
const field = { type: 'string', enum: FIELD_KEYS, description: 'Which brief field this is about.' };

const fn = (name, description, properties, required) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});

export const TOOLS = [
  fn('start_intake',
    'Start a new saved intake from what the person first said (or a public link they gave). Call once, at the start. Returns session_id, a 6-digit resume_code, what is already known, and the next question.',
    { starting_input: { type: 'string', description: 'The person\'s opening description of the problem, in their words (translated to English if needed), or one public http(s) link.' } },
    ['starting_input']),
  fn('resume_intake',
    'Re-open a paused or earlier intake using the 6-digit resume code the person reads out. Returns the same next question they stopped at.',
    { resume_code: { type: 'string', description: 'Six digits.' } },
    ['resume_code']),
  fn('get_status', 'Get the saved progress and the next step for a session. Use if unsure what to ask next.', { session_id: sessionId }, ['session_id']),
  fn('save_answer',
    'Save what the person said for one field (also used to change an earlier answer). Split their answer into short statements and label each one.',
    {
      session_id: sessionId,
      field,
      value: { type: 'string', description: `Their answer in English, faithful to what they said. For field "category" use one of: ${Object.keys(CATEGORIES).join(', ')}.` },
      statements: {
        type: 'array',
        description: 'Their answer split into short statements. observation = they saw or measured it themselves; claim = reported by others or a generalisation like "always"/"everyone"; assumption = a guess about cause or fix.',
        items: {
          type: 'object',
          properties: { text: { type: 'string' }, kind: { type: 'string', enum: STATEMENT_KINDS } },
          required: ['text', 'kind'],
          additionalProperties: false,
        },
      },
    },
    ['session_id', 'field', 'value']),
  fn('suggest_answer',
    'Propose an answer for a still-open field from facts the person already gave. It is NOT saved as their answer until they confirm it with confirm_suggestion.',
    { session_id: sessionId, field, value: { type: 'string' }, basis: { type: 'string', description: 'Which earlier statement this comes from.' } },
    ['session_id', 'field', 'value', 'basis']),
  fn('confirm_suggestion', 'The person said a suggested answer is right. Only call right after they clearly agree.', { session_id: sessionId, field }, ['session_id', 'field']),
  fn('mark_unknown', 'The person does not know or does not want to say. Keeps the gap visible in the brief instead of guessing.', { session_id: sessionId, field, reason: { type: 'string' } }, ['session_id', 'field', 'reason']),
  fn('pause_intake', 'The person wants to stop for now. Saves progress; read them the resume_code from the result.', { session_id: sessionId }, ['session_id']),
  fn('get_preview', 'Get the full brief to read back for final review. Returns version — pass it unchanged to finalize_intake.', { session_id: sessionId }, ['session_id']),
  fn('finalize_intake',
    'Only after reading the latest preview aloud and the person explicitly says approve, or explicitly says cancel. Approving saves the brief for the Mappls team; it does not send anything to anyone.',
    {
      session_id: sessionId,
      decision: { type: 'string', enum: ['approve', 'cancel'] },
      preview_version: { type: 'integer', description: 'The version from the get_preview you read aloud.' },
    },
    ['session_id', 'decision', 'preview_version']),
];

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);
