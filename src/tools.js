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
  fn('save_answers',
    'Save everything the person just said, in ONE call: one entry per field their words cover (any fields, not only the ones just asked). Also used to change earlier answers.',
    {
      session_id: sessionId,
      answers: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            field,
            value: { type: 'string', description: `Their answer for this field in English, faithful to what they said. For "category" use one of: ${Object.keys(CATEGORIES).join(', ')}.` },
            statements: {
              type: 'array',
              description: 'This part of their answer as short statements. observation = they saw or measured it themselves; claim = heard from others or a generalisation like "always"/"everyone"; assumption = a guess about cause or fix.',
              items: {
                type: 'object',
                properties: { text: { type: 'string' }, kind: { type: 'string', enum: STATEMENT_KINDS } },
                required: ['text', 'kind'],
                additionalProperties: false,
              },
            },
          },
          required: ['field', 'value'],
          additionalProperties: false,
        },
      },
    },
    ['session_id', 'answers']),
  fn('suggest_answer',
    'Record your best guess for a field the person did not state directly (especially category). It is marked as a guess and is read back for confirmation in the final review.',
    { session_id: sessionId, field, value: { type: 'string' }, basis: { type: 'string', description: 'Which earlier statement this comes from.' } },
    ['session_id', 'field', 'value', 'basis']),
  fn('confirm_suggestion', 'The person explicitly said one guessed answer is right (before final approval). Approving the read-back confirms all guesses anyway.', { session_id: sessionId, field }, ['session_id', 'field']),
  fn('mark_unknown', 'The person does not know or does not want to say. Keeps the gap visible in the brief instead of guessing.', { session_id: sessionId, field, reason: { type: 'string' } }, ['session_id', 'field', 'reason']),
  fn('pause_intake', 'The person wants to stop for now. Saves progress; read them the resume_code from the result.', { session_id: sessionId }, ['session_id']),
  fn('get_preview', 'Get the full brief to read back for final review. Returns version — pass it unchanged to finalize_intake.', { session_id: sessionId }, ['session_id']),
  fn('finalize_intake',
    'Only after reading the latest preview aloud and the person explicitly says approve, or explicitly says cancel. Approving confirms the guessed items that were read back and saves the brief for the Mappls team; it does not send anything to anyone.',
    {
      session_id: sessionId,
      decision: { type: 'string', enum: ['approve', 'cancel'] },
      preview_version: { type: 'integer', description: 'The version from the get_preview you read aloud.' },
    },
    ['session_id', 'decision', 'preview_version']),
];

export const TOOL_NAMES = TOOLS.map((t) => t.function.name);
