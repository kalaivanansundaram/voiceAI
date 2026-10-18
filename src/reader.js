// Turns the starting input into text. Plain text passes through. A public
// http(s) link is read (via Firecrawl when FIRECRAWL_API_KEY is set, otherwise
// a plain fetch). Private, local, or broken links stop safely with a clear error.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class InputError extends Error {}

const MAX_CHARS = 8000;
const URL_ONLY = /^\s*https?:\/\/\S+\s*$/i;

export async function readStartingInput(raw) {
  const input = String(raw ?? '').trim();
  if (!input) throw new InputError('The starting input is empty. Ask the person to describe the problem in their own words.');
  if (!URL_ONLY.test(input)) return { text: input.slice(0, MAX_CHARS), source_url: null };

  const url = new URL(input);
  await assertPublicHost(url.hostname);
  const text = process.env.FIRECRAWL_API_KEY ? await viaFirecrawl(url) : await viaFetch(url);
  if (!text || text.length < 20) throw new InputError('The link opened but had no readable text. Ask the person to describe the problem instead.');
  return { text: text.slice(0, MAX_CHARS), source_url: url.href };
}

function isPrivateAddress(ip) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function assertPublicHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try {
    addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  } catch {
    throw new InputError(`Could not find the website "${host}". Ask the person to check the link or describe the problem instead.`);
  }
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    throw new InputError('That link points to a private or local address, so it was not opened. Ask the person to describe the problem instead.');
  }
}

async function viaFetch(url, hops = 0) {
  let res;
  try {
    res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'MapplsProblemIntake/1.0' } });
  } catch {
    throw new InputError('The link did not respond in time. Ask the person to describe the problem instead.');
  }
  if (res.status >= 300 && res.status < 400 && res.headers.get('location') && hops < 3) {
    const next = new URL(res.headers.get('location'), url);
    await assertPublicHost(next.hostname);
    return viaFetch(next, hops + 1);
  }
  if (res.status === 401 || res.status === 403) throw new InputError('That page is private or needs a login, so it was not read. Ask the person to describe the problem instead.');
  if (!res.ok) throw new InputError(`The link returned an error (${res.status}). Ask the person to describe the problem instead.`);
  const html = await res.text();
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function viaFirecrawl(url) {
  let res;
  try {
    res = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
      body: JSON.stringify({ url: url.href, formats: ['markdown'], onlyMainContent: true }),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new InputError('The page reader did not respond in time. Ask the person to describe the problem instead.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.markdown) throw new InputError('The page could not be read. Ask the person to describe the problem instead.');
  return body.data.markdown;
}
