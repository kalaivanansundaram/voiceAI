// HTTP routes, shared by the local server (server.js) and the Vercel function (api/index.js).
//
//   GET  /api/config               what is configured (no secrets)
//   POST /api/tools/:name          call one intake tool directly (guided mode, hosted voice providers)
//   POST /api/agent/text           one typed turn with the Sarvam agent
//   POST /api/agent/voice          one spoken turn: Sarvam STT -> agent -> Sarvam TTS
//   GET  /api/brief/:session_id    live brief + change history for the side panel

import { timingSafeEqual } from 'node:crypto';
import { openStore } from './store.js';
import { createIntake, IntakeError } from './intake.js';
import { agentTurn } from './agent.js';
import { transcribe, speak, sarvamConfigured, SarvamError } from './sarvam.js';
import { TOOL_NAMES } from './tools.js';
import { FIELDS, CATEGORIES } from './fields.js';

let intakePromise;
const getIntake = () =>
  (intakePromise ??= openStore()
    .then((store) => ({ store, intake: createIntake(store) }))
    .catch((err) => {
      intakePromise = null; // retry on the next request instead of caching the failure
      throw new IntakeError('STORE', err.message);
    }));

const MAX_BODY = 4 * 1024 * 1024; // Vercel's request limit is 4.5 MB

async function readJson(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new IntakeError('TOO_LARGE', 'Request too large. Keep each spoken turn under about a minute.');
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new IntakeError('BAD_JSON', 'Request body was not valid JSON.');
  }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

// Optional shared passcode so a public link cannot burn Sarvam credit.
function allowed(req) {
  const expected = process.env.ACCESS_CODE;
  if (!expected) return true;
  const given = String(req.headers['x-access-code'] ?? '');
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '');
  try {
    if (req.method === 'GET' && path === '/api/config') {
      const { store } = await getIntake();
      return send(res, 200, {
        sarvam: sarvamConfigured(),
        store: store.kind,
        access_required: Boolean(process.env.ACCESS_CODE),
        fields: FIELDS.map(({ key, label, question }) => ({ key, label, question })),
        categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])),
      });
    }

    if (!allowed(req)) return send(res, 401, { error: { code: 'ACCESS_CODE', message: 'Enter the access code to use this demo.' } });
    const { intake } = await getIntake();

    let m = path.match(/^\/api\/tools\/([a-z_]+)$/);
    if (req.method === 'POST' && m) {
      if (!TOOL_NAMES.includes(m[1])) return send(res, 404, { error: { code: 'UNKNOWN_TOOL', message: `No tool named ${m[1]}.` } });
      return send(res, 200, await intake[m[1]](await readJson(req)));
    }

    m = path.match(/^\/api\/brief\/([\w-]+)$/);
    if (req.method === 'GET' && m) {
      const preview = await intake.get_preview({ session_id: m[1] });
      return send(res, 200, { ...preview, history: await intake.history({ session_id: m[1] }) });
    }

    if (req.method === 'POST' && path === '/api/agent/text') {
      const body = await readJson(req);
      return send(res, 200, await agentTurn(intake, { messages: body.messages, text: body.text }));
    }

    if (req.method === 'POST' && path === '/api/agent/voice') {
      const body = await readJson(req);
      const audio = Buffer.from(String(body.audio_base64 ?? ''), 'base64');
      if (audio.length < 1000) throw new IntakeError('EMPTY', 'Nothing was recorded. Hold the button a little longer.');
      const heard = await transcribe(audio, String(body.mime || 'audio/webm'));
      if (!heard.transcript.trim()) {
        const reply = 'Sorry, I could not hear that clearly. Could you say it again?';
        return send(res, 200, { heard, reply, messages: body.messages ?? [], trace: [], session_id: null, speech: await speak(reply, 'en-IN') });
      }
      // Non-English speech: also get an English translation so tool arguments (the brief) stay in English.
      if (heard.language_code && heard.language_code !== 'en-IN') {
        heard.english = (await transcribe(audio, String(body.mime || 'audio/webm'), { translate: true }).catch(() => null))?.transcript || null;
      }
      const turn = await agentTurn(intake, { messages: body.messages, text: heard.transcript, english: heard.english, language_code: heard.language_code });
      const speech = await speak(turn.reply, heard.language_code);
      return send(res, 200, { heard, ...turn, speech });
    }

    return send(res, 404, { error: { code: 'NOT_FOUND', message: 'No such route.' } });
  } catch (err) {
    if (err instanceof IntakeError) return send(res, 400, { error: { code: err.code, message: err.message } });
    if (err instanceof SarvamError) return send(res, 502, { error: { code: 'SARVAM', message: err.message } });
    console.error(err);
    if (err.expose) return send(res, 503, { error: { code: 'SETUP', message: err.message } });
    return send(res, 500, { error: { code: 'SERVER', message: 'Something went wrong on the server. Your saved progress is safe; try again.' } });
  }
}
