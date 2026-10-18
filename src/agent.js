// One conversational turn: the Sarvam chat model reads the conversation, calls
// intake tools as needed, and ends with a short spoken reply. The browser keeps
// the message history and sends it back each turn, so this works on stateless
// serverless functions; the saved intake itself lives in the store.

import { chat } from './sarvam.js';
import { TOOLS, TOOL_NAMES } from './tools.js';
import { SYSTEM_PROMPT } from './prompt.js';
import { IntakeError } from './intake.js';

const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY = 80;

// Only trust the shapes we produce ourselves.
function cleanHistory(messages) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.role === 'user' && typeof m.content === 'string') out.push({ role: 'user', content: m.content.slice(0, 4000) });
    else if (m?.role === 'assistant') {
      const msg = { role: 'assistant', content: typeof m.content === 'string' ? m.content.slice(0, 4000) : '' };
      if (Array.isArray(m.tool_calls)) {
        msg.tool_calls = m.tool_calls
          .filter((c) => TOOL_NAMES.includes(c?.function?.name))
          .map((c) => ({ id: String(c.id), type: 'function', function: { name: c.function.name, arguments: String(c.function.arguments ?? '{}') } }));
      }
      out.push(msg);
    } else if (m?.role === 'tool' && m.tool_call_id) out.push({ role: 'tool', tool_call_id: String(m.tool_call_id), content: String(m.content ?? '').slice(0, 8000) });
  }
  // Trim from the front, but always restart at a user message so tool results never lose their call.
  let start = Math.max(0, out.length - MAX_HISTORY);
  while (start < out.length && out[start].role !== 'user') start++;
  return out.slice(start);
}

async function runTool(intake, name, rawArgs) {
  let args;
  try {
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
  } catch {
    return { ok: false, error: { code: 'BAD_ARGUMENTS', message: 'Tool arguments were not valid JSON. Try the call again.' } };
  }
  if (!TOOL_NAMES.includes(name)) return { ok: false, error: { code: 'UNKNOWN_TOOL', message: `No tool named ${name}.` } };
  try {
    return { ok: true, result: await intake[name](args) };
  } catch (err) {
    if (err instanceof IntakeError) return { ok: false, error: { code: err.code, message: err.message } };
    throw err;
  }
}

export async function agentTurn(intake, { messages, text, language_code }) {
  const history = cleanHistory(messages);
  const userText = String(text ?? '').trim();
  if (!userText) throw new IntakeError('EMPTY', 'Nothing was heard. Please try again.');
  const note = language_code && language_code !== 'en-IN' ? ` [spoken; detected language ${language_code}]` : '';
  history.push({ role: 'user', content: userText + note });

  const trace = [];
  let sessionId = null;
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const choice = await chat([{ role: 'system', content: SYSTEM_PROMPT }, ...history], TOOLS);
    const msg = choice.message;
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      const reply = String(msg.content || '').trim() || 'Sorry, could you say that again?';
      history.push({ role: 'assistant', content: reply });
      return { reply, messages: history, trace, session_id: sessionId };
    }
    history.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      const outcome = await runTool(intake, call.function?.name, call.function?.arguments);
      const sid = outcome.result?.session_id;
      if (sid) sessionId = sid;
      trace.push({ tool: call.function?.name, args: safeParse(call.function?.arguments), ok: outcome.ok, error: outcome.error, next: outcome.result?.next });
      history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(outcome.ok ? outcome.result : { error: outcome.error }) });
    }
  }
  const reply = 'Sorry, I got stuck there. Could you repeat that?';
  history.push({ role: 'assistant', content: reply });
  return { reply, messages: history, trace, session_id: sessionId };
}

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return s; }
}
