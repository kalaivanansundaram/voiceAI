// Thin client for the three Sarvam APIs this agent uses:
// speech-to-text (saaras), chat completions with tools (sarvam-105b-conversations),
// and text-to-speech (bulbul). The key is read from SARVAM_API_KEY only.

const BASE = 'https://api.sarvam.ai';
const TTS_LANGUAGES = new Set(['bn-IN', 'en-IN', 'gu-IN', 'hi-IN', 'kn-IN', 'ml-IN', 'mr-IN', 'od-IN', 'pa-IN', 'ta-IN', 'te-IN']);

export class SarvamError extends Error {}

function key() {
  const k = process.env.SARVAM_API_KEY;
  if (!k) throw new SarvamError('SARVAM_API_KEY is not set. Add it to .env locally, or to the Vercel project environment variables.');
  return k;
}

export const sarvamConfigured = () => Boolean(process.env.SARVAM_API_KEY);

async function check(res, what) {
  if (res.ok) return res.json();
  const body = await res.json().catch(() => ({}));
  const msg = body?.error?.message || res.statusText;
  if (res.status === 429) throw new SarvamError(`Sarvam ${what}: rate limit or credit exhausted (${msg}).`);
  if (res.status === 403) throw new SarvamError(`Sarvam ${what}: the API key was rejected (${msg}).`);
  throw new SarvamError(`Sarvam ${what} failed (${res.status}): ${msg}`);
}

// translate: true returns an English translation (saaras:v3 translate mode) instead of the native transcript.
export async function transcribe(audio, mimeType = 'audio/webm', { translate = false } = {}) {
  const form = new FormData();
  const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'm4a' : mimeType.includes('wav') ? 'wav' : /mpeg|mp3/.test(mimeType) ? 'mp3' : 'webm';
  form.append('file', new Blob([audio], { type: mimeType.split(';')[0] }), `turn.${ext}`);
  if (translate) {
    form.append('model', 'saaras:v3');
    form.append('mode', 'translate');
  } else {
    form.append('model', process.env.SARVAM_STT_MODEL || 'saaras:v4');
    form.append('keyterms', JSON.stringify(['Mappls', 'MapmyIndia', 'ETA', 'navigation', 'PIN code']));
  }
  form.append('language_code', 'unknown');
  const res = await fetch(`${BASE}/speech-to-text`, {
    method: 'POST',
    headers: { 'api-subscription-key': key() },
    body: form,
    signal: AbortSignal.timeout(30000),
  });
  const data = await check(res, 'speech-to-text');
  return { transcript: data.transcript ?? '', language_code: data.language_code ?? null };
}

export async function chat(messages, tools) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-subscription-key': key(), authorization: `Bearer ${key()}` },
    body: JSON.stringify({
      model: process.env.SARVAM_CHAT_MODEL || 'sarvam-105b-conversations',
      messages,
      tools,
      temperature: 0.2,
      reasoning_effort: 'low',
      max_tokens: 2048,
    }),
    signal: AbortSignal.timeout(45000),
  });
  const data = await check(res, 'chat');
  const choice = data.choices?.[0];
  if (!choice?.message) throw new SarvamError('Sarvam chat returned no message.');
  return choice;
}

export async function speak(text, languageCode) {
  const language_code = TTS_LANGUAGES.has(languageCode) ? languageCode : 'en-IN';
  const res = await fetch(`${BASE}/text-to-speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'api-subscription-key': key() },
    body: JSON.stringify({
      text: String(text).slice(0, 2400),
      language_code,
      model: process.env.SARVAM_TTS_MODEL || 'bulbul:v3',
      speaker: process.env.SARVAM_TTS_SPEAKER || 'simran',
      pace: 1.05,
      output_audio_codec: 'mp3',
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await check(res, 'text-to-speech');
  return { audio_base64: (data.audios || []).join(''), mime: 'audio/mpeg', language_code };
}
